import { createHash } from "node:crypto";
import { Socket } from "node:net";
import { lstat, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import pg from "pg";

const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://migration:migration@localhost:5432/o_okul";
const batchSize = Number(process.env.INLINE_UPLOAD_CONTENT_HASH_AUDIT_BATCH_SIZE ?? 100);
const outputPath = readOption("--output") ?? process.env.INLINE_UPLOAD_CONTENT_HASH_AUDIT_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";

const subjects = [
  {
    label: "homework_material_files",
    table: "HomeworkMaterialFile",
  },
  {
    label: "support_ticket_attachments",
    table: "SupportTicketAttachment",
  },
];

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
  throw new Error("INLINE_UPLOAD_CONTENT_HASH_AUDIT_BATCH_SIZE must be an integer between 1 and 1000.");
}

const resolvedOutputPath = outputPath ? await validateOutputFile(outputPath) : undefined;
const postgresUrl = new URL(directDatabaseUrl);
await assertPort("Postgres", postgresUrl.hostname, Number(postgresUrl.port || 5432), "pnpm db:migrate");

const pool = new pg.Pool({ connectionString: directDatabaseUrl });
const client = await pool.connect();

try {
  await client.query("SELECT set_config('app.bypass_rls', 'true', false)");
  const subjectReports = [];
  for (const subject of subjects) {
    subjectReports.push(await auditSubject(subject));
  }

  const totalPendingRows = subjectReports.reduce((sum, item) => sum + item.pendingRows, 0);
  const totalMismatchRows = subjectReports.reduce((sum, item) => sum + item.sha256MismatchRows, 0);
  const totalInvalidBase64Rows = subjectReports.reduce((sum, item) => sum + item.invalidBase64Rows, 0);
  const totalMissingSha256Rows = subjectReports.reduce((sum, item) => sum + item.missingSha256Rows, 0);
  const gaps = [];

  if (totalMismatchRows > 0) gaps.push("pending_inline_upload_sha256_mismatch_repair_required");
  if (totalInvalidBase64Rows > 0) gaps.push("pending_inline_upload_invalid_base64_repair_required");
  if (totalMissingSha256Rows > 0) gaps.push("pending_inline_upload_missing_sha256_repair_required");
  if (totalPendingRows > 0 && gaps.length === 0) gaps.push("pending_inline_upload_migration_required");

  const report = {
    result: gaps.length === 0 ? "PASS" : "BLOCKED",
    status: determineStatus({ totalPendingRows, totalMismatchRows, totalInvalidBase64Rows, totalMissingSha256Rows }),
    environment,
    checkedAt: new Date().toISOString(),
    subjects: subjectReports,
    commandsPassed: ["pnpm inline-upload-content:hash-audit"],
    gaps,
  };

  await writeReport(report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  client.release();
  await pool.end();
}

async function auditSubject(subject) {
  const counts = await client.query(
    `SELECT
       count(*) FILTER (
         WHERE "storageKey" IS NULL
           AND "contentBase64" IS NOT NULL
           AND "contentBase64" <> ''
       )::int AS "pendingRows",
       coalesce(sum(length("contentBase64")) FILTER (
         WHERE "storageKey" IS NULL
           AND "contentBase64" IS NOT NULL
           AND "contentBase64" <> ''
       ), 0)::bigint AS "pendingBase64Characters",
       pg_total_relation_size(format('%I', $1::text)::regclass)::bigint AS "tableSizeBytes"
     FROM "${subject.table}"`,
    [subject.table],
  );
  const snapshot = normalizeSubjectSnapshot(subject.label, counts.rows[0] ?? {});
  const hashSummary = await countHashResults(subject);

  return {
    ...snapshot,
    ...hashSummary,
  };
}

function normalizeSubjectSnapshot(subject, row) {
  return {
    subject,
    pendingRows: Number(row.pendingRows ?? 0),
    pendingBase64Characters: Number(row.pendingBase64Characters ?? 0),
    tableSizeBytes: Number(row.tableSizeBytes ?? 0),
  };
}

async function countHashResults(subject) {
  let checkedRows = 0;
  let matchingRows = 0;
  let sha256MismatchRows = 0;
  let invalidBase64Rows = 0;
  let missingSha256Rows = 0;
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
      if (!isSha256(row.sha256)) {
        missingSha256Rows += 1;
      } else {
        try {
          const body = decodeBase64(row.contentBase64);
          if (sha256(body) === row.sha256) {
            matchingRows += 1;
          } else {
            sha256MismatchRows += 1;
          }
        } catch {
          invalidBase64Rows += 1;
        }
      }
      cursorTenantId = row.tenantId;
      cursorId = row.id;
    }
  }

  return {
    checkedRows,
    matchingRows,
    sha256MismatchRows,
    invalidBase64Rows,
    missingSha256Rows,
  };
}

function determineStatus(values) {
  if (values.totalMissingSha256Rows > 0) return "MISSING_SHA256_FOUND";
  if (values.totalInvalidBase64Rows > 0) return "INVALID_BASE64_FOUND";
  if (values.totalMismatchRows > 0) return "HASH_MISMATCH_FOUND";
  if (values.totalPendingRows > 0) return "PENDING_HASHES_MATCH";
  return "NO_PENDING_ROWS";
}

function decodeBase64(value) {
  const normalized = String(value).trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    throw new Error("contentBase64 is not valid base64.");
  }
  return Buffer.from(normalized, "base64");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

async function writeReport(report) {
  if (!resolvedOutputPath) return;
  await assertExistingFileArtifact(resolvedOutputPath);
  await writeFile(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await assertExistingFileArtifact(resolvedOutputPath);
}

async function validateOutputFile(path) {
  const resolvedPath = resolve(path);
  if (isLocalTempPath(resolvedPath)) {
    throw new Error("INLINE_UPLOAD_CONTENT_HASH_AUDIT_OUTPUT lokal temp path olmamalı.");
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
      throw new Error("INLINE_UPLOAD_CONTENT_HASH_AUDIT_OUTPUT parent dizini symlink olmayan dizin olmalı.");
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
    throw new Error("INLINE_UPLOAD_CONTENT_HASH_AUDIT_OUTPUT symlink olmayan file artifact olmalı.");
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
  await new Promise((resolvePromise, reject) => {
    const socket = new Socket();
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolvePromise();
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

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} için değer gerekli.`);
  }
  return value;
}
