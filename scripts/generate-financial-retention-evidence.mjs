import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import pg from "pg";

const outputPath = readOption("--output") ?? process.env.FINANCIAL_RETENTION_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";
const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://migration:migration@localhost:5432/uzman_hocam";

const approvedBy = process.env.FINANCIAL_RETENTION_APPROVED_BY?.trim();
const approvalReference = process.env.FINANCIAL_RETENTION_APPROVAL_REFERENCE?.trim();
const legalBasis = process.env.FINANCIAL_RETENTION_LEGAL_BASIS?.trim();
const retentionPeriodYears = Number(process.env.FINANCIAL_RETENTION_PERIOD_YEARS);
const purgeException = process.env.FINANCIAL_RETENTION_PURGE_EXCEPTION;

const paymentTestCommand = "pnpm --filter @uzman-hocam/api exec vitest run src/payment/payment.e2e.test.ts";

const failures = [];
requireValue(outputPath, "FINANCIAL_RETENTION_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireDecisionValue(approvedBy, "FINANCIAL_RETENTION_APPROVED_BY", failures);
requireDecisionValue(approvalReference, "FINANCIAL_RETENTION_APPROVAL_REFERENCE", failures);
requireDecisionValue(legalBasis, "FINANCIAL_RETENTION_LEGAL_BASIS", failures);
if (!Number.isInteger(retentionPeriodYears) || retentionPeriodYears < 1) {
  failures.push("FINANCIAL_RETENTION_PERIOD_YEARS pozitif tam sayi olmali.");
}
if (purgeException !== "true") {
  failures.push("FINANCIAL_RETENTION_PURGE_EXCEPTION true olmali.");
}
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);
runCommand(paymentTestCommand);

const pool = new pg.Pool({ connectionString: directDatabaseUrl });
try {
  const financialRecords = await readFinancialRecordCounts(pool);
  const report = {
    result: "PASS",
    environment,
    checkedAt: new Date().toISOString(),
    policyDecision: {
      approvedBy,
      approvalReference,
      retentionPeriodYears,
      legalBasis,
      purgeException: true,
    },
    financialRecords,
    purgeBehaviorVerified: [
      "privacy.me.purge_preserves_payment_plans",
      "payment_plan_records_excluded_from_pii_purge",
    ],
    gaps: [],
  };

  mkdirSync(dirname(outputFile), { recursive: true });
  validateOutputTarget(outputFile);
  writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  validateOutputTarget(outputFile);
  runCommand(`FINANCIAL_RETENTION_TARGET=file://${outputFile} pnpm financial-retention:check`);
  console.log(`Finansal saklama kanıtı yazıldı: ${outputFile}`);
} finally {
  await pool.end();
}

async function readFinancialRecordCounts(pool) {
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM "PaymentPlan") AS "paymentPlans",
       (SELECT count(*)::int FROM "PaymentInstallment") AS "installments"`,
  );
  const row = result.rows[0] ?? {};
  const counts = {
    paymentPlans: Number(row.paymentPlans ?? 0),
    installments: Number(row.installments ?? 0),
  };

  for (const [label, value] of Object.entries(counts)) {
    if (!Number.isInteger(value) || value < 1) {
      fail([`financialRecords.${label} staging/prod gerçek kanıt için sıfırdan büyük olmalı.`]);
    }
  }

  return counts;
}

function runCommand(command) {
  const testEnv = { ...process.env };
  for (const key of [
    "DATABASE_URL",
    "DIRECT_DATABASE_URL",
    "NODE_ENV",
    "ADMIN_MFA_MODE",
    "PERSISTENCE_DRIVER",
    "IDEMPOTENCY_STORE",
  ]) {
    delete testEnv[key];
  }

  const result = spawnSync("sh", ["-lc", command], {
    env: testEnv,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail([`${command} başarısız oldu.`]);
  }
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail([`${name} için değer gerekli.`]);
  }
  return value;
}

function requireValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
  }
}

function requireOneOf(value, label, expected, output) {
  if (!expected.includes(value)) {
    output.push(`${label} ${expected.join(" veya ")} olmalı.`);
  }
}

function requireDecisionValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
    return;
  }

  if (hasPlaceholderToken(value)) {
    output.push(`${label} gerçek karar/onay değeri olmalı; placeholder/example/redacted/test içeremez.`);
  }
}

function hasPlaceholderToken(value) {
  const normalized = value.toLowerCase();
  return [
    "__set",
    "change-me",
    "replace-me",
    "placeholder",
    "redacted",
    "example",
    ".test",
    "localhost",
    "todo",
    "tbd",
    "???",
  ].some((token) => normalized.includes(token));
}

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) {
    fail(["FINANCIAL_RETENTION_OUTPUT lokal temp path olmamalı."]);
  }

  assertParentPathAllowed(dirname(filePath));

  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail(["FINANCIAL_RETENTION_OUTPUT symlink olmayan file artifact olmalı."]);
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

    const directoryStat = lstatSync(current);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      fail(["FINANCIAL_RETENTION_OUTPUT parent dizini symlink olmayan dizin olmalı."]);
    }
  }
}

function isLocalTempPath(filePath) {
  const normalized = filePath.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

function fail(messages) {
  console.error("Finansal saklama kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
