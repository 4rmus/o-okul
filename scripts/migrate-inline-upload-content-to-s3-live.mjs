import { createHash } from "node:crypto";
import { Socket } from "node:net";
import { lstat, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import pg from "pg";

const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://migration:migration@localhost:5432/o_okul";
const approval = process.env.INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED;
const batchSize = Number(process.env.INLINE_UPLOAD_CONTENT_MIGRATION_BATCH_SIZE ?? 100);
const reportFile = process.env.INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE;

const subjects = [
  {
    label: "homework_material_files",
    table: "HomeworkMaterialFile",
    parentColumn: "materialId",
    prefix: "homework-material-files",
  },
  {
    label: "support_ticket_attachments",
    table: "SupportTicketAttachment",
    parentColumn: "ticketId",
    prefix: "support-ticket-attachments",
  },
];

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
  throw new Error("INLINE_UPLOAD_CONTENT_MIGRATION_BATCH_SIZE must be an integer between 1 and 1000.");
}

const resolvedReportFile = reportFile ? await validateReportFile(reportFile) : undefined;
const postgresUrl = new URL(directDatabaseUrl);
await assertPort("Postgres", postgresUrl.hostname, Number(postgresUrl.port || 5432), "pnpm db:migrate");

const pool = new pg.Pool({ connectionString: directDatabaseUrl });
const client = await pool.connect();
let s3Client;
let s3Bucket;

try {
  await client.query("SELECT set_config('app.bypass_rls', 'true', false)");
  const before = await auditInlineUploadContent();

  if (approval !== "true") {
    const report = {
      status: "DRY_RUN",
      approvalRequired: "INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true",
      generatedAt: new Date().toISOString(),
      subjects: before,
    };
    await writeReport(report);
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  await assertPendingContentHashesMatch();
  ({ client: s3Client, bucket: s3Bucket } = await createS3ClientFromEnv());
  const migrated = [];
  for (const subject of subjects) {
    migrated.push(await migrateSubject(subject));
  }

  const after = await auditInlineUploadContent();
  const report = {
    status: "MIGRATED",
    generatedAt: new Date().toISOString(),
    subjects: after,
    migrated,
  };
  await writeReport(report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  client.release();
  await pool.end();
}

async function auditInlineUploadContent() {
  const results = [];
  for (const subject of subjects) {
    const counts = await client.query(
      `SELECT
         count(*)::int AS "totalRows",
         count(*) FILTER (
           WHERE "storageKey" IS NULL
             AND "contentBase64" IS NOT NULL
             AND "contentBase64" <> ''
         )::int AS "pendingRows",
         count(*) FILTER (
           WHERE "storageKey" IS NULL
             AND "contentBase64" IS NOT NULL
             AND "contentBase64" <> ''
             AND "deletedAt" IS NULL
         )::int AS "pendingActiveRows",
         count(*) FILTER (
           WHERE "storageKey" IS NULL
             AND "contentBase64" IS NOT NULL
             AND "contentBase64" <> ''
             AND "deletedAt" IS NOT NULL
         )::int AS "pendingDeletedRows",
         coalesce(sum(length("contentBase64")) FILTER (
           WHERE "storageKey" IS NULL
             AND "contentBase64" IS NOT NULL
             AND "contentBase64" <> ''
         ), 0)::bigint AS "pendingBase64Characters",
         pg_total_relation_size(format('%I', $1::text)::regclass)::bigint AS "tableSizeBytes"
       FROM "${subject.table}"`,
      [subject.table],
    );
    results.push(normalizeSubjectSnapshot(subject.label, counts.rows[0] ?? {}));
  }
  return results;
}

function normalizeSubjectSnapshot(subject, row) {
  return {
    subject,
    totalRows: Number(row.totalRows ?? 0),
    pendingRows: Number(row.pendingRows ?? 0),
    pendingActiveRows: Number(row.pendingActiveRows ?? 0),
    pendingDeletedRows: Number(row.pendingDeletedRows ?? 0),
    pendingBase64Characters: Number(row.pendingBase64Characters ?? 0),
    tableSizeBytes: Number(row.tableSizeBytes ?? 0),
  };
}

async function assertPendingContentHashesMatch() {
  const failures = [];

  for (const subject of subjects) {
    const summary = await countHashMismatches(subject);
    if (summary.mismatchedRows > 0 || summary.invalidBase64Rows > 0) {
      failures.push(summary);
    }
  }

  if (failures.length === 0) return;

  const details = failures
    .map(
      (item) =>
        `${item.subject}: checked=${item.checkedRows}, sha256Mismatch=${item.mismatchedRows}, invalidBase64=${item.invalidBase64Rows}`,
    )
    .join("; ");
  throw new Error(`Inline upload sha256 preflight failed; migration stopped before S3 write/DB update. ${details}`);
}

async function countHashMismatches(subject) {
  let checkedRows = 0;
  let mismatchedRows = 0;
  let invalidBase64Rows = 0;
  let cursorTenantId = "";
  let cursorId = "";

  while (true) {
    const result = await client.query(
      `SELECT "id", "tenantId", "sha256", "contentBase64"
       FROM "${subject.table}"
       WHERE "storageKey" IS NULL
         AND "contentBase64" IS NOT NULL
         AND "contentBase64" <> ''
         AND ("tenantId", "id") > ($2, $3)
       ORDER BY "tenantId", "id"
       LIMIT $1`,
      [batchSize, cursorTenantId, cursorId],
    );

    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      checkedRows += 1;
      try {
        const body = decodeBase64(row.contentBase64, `${subject.label}:pending`);
        if (sha256(body) !== row.sha256) mismatchedRows += 1;
      } catch {
        invalidBase64Rows += 1;
      }
      cursorTenantId = row.tenantId;
      cursorId = row.id;
    }
  }

  return { subject: subject.label, checkedRows, mismatchedRows, invalidBase64Rows };
}

async function migrateSubject(subject) {
  let migratedRows = 0;
  let migratedBytes = 0;

  while (true) {
    const result = await client.query(
      `SELECT "id", "tenantId", "${subject.parentColumn}", "contentType", "sha256", "contentBase64"
       FROM "${subject.table}"
       WHERE "storageKey" IS NULL
         AND "contentBase64" IS NOT NULL
         AND "contentBase64" <> ''
       ORDER BY "tenantId", "id"
       LIMIT $1`,
      [batchSize],
    );

    if (result.rows.length === 0) {
      return { subject: subject.label, migratedRows, migratedBytes };
    }

    for (const row of result.rows) {
      const body = decodeBase64(row.contentBase64, `${subject.label}:pending-row`);
      const actualSha256 = sha256(body);
      if (actualSha256 !== row.sha256) {
        throw new Error(`${subject.label} sha256 mismatch; migration stopped before DB update.`);
      }

      const storageKey = createStorageKey(subject, row);
      await putS3Object(storageKey, body, row.contentType);
      const updated = await client.query(
        `UPDATE "${subject.table}"
         SET "storageKey" = $2,
             "contentBase64" = NULL,
             "updatedAt" = now()
         WHERE "id" = $1
           AND "storageKey" IS NULL
           AND "contentBase64" IS NOT NULL
           AND "contentBase64" <> ''
           AND "sha256" = $3`,
        [row.id, storageKey, row.sha256],
      );

      if (updated.rowCount !== 1) {
        if (!(await hasDbStorageKeyReference(storageKey))) {
          await deleteS3Object(storageKey);
        }
        throw new Error(`${subject.label} DB update failed after S3 put; S3 object cleanup was guarded by DB references.`);
      }

      migratedRows += 1;
      migratedBytes += body.length;
    }
  }
}

async function createS3ClientFromEnv() {
  const bucket = process.env.S3_BUCKET?.trim();
  if (!bucket) {
    throw new Error("S3_BUCKET is required when INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true.");
  }

  const { S3Client } = await import("@aws-sdk/client-s3");
  return {
    bucket,
    client: new S3Client({
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION || "us-east-1",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials:
        process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.S3_ACCESS_KEY_ID,
              secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    }),
  };
}

async function putS3Object(key, body, contentType) {
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  await s3Client.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

async function deleteS3Object(key) {
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  await s3Client.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }));
}

async function hasDbStorageKeyReference(storageKey) {
  const result = await client.query(
    `SELECT (
       EXISTS (SELECT 1 FROM "HomeworkMaterialFile" WHERE "storageKey" = $1)
       OR EXISTS (SELECT 1 FROM "SupportTicketAttachment" WHERE "storageKey" = $1)
     ) AS "referenced"`,
    [storageKey],
  );
  return result.rows[0]?.referenced === true;
}

function createStorageKey(subject, row) {
  return [subject.prefix, row.tenantId, row[subject.parentColumn], row.sha256, "source"].map(encodeURIComponent).join("/");
}

function decodeBase64(value, label) {
  const normalized = String(value).trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    throw new Error(`${label} contentBase64 is not valid base64.`);
  }
  return Buffer.from(normalized, "base64");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeReport(report) {
  if (!resolvedReportFile) return;
  await assertExistingFileArtifact(resolvedReportFile);
  await writeFile(resolvedReportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await assertExistingFileArtifact(resolvedReportFile);
}

async function validateReportFile(path) {
  const resolvedPath = resolve(path);
  if (isLocalTempPath(resolvedPath)) {
    throw new Error("INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE lokal temp path olmamalı.");
  }

  await assertParentPathAllowed(dirname(resolvedPath));
  await assertExistingFileArtifact(resolvedPath);
  return resolvedPath;
}

async function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);

    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE parent dizini symlink olmayan dizin olmalı.");
    }
  }
}

async function assertExistingFileArtifact(path) {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE symlink olmayan file artifact olmalı.");
  }
}

function isLocalTempPath(path) {
  const normalized = path.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

async function assertPort(label, host, port, hint) {
  await new Promise((resolve, reject) => {
    const socket = new Socket();
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`${label} is not reachable at ${host}:${port}. Run ${hint} first.`));
    });
    socket.once("error", () => {
      socket.destroy();
      reject(new Error(`${label} is not reachable at ${host}:${port}. Run ${hint} first.`));
    });
    socket.connect(port, host);
  });
}
