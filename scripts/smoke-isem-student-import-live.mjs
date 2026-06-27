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
const tenantId = `tenant-isem-student-smoke-${runId}`;
const userId = `user-isem-student-smoke-${runId}`;
const membershipId = `membership-isem-student-smoke-${runId}`;
const classAId = `class-isem-student-smoke-a-${runId}`;
const classBId = `class-isem-student-smoke-b-${runId}`;
const smokeEmail = `isem-student-smoke-${runId}@example.test`;
const smokePassword = "password";
const importFilePath = "ornek-veriler/ogrenci-aktarim-excel.xlsx";
const opticalTxtPath = "ornek-veriler/iSEM .txt";

process.env.DATABASE_URL = databaseUrl;
process.env.PERSISTENCE_DRIVER = "postgres";

const postgresUrl = new URL(directDatabaseUrl);
await assertPort("Postgres", postgresUrl.hostname, Number(postgresUrl.port || 5432), "pnpm db:migrate");

const fileBase64 = readFileSync(importFilePath).toString("base64");
const opticalStudentNos = readOpticalStudentNos(opticalTxtPath);

await seedTenant();

let app;
try {
  app = await NestFactory.create(AppModule, { logger: false });
  configureApiApp(app);
  await app.listen(0, "127.0.0.1");

  const baseUrl = await getBaseUrl(app);
  const token = await login(baseUrl);
  const dryRun = await postJson(baseUrl, "/api/v1/students/imports/dry-run", token, { fileBase64 });
  const dryRunData = dryRun.data ?? dryRun;
  assertDryRun(dryRunData);

  const imported = await postJson(baseUrl, "/api/v1/students/imports", token, { fileBase64 });
  const importData = imported.data ?? imported;
  if (importData.importedRows !== 19 || !Array.isArray(importData.students) || importData.students.length !== 19) {
    throw new Error("ISEM_STUDENT_IMPORT_IMPORTED_ROWS_MISMATCH");
  }

  const evidence = await readImportEvidence(dryRunData.validRows, opticalStudentNos);
  if (
    evidence.studentCount !== 19 ||
    evidence.guardianCount !== 19 ||
    evidence.guardianLinkCount !== 19 ||
    evidence.matchedOpticalStudentNoCount !== 17 ||
    evidence.missingOpticalStudentNos.join(",") !== "1597,1606"
  ) {
    throw new Error(`ISEM_STUDENT_IMPORT_DB_MISMATCH: ${JSON.stringify(evidence)}`);
  }

  console.log(
    `iSEM student import live smoke passed: tenant ${tenantId}, dry-run ${dryRunData.totalRows} rows, imported ${importData.importedRows} students, guardian links ${evidence.guardianLinkCount}, TXT match ${evidence.matchedOpticalStudentNoCount}/19, missing TXT ${evidence.missingOpticalStudentNos.join(",")}, first student ${evidence.firstStudentNo}`,
  );
} finally {
  if (app) {
    await app.close();
  }
}

async function seedTenant() {
  const pool = new pg.Pool({ connectionString: directDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    await client.query(
      `INSERT INTO "Tenant" ("id", "name", "slug", "status", "seatLimit", "updatedAt")
       VALUES ($1, 'iSEM Student Smoke Tenant', $2, 'ACTIVE', 200, now())`,
      [tenantId, `isem-student-smoke-${runId}`],
    );
    await client.query(
      `INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt")
       VALUES ($1, $2, 'iSEM Student Smoke Admin', $3, now())`,
      [userId, smokeEmail, hashPassword(smokePassword)],
    );
    await client.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt")
       VALUES ($1, $2, $3, 'TENANT_ADMIN', now())`,
      [membershipId, tenantId, userId],
    );
    await client.query(
      `INSERT INTO "Class" ("id", "tenantId", "name", "updatedAt")
       VALUES
         ($1, $2, '8 LGS A', now()),
         ($3, $2, '8 LGS B', now())`,
      [classAId, tenantId, classBId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`ISEM_STUDENT_IMPORT_DB_SEED_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: smokeEmail, password: smokePassword }),
  });
  if (!response.ok) {
    throw new Error(`ISEM_STUDENT_IMPORT_LOGIN_FAILED: ${response.status} ${await response.text()}`);
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
    throw new Error(`ISEM_STUDENT_IMPORT_HTTP_FAILED: ${path} ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function assertDryRun(dryRun) {
  if (
    dryRun.dryRun !== true ||
    dryRun.totalRows !== 19 ||
    dryRun.wouldImport !== true ||
    !Array.isArray(dryRun.validRows) ||
    dryRun.validRows.length !== 19 ||
    !Array.isArray(dryRun.errors) ||
    dryRun.errors.length !== 0 ||
    dryRun.quota?.current !== 0 ||
    dryRun.quota?.incoming !== 19 ||
    dryRun.quota?.wouldExceed !== false
  ) {
    throw new Error(`ISEM_STUDENT_IMPORT_DRY_RUN_MISMATCH: ${JSON.stringify(dryRun)}`);
  }
}

async function readImportEvidence(validRows, opticalStudentNos) {
  const importedStudentNos = validRows.map((row) => row.studentNo).filter(Boolean);
  const missingOpticalStudentNos = importedStudentNos.filter((studentNo) => !opticalStudentNos.has(studentNo)).sort(numericSort);
  const pool = new pg.Pool({ connectionString: directDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    const result = await client.query(
      `SELECT
         (SELECT count(*)::int FROM "Student" WHERE "tenantId" = $1 AND "deletedAt" IS NULL) AS "studentCount",
         (SELECT count(*)::int FROM "Guardian" WHERE "tenantId" = $1 AND "deletedAt" IS NULL) AS "guardianCount",
         (SELECT count(*)::int FROM "GuardianStudent" WHERE "tenantId" = $1) AS "guardianLinkCount",
         (SELECT count(*)::int FROM "Student" WHERE "tenantId" = $1 AND "userId" IS NOT NULL) AS "studentUserLinkCount",
         (SELECT count(*)::int FROM "Guardian" WHERE "tenantId" = $1 AND "userId" IS NOT NULL) AS "guardianUserLinkCount",
         (SELECT "studentNo" FROM "Student" WHERE "tenantId" = $1 ORDER BY "createdAt", "studentNo" LIMIT 1) AS "firstStudentNo"`,
      [tenantId],
    );
    await client.query("COMMIT");
    const row = result.rows[0];
    return {
      studentCount: row.studentCount,
      guardianCount: row.guardianCount,
      guardianLinkCount: row.guardianLinkCount,
      studentUserLinkCount: row.studentUserLinkCount,
      guardianUserLinkCount: row.guardianUserLinkCount,
      firstStudentNo: row.firstStudentNo,
      matchedOpticalStudentNoCount: importedStudentNos.length - missingOpticalStudentNos.length,
      missingOpticalStudentNos,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function readOpticalStudentNos(path) {
  const content = readFileSync(path, "utf8");
  return new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(\d{1,4})/)?.[1])
      .filter(Boolean),
  );
}

function numericSort(left, right) {
  return Number(left) - Number(right);
}

async function getBaseUrl(app) {
  const address = app.getHttpServer().address();
  if (!address || typeof address === "string") {
    throw new Error("ISEM_STUDENT_IMPORT_SERVER_ADDRESS_INVALID");
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
