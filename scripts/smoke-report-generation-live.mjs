import { createHash, randomUUID } from "node:crypto";
import { Socket } from "node:net";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { hashPassword } from "../apps/api/dist/auth/auth-user-store.js";
import { createBullTenantQueueProducer } from "../apps/api/dist/queue/bullmq-producer.js";
import {
  createRedisConnectionOptions,
  createReportGenerationBullWorker,
} from "../apps/worker/dist/queue/bullmq-worker.js";
import { validateSmokeEvidenceOutputTarget, writeSmokeEvidence } from "./smoke-evidence.mjs";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul";
const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://migration:migration@localhost:5432/o_okul";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const queuePrefix = process.env.QUEUE_PREFIX ?? `report-generation-smoke-${Date.now()}`;
const resultCount = readResultCount();
const generationDurationMsMax = resultCount >= 10_000 ? 60_000 : 10_000;
const runId = randomUUID();
const tenantId = process.env.REPORT_GENERATION_SMOKE_TENANT_ID ?? "tenant-smoke-report";
const userId = process.env.REPORT_GENERATION_SMOKE_USER_ID ?? "user-smoke-report";
const smokeEmail = process.env.REPORT_GENERATION_SMOKE_EMAIL ?? `report-smoke-${runId}@example.test`;
const smokePassword = process.env.REPORT_GENERATION_SMOKE_PASSWORD ?? "password";
const evidencePath = process.env.REPORT_GENERATION_SMOKE_EVIDENCE_FILE ?? process.env.REPORT_GENERATION_SMOKE_EVIDENCE_PATH;
const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
const commandPassed =
  process.env.REPORT_GENERATION_SMOKE_COMMAND ??
  (resultCount >= 10_000 ? "pnpm report-generation:perf" : "pnpm report-generation:smoke");
const membershipId = `membership-report-smoke-${runId}`;
const examId = `exam-report-smoke-${runId}`;
const rawImportId = `raw-import-report-smoke-${runId}`;
const answerKeyId = `answer-key-report-smoke-${runId}`;
const contentHash = `results-${resultCount}-${runId}`;
const expectedClassCount = resultCount === 1 ? 1 : 20;

await validateSmokeEvidenceOutputTarget(evidencePath);

process.env.DATABASE_URL = databaseUrl;
process.env.REDIS_URL = redisUrl;
process.env.QUEUE_PREFIX = queuePrefix;

const redisConnection = createRedisConnectionOptions(redisUrl);
const postgresUrl = new URL(directDatabaseUrl);

await assertPort("Postgres", postgresUrl.hostname, Number(postgresUrl.port || 5432), "pnpm db:migrate");
await assertPort("Redis", redisConnection.host, redisConnection.port, "docker compose up -d redis");

const seedStartedAt = performance.now();
await seedReportInput();
const seedDurationMs = Math.round(performance.now() - seedStartedAt);

const producer = createBullTenantQueueProducer({ connection: redisConnection, prefix: queuePrefix });
const worker = createReportGenerationBullWorker({
  connection: redisConnection,
  workerOptions: { prefix: queuePrefix },
});

try {
  if (typeof worker.waitUntilReady === "function") {
    await worker.waitUntilReady();
  }

  const producedJob = await producer.enqueue({
    queueName: "report-generation",
    tenantId,
    userId,
    entityId: examId,
    contentHash,
    reportType: "EXAM_RESULT_SUMMARY",
  });

  const startedAt = performance.now();
  const snapshot = await waitForSnapshot(generationDurationMsMax);
  const generationDurationMs = Math.round(performance.now() - startedAt);
  if (producedJob.options.jobId !== `${examId}_${contentHash}`) {
    throw new Error("REPORT_GENERATION_SMOKE_JOB_ID_MISMATCH");
  }
  if (
    snapshot.tenantId !== tenantId ||
    snapshot.examId !== examId ||
    snapshot.reportType !== "EXAM_RESULT_SUMMARY" ||
    snapshot.status !== "READY" ||
    snapshot.resultCount !== resultCount ||
    snapshot.studentCount !== resultCount ||
    snapshot.classCount !== expectedClassCount ||
    snapshot.branchCount !== 2 ||
    snapshot.firstStudentId !== studentIdAt(0)
  ) {
    throw new Error("REPORT_GENERATION_SMOKE_SNAPSHOT_MISMATCH");
  }

  await writeSmokeEvidence(evidencePath, {
    result: "PASS",
    check: "report_generation_smoke",
    environment,
    checkedAt: new Date().toISOString(),
    reportType: "EXAM_RESULT_SUMMARY",
    status: "READY",
    resultCount,
    studentCount: snapshot.studentCount,
    classCount: snapshot.classCount,
    branchCount: snapshot.branchCount,
    expectedClassCount,
    seedDurationMs,
    generationDurationMs,
    hashes: {
      tenantHash: sha256(tenantId),
      userHash: sha256(userId),
      emailHash: sha256(smokeEmail.toLowerCase()),
      examHash: sha256(examId),
      snapshotHash: sha256(snapshot.id),
      firstStudentHash: sha256(snapshot.firstStudentId),
      contentHash: sha256(contentHash),
      queuedJobIdHash: sha256(producedJob.options.jobId),
    },
    thresholds: {
      resultCountMatches: snapshot.resultCount === resultCount,
      generationDurationMsMax,
      generationDurationPassed: generationDurationMs <= generationDurationMsMax,
    },
    commandsPassed: [commandPassed],
    gaps: [],
  });

  console.log(
    `ReportGeneration live smoke passed: tenant ${tenantId}, exam ${examId}, first student ${snapshot.firstStudentId}, ${resultCount} results, queued ${producedJob.options.jobId}, snapshot ${snapshot.id}, seed ${seedDurationMs}ms, generation ${generationDurationMs}ms`,
  );
} finally {
  await worker.close();
  await producer.close();
}

async function seedReportInput() {
  const pool = new pg.Pool({ connectionString: directDatabaseUrl });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    await client.query(
      `INSERT INTO "Tenant" ("id", "name", "slug", "status", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now())
       ON CONFLICT ("id") DO UPDATE SET "updatedAt" = now()`,
      [tenantId, "Report Smoke Tenant", `report-smoke-${runId}`],
    );
    await client.query(
      `INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt")
       VALUES ($1, $2, 'Report Smoke Admin', $3, now())
       ON CONFLICT ("id") DO UPDATE
       SET "email" = EXCLUDED."email",
           "passwordHash" = EXCLUDED."passwordHash",
           "updatedAt" = now()`,
      [userId, smokeEmail, hashPassword(smokePassword)],
    );
    await client.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt")
       VALUES ($1, $2, $3, 'TENANT_ADMIN', now())
       ON CONFLICT ("tenantId", "userId", "role") DO UPDATE SET "updatedAt" = now()`,
      [membershipId, tenantId, userId],
    );
    await client.query(
      `INSERT INTO "Exam" ("id", "tenantId", "title", "status", "updatedAt")
       VALUES ($1, $2, 'Report Generation Smoke Exam', 'DRAFT', now())`,
      [examId, tenantId],
    );
    await client.query(
      `INSERT INTO "RawImport" ("id", "tenantId", "examId", "sourceType", "fileName", "s3Key", "sha256", "parserConfigVersion", "updatedAt")
       VALUES ($1, $2, $3, 'OPTICAL_TXT', 'report-smoke.dat', $4, $5, 'parser-smoke-v1', now())`,
      [rawImportId, tenantId, examId, `smoke/report/${runId}.dat`, `sha256-${runId}`],
    );
    await client.query(
      `INSERT INTO "AnswerKey" ("id", "tenantId", "examId", "version", "keyData", "updatedAt")
       VALUES ($1, $2, $3, 'answer-key-smoke-v1', $4::jsonb, now())`,
      [answerKeyId, tenantId, examId, JSON.stringify({ questions: [] })],
    );

    await insertRows(
      client,
      `INSERT INTO "Class" ("id", "tenantId", "name", "updatedAt") VALUES `,
      ["id", "tenantId", "name"],
      Array.from({ length: expectedClassCount }, (_value, index) => [
        classIdAt(index),
        tenantId,
        classNameAt(index),
      ]),
    );

    for (let start = 0; start < resultCount; start += 1_000) {
      const end = Math.min(start + 1_000, resultCount);
      await insertRows(
        client,
        `INSERT INTO "Student" ("id", "tenantId", "classId", "firstName", "lastName", "studentNo", "updatedAt") VALUES `,
        ["id", "tenantId", "classId", "firstName", "lastName", "studentNo"],
        range(start, end).map((index) => [
          studentIdAt(index),
          tenantId,
          classIdAt(classIndexFor(index)),
          "Smoke",
          `Student ${index + 1}`,
          `smoke-${runId}-${index}`,
        ]),
      );
      await insertRows(
        client,
        `INSERT INTO "ExamParticipant" ("id", "tenantId", "examId", "studentId", "participantNo", "bookletType", "status", "updatedAt") VALUES `,
        ["id", "tenantId", "examId", "studentId", "participantNo", "bookletType", "status"],
        range(start, end).map((index) => [
          participantIdAt(index),
          tenantId,
          examId,
          studentIdAt(index),
          String(index + 1),
          "A",
          "EVALUATED",
        ]),
      );
      await insertRows(
        client,
        `INSERT INTO "ExamResult" (
           "id",
           "tenantId",
           "examId",
           "studentId",
           "participantId",
           "rawImportId",
           "answerKeyId",
           "answerKeyVersion",
           "parserConfigVersion",
           "engineVersion",
           "resultKey",
           "scoreData",
           "computedAt",
           "updatedAt"
         ) VALUES `,
        [
          "id",
          "tenantId",
          "examId",
          "studentId",
          "participantId",
          "rawImportId",
          "answerKeyId",
          "answerKeyVersion",
          "parserConfigVersion",
          "engineVersion",
          "resultKey",
          "scoreData",
        ],
        range(start, end).map((index) => [
          `exam-result-report-smoke-${runId}-${index}`,
          tenantId,
          examId,
          studentIdAt(index),
          participantIdAt(index),
          rawImportId,
          answerKeyId,
          "answer-key-smoke-v1",
          "parser-smoke-v1",
          "scoring-smoke-v1",
          resultKeyAt(index),
          JSON.stringify(createScoreData(index)),
        ]),
        ", now(), now()",
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`REPORT_GENERATION_SMOKE_DB_SEED_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function insertRows(client, sqlPrefix, columns, rows, rowSuffix = ", now()") {
  if (rows.length === 0) return;

  const values = [];
  const placeholders = rows.map((row, rowIndex) => {
    const valuePlaceholders = columns.map((_column, columnIndex) => {
      values.push(row[columnIndex]);
      return `$${rowIndex * columns.length + columnIndex + 1}`;
    });
    return `(${valuePlaceholders.join(", ")}${rowSuffix})`;
  });

  await client.query(`${sqlPrefix}${placeholders.join(", ")}`, values);
}

async function waitForSnapshot(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await findSnapshot();
    if (snapshot) {
      return snapshot;
    }
    await delay(200);
  }
  throw new Error("REPORT_GENERATION_SMOKE_QUEUE_TIMEOUT");
}

async function findSnapshot() {
  const pool = new pg.Pool({ connectionString: directDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    const result = await client.query(
      `SELECT
         "id",
         "tenantId",
         "examId",
         "reportType",
         "status",
         "snapshotData"->>'resultCount' AS "resultCount",
         jsonb_array_length("snapshotData"->'students') AS "studentCount",
         jsonb_array_length("snapshotData"->'classes') AS "classCount",
         jsonb_array_length("snapshotData"->'branches') AS "branchCount",
         "snapshotData"->'students'->0->>'studentId' AS "firstStudentId"
       FROM "ReportSnapshot"
       WHERE "tenantId" = $1
         AND "examId" = $2
         AND "reportType" = 'EXAM_RESULT_SUMMARY'
         AND "status" = 'READY'
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [tenantId, examId],
    );
    await client.query("COMMIT");
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      ...row,
      resultCount: Number(row.resultCount),
      studentCount: Number(row.studentCount),
      classCount: Number(row.classCount),
      branchCount: Number(row.branchCount),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function createScoreData(index) {
  const correct = 16 + (index % 5);
  const wrong = index % 3;
  const blank = index % 2;
  const net = correct - wrong * 0.25;
  const branchWrong = wrong > 0 ? 1 : 0;

  return {
    total: {
      correct,
      wrong,
      blank,
      net,
      rawScore: net * 5,
      standardScore: 70 + (index % 31),
    },
    branches: [
      {
        branch: "Matematik",
        correct: Math.min(correct, 10),
        wrong: branchWrong,
        blank: 0,
        net: Math.min(correct, 10) - branchWrong * 0.25,
      },
      {
        branch: "Türkçe",
        correct: Math.max(correct - 10, 0),
        wrong: Math.max(wrong - branchWrong, 0),
        blank,
        net: Math.max(correct - 10, 0) - Math.max(wrong - branchWrong, 0) * 0.25,
      },
    ],
    _meta: {
      answerKeyVersion: "answer-key-smoke-v1",
      engineVersion: "scoring-smoke-v1",
      computedAt: new Date(0).toISOString(),
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

function readResultCount() {
  const value = process.env.REPORT_GENERATION_SMOKE_RESULT_COUNT ?? "1";
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20_000) {
    throw new Error("REPORT_GENERATION_SMOKE_RESULT_COUNT_INVALID");
  }
  return parsed;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function range(start, end) {
  return Array.from({ length: end - start }, (_value, offset) => start + offset);
}

function classIndexFor(index) {
  return resultCount === 1 ? 0 : index % expectedClassCount;
}

function classIdAt(index) {
  return resultCount === 1
    ? `class-report-smoke-${runId}`
    : `class-report-smoke-${runId}-${String(index).padStart(2, "0")}`;
}

function classNameAt(index) {
  return resultCount === 1 ? "Smoke 8-A" : `Smoke 8-${String(index + 1).padStart(2, "0")}`;
}

function studentIdAt(index) {
  return `student-report-smoke-${runId}-${String(index).padStart(5, "0")}`;
}

function participantIdAt(index) {
  return `participant-report-smoke-${runId}-${String(index).padStart(5, "0")}`;
}

function resultKeyAt(index) {
  return `${participantIdAt(index)}_answer-key-smoke-v1_parser-smoke-v1_scoring-smoke-v1`;
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
