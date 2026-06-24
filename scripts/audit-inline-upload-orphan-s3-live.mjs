import { Socket } from "node:net";
import { lstat, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import pg from "pg";

const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://migration:migration@localhost:5432/uzman_hocam";
const outputPath = readOption("--output") ?? process.env.INLINE_UPLOAD_CONTENT_ORPHAN_AUDIT_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";

const subjects = [
  {
    label: "homework_material_files",
    table: "HomeworkMaterialFile",
    prefix: "homework-material-files/",
  },
  {
    label: "support_ticket_attachments",
    table: "SupportTicketAttachment",
    prefix: "support-ticket-attachments/",
  },
];

const resolvedOutputPath = outputPath ? await validateOutputFile(outputPath) : undefined;
const postgresUrl = new URL(directDatabaseUrl);
await assertPort("Postgres", postgresUrl.hostname, Number(postgresUrl.port || 5432), "pnpm db:migrate");

const { client: s3Client, bucket: s3Bucket } = await createS3ClientFromEnv();
const pool = new pg.Pool({ connectionString: directDatabaseUrl });
const client = await pool.connect();

try {
  await client.query("SELECT set_config('app.bypass_rls', 'true', false)");
  const subjectReports = [];
  for (const subject of subjects) {
    subjectReports.push(await auditSubject(subject));
  }

  const totals = subjectReports.reduce(
    (sum, item) => ({
      orphanObjects: sum.orphanObjects + item.orphanObjects,
      invalidKeyObjects: sum.invalidKeyObjects + item.invalidKeyObjects,
      dbReferencedMissingObjects: sum.dbReferencedMissingObjects + item.dbReferencedMissingObjects,
      legacyDbStorageKeyRows: sum.legacyDbStorageKeyRows + item.legacyDbStorageKeyRows,
    }),
    { orphanObjects: 0, invalidKeyObjects: 0, dbReferencedMissingObjects: 0, legacyDbStorageKeyRows: 0 },
  );
  const gaps = [];

  if (totals.orphanObjects > 0) gaps.push("inline_upload_orphan_s3_objects_found");
  if (totals.invalidKeyObjects > 0) gaps.push("inline_upload_invalid_s3_object_keys_found");
  if (totals.dbReferencedMissingObjects > 0) gaps.push("inline_upload_db_referenced_s3_objects_missing");
  if (totals.legacyDbStorageKeyRows > 0) gaps.push("inline_upload_legacy_db_storage_keys_found");

  const report = {
    result: gaps.length === 0 ? "PASS" : "BLOCKED",
    status: determineStatus(totals),
    environment,
    checkedAt: new Date().toISOString(),
    bucketVerified: true,
    subjects: subjectReports,
    commandsPassed: ["pnpm inline-upload-content:orphan-audit"],
    gaps,
  };

  await writeReport(report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  client.release();
  await pool.end();
}

async function auditSubject(subject) {
  const listedKeys = await listS3Keys(subject.prefix);
  const dbKeys = await listDbStorageKeys(subject.table);
  const validListedKeys = new Set();
  let invalidKeyObjects = 0;
  let legacyDbStorageKeyRows = 0;

  for (const key of listedKeys) {
    if (isHashOnlyStorageKey(key, subject.prefix)) {
      validListedKeys.add(key);
    } else {
      invalidKeyObjects += 1;
    }
  }

  const dbKeySet = new Set();
  for (const key of dbKeys) {
    dbKeySet.add(key);
    if (!isHashOnlyStorageKey(key, subject.prefix)) {
      legacyDbStorageKeyRows += 1;
    }
  }

  let referencedObjectsPresent = 0;
  let dbReferencedMissingObjects = 0;
  for (const key of dbKeySet) {
    if (validListedKeys.has(key) || listedKeys.has(key)) {
      referencedObjectsPresent += 1;
    } else {
      dbReferencedMissingObjects += 1;
    }
  }

  let orphanObjects = 0;
  for (const key of validListedKeys) {
    if (!dbKeySet.has(key)) {
      orphanObjects += 1;
    }
  }

  return {
    subject: subject.label,
    prefix: subject.prefix,
    listedObjects: listedKeys.size,
    dbReferencedObjects: dbKeySet.size,
    referencedObjectsPresent,
    dbReferencedMissingObjects,
    orphanObjects,
    invalidKeyObjects,
    legacyDbStorageKeyRows,
  };
}

async function listDbStorageKeys(table) {
  const result = await client.query(
    `SELECT "storageKey"
     FROM "${table}"
     WHERE "storageKey" IS NOT NULL
       AND "storageKey" <> ''`,
  );
  return result.rows.map((row) => row.storageKey);
}

async function listS3Keys(prefix) {
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const keys = new Set();
  let continuationToken;

  do {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: s3Bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of response.Contents ?? []) {
      if (typeof item.Key === "string" && item.Key.trim() !== "") {
        keys.add(item.Key);
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function createS3ClientFromEnv() {
  const bucket = process.env.S3_BUCKET?.trim();
  if (!bucket) {
    throw new Error("S3_BUCKET is required for inline upload orphan S3 audit.");
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

function isHashOnlyStorageKey(key, prefix) {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedPrefix}[a-f0-9]{64}$`, "i").test(key);
}

function determineStatus(totals) {
  if (totals.invalidKeyObjects > 0) return "INVALID_OBJECT_KEYS_FOUND";
  if (totals.legacyDbStorageKeyRows > 0) return "LEGACY_DB_STORAGE_KEYS_FOUND";
  if (totals.dbReferencedMissingObjects > 0) return "DB_REFERENCED_OBJECTS_MISSING";
  if (totals.orphanObjects > 0) return "ORPHAN_OBJECTS_FOUND";
  return "NO_ORPHANS";
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
    throw new Error("INLINE_UPLOAD_CONTENT_ORPHAN_AUDIT_OUTPUT lokal temp path olmamalı.");
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
      throw new Error("INLINE_UPLOAD_CONTENT_ORPHAN_AUDIT_OUTPUT parent dizini symlink olmayan dizin olmalı.");
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
    throw new Error("INLINE_UPLOAD_CONTENT_ORPHAN_AUDIT_OUTPUT symlink olmayan file artifact olmalı.");
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
