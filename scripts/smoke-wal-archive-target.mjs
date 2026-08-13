import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { validateSmokeEvidenceOutputTarget, writeSmokeEvidence } from "./smoke-evidence.mjs";

await loadEnvFile(readArgValue("--env-file"));

const target = process.env.WAL_ARCHIVE_TARGET;
const evidenceFile = process.env.WAL_ARCHIVE_SMOKE_EVIDENCE_FILE ?? process.env.SMOKE_EVIDENCE_FILE;
const checkedAt = new Date().toISOString();
const fileTargetTempOrRootError = "WAL_ARCHIVE_TARGET file:// hedefi lokal temp/root path olmamalı.";
const fileTargetSymlinkError = "WAL_ARCHIVE_TARGET file:// hedefi symlink olmayan dizin olmalı.";
const fileTargetParentSymlinkError = "WAL_ARCHIVE_TARGET file:// parent dizini symlink olmayan dizin olmalı.";

await validateSmokeEvidenceOutputTarget(evidenceFile);

if (!target) {
  fail("WAL_ARCHIVE_TARGET boş bırakılamaz.");
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail("WAL_ARCHIVE_TARGET file:// veya s3:// URL olmalı.");
}

const markerName = `o-okul-wal-archive-smoke-${Date.now()}.wal`;
const markerBody = JSON.stringify(
  {
    source: "o-okul",
    event: "backup.wal_archive_smoke",
    sentAt: checkedAt,
  },
  null,
  2,
);
const expectedHash = sha256(markerBody);

if (targetUrl.protocol === "file:") {
  await smokeFileTarget(targetUrl, markerName, markerBody, expectedHash);
} else if (targetUrl.protocol === "s3:") {
  await smokeS3Target(targetUrl, markerName, markerBody, expectedHash);
} else {
  fail("WAL_ARCHIVE_TARGET yalnız file:// veya s3:// destekler.");
}

const postgresWalArchive = await smokePostgresWalArchive();

await writeSmokeEvidence(evidenceFile, {
  result: "PASS",
  check: "wal_archive_smoke",
  environment: process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
  checkedAt,
  target: summarizeTarget(targetUrl),
  markerSha256: expectedHash,
  postgresWalArchive,
  commandsPassed: ["pnpm wal:archive:smoke"],
  gaps: [],
});

console.log(`WAL archive smoke geçti: ${targetUrl.protocol}// hedef doğrulandı.`);

async function smokeFileTarget(url, name, body, expected) {
  const directory = await validateFileTargetDirectory(url);
  const path = `${directory.replace(/\/$/, "")}/${name}`;

  await mkdir(directory, { recursive: true });
  await assertExistingDirectory(directory);
  await writeFile(path, body, "utf8");

  const restored = await readFile(path, "utf8");
  if (sha256(restored) !== expected) {
    fail("WAL file hedefi okunan içerik yazılan içerikle eşleşmedi.");
  }

  await rm(path, { force: true });
}

async function smokeS3Target(url, name, body, expected) {
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

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/octet-stream",
    }),
  );

  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const restored = await response.Body.transformToString();
  if (sha256(restored) !== expected) {
    fail("WAL S3 hedefi okunan içerik yazılan içerikle eşleşmedi.");
  }

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

async function smokePostgresWalArchive() {
  const configLine = runPostgresText(
    `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select current_setting('archive_mode') || E'\\t' || current_setting('wal_level') || E'\\t' || current_setting('archive_command');"`,
  );
  const [archiveMode, walLevel, archiveCommand] = configLine.split("\t");
  if (!["on", "always"].includes(archiveMode)) {
    fail("Postgres archive_mode on veya always olmalı.");
  }
  if (!["replica", "logical"].includes(walLevel)) {
    fail("Postgres wal_level replica veya logical olmalı.");
  }

  const walFileName = runPostgresText(
    `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select pg_walfile_name(pg_switch_wal());"`,
  );
  if (!/^[0-9A-F]{24}$/i.test(walFileName)) {
    fail("Postgres WAL switch geçerli WAL dosya adı üretmeli.");
  }

  return {
    archiveMode,
    walLevel,
    archiveCommandSha256: sha256(archiveCommand ?? ""),
    switchedWalFileNameHash: sha256(walFileName),
    archivedWalFileSha256: await readArchivedWalSha256(walFileName),
  };
}

async function readArchivedWalSha256(walFileName) {
  const archiveDirectory = process.env.POSTGRES_WAL_ARCHIVE_DIR || "/var/lib/postgresql/wal-archive";
  const archivePath = `${archiveDirectory.replace(/\/+$/g, "")}/${walFileName}`;
  const command = `test -s "${archivePath}" && sha256sum "${archivePath}" | awk '{print $1}'`;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = runPostgresText(command, { failOnError: false });
    if (/^[a-f0-9]{64}$/i.test(result)) return result;
    await sleep(500);
  }

  fail("Postgres WAL archive dosyası archive_command sonrası bulunamadı.");
}

function runPostgresText(command, { failOnError = true } = {}) {
  const result = spawnSync("docker", ["compose", "exec", "-T", "postgres", "sh", "-lc", command], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    if (!failOnError) return "";
    fail(`Postgres WAL archive doğrulaması çalışmadı: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout.trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
    fail(fileTargetTempOrRootError);
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
      fail(fileTargetParentSymlinkError);
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
    fail(fileTargetSymlinkError);
  }
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

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${name} için dosya yolu gerekli.`);
  }
  return value;
}

async function loadEnvFile(file) {
  if (!file) return;

  const seen = new Set();
  const contents = await readFile(file, "utf8");
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      fail(`${file}:${index + 1} KEY=VALUE biçiminde olmalı.`);
    }

    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) {
      fail(`${file}:${index + 1} geçersiz env anahtarı: ${key}`);
    }
    if (seen.has(key)) {
      fail(`${file} tekrar eden env anahtarı içeriyor: ${key}`);
    }
    seen.add(key);

    if (process.env[key] === undefined) {
      process.env[key] = trimmed.slice(separator + 1).replace(/^["']|["']$/g, "");
    }
  }
}
