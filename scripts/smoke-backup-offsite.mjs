import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.BACKUP_OFFSITE_TARGET;

if (!target) {
  fail("BACKUP_OFFSITE_TARGET boş bırakılamaz.");
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail("BACKUP_OFFSITE_TARGET file:// veya s3:// URL olmalı.");
}

const markerName = `uzman-hocam-offsite-smoke-${Date.now()}.txt`;
const markerBody = JSON.stringify(
  {
    source: "uzman-hocam",
    event: "backup.offsite_smoke",
    sentAt: new Date().toISOString(),
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
  fail("BACKUP_OFFSITE_TARGET yalnız file:// veya s3:// destekler.");
}

console.log(`Offsite backup smoke geçti: ${targetUrl.protocol}// hedef doğrulandı.`);

async function smokeFileTarget(url, name, body, expected) {
  const directory = fileURLToPath(url);
  const path = `${directory.replace(/\/$/, "")}/${name}`;

  await mkdir(directory, { recursive: true });
  await writeFile(path, body, "utf8");

  const restored = await readFile(path, "utf8");
  if (sha256(restored) !== expected) {
    fail("Offsite file hedefi okunan içerik yazılan içerikle eşleşmedi.");
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
      ContentType: "text/plain; charset=utf-8",
    }),
  );

  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const restored = await response.Body.transformToString();
  if (sha256(restored) !== expected) {
    fail("Offsite S3 hedefi okunan içerik yazılan içerikle eşleşmedi.");
  }

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
