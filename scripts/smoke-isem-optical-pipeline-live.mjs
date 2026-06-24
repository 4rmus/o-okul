import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
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
import { rawImportQueueProducerToken } from "../apps/api/dist/exam/raw-import-queue.service.js";
import { configureApiApp } from "../apps/api/dist/http/configure-api-app.js";
import { reportGenerationQueueProducerToken } from "../apps/api/dist/report/report-generation.service.js";
import { getParserConfigPresetSuggestion } from "../apps/worker/dist/jobs/format-analyzer-service.js";
import {
  createExamEvaluationBullWorker,
  createExcelImportBullWorker,
  createRedisConnectionOptions,
  createReportGenerationBullWorker,
} from "../apps/worker/dist/queue/bullmq-worker.js";
import { validateSmokeEvidenceOutputTarget, writeSmokeEvidence } from "./smoke-evidence.mjs";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul";
const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://migration:migration@localhost:5432/o_okul";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const s3Endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";
const s3Bucket = process.env.S3_BUCKET ?? "o-okul-local";
const queuePrefix = process.env.QUEUE_PREFIX ?? `isem-optical-smoke-${Date.now()}`;
const s3Credentials = resolveS3Credentials();
const runId = randomUUID();
const tenantId = `tenant-isem-optical-smoke-${runId}`;
const userId = `user-isem-optical-smoke-${runId}`;
const membershipId = `membership-isem-optical-smoke-${runId}`;
let examId = `exam-isem-optical-smoke-${runId}`;
const classAId = `class-isem-optical-smoke-a-${runId}`;
const classBId = `class-isem-optical-smoke-b-${runId}`;
const parserConfigVersion = "optik-7108-lgs-v1";
const answerKeyVersion = "isem-lgs-1-v1";
const txtPath = "ornek-veriler/iSEM .txt";
const answerKeyPath = "ornek-veriler/iSEM - LGS - 1 Detaylı Cevap Anahtarı.xlsx";
const expectedRawRowCount = 21;
const expectedMatchedCount = 21;
const expectedQuarantineCount = 0;
const expectedParticipantCount = 21;
const expectedValidBookletCounts = { A: 12, B: 9 };
const sampleStudentNos = ["102", "101"];
const smokeEmailDomain = process.env.ISEM_OPTICAL_PIPELINE_SMOKE_EMAIL_DOMAIN ?? "example.test";
const smokeEmail = process.env.ISEM_OPTICAL_PIPELINE_SMOKE_EMAIL ?? `isem-optical-smoke-${runId}@${smokeEmailDomain}`;
const smokePassword = process.env.ISEM_OPTICAL_PIPELINE_SMOKE_PASSWORD ?? "password";
const evidencePath = process.env.ISEM_OPTICAL_PIPELINE_SMOKE_EVIDENCE_FILE ?? process.env.ISEM_OPTICAL_PIPELINE_SMOKE_EVIDENCE_PATH;
const uiWorkerEvidencePath =
  process.env.ISEM_OPTICAL_PIPELINE_UI_WORKER_EVIDENCE_FILE ??
  process.env.ISEM_OPTICAL_PIPELINE_UI_WORKER_EVIDENCE_PATH;
const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
const commandPassed = process.env.ISEM_OPTICAL_PIPELINE_SMOKE_COMMAND ?? "pnpm isem-optical-pipeline:smoke";
const expectedScores = new Map([
  ["102", { correct: 79, wrong: 10, blank: 1, net: 75.6667 }],
  ["101", { correct: 44, wrong: 31, blank: 15, net: 33.6667 }],
]);

process.env.DATABASE_URL = databaseUrl;
process.env.REDIS_URL = redisUrl;
process.env.S3_ENDPOINT = s3Endpoint;
process.env.S3_BUCKET = s3Bucket;
process.env.S3_REGION = process.env.S3_REGION ?? "us-east-1";
process.env.S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE ?? "true";
process.env.S3_ACCESS_KEY_ID = s3Credentials.accessKeyId;
process.env.S3_SECRET_ACCESS_KEY = s3Credentials.secretAccessKey;
process.env.QUEUE_PREFIX = queuePrefix;
process.env.PERSISTENCE_DRIVER = "postgres";

const redisConnection = createRedisConnectionOptions(redisUrl);
const postgresUrl = new URL(directDatabaseUrl);
const s3Url = new URL(s3Endpoint);
const s3Port = Number(s3Url.port || (s3Url.protocol === "https:" ? 443 : 80));
const pipelineStartedAt = performance.now();

await validateSmokeEvidenceOutputTarget(evidencePath);
await validateSmokeEvidenceOutputTarget(uiWorkerEvidencePath);
await assertPort("Postgres", postgresUrl.hostname, Number(postgresUrl.port || 5432), "pnpm db:migrate");
await assertPort("Redis", redisConnection.host, redisConnection.port, "docker compose up -d redis");
await assertPort("MinIO/S3", s3Url.hostname, s3Port, "docker compose up -d minio");

const opticalContent = readFileSync(txtPath, "utf8");
const answerKeyContent = readFileSync(answerKeyPath);
const opticalRows = readOpticalRows(opticalContent);
assertOpticalRows(opticalRows);

const s3 = createS3Client();
await ensureBucket(s3, s3Bucket);
await seedPipelineInput(opticalRows);

const parseWorker = createExcelImportBullWorker({
  connection: redisConnection,
  workerOptions: { prefix: queuePrefix },
});
const evaluationWorker = createExamEvaluationBullWorker({
  connection: redisConnection,
  workerOptions: { prefix: queuePrefix },
});
const reportWorker = createReportGenerationBullWorker({
  connection: redisConnection,
  workerOptions: { prefix: queuePrefix },
});

let app;
let rawImportProducer;
let reportGenerationProducer;
try {
  await waitUntilReady(parseWorker);
  await waitUntilReady(evaluationWorker);
  await waitUntilReady(reportWorker);

  app = await NestFactory.create(AppModule, { logger: false });
  configureApiApp(app);
  await app.listen(0, "127.0.0.1");
  rawImportProducer = app.get(rawImportQueueProducerToken);
  reportGenerationProducer = app.get(reportGenerationQueueProducerToken);

  const baseUrl = await getBaseUrl(app);
  const token = await login(baseUrl);
  const answerKey = await createExamWithAnswerKey(baseUrl, token);
  await seedExamScopedInput(opticalRows);
  const rawImportPayload = await uploadRawImport(baseUrl, token, opticalContent);
  const rawImport = rawImportPayload.rawImport;
  const parseJob = rawImportPayload.parseJob;
  await s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: rawImport.s3Key }));

  const summary = await waitForSummary(baseUrl, token, rawImport.id, expectedRawRowCount, 20_000);
  if (
    summary.matchedCount !== expectedMatchedCount ||
    summary.quarantinedCount !== expectedQuarantineCount ||
    summary.totalRows !== expectedRawRowCount ||
    summary.quarantineReasons.length !== 0
  ) {
    throw new Error(
      `ISEM_OPTICAL_PARSE_SUMMARY_MISMATCH: totalRows ${summary.totalRows}, matched ${summary.matchedCount}, quarantined ${summary.quarantinedCount}`,
    );
  }

  const evaluation = await enqueueEvaluation(baseUrl, token, rawImport.id);
  if (
    evaluation.queuedCount !== expectedMatchedCount ||
    evaluation.matchedCount !== expectedMatchedCount ||
    evaluation.jobs.length !== expectedMatchedCount
  ) {
    throw new Error(
      `ISEM_OPTICAL_EVALUATION_QUEUE_MISMATCH: queued ${evaluation.queuedCount}, matched ${evaluation.matchedCount}, jobs ${evaluation.jobs.length}`,
    );
  }
  if (!evaluation.answerKeyId) {
    throw new Error(`ISEM_OPTICAL_EVALUATION_ANSWER_KEY_MISSING: ${JSON.stringify(evaluation)}`);
  }
  if (evaluation.answerKeyId !== answerKey.id) {
    throw new Error(
      `ISEM_OPTICAL_EVALUATION_ANSWER_KEY_MISMATCH: expected ${sha256(answerKey.id)}, got ${sha256(evaluation.answerKeyId)}`,
    );
  }
  await waitForExamResultCount(expectedMatchedCount, 30_000);

  const reportJob = await enqueueReportGeneration(baseUrl, token, rawImport.sha256, evaluation.answerKeyId);
  const snapshot = await waitForSnapshot(expectedMatchedCount, 30_000);
  const evidence = await readPipelineEvidence(rawImport.id, evaluation.answerKeyId, snapshot.id);
  assertPipelineEvidence(evidence);
  const pipelineDurationMs = Math.round(performance.now() - pipelineStartedAt);

  await writeSmokeEvidence(evidencePath, {
    result: "PASS",
    check: "isem_optical_pipeline_smoke",
    environment,
    checkedAt: new Date().toISOString(),
    parserConfigVersion,
    answerKeyVersion,
    answerKeyQuestionCount: answerKey.questionCount,
    bookletVariantCount: answerKey.bookletVariantCount,
    counts: {
      studentCount: evidence.studentCount,
      participantCount: evidence.participantCount,
      matchedCount: evidence.matchedCount,
      quarantineCount: evidence.quarantineCount,
      examResultCount: evidence.examResultCount,
      reportResultCount: evidence.snapshotResultCount,
      studentPortalUserLinkCount: evidence.studentUserLinkCount,
      guardianPortalUserLinkCount: evidence.guardianUserLinkCount,
      guardianLinkCount: evidence.guardianLinkCount,
    },
    pipeline: {
      answerKeyImported: true,
      opticalImportCommitted: true,
      rawImportArchived: true,
      evaluationQueued: true,
      quarantinePathVerified: evidence.quarantineCount === expectedQuarantineCount,
      reportGenerated: true,
      reportReady: true,
    },
    sampleScores: evidence.sampleScores.map((sample) => ({
      studentNoHash: sha256(sample.studentNo),
      correct: sample.correct,
      wrong: sample.wrong,
      blank: sample.blank,
      net: sample.net,
    })),
    hashes: {
      tenantHash: sha256(tenantId),
      userHash: sha256(userId),
      emailHash: sha256(smokeEmail.toLowerCase()),
      examHash: sha256(examId),
      rawImportHash: sha256(rawImport.id),
      answerKeyHash: sha256(evaluation.answerKeyId),
      reportSnapshotHash: sha256(snapshot.id),
      firstStudentHash: sha256(studentId(sampleStudentNos[0])),
      opticalTxtSha256: sha256(opticalContent),
      answerKeyFileSha256: sha256(answerKeyContent),
      parseJobHash: sha256(parseJob.jobId),
      reportJobHash: sha256(reportJob.jobId),
    },
    thresholds: {
      participantCountMatches: evidence.participantCount === expectedParticipantCount,
      matchedCountMatches: evidence.matchedCount === expectedMatchedCount,
      examResultCountMatches: evidence.examResultCount === expectedMatchedCount,
      reportResultCountMatches: evidence.snapshotResultCount === expectedMatchedCount,
      sampleScoreCountMatches: evidence.sampleScores.length === sampleStudentNos.length,
      pipelineDurationMsMax: 60_000,
      pipelineDurationPassed: pipelineDurationMs <= 60_000,
    },
    pipelineDurationMs,
    commandsPassed: [commandPassed],
    gaps: [],
  });
  await writeUiWorkerEvidence(uiWorkerEvidencePath, {
    email: smokeEmail,
    examId,
    firstStudentId: studentId(sampleStudentNos[0]),
    guardianPortal: {
      email: sampleGuardianEmail(sampleStudentNos[0]),
      password: smokePassword,
    },
    password: smokePassword,
    studentPortal: {
      email: sampleStudentEmail(sampleStudentNos[0]),
      password: smokePassword,
    },
  });

  console.log(
    `iSEM optical pipeline live smoke passed: tenantHash ${sha256(tenantId)}, examHash ${sha256(examId)}, rawImportHash ${sha256(rawImport.id)}, parseJobHash ${sha256(parseJob.jobId)}, evaluation jobs ${evaluation.queuedCount}, reportJobHash ${sha256(reportJob.jobId)}, snapshotHash ${sha256(snapshot.id)}, results ${evidence.examResultCount}, sampleScores ${formatSampleScores(evidence.sampleScores)}`,
  );
} finally {
  await closeProducer(reportGenerationProducer);
  await closeProducer(rawImportProducer);
  if (app) {
    await app.close();
  }
  await reportWorker.close();
  await evaluationWorker.close();
  await parseWorker.close();
}

async function seedPipelineInput(rows) {
  const pool = new pg.Pool({ connectionString: directDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    await client.query(
      `INSERT INTO "Tenant" ("id", "name", "slug", "status", "seatLimit", "updatedAt")
       VALUES ($1, 'iSEM Optical Smoke Tenant', $2, 'ACTIVE', 500, now())`,
      [tenantId, `isem-optical-smoke-${runId}`],
    );
    await client.query(
      `INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt")
       VALUES ($1, $2, 'iSEM Optical Smoke Admin', $3, now())`,
      [userId, smokeEmail, hashPassword(smokePassword)],
    );
    await client.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt")
       VALUES ($1, $2, $3, 'TENANT_ADMIN', now())`,
      [membershipId, tenantId, userId],
    );
    await client.query(
      `INSERT INTO "Class" ("id", "tenantId", "name", "level", "updatedAt")
       VALUES
         ($1, $2, '8 LGS A', '8', now()),
         ($3, $2, '8 LGS B', '8', now())`,
      [classAId, tenantId, classBId],
    );
    await seedSampleUsers(client);
    await insertRows(
      client,
      `INSERT INTO "Student" ("id", "tenantId", "classId", "firstName", "lastName", "studentNo", "userId", "updatedAt") VALUES `,
      ["id", "tenantId", "classId", "firstName", "lastName", "studentNo", "userId"],
      rows.map((row) => [
        studentId(row.studentNo),
        tenantId,
        row.bookletType === "B" ? classBId : classAId,
        "iSEM",
        `Student ${row.studentNo}`,
        row.studentNo,
        sampleStudentNos.includes(row.studentNo) ? sampleStudentUserId(row.studentNo) : null,
      ]),
    );
    await seedSampleGuardians(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`ISEM_OPTICAL_DB_SEED_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function seedExamScopedInput(rows) {
  const parserConfig = getParserConfigPresetSuggestion("OPTIK_7108_LGS");
  const pool = new pg.Pool({ connectionString: directDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    await client.query(
      `INSERT INTO "ParserConfig" (
         "id", "tenantId", "examId", "version", "encoding", "delimiter", "skipHeaderLines", "fieldMapping", "status", "updatedAt"
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'APPROVED', now())`,
      [
        `parser-isem-optical-smoke-${runId}`,
        tenantId,
        examId,
        parserConfigVersion,
        parserConfig.encoding,
        parserConfig.delimiter,
        parserConfig.skipHeaderLines,
        JSON.stringify(parserConfig.fieldMapping),
      ],
    );
    await insertRows(
      client,
      `INSERT INTO "ExamParticipant" ("id", "tenantId", "examId", "studentId", "participantNo", "bookletType", "status", "updatedAt") VALUES `,
      ["id", "tenantId", "examId", "studentId", "participantNo", "bookletType", "status"],
      rows.map((row) => [
        participantId(row.studentNo),
        tenantId,
        examId,
        studentId(row.studentNo),
        row.studentNo,
        row.bookletType,
        "REGISTERED",
      ]),
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`ISEM_OPTICAL_EXAM_SCOPED_DB_SEED_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function seedSampleUsers(client) {
  for (const studentNo of sampleStudentNos) {
    await client.query(
      `INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt")
       VALUES
         ($1, $2, $3, $4, now()),
         ($5, $6, $7, $4, now())`,
      [
        sampleStudentUserId(studentNo),
        sampleStudentEmail(studentNo),
        `iSEM Student ${studentNo}`,
        hashPassword(smokePassword),
        sampleGuardianUserId(studentNo),
        sampleGuardianEmail(studentNo),
        `iSEM Guardian ${studentNo}`,
      ],
    );
    await client.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt")
       VALUES
         ($1, $2, $3, 'STUDENT', now()),
         ($4, $2, $5, 'GUARDIAN', now())`,
      [
        `membership-student-isem-${runId}-${studentNo}`,
        tenantId,
        sampleStudentUserId(studentNo),
        `membership-guardian-isem-${runId}-${studentNo}`,
        sampleGuardianUserId(studentNo),
      ],
    );
  }
}

async function seedSampleGuardians(client) {
  await insertRows(
    client,
    `INSERT INTO "Guardian" ("id", "tenantId", "firstName", "lastName", "phone", "userId", "updatedAt") VALUES `,
    ["id", "tenantId", "firstName", "lastName", "phone", "userId"],
    sampleStudentNos.map((studentNo) => [
      guardianId(studentNo),
      tenantId,
      "iSEM",
      `Guardian ${studentNo}`,
      `555000${studentNo.padStart(4, "0")}`,
      sampleGuardianUserId(studentNo),
    ]),
  );
  await insertRows(
    client,
    `INSERT INTO "GuardianStudent" ("id", "tenantId", "guardianId", "studentId", "relationshipType", "isPrimary", "updatedAt") VALUES `,
    ["id", "tenantId", "guardianId", "studentId", "relationshipType", "isPrimary"],
    sampleStudentNos.map((studentNo) => [
      `guardian-link-isem-${runId}-${studentNo}`,
      tenantId,
      guardianId(studentNo),
      studentId(studentNo),
      "GUARDIAN",
      true,
    ]),
  );
}

async function createExamWithAnswerKey(baseUrl, token) {
  const response = await postJson(baseUrl, "/api/v1/exams", token, {
    title: "iSEM LGS 1 Optical Smoke Exam",
    answerKey: {
      version: answerKeyVersion,
      fileBase64: answerKeyContent.toString("base64"),
      scoringConfig: { wrongPenalty: 1 / 3 },
    },
  });
  const payload = response.data ?? response;
  examId = payload.id;
  if (
    !examId ||
    payload.title !== "iSEM LGS 1 Optical Smoke Exam" ||
    payload.answerKeySummary?.version !== answerKeyVersion ||
    payload.answerKeySummary?.questionCount !== 90 ||
    payload.answerKeySummary?.status !== "DRAFT"
  ) {
    throw new Error(`ISEM_OPTICAL_EXAM_CREATE_ANSWER_KEY_MISMATCH: ${JSON.stringify(payload)}`);
  }
  return readCreatedAnswerKeyEvidence();
}

async function readCreatedAnswerKeyEvidence() {
  const pool = new pg.Pool({ connectionString: directDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    const result = await client.query(
      `SELECT
         ak."id",
         jsonb_array_length(ak."keyData"->'questions')::int AS "questionCount",
         count(ebv."id")::int AS "bookletVariantCount",
         bool_or(ebv."code" = 'B') AS "hasBookletB"
       FROM "AnswerKey" ak
       LEFT JOIN "ExamBookletVariant" ebv
         ON ebv."tenantId" = ak."tenantId"
        AND ebv."examId" = ak."examId"
        AND ebv."deletedAt" IS NULL
       WHERE ak."tenantId" = $1
         AND ak."examId" = $2
         AND ak."version" = $3
         AND ak."deletedAt" IS NULL
       GROUP BY ak."id", ak."keyData"
      LIMIT 1`,
      [tenantId, examId, answerKeyVersion],
    );
    const answerKey = result.rows[0];
    if (
      !answerKey?.id ||
      answerKey.questionCount !== 90 ||
      answerKey.bookletVariantCount !== 1 ||
      answerKey.hasBookletB !== true
    ) {
      throw new Error(`ISEM_OPTICAL_CREATED_ANSWER_KEY_DB_MISMATCH: ${JSON.stringify(answerKey)}`);
    }
    await client.query("COMMIT");
    return answerKey;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function uploadRawImport(baseUrl, token, content) {
  const response = await postJson(baseUrl, `/api/v1/exams/${examId}/raw-imports`, token, {
    sourceType: "OPTICAL_TXT",
    fileName: `isem-lgs-1-${runId}.txt`,
    fileBase64: Buffer.from(content, "utf8").toString("base64"),
    contentType: "text/plain",
    parserConfigVersion,
  });
  const payload = response.data ?? response;
  if (!payload.rawImport?.id || !payload.rawImport?.s3Key || !payload.parseJob?.jobId) {
    throw new Error(`ISEM_OPTICAL_RAW_IMPORT_UPLOAD_MISMATCH: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function enqueueEvaluation(baseUrl, token, rawImportId) {
  const response = await postJson(baseUrl, `/api/v1/exams/${examId}/raw-imports/${rawImportId}/evaluation-jobs`, token, {});
  return response.data ?? response;
}

async function enqueueReportGeneration(baseUrl, token, rawImportSha256, answerKeyId) {
  const response = await postJson(baseUrl, `/api/v1/exams/${examId}/reports/generation-jobs`, token, {
    reportType: "EXAM_RESULT_SUMMARY",
    contentHash: `${rawImportSha256}-${answerKeyId}`,
  });
  const payload = response.data ?? response;
  if (payload.queueName !== "report-generation" || !payload.jobId) {
    throw new Error(`ISEM_OPTICAL_REPORT_QUEUE_MISMATCH: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForSummary(baseUrl, token, rawImportId, expectedRows, timeoutMs) {
  return waitFor("ISEM_OPTICAL_PARSE_TIMEOUT", timeoutMs, async () => {
    const response = await fetch(`${baseUrl}/api/v1/exams/${examId}/raw-imports/${rawImportId}/summary`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return undefined;
    const body = await response.json();
    const summary = body.data ?? body;
    return summary.totalRows === expectedRows ? summary : undefined;
  });
}

async function waitForExamResultCount(expectedCount, timeoutMs) {
  return waitFor("ISEM_OPTICAL_EVALUATION_TIMEOUT", timeoutMs, async () => {
    const pool = new pg.Pool({ connectionString: directDatabaseUrl });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
      const result = await client.query(
        `SELECT count(*)::int AS "count"
         FROM "ExamResult"
         WHERE "tenantId" = $1
           AND "examId" = $2
           AND "deletedAt" IS NULL`,
        [tenantId, examId],
      );
      await client.query("COMMIT");
      return result.rows[0]?.count === expectedCount ? result.rows[0] : undefined;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  });
}

async function waitForSnapshot(expectedCount, timeoutMs) {
  return waitFor("ISEM_OPTICAL_REPORT_TIMEOUT", timeoutMs, async () => {
    const pool = new pg.Pool({ connectionString: directDatabaseUrl });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
      const result = await client.query(
        `SELECT
           "id",
           ("snapshotData"->>'resultCount')::int AS "resultCount"
         FROM "ReportSnapshot"
         WHERE "tenantId" = $1
           AND "examId" = $2
           AND "reportType" = 'EXAM_RESULT_SUMMARY'
           AND "status" = 'READY'
           AND "deletedAt" IS NULL
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        [tenantId, examId],
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      return row?.resultCount === expectedCount ? row : undefined;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  });
}

async function readPipelineEvidence(rawImportId, answerKeyId, snapshotId) {
  const pool = new pg.Pool({ connectionString: directDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    const result = await client.query(
      `WITH sample_scores AS (
         SELECT jsonb_agg(
           jsonb_build_object(
             'studentNo', s."studentNo",
             'correct', (er."scoreData"->'total'->>'correct')::int,
             'wrong', (er."scoreData"->'total'->>'wrong')::int,
             'blank', (er."scoreData"->'total'->>'blank')::int,
             'net', (er."scoreData"->'total'->>'net')::numeric
           )
           ORDER BY s."studentNo"
         ) AS rows
         FROM "Student" s
         INNER JOIN "ExamResult" er
           ON er."tenantId" = s."tenantId"
          AND er."studentId" = s."id"
         WHERE s."tenantId" = $1
           AND er."examId" = $2
           AND s."studentNo" = ANY($5::text[])
           AND s."deletedAt" IS NULL
           AND er."deletedAt" IS NULL
       )
       SELECT
         (SELECT count(*)::int FROM "Student" WHERE "tenantId" = $1 AND "deletedAt" IS NULL) AS "studentCount",
         (SELECT count(*)::int FROM "ExamParticipant" WHERE "tenantId" = $1 AND "examId" = $2 AND "deletedAt" IS NULL) AS "participantCount",
         (SELECT count(*)::int FROM "ParsedAnswer" WHERE "tenantId" = $1 AND "examId" = $2 AND "rawImportId" = $3 AND "status" = 'MATCHED' AND "deletedAt" IS NULL) AS "matchedCount",
         (SELECT count(*)::int FROM "ImportQuarantine" WHERE "tenantId" = $1 AND "examId" = $2 AND "rawImportId" = $3 AND "deletedAt" IS NULL) AS "quarantineCount",
         (SELECT count(*)::int FROM "ExamResult" WHERE "tenantId" = $1 AND "examId" = $2 AND "rawImportId" = $3 AND "answerKeyId" = $4 AND "deletedAt" IS NULL) AS "examResultCount",
         (SELECT count(*)::int FROM "Student" WHERE "tenantId" = $1 AND "userId" IS NOT NULL AND "deletedAt" IS NULL) AS "studentUserLinkCount",
         (SELECT count(*)::int FROM "Guardian" WHERE "tenantId" = $1 AND "userId" IS NOT NULL AND "deletedAt" IS NULL) AS "guardianUserLinkCount",
         (SELECT count(*)::int FROM "GuardianStudent" WHERE "tenantId" = $1) AS "guardianLinkCount",
         (SELECT ("snapshotData"->>'resultCount')::int FROM "ReportSnapshot" WHERE "tenantId" = $1 AND "examId" = $2 AND "id" = $6) AS "snapshotResultCount",
         COALESCE((SELECT rows FROM sample_scores), '[]'::jsonb) AS "sampleScores"`,
      [tenantId, examId, rawImportId, answerKeyId, sampleStudentNos, snapshotId],
    );
    await client.query("COMMIT");
    const row = result.rows[0];
    return {
      studentCount: row.studentCount,
      participantCount: row.participantCount,
      matchedCount: row.matchedCount,
      quarantineCount: row.quarantineCount,
      examResultCount: row.examResultCount,
      studentUserLinkCount: row.studentUserLinkCount,
      guardianUserLinkCount: row.guardianUserLinkCount,
      guardianLinkCount: row.guardianLinkCount,
      snapshotResultCount: row.snapshotResultCount,
      sampleScores: row.sampleScores.map((sample) => ({ ...sample, net: Number(sample.net) })),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function assertPipelineEvidence(evidence) {
  if (
    evidence.studentCount !== expectedParticipantCount ||
    evidence.participantCount !== expectedParticipantCount ||
    evidence.matchedCount !== expectedMatchedCount ||
    evidence.quarantineCount !== expectedQuarantineCount ||
    evidence.examResultCount !== expectedMatchedCount ||
    evidence.snapshotResultCount !== expectedMatchedCount ||
    evidence.studentUserLinkCount !== 2 ||
    evidence.guardianUserLinkCount !== 2 ||
    evidence.guardianLinkCount !== 2
  ) {
    throw new Error(
      `ISEM_OPTICAL_EVIDENCE_MISMATCH: students ${evidence.studentCount}, participants ${evidence.participantCount}, matched ${evidence.matchedCount}, quarantine ${evidence.quarantineCount}, examResults ${evidence.examResultCount}, reportResults ${evidence.snapshotResultCount}, studentLinks ${evidence.studentUserLinkCount}, guardianLinks ${evidence.guardianUserLinkCount}/${evidence.guardianLinkCount}`,
    );
  }
  for (const sample of evidence.sampleScores) {
    const expected = expectedScores.get(sample.studentNo);
    if (
      !expected ||
      sample.correct !== expected.correct ||
      sample.wrong !== expected.wrong ||
      sample.blank !== expected.blank ||
      Math.abs(sample.net - expected.net) > 0.0001
    ) {
      throw new Error(
        `ISEM_OPTICAL_SAMPLE_SCORE_MISMATCH: studentNoHash ${sha256(sample.studentNo)}, correct ${sample.correct}, wrong ${sample.wrong}, blank ${sample.blank}, net ${sample.net}`,
      );
    }
  }
}

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: smokeEmail, password: smokePassword }),
  });
  if (!response.ok) {
    throw new Error(`ISEM_OPTICAL_LOGIN_FAILED: ${response.status} ${await response.text()}`);
  }
  const body = await response.json();
  return body.data?.accessToken ?? body.accessToken;
}

async function postJson(baseUrl, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`ISEM_OPTICAL_HTTP_FAILED: ${path} ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function waitFor(errorCode, timeoutMs, check) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(errorCode);
}

function readOpticalRows(content) {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.trim())
    .map(normalizeFixedWidthLine)
    .map((line, index) => ({
      rowNumber: index + 1,
      line,
      studentNo: line.slice(11, 15).trim(),
      bookletType: line.slice(50, 51),
    }));
}

function assertOpticalRows(rows) {
  const uniqueStudentNos = new Set(rows.map((row) => row.studentNo));
  const validRows = rows.filter((row) => row.line.length >= 171);
  const aCount = validRows.filter((row) => row.bookletType === "A").length;
  const bCount = validRows.filter((row) => row.bookletType === "B").length;
  if (
    rows.length !== expectedRawRowCount ||
    uniqueStudentNos.size !== expectedRawRowCount ||
    validRows.length !== expectedMatchedCount ||
    aCount !== expectedValidBookletCounts.A ||
    bCount !== expectedValidBookletCounts.B
  ) {
    throw new Error(
      `ISEM_OPTICAL_TXT_SHAPE_MISMATCH: ${JSON.stringify({
        rows: rows.length,
        uniqueStudentNos: uniqueStudentNos.size,
        validRows: validRows.length,
        aCount,
        bCount,
      })}`,
    );
  }
  for (const studentNo of sampleStudentNos) {
    if (!uniqueStudentNos.has(studentNo)) {
      throw new Error(`ISEM_OPTICAL_SAMPLE_STUDENT_MISSING: ${studentNo}`);
    }
  }
}

function normalizeFixedWidthLine(line) {
  if (!line.includes("\t")) {
    return line;
  }

  let normalized = "";
  let column = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\t") {
      const spaceCount = 8 - (column % 8);
      normalized += " ".repeat(spaceCount);
      column += spaceCount;
      continue;
    }
    normalized += char;
    column += 1;
  }
  return normalized;
}

async function insertRows(client, sqlPrefix, columns, rows, rowSuffix = ", now()") {
  if (rows.length === 0) return;
  for (let start = 0; start < rows.length; start += 100) {
    const chunk = rows.slice(start, start + 100);
    const values = [];
    const placeholders = chunk.map((row, rowIndex) => {
      const valuePlaceholders = columns.map((_column, columnIndex) => {
        values.push(row[columnIndex]);
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${valuePlaceholders.join(", ")}${rowSuffix})`;
    });
    await client.query(`${sqlPrefix}${placeholders.join(", ")}`, values);
  }
}

function studentId(studentNo) {
  return `student-isem-optical-${runId}-${studentNo}`;
}

function participantId(studentNo) {
  return `participant-isem-optical-${runId}-${studentNo}`;
}

function guardianId(studentNo) {
  return `guardian-isem-optical-${runId}-${studentNo}`;
}

function sampleStudentUserId(studentNo) {
  return `user-student-isem-optical-${runId}-${studentNo}`;
}

function sampleGuardianUserId(studentNo) {
  return `user-guardian-isem-optical-${runId}-${studentNo}`;
}

function sampleStudentEmail(studentNo) {
  return `isem-student-${studentNo}-${runId}@${smokeEmailDomain}`;
}

function sampleGuardianEmail(studentNo) {
  return `isem-guardian-${studentNo}-${runId}@${smokeEmailDomain}`;
}

async function writeUiWorkerEvidence(filePath, payload) {
  if (!filePath) return;
  const resolvedPath = resolve(filePath);
  assertPrivateRuntimeInputPath(resolvedPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(resolvedPath, 0o600);
  await validateSmokeEvidenceOutputTarget(resolvedPath);
}

function assertPrivateRuntimeInputPath(filePath) {
  const segments = filePath.split(/[\\/]+/).filter(Boolean);
  if (!segments.includes("private")) {
    throw new Error("ISEM_OPTICAL_PIPELINE_UI_WORKER_EVIDENCE_FILE private runtime input dizini altında olmalı.");
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function formatSampleScores(samples) {
  return samples
    .map((sample, index) => `sample${index + 1}:${sample.correct}/${sample.wrong}/${sample.blank}/${sample.net.toFixed(4)}`)
    .join(",");
}

function createS3Client() {
  return new S3Client({
    endpoint: s3Endpoint,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: s3Credentials,
  });
}

async function ensureBucket(s3, bucket) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

function resolveS3Credentials() {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!accessKeyId && !secretAccessKey) {
    return { accessKeyId: "minio", secretAccessKey: "minio123" };
  }
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("ISEM_OPTICAL_S3_CREDENTIALS_INCOMPLETE");
  }
  return { accessKeyId, secretAccessKey };
}

async function waitUntilReady(worker) {
  if (typeof worker.waitUntilReady === "function") {
    await worker.waitUntilReady();
  }
}

async function closeProducer(producer) {
  if (producer && typeof producer.close === "function") {
    await producer.close();
  }
}

async function getBaseUrl(app) {
  const address = app.getHttpServer().address();
  if (!address || typeof address === "string") {
    throw new Error("ISEM_OPTICAL_SERVER_ADDRESS_INVALID");
  }
  return `http://127.0.0.1:${address.port}`;
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
