import { readFileSync } from "node:fs";
import { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { NestFactory } from "@nestjs/core";
import { hashPassword } from "../apps/api/dist/auth/auth-user-store.js";
import { AppModule } from "../apps/api/dist/app.module.js";
import { configureApiApp } from "../apps/api/dist/http/configure-api-app.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul";
const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://migration:migration@localhost:5432/o_okul";
const runId = randomUUID();
const tenantId = `tenant-isem-answer-key-smoke-${runId}`;
const tenantSlug = `isem-answer-key-smoke-${runId}`;
const userId = `user-isem-answer-key-smoke-${runId}`;
const membershipId = `membership-isem-answer-key-smoke-${runId}`;
const examId = `exam-isem-answer-key-smoke-${runId}`;
const smokeEmail = `isem-answer-key-smoke-${runId}@example.test`;
const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
const smokePassword = resolveSmokePassword(process.env.ISEM_OPTICAL_PIPELINE_SMOKE_PASSWORD);
const answerKeyVersion = "isem-lgs-1-v1";
const answerKeyFilePath = "ornek-veriler/iSEM - LGS - 1 Detaylı Cevap Anahtarı.xlsx";
const expectedBranches = new Map([
  ["LGS TÜRKÇE", 20],
  ["LGS T.C. İNKILAP TARİHİ VE ATATÜRKÇÜLÜK", 10],
  ["LGS DİN KÜLTÜRÜ VE AHLAK BİLGİSİ", 10],
  ["LGS İNGİLİZCE", 10],
  ["LGS MATEMATİK", 20],
  ["LGS FEN BİLİMLERİ", 20],
]);

process.env.DATABASE_URL = databaseUrl;
process.env.PERSISTENCE_DRIVER = "postgres";

const postgresUrl = new URL(directDatabaseUrl);
await assertPort("Postgres", postgresUrl.hostname, Number(postgresUrl.port || 5432), "pnpm db:migrate");

const fileBase64 = readFileSync(answerKeyFilePath).toString("base64");
await seedTenantAndExam();

let app;
try {
  app = await NestFactory.create(AppModule, { logger: false });
  configureApiApp(app);
  await app.listen(0, "127.0.0.1");

  const baseUrl = await getBaseUrl(app);
  const token = await login(baseUrl);
  const dryRun = await postJson(baseUrl, `/api/v1/exams/${examId}/answer-keys/imports/dry-run`, token, {
    version: answerKeyVersion,
    fileBase64,
    scoringConfig: { wrongPenalty: 0.25 },
  });
  const dryRunData = dryRun.data ?? dryRun;
  assertAnswerKeyPreview(dryRunData, true);

  const imported = await postJson(baseUrl, `/api/v1/exams/${examId}/answer-keys/imports`, token, {
    version: answerKeyVersion,
    fileBase64,
    scoringConfig: { wrongPenalty: 0.25 },
  });
  const importData = imported.data ?? imported;
  if (importData.imported !== true) {
    throw new Error(`ISEM_ANSWER_KEY_IMPORT_RESULT_INVALID: ${JSON.stringify(importData)}`);
  }
  assertAnswerKeyPreview(importData.answerKey, false);
  if (!Array.isArray(importData.bookletVariants) || importData.bookletVariants[0]?.code !== "B" || importData.bookletVariants[0]?.questionCount !== 90) {
    throw new Error(`ISEM_ANSWER_KEY_IMPORT_BOOKLET_VARIANT_MISMATCH: ${JSON.stringify(importData.bookletVariants)}`);
  }

  const evidence = await readAnswerKeyEvidence();
  if (
    evidence.answerKeyCount !== 1 ||
    evidence.questionCount !== 90 ||
    evidence.bookletVariantCount !== 1 ||
    evidence.bPermutationCount !== 90 ||
    evidence.firstBookletQuestionNo !== 20
  ) {
    throw new Error(`ISEM_ANSWER_KEY_DB_MISMATCH: ${JSON.stringify(evidence)}`);
  }
  assertBranches(evidence.branches);

  console.log(
    `iSEM answer key live smoke passed: tenant ${tenantId}, exam ${examId}, version ${answerKeyVersion}, questions ${evidence.questionCount}, branches ${evidence.branches.length}, B variant ${evidence.bPermutationCount}, first B maps to ${evidence.firstBookletQuestionNo}`,
  );
} finally {
  if (app) {
    await app.close();
  }
}

async function seedTenantAndExam() {
  const pool = new pg.Pool({ connectionString: directDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    await client.query(
      `INSERT INTO "Tenant" ("id", "name", "slug", "status", "seatLimit", "updatedAt")
       VALUES ($1, 'iSEM Answer Key Smoke Tenant', $2, 'ACTIVE', 200, now())`,
      [tenantId, tenantSlug],
    );
    await client.query(
      `INSERT INTO "User" ("id", "tenantId", "email", "emailNormalized", "loginName", "loginNameNormalized", "name", "passwordHash", "updatedAt")
       VALUES ($1, $2, $3, lower(btrim($3)), $3, lower(btrim($3)), 'iSEM Answer Key Smoke Admin', $4, now())`,
      [userId, tenantId, smokeEmail, hashPassword(smokePassword)],
    );
    await client.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt")
       VALUES ($1, $2, $3, 'TENANT_ADMIN', now())`,
      [membershipId, tenantId, userId],
    );
    await client.query(
      `INSERT INTO "Exam" ("id", "tenantId", "title", "status", "updatedAt")
       VALUES ($1, $2, 'iSEM LGS 1 Smoke Exam', 'DRAFT', now())`,
      [examId, tenantId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`ISEM_ANSWER_KEY_DB_SEED_FAILED: ${error instanceof Error ? error.message : String(error)}`);
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

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantSlug, loginName: smokeEmail, password: smokePassword }),
  });
  if (!response.ok) {
    throw new Error(`ISEM_ANSWER_KEY_LOGIN_FAILED: ${response.status} ${await response.text()}`);
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
    throw new Error(`ISEM_ANSWER_KEY_HTTP_FAILED: ${path} ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function assertAnswerKeyPreview(value, isDryRun) {
  const version = value.version;
  const questionCount = value.questionCount;
  const bookletVariants = value.bookletVariants ?? [];
  if (
    value.tenantId !== tenantId ||
    value.examId !== examId ||
    version !== answerKeyVersion ||
    questionCount !== 90 ||
    (isDryRun && (value.dryRun !== true || value.wouldImport !== true)) ||
    (isDryRun && (bookletVariants[0]?.code !== "B" || bookletVariants[0]?.questionCount !== 90)) ||
    value.scoringConfig?.wrongPenalty !== 0.25
  ) {
    throw new Error(`ISEM_ANSWER_KEY_PREVIEW_MISMATCH: ${JSON.stringify(value)}`);
  }
  assertBranches(value.branches);
}

async function readAnswerKeyEvidence() {
  const pool = new pg.Pool({ connectionString: directDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    const result = await client.query(
      `SELECT
         (SELECT count(*)::int FROM "AnswerKey" WHERE "tenantId" = $1 AND "examId" = $2 AND "deletedAt" IS NULL) AS "answerKeyCount",
         jsonb_array_length(ak."keyData"->'questions') AS "questionCount",
         (
           SELECT jsonb_object_agg(branch, question_count)
           FROM (
             SELECT question->>'branch' AS branch, count(*)::int AS question_count
             FROM jsonb_array_elements(ak."keyData"->'questions') AS question
             GROUP BY question->>'branch'
           ) branch_counts
         ) AS "branches",
         (SELECT count(*)::int FROM "ExamBookletVariant" WHERE "tenantId" = $1 AND "examId" = $2 AND "deletedAt" IS NULL) AS "bookletVariantCount",
         jsonb_array_length(variant."permutation") AS "bPermutationCount",
         (variant."permutation"->>0)::int AS "firstBookletQuestionNo"
       FROM "AnswerKey" ak
       JOIN "ExamBookletVariant" variant
         ON variant."tenantId" = ak."tenantId"
        AND variant."examId" = ak."examId"
        AND variant."code" = 'B'
        AND variant."deletedAt" IS NULL
       WHERE ak."tenantId" = $1
         AND ak."examId" = $2
         AND ak."version" = $3
         AND ak."deletedAt" IS NULL
       LIMIT 1`,
      [tenantId, examId, answerKeyVersion],
    );
    await client.query("COMMIT");
    const row = result.rows[0];
    if (!row) {
      throw new Error("ISEM_ANSWER_KEY_DB_ROW_MISSING");
    }
    return {
      answerKeyCount: row.answerKeyCount,
      questionCount: row.questionCount,
      branches: Object.entries(row.branches).map(([branch, questionCount]) => ({ branch, questionCount: Number(questionCount) })),
      bookletVariantCount: row.bookletVariantCount,
      bPermutationCount: row.bPermutationCount,
      firstBookletQuestionNo: row.firstBookletQuestionNo,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function assertBranches(branches) {
  if (!Array.isArray(branches) || branches.length !== expectedBranches.size) {
    throw new Error(`ISEM_ANSWER_KEY_BRANCH_COUNT_MISMATCH: ${JSON.stringify(branches)}`);
  }
  const actual = new Map(branches.map((branch) => [branch.branch, branch.questionCount]));
  for (const [branch, questionCount] of expectedBranches) {
    if (actual.get(branch) !== questionCount) {
      throw new Error(`ISEM_ANSWER_KEY_BRANCH_MISMATCH: ${branch}`);
    }
  }
}

async function getBaseUrl(app) {
  const address = app.getHttpServer().address();
  if (!address || typeof address === "string") {
    throw new Error("ISEM_ANSWER_KEY_SERVER_ADDRESS_INVALID");
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
