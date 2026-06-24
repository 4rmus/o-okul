import { createHash } from "node:crypto";
import { Socket } from "node:net";
import { lstat, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import pg from "pg";

const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://migration:migration@localhost:5432/uzman_hocam";
const approval = process.env.INLINE_UPLOAD_CONTENT_SHA_REPAIR_APPROVED;
const batchSize = Number(process.env.INLINE_UPLOAD_CONTENT_SHA_REPAIR_BATCH_SIZE ?? 100);
const outputPath = readOption("--output") ?? process.env.INLINE_UPLOAD_CONTENT_SHA_REPAIR_OUTPUT;
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
  throw new Error("INLINE_UPLOAD_CONTENT_SHA_REPAIR_BATCH_SIZE must be an integer between 1 and 1000.");
}

const resolvedOutputPath = outputPath ? await validateOutputFile(outputPath) : undefined;
const postgresUrl = new URL(directDatabaseUrl);
await assertPort("Postgres", postgresUrl.hostname, Number(postgresUrl.port || 5432), "pnpm db:migrate");

const pool = new pg.Pool({ connectionString: directDatabaseUrl });
const client = await pool.connect();

try {
  await client.query("SELECT set_config('app.bypass_rls', 'true', false)");
  const before = [];
  for (const subject of subjects) {
    before.push(await inspectSubject(subject));
  }

  const totalInvalidBase64Rows = before.reduce((sum, item) => sum + item.invalidBase64Rows, 0);
  let repaired = subjects.map((subject) => ({ subject: subject.label, repairedRows: 0 }));

  if (approval === "true" && totalInvalidBase64Rows === 0) {
    repaired = [];
    for (const subject of subjects) {
      repaired.push(await repairSubject(subject));
    }
  }

  const after = [];
  for (const subject of subjects) {
    after.push(await inspectSubject(subject));
  }

  const totalRepairableRows = after.reduce((sum, item) => sum + item.repairableRows, 0);
  const totalAfterInvalidBase64Rows = after.reduce((sum, item) => sum + item.invalidBase64Rows, 0);
  const totalRepairedRows = repaired.reduce((sum, item) => sum + item.repairedRows, 0);
  const gaps = [];

  if (approval !== "true" && before.some((item) => item.repairableRows > 0)) {
    gaps.push("pending_inline_upload_sha_repair_approval_required");
  }
  if (totalAfterInvalidBase64Rows > 0) gaps.push("pending_inline_upload_invalid_base64_repair_required");
  if (approval === "true" && totalRepairableRows > 0) gaps.push("pending_inline_upload_missing_sha256_repair_incomplete");

  const report = {
    result: gaps.length === 0 ? "PASS" : "BLOCKED",
    status: determineStatus({
      approved: approval === "true",
      beforeRepairableRows: before.reduce((sum, item) => sum + item.repairableRows, 0),
      afterRepairableRows: totalRepairableRows,
      invalidBase64Rows: totalAfterInvalidBase64Rows,
      repairedRows: totalRepairedRows,
    }),
    approvalRequired: approval === "true" ? null : "INLINE_UPLOAD_CONTENT_SHA_REPAIR_APPROVED=true",
    environment,
    checkedAt: new Date().toISOString(),
    before,
    repaired,
    after,
    commandsPassed: ["pnpm inline-upload-content:repair-sha"],
    gaps,
  };

  await writeReport(report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  client.release();
  await pool.end();
}

async function inspectSubject(subject) {
  const counts = await client.query(
    `SELECT
       count(*) FILTER (
         WHERE "storageKey" IS NULL
           AND "contentBase64" IS NOT NULL
           AND "contentBase64" <> ''
       )::int AS "pendingRows",
       count(*) FILTER (
         WHERE "storageKey" IS NULL
           AND "contentBase64" IS NOT NULL
           AND "contentBase64" <> ''
           AND "sha256" ~* '^[a-f0-9]{64}$'
       )::int AS "existingSha256Rows",
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
  const repairSummary = await countRepairableRows(subject);

  return {
    ...snapshot,
    ...repairSummary,
  };
}

function normalizeSubjectSnapshot(subject, row) {
  return {
    subject,
    pendingRows: Number(row.pendingRows ?? 0),
    existingSha256Rows: Number(row.existingSha256Rows ?? 0),
    pendingBase64Characters: Number(row.pendingBase64Characters ?? 0),
    tableSizeBytes: Number(row.tableSizeBytes ?? 0),
  };
}

async function countRepairableRows(subject) {
  let checkedRows = 0;
  let repairableRows = 0;
  let invalidBase64Rows = 0;
  let cursorTenantId = "";
  let cursorId = "";

  while (true) {
    const result = await client.query(
      `SELECT "id", "tenantId", "contentBase64"
       FROM "${subject.table}"
       WHERE "storageKey" IS NULL
         AND "contentBase64" IS NOT NULL
         AND "contentBase64" <> ''
         AND ("sha256" IS NULL OR NOT ("sha256" ~* '^[a-f0-9]{64}$'))
         AND ("tenantId", "id") > ($2, $3)
       ORDER BY "tenantId", "id"
       LIMIT $1`,
      [batchSize, cursorTenantId, cursorId],
    );

    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      checkedRows += 1;
      try {
        decodeBase64(row.contentBase64);
        repairableRows += 1;
      } catch {
        invalidBase64Rows += 1;
      }
      cursorTenantId = row.tenantId;
      cursorId = row.id;
    }
  }

  return {
    checkedRows,
    repairableRows,
    invalidBase64Rows,
  };
}

async function repairSubject(subject) {
  let repairedRows = 0;

  while (true) {
    const result = await client.query(
      `SELECT "id", "tenantId", "contentBase64"
       FROM "${subject.table}"
       WHERE "storageKey" IS NULL
         AND "contentBase64" IS NOT NULL
         AND "contentBase64" <> ''
         AND ("sha256" IS NULL OR NOT ("sha256" ~* '^[a-f0-9]{64}$'))
       ORDER BY "tenantId", "id"
       LIMIT $1`,
      [batchSize],
    );

    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      const digest = sha256(decodeBase64(row.contentBase64));
      const updated = await client.query(
        `UPDATE "${subject.table}"
         SET "sha256" = $3,
             "updatedAt" = now()
         WHERE "id" = $1
           AND "tenantId" = $2
           AND "storageKey" IS NULL
           AND "contentBase64" IS NOT NULL
           AND "contentBase64" <> ''
           AND ("sha256" IS NULL OR NOT ("sha256" ~* '^[a-f0-9]{64}$'))`,
        [row.id, row.tenantId, digest],
      );

      if (updated.rowCount === 1) repairedRows += 1;
    }
  }

  return { subject: subject.label, repairedRows };
}

function determineStatus(values) {
  if (values.invalidBase64Rows > 0) return "INVALID_BASE64_FOUND";
  if (!values.approved && values.beforeRepairableRows > 0) return "DRY_RUN_REPAIR_REQUIRED";
  if (values.approved && values.afterRepairableRows > 0) return "REPAIR_INCOMPLETE";
  if (values.approved && values.repairedRows > 0) return "REPAIRED";
  return "NO_REPAIR_REQUIRED";
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

async function writeReport(report) {
  if (!resolvedOutputPath) return;
  await assertExistingFileArtifact(resolvedOutputPath);
  await writeFile(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await assertExistingFileArtifact(resolvedOutputPath);
}

async function validateOutputFile(path) {
  const resolvedPath = resolve(path);
  if (isLocalTempPath(resolvedPath)) {
    throw new Error("INLINE_UPLOAD_CONTENT_SHA_REPAIR_OUTPUT must not be under a local temp path.");
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
      throw new Error("INLINE_UPLOAD_CONTENT_SHA_REPAIR_OUTPUT parent must be a non-symlink directory.");
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
    throw new Error("INLINE_UPLOAD_CONTENT_SHA_REPAIR_OUTPUT must be a non-symlink file artifact.");
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
    throw new Error(`${name} requires a value.`);
  }
  return value;
}
