import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import pg from "pg";

const outputPath = readOption("--output") ?? process.env.KVKK_INVENTORY_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";
const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://migration:migration@localhost:5432/o_okul";
const whatsappEnabled = process.env.WHATSAPP_ENABLED;

const auditTestCommand = "pnpm --filter @o-okul/api exec vitest run src/audit-log/audit-log.service.test.ts src/audit-log/audit-log.e2e.test.ts";
const purgeCoverage = {
  student: ["firstName", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone", "email", "photoKey"],
  studentContact: [
    "firstName", "lastName", "relationType", "phoneEncrypted", "phoneHash", "emailEncrypted", "emailHash",
    "canReceiveSms", "canReceiveAnnouncements", "canReceiveFinance", "consentSource", "consentRecordedAt",
  ],
  teacher: ["firstName", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone"],
  guardian: ["firstName", "lastName", "phone"],
  user: ["email", "name"],
};
const auditActionsVerified = [
  "kvkk.student_pii_purged",
  "kvkk.student_contact_pii_purged",
  "kvkk.teacher_pii_purged",
  "kvkk.guardian_pii_purged",
  "kvkk.user_pii_purged",
];
const auditDiffNegativeControls = [
  "body", "contentBase64", "email", "fileBase64", "fileName", "firstName", "lastName", "message", "name",
  "nationalId", "objectKey", "phone", "rawLine", "rawRow", "rawText", "s3Key", "sourceFileName",
  "sourceFilePath", "subject", "title", "token",
];
const auditDiffActions = [
  "announcement.created",
  "message_template.created",
  "support_ticket.created",
  "support_ticket_comment.created",
  ...auditActionsVerified,
];

const failures = [];
requireValue(outputPath, "KVKK_INVENTORY_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
if (whatsappEnabled !== "false") failures.push("WHATSAPP_ENABLED false olmalı.");
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

const pool = new pg.Pool({ connectionString: directDatabaseUrl });
try {
  const client = await pool.connect();
  let dataSubjectCounts;
  let whatsappCounts;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    ({ dataSubjectCounts, whatsappCounts } = await readInventoryCounts(client));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  runCommand(auditTestCommand);

  const report = {
    result: "PASS",
    environment,
    checkedAt: new Date().toISOString(),
    inventorySource: "staging read-only PostgreSQL counts plus isolated audit-log redaction tests",
    dataSubjectCounts,
    purgeCoverage,
    whatsappConsent: {
      recordCount: whatsappCounts.recordCount,
      eventRecordCount: whatsappCounts.eventRecordCount,
      piiRelevantStoredFields: [
        "phoneHash", "purpose", "canReceiveWhatsapp", "version", "noticeVersion", "source", "recordedAt", "withdrawnAt",
      ],
      piiRelevantEventStoredFields: [
        "whatsappConsentId", "studentContactId", "purpose", "sequence", "eventType", "noticeVersion", "source",
        "recordedAt", "commandKeyHash", "requestHash",
      ],
      policy: {
        featureEnabled: false,
        retentionPeriodDays: 0,
        disposalMethod: "NO_RECORDS_WHILE_DISABLED",
        purgeException: false,
        explanation: "WHATSAPP_ENABLED=false olduğu sürece runtime WhatsAppConsent veya WhatsAppConsentEvent kaydı yazılmaz.",
      },
    },
    auditActionsVerified,
    auditDiffRedactionVerified: {
      endpoint: "/audit-logs",
      negativeControls: auditDiffNegativeControls,
      actionsSampled: auditDiffActions,
      command: auditTestCommand,
    },
    gaps: [],
  };

  mkdirSync(dirname(outputFile), { recursive: true });
  validateOutputTarget(outputFile);
  writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  validateOutputTarget(outputFile);
  runCommand(`KVKK_INVENTORY_TARGET=file://${outputFile} pnpm privacy:inventory:check`);
  console.log(`KVKK envanter kanıtı yazıldı: ${outputFile}`);
} finally {
  await pool.end();
}

async function readInventoryCounts(client) {
  const result = await client.query(
    `SELECT
       (SELECT count(*)::int FROM "Student" WHERE "deletedAt" IS NULL) AS "student",
       (SELECT count(*)::int FROM "StudentContact" WHERE "deletedAt" IS NULL) AS "studentContact",
       (SELECT count(*)::int FROM "Teacher" WHERE "deletedAt" IS NULL) AS "teacher",
       (SELECT count(*)::int FROM "Guardian" WHERE "deletedAt" IS NULL) AS "guardian",
       (SELECT count(*)::int FROM "User") AS "user",
       (SELECT count(*)::int FROM "WhatsAppConsent") AS "whatsappConsent",
       (SELECT count(*)::int FROM "WhatsAppConsentEvent") AS "whatsappConsentEvent"`,
  );
  const row = result.rows[0] ?? {};
  const dataSubjectCounts = {
    student: Number(row.student ?? 0),
    studentContact: Number(row.studentContact ?? 0),
    teacher: Number(row.teacher ?? 0),
    guardian: Number(row.guardian ?? 0),
    user: Number(row.user ?? 0),
  };
  const whatsappCounts = {
    recordCount: Number(row.whatsappConsent ?? 0),
    eventRecordCount: Number(row.whatsappConsentEvent ?? 0),
  };

  if (Object.values(dataSubjectCounts).some((value) => !Number.isInteger(value) || value < 0)) {
    fail(["dataSubjectCounts sıfır veya daha büyük tam sayılar içermeli."]);
  }
  if (Object.values(dataSubjectCounts).reduce((total, value) => total + value, 0) < 1) {
    fail(["dataSubjectCounts toplamı staging/prod gerçek kanıt için sıfırdan büyük olmalı."]);
  }
  if (whatsappCounts.recordCount !== 0 || whatsappCounts.eventRecordCount !== 0) {
    fail([`WhatsApp disabled kanıtı için kayıt sayıları 0/0 olmalı: ${whatsappCounts.recordCount}/${whatsappCounts.eventRecordCount}.`]);
  }

  return { dataSubjectCounts, whatsappCounts };
}

function runCommand(command) {
  const testEnv = {
    ...process.env,
    NODE_ENV: "test",
    PERSISTENCE_DRIVER: "memory",
    API_RATE_LIMIT_ENABLED: "false",
    API_RATE_LIMIT_STORE: "memory",
    LOGIN_ATTEMPT_LIMITER_STORE: "memory",
    QUEUE_METRICS_ENABLED: "false",
    REDIS_URL: "redis://127.0.0.1:1",
    REPORT_PDF_RENDERER: "memory",
  };
  for (const key of ["DATABASE_URL", "DIRECT_DATABASE_URL", "ADMIN_MFA_MODE", "IDEMPOTENCY_STORE", "QUEUE_PREFIX"]) {
    delete testEnv[key];
  }

  const result = spawnSync("sh", ["-lc", command], { env: testEnv, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) fail([`${command} başarısız oldu.`]);
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail([`${name} için değer gerekli.`]);
  return value;
}

function requireValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") output.push(`${label} boş bırakılamaz.`);
}

function requireOneOf(value, label, expected, output) {
  if (!expected.includes(value)) output.push(`${label} ${expected.join(" veya ")} olmalı.`);
}

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) fail(["KVKK_INVENTORY_OUTPUT lokal temp path olmamalı."]);
  assertParentPathAllowed(dirname(filePath));
  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail(["KVKK_INVENTORY_OUTPUT symlink olmayan file artifact olmalı."]);
    }
  }
}

function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["KVKK_INVENTORY_OUTPUT parent dizini symlink olmayan dizin olmalı."]);
    }
  }
}

function isLocalTempPath(filePath) {
  const normalized = filePath.replace(/\/+$/g, "") || "/";
  return normalized === "/tmp" || normalized.startsWith("/tmp/")
    || normalized === "/var/tmp" || normalized.startsWith("/var/tmp/")
    || normalized === "/private/tmp" || normalized.startsWith("/private/tmp/");
}

function fail(messages) {
  console.error("KVKK envanter kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
