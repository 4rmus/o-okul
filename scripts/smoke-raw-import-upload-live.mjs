import { Socket } from "node:net";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { NestFactory } from "@nestjs/core";
import { hashPassword } from "../apps/api/dist/auth/auth-user-store.js";
import { AppModule } from "../apps/api/dist/app.module.js";
import { configureApiApp } from "../apps/api/dist/http/configure-api-app.js";
import { rawImportQueueProducerToken } from "../apps/api/dist/exam/raw-import-queue.service.js";
import {
  createExcelImportBullWorker,
  createRedisConnectionOptions,
} from "../apps/worker/dist/queue/bullmq-worker.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul";
const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://migration:migration@localhost:5432/o_okul";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const s3Endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";
const s3Bucket = process.env.S3_BUCKET ?? "o-okul-local";
const queuePrefix = process.env.QUEUE_PREFIX ?? `raw-import-smoke-${Date.now()}`;
const s3Credentials = resolveS3Credentials();
const runId = randomUUID();
const tenantId = `tenant-raw-import-smoke-${runId}`;
const tenantSlug = `raw-import-smoke-${runId}`;
const userId = `user-raw-import-smoke-${runId}`;
const membershipId = `membership-raw-import-smoke-${runId}`;
const examId = `exam-smoke-${runId}`;
const smokeEmail = `raw-import-smoke-${runId}@example.test`;
const licensePlanCode = "TRIAL";
const licenseStartsAt = new Date(Date.now() - 60_000).toISOString();
const licenseEndsAt = new Date(Date.now() + 86_400_000).toISOString();
const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
const smokePassword = resolveSmokePassword(process.env.ISEM_OPTICAL_PIPELINE_SMOKE_PASSWORD);

process.env.DATABASE_URL = databaseUrl;
process.env.REDIS_URL = redisUrl;
process.env.S3_ENDPOINT = s3Endpoint;
process.env.S3_BUCKET = s3Bucket;
process.env.S3_REGION = process.env.S3_REGION ?? "us-east-1";
process.env.S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE ?? "true";
process.env.S3_ACCESS_KEY_ID = s3Credentials.accessKeyId;
process.env.S3_SECRET_ACCESS_KEY = s3Credentials.secretAccessKey;
process.env.QUEUE_PREFIX = queuePrefix;

const redisConnection = createRedisConnectionOptions(redisUrl);
const postgresUrl = new URL(directDatabaseUrl);
const s3Url = new URL(s3Endpoint);
const s3Port = Number(s3Url.port || (s3Url.protocol === "https:" ? 443 : 80));

await assertPort("Postgres", postgresUrl.hostname, Number(postgresUrl.port || 5432), "pnpm db:migrate");
await assertPort("Redis", redisConnection.host, redisConnection.port, "pnpm queue:smoke");
await assertPort("MinIO/S3", s3Url.hostname, s3Port, "docker compose up -d minio");

const s3 = createS3Client();
await ensureBucket(s3, s3Bucket);
await seedExam();

const processed = createProcessedTracker();
const worker = createExcelImportBullWorker({
  connection: redisConnection,
  workerOptions: { prefix: queuePrefix },
  processor: async (job) => {
    processed.record(job);
    return {
      tenantId: job.payload.tenantId,
      importId: job.payload.entityId,
      contentHash: job.payload.contentHash,
      processedRows: 0,
      errorRows: 0,
      status: "completed",
    };
  },
});

let app;
let producer;
try {
  if (typeof worker.waitUntilReady === "function") {
    await worker.waitUntilReady();
  }

  app = await NestFactory.create(AppModule, { logger: false });
  configureApiApp(app);
  await app.listen(0, "127.0.0.1");
  producer = app.get(rawImportQueueProducerToken);

  const baseUrl = await getBaseUrl(app);
  const token = await login(baseUrl);
  const upload = await uploadRawImport(baseUrl, token);
  const payload = upload.data ?? upload;
  const rawImport = payload.rawImport;
  const parseJob = payload.parseJob;

  await s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: rawImport.s3Key }));
  await assertRawImportPersisted(rawImport.id, rawImport.sha256, rawImport.s3Key);

  const processedJob = await processed.wait(5_000);
  if (processedJob.id !== parseJob.jobId) {
    throw new Error("RAW_IMPORT_SMOKE_JOB_ID_MISMATCH");
  }
  if (
    processedJob.name !== "excel-import" ||
    processedJob.payload.tenantId !== tenantId ||
    processedJob.payload.entityId !== rawImport.id ||
    !processedJob.payload.contentHash.startsWith(`${rawImport.sha256}-`)
  ) {
    throw new Error("RAW_IMPORT_SMOKE_QUEUE_PAYLOAD_MISMATCH");
  }

  console.log(
    `RawImport live smoke passed: uploaded ${rawImport.id}, archived ${rawImport.s3Key}, queued ${processedJob.id}`,
  );
} finally {
  await worker.close();
  if (producer && typeof producer.close === "function") {
    await producer.close();
  }
  if (app) {
    await app.close();
  }
}

async function seedExam() {
  const pool = new pg.Pool({ connectionString: directDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    await client.query(
      `INSERT INTO "Tenant" (
         "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "status", "seatLimit", "updatedAt"
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 200, now())
       ON CONFLICT ("id") DO UPDATE SET "status" = 'ACTIVE', "updatedAt" = now()`,
      [tenantId, "Raw Import Smoke Tenant", tenantSlug, licensePlanCode, licenseStartsAt, licenseEndsAt],
    );
    await client.query(
      `INSERT INTO "LicenseTerm" (
         "id", "tenantId", "planCode", "startsAt", "endsAt", "activeStudentLimit", "auditReference", "updatedAt"
       )
       VALUES ($1, $2, $3, $4, $5, 200, 'raw-import-smoke', now())`,
      [`license-raw-import-smoke-${runId}`, tenantId, licensePlanCode, licenseStartsAt, licenseEndsAt],
    );
    await client.query(
      `INSERT INTO "User" ("id", "tenantId", "email", "emailNormalized", "loginName", "loginNameNormalized", "name", "passwordHash", "updatedAt")
       VALUES ($1, $2, $3, lower(btrim($3)), $3, lower(btrim($3)), 'Raw Import Smoke Admin', $4, now())`,
      [userId, tenantId, smokeEmail, hashPassword(smokePassword)],
    );
    await client.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt")
       VALUES ($1, $2, $3, 'TENANT_ADMIN', now())
       ON CONFLICT ("tenantId", "userId", "role") DO UPDATE SET "updatedAt" = now()`,
      [membershipId, tenantId, userId],
    );
    await client.query(
      `INSERT INTO "Exam" ("id", "tenantId", "title", "status", "updatedAt")
       VALUES ($1, $2, $3, 'DRAFT', now())
       ON CONFLICT ("id") DO UPDATE SET "updatedAt" = now()`,
      [examId, tenantId, "RawImport Smoke Exam"],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`RAW_IMPORT_SMOKE_DB_SEED_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
    await pool.end();
  }
}

function resolveSmokePassword(configuredPassword) {
  const liveEnvironment = ["staging", "production"].includes(environment.toLowerCase());
  if (!configuredPassword && !liveEnvironment) return "password";
  if (!configuredPassword) {
    throw new Error("ISEM_OPTICAL_PIPELINE_SMOKE_PASSWORD staging/production için açıkça verilmelidir.");
  }
  if (
    configuredPassword.length < 16 ||
    !/[a-z]/.test(configuredPassword) ||
    !/[A-Z]/.test(configuredPassword) ||
    !/[0-9]/.test(configuredPassword) ||
    !/[^A-Za-z0-9]/.test(configuredPassword) ||
    /password|qwerty|12345678|admin123/i.test(configuredPassword)
  ) {
    throw new Error(
      "ISEM_OPTICAL_PIPELINE_SMOKE_PASSWORD en az 16 karakter, büyük/küçük harf, rakam ve sembol içeren güçlü bir secret olmalıdır.",
    );
  }
  return configuredPassword;
}

async function assertRawImportPersisted(rawImportId, sha256, s3Key) {
  const pool = new pg.Pool({ connectionString: directDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    const result = await client.query(
      `SELECT "id", "tenantId", "examId", "sha256", "s3Key"
         FROM "RawImport"
        WHERE "id" = $1
        LIMIT 1`,
      [rawImportId],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.tenantId !== tenantId ||
      row.examId !== examId ||
      row.sha256 !== sha256 ||
      row.s3Key !== s3Key
    ) {
      throw new Error("RAW_IMPORT_SMOKE_DB_ROW_MISMATCH");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantSlug, loginName: smokeEmail, password: smokePassword }),
  });
  if (!response.ok) {
    throw new Error(`RAW_IMPORT_SMOKE_LOGIN_FAILED: ${response.status}`);
  }
  const body = await response.json();
  return body.data?.accessToken ?? body.accessToken;
}

async function uploadRawImport(baseUrl, token) {
  const file = Buffer.from("ogrenci_no\tkitapcik\tcevaplar\n12345\tA\tABCDE\n");
  const response = await fetch(`${baseUrl}/api/v1/exams/${examId}/raw-imports`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sourceType: "OPTICAL_TXT",
      fileName: `answers-${runId}.dat`,
      fileBase64: file.toString("base64"),
      contentType: "text/plain",
      parserConfigVersion: "parser-smoke-v1",
    }),
  });
  if (!response.ok) {
    throw new Error(`RAW_IMPORT_SMOKE_UPLOAD_FAILED: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function ensureBucket(s3, bucket) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

function createS3Client() {
  return new S3Client({
    endpoint: s3Endpoint,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: s3Credentials,
  });
}

function resolveS3Credentials() {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!accessKeyId && !secretAccessKey) {
    return { accessKeyId: "minio", secretAccessKey: "minio123" };
  }
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("RAW_IMPORT_SMOKE_S3_CREDENTIALS_INCOMPLETE");
  }
  return { accessKeyId, secretAccessKey };
}

async function getBaseUrl(app) {
  const address = app.getHttpServer().address();
  if (!address || typeof address === "string") {
    throw new Error("RAW_IMPORT_SMOKE_SERVER_ADDRESS_INVALID");
  }
  return `http://127.0.0.1:${address.port}`;
}

function createProcessedTracker() {
  let processedJob;
  let resolveProcessed;
  const processed = new Promise((resolve) => {
    resolveProcessed = resolve;
  });

  return {
    record(job) {
      processedJob = job;
      resolveProcessed(job);
    },
    wait(timeoutMs) {
      return Promise.race([
        processed,
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("RAW_IMPORT_SMOKE_QUEUE_TIMEOUT")), timeoutMs);
        }),
      ]).then(() => processedJob);
    },
  };
}

async function assertPort(label, host, port, hint) {
  if (await canConnect(host, port)) {
    return;
  }

  console.error(`${label} smoke çalışmadı: ${host}:${port} bağlantısı kurulamadı.`);
  console.error(`Önce gerekli servisi başlatın. İpucu: ${hint}`);
  process.exit(1);
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = new Socket();
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}
