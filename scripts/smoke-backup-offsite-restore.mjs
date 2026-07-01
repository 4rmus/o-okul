import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { validateSmokeEvidenceOutputTarget, writeSmokeEvidence } from "./smoke-evidence.mjs";

const target = process.env.BACKUP_OFFSITE_RESTORE_TARGET ?? process.env.BACKUP_OFFSITE_TARGET;
const evidenceFile = process.env.BACKUP_OFFSITE_RESTORE_SMOKE_EVIDENCE_FILE ?? process.env.SMOKE_EVIDENCE_FILE;
const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
const restoreDb = `o_okul_offsite_restore_smoke_${Date.now()}`;
const dumpName = `${restoreDb}.dump`;
const containerDumpPath = `/tmp/${dumpName}`;
const startedAt = performance.now();

await validateSmokeEvidenceOutputTarget(evidenceFile);

if (!target) {
  fail("BACKUP_OFFSITE_RESTORE_TARGET veya BACKUP_OFFSITE_TARGET boş bırakılamaz.");
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail("BACKUP_OFFSITE_RESTORE_TARGET file:// veya s3:// URL olmalı.");
}

try {
  const dump = runDockerBuffer(`pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges --file=-`);
  if (dump.length === 0) {
    throw new Error("pg_dump boş çıktı üretti.");
  }

  const backupSha256 = sha256(dump);
  const restoredDump = await roundTripOffsiteDump(targetUrl, dumpName, dump);
  if (sha256(restoredDump) !== backupSha256) {
    throw new Error("Off-host hedeften okunan dump hash'i yazılan dump ile eşleşmedi.");
  }

  runDockerText(`cat > "${containerDumpPath}"`, restoredDump);
  runDockerText(`createdb -U "$POSTGRES_USER" "${restoreDb}"`);
  runDockerText(`pg_restore -U "$POSTGRES_USER" -d "${restoreDb}" "${containerDumpPath}"`);

  const tableCounts = readTableCounts(restoreDb);
  await writeSmokeEvidence(evidenceFile, {
    result: "PASS",
    check: "backup_offsite_restore_smoke",
    environment,
    checkedAt: new Date().toISOString(),
    target: summarizeTarget(targetUrl),
    backupSha256,
    restoreDatabaseHash: sha256(restoreDb),
    dumpFormat: "custom",
    tableCounts,
    durationMs: Math.round(performance.now() - startedAt),
    commandsPassed: ["pnpm backup:offsite-restore:smoke"],
    gaps: [],
  });

  console.log(`Off-host backup restore smoke geçti: ${targetUrl.protocol}// hedefinden restore doğrulandı.`);
} finally {
  try {
    runDockerText(`dropdb -U "$POSTGRES_USER" --if-exists "${restoreDb}"`);
  } catch {
    // Best-effort cleanup.
  }
  try {
    runDockerText(`rm -f "${containerDumpPath}"`);
  } catch {
    // Best-effort cleanup.
  }
}

async function roundTripOffsiteDump(url, name, dump) {
  if (url.protocol === "file:") return roundTripFileTarget(url, name, dump);
  if (url.protocol === "s3:") return roundTripS3Target(url, name, dump);
  fail("BACKUP_OFFSITE_RESTORE_TARGET yalnız file:// veya s3:// destekler.");
}

async function roundTripFileTarget(url, name, dump) {
  const directory = await validateFileTargetDirectory(url);
  await mkdir(directory, { recursive: true });
  await assertExistingDirectory(directory);
  const path = `${directory.replace(/\/$/, "")}/${name}`;

  await writeFile(path, dump);
  const restored = await readFile(path);
  await rm(path, { force: true });
  return restored;
}

async function roundTripS3Target(url, name, dump) {
  const bucket = url.hostname;
  const prefix = url.pathname.replace(/^\/+|\/+$/g, "");
  const key = [prefix, name].filter(Boolean).join("/");
  const { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
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
  });

  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: dump, ContentType: "application/octet-stream" }));
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const restored = await readS3Body(response.Body);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  return restored;
}

function runDockerText(command, input) {
  const result = spawnSync("docker", ["compose", "exec", "-T", "postgres", "sh", "-lc", command], {
    input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${command}\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function runDockerBuffer(command) {
  const result = spawnSync("docker", ["compose", "exec", "-T", "postgres", "sh", "-lc", command], {
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${command}\n${Buffer.from(result.stderr).toString("utf8") || Buffer.from(result.stdout).toString("utf8")}`);
  }
  return Buffer.from(result.stdout);
}

function readTableCounts(databaseName) {
  const lines = runDockerText(
    `psql -U "$POSTGRES_USER" -d "${databaseName}" -Atc "select 'Tenant=' || count(*) from \\"Tenant\\" union all select 'AuditLog=' || count(*) from \\"AuditLog\\" union all select 'ReportSnapshot=' || count(*) from \\"ReportSnapshot\\" union all select 'Migration=' || count(*) from \\"_prisma_migrations\\";"`,
  )
    .split("\n")
    .filter(Boolean);

  const counts = {
    Tenant: null,
    AuditLog: null,
    ReportSnapshot: null,
    _prisma_migrations: null,
  };
  const labels = new Map([
    ["Tenant", "Tenant"],
    ["AuditLog", "AuditLog"],
    ["ReportSnapshot", "ReportSnapshot"],
    ["Migration", "_prisma_migrations"],
  ]);

  for (const line of lines) {
    const [rawLabel, rawValue] = line.split("=");
    const key = labels.get(rawLabel);
    if (!key) continue;
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`Off-host restore ${key} sayımı en az 1 olmalı: ${rawValue}`);
    }
    counts[key] = value;
  }

  for (const [key, value] of Object.entries(counts)) {
    if (value === null) {
      throw new Error(`Off-host restore ${key} sayımı eksik.`);
    }
  }

  return counts;
}

function summarizeTarget(url) {
  if (url.protocol === "s3:") {
    return {
      protocol: "s3",
      bucket: url.hostname,
      prefix: url.pathname.replace(/^\/+|\/+$/g, ""),
    };
  }
  return {
    protocol: "file",
    pathRedacted: true,
  };
}

async function validateFileTargetDirectory(url) {
  const directory = resolve(fileURLToPath(url));
  if (isLocalTempOrRootPath(directory)) {
    fail("BACKUP_OFFSITE_RESTORE_TARGET file:// hedefi lokal temp/root path olmamalı.");
  }
  await assertParentPathAllowed(dirname(directory));
  await assertExistingDirectory(directory);
  return directory;
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
      fail("BACKUP_OFFSITE_RESTORE_TARGET file:// parent dizini symlink olmayan dizin olmalı.");
    }
  }
}

async function assertExistingDirectory(directory) {
  let stat;
  try {
    stat = await lstat(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("BACKUP_OFFSITE_RESTORE_TARGET file:// hedefi symlink olmayan dizin olmalı.");
  }
}

async function readS3Body(body) {
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "object" && body !== null && "transformToByteArray" in body) {
    return Buffer.from(await body.transformToByteArray());
  }
  if (isAsyncIterable(body)) {
    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  throw new Error("Off-host S3 dump body okunamadı.");
}

function isAsyncIterable(value) {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function isLocalTempOrRootPath(path) {
  const normalized = path.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/" ||
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
