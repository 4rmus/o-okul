import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { writeSmokeEvidence } from "./smoke-evidence.mjs";

const target = process.env.WAL_ARCHIVE_TARGET;
const evidenceFile = process.env.WAL_ARCHIVE_SMOKE_EVIDENCE_FILE ?? process.env.SMOKE_EVIDENCE_FILE;
const checkedAt = new Date().toISOString();

if (!target) {
  fail("WAL_ARCHIVE_TARGET boş bırakılamaz.");
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail("WAL_ARCHIVE_TARGET file:// veya s3:// URL olmalı.");
}

const markerName = `uzman-hocam-wal-archive-smoke-${Date.now()}.wal`;
const markerBody = JSON.stringify(
  {
    source: "uzman-hocam",
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

await writeSmokeEvidence(evidenceFile, {
  result: "PASS",
  check: "wal_archive_smoke",
  environment: process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
  checkedAt,
  target: summarizeTarget(targetUrl),
  markerSha256: expectedHash,
  commandsPassed: ["pnpm wal:archive:smoke"],
  gaps: [],
});

console.log(`WAL archive smoke geçti: ${targetUrl.protocol}// hedef doğrulandı.`);

async function smokeFileTarget(url, name, body, expected) {
  const directory = fileURLToPath(url);
  const path = `${directory.replace(/\/$/, "")}/${name}`;

  await mkdir(directory, { recursive: true });
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

function fail(message) {
  console.error(message);
  process.exit(1);
}
