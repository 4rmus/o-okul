import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const outputPath = readOption("--output") ?? process.env.ADMIN_MFA_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";
const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const adminMfaMode = process.env.ADMIN_MFA_MODE?.trim().toLowerCase();
const recoveryCodesPerEnrollment = Number(process.env.ADMIN_MFA_RECOVERY_CODES_PER_ENROLLMENT);

const evidenceReferenceEnvNames = [
  "ADMIN_MFA_PASSWORD_ONLY_EVIDENCE_REFERENCE",
  "ADMIN_MFA_TOTP_SUCCESS_EVIDENCE_REFERENCE",
  "ADMIN_MFA_INVALID_TOTP_EVIDENCE_REFERENCE",
  "ADMIN_MFA_TOTP_REUSE_EVIDENCE_REFERENCE",
  "ADMIN_MFA_RECOVERY_SUCCESS_EVIDENCE_REFERENCE",
  "ADMIN_MFA_RECOVERY_REUSE_EVIDENCE_REFERENCE",
  "ADMIN_MFA_SESSIONS_REVOKED_ENABLE_EVIDENCE_REFERENCE",
  "ADMIN_MFA_SESSIONS_REVOKED_DISABLE_EVIDENCE_REFERENCE",
];

const commandReferences = evidenceReferenceEnvNames.map((name) => process.env[name]?.trim());

const loginVerificationFlags = [
  ["ADMIN_MFA_PASSWORD_ONLY_LOGIN_BLOCKED", "passwordOnlyLoginBlocked"],
  ["ADMIN_MFA_TOTP_LOGIN_SUCCEEDED", "totpLoginSucceeded"],
  ["ADMIN_MFA_INVALID_TOTP_REJECTED", "invalidTotpRejected"],
  ["ADMIN_MFA_TOTP_REUSE_REJECTED", "totpReuseRejected"],
  ["ADMIN_MFA_RECOVERY_CODE_LOGIN_SUCCEEDED", "recoveryCodeLoginSucceeded"],
  ["ADMIN_MFA_RECOVERY_CODE_REUSE_REJECTED", "recoveryCodeReuseRejected"],
  ["ADMIN_MFA_SESSIONS_REVOKED_ON_ENABLE", "sessionsRevokedOnEnable"],
  ["ADMIN_MFA_SESSIONS_REVOKED_ON_DISABLE", "sessionsRevokedOnDisable"],
];

const commandsPassed = [
  "pnpm --filter @o-okul/api exec vitest run src/auth/auth.service.test.ts src/auth/auth-user-store.test.ts",
  "pnpm --filter @o-okul/api typecheck",
];

const failures = [];
requireValue(outputPath, "ADMIN_MFA_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireValue(directDatabaseUrl, "DIRECT_DATABASE_URL veya DATABASE_URL", failures);
requireOneOf(adminMfaMode, "ADMIN_MFA_MODE", ["optional", "required"], failures);
requireSecretValue(process.env.ADMIN_MFA_SECRET_ENCRYPTION_KEY, "ADMIN_MFA_SECRET_ENCRYPTION_KEY", failures);
requireSecretValue(process.env.ADMIN_MFA_RECOVERY_HASH_KEY, "ADMIN_MFA_RECOVERY_HASH_KEY", failures);
requireSecretValue(process.env.ADMIN_MFA_CHALLENGE_SECRET, "ADMIN_MFA_CHALLENGE_SECRET", failures);
if (!Number.isInteger(recoveryCodesPerEnrollment) || recoveryCodesPerEnrollment < 8) {
  failures.push("ADMIN_MFA_RECOVERY_CODES_PER_ENROLLMENT en az 8 olan tam sayı olmalı.");
}
for (const [envName] of loginVerificationFlags) {
  requireTrue(process.env[envName], envName, failures);
}
for (const [index, reference] of commandReferences.entries()) {
  requireEvidenceReference(reference, evidenceReferenceEnvNames[index], failures);
}
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

const pool = new pg.Pool({ connectionString: directDatabaseUrl });
try {
  const enrollment = await readEnrollment(pool);
  for (const command of commandsPassed) {
    runCommand(command);
  }

  const loginVerification = Object.fromEntries(loginVerificationFlags.map(([, key]) => [key, true]));
  const report = {
    result: "PASS",
    environment,
    checkedAt: new Date().toISOString(),
    policy: {
      mode: adminMfaMode,
      requiredRoles: ["SYSTEM_ADMIN"],
      secretStorage: "aes-256-gcm",
      secretEncryptionKeyEnv: "ADMIN_MFA_SECRET_ENCRYPTION_KEY",
      recoveryCodeHashKeyEnv: "ADMIN_MFA_RECOVERY_HASH_KEY",
      challengeSecretEnv: "ADMIN_MFA_CHALLENGE_SECRET",
      smsOtpRejected: true,
    },
    enrollment,
    loginVerification,
    commandsPassed,
    evidenceReferences: commandReferences,
    gaps: [],
  };

  mkdirSync(dirname(outputFile), { recursive: true });
  validateOutputTarget(outputFile);
  writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  validateOutputTarget(outputFile);
  runCheck(outputFile);
  console.log(`Admin MFA kanıtı yazıldı: ${outputFile}`);
} finally {
  await pool.end();
}

async function readEnrollment(pool) {
  const result = await pool.query(
    `SELECT
       count(DISTINCT u."id") FILTER (WHERE m."role" = 'SYSTEM_ADMIN')::int AS "systemAdminsTotal",
       count(DISTINCT u."id") FILTER (
         WHERE m."role" = 'SYSTEM_ADMIN'
           AND u."totpSecretEncrypted" IS NOT NULL
           AND u."totpEnabledAt" IS NOT NULL
       )::int AS "systemAdminsEnrolled",
       count(DISTINCT u."id") FILTER (
         WHERE m."role" = 'SYSTEM_ADMIN'
           AND (
             u."totpSecretEncrypted" IS NULL
             OR u."totpEnabledAt" IS NULL
           )
       )::int AS "unenrolledRequiredAdmins",
       min(cardinality(u."totpRecoveryCodeHashes")) FILTER (
         WHERE m."role" = 'SYSTEM_ADMIN'
           AND u."totpSecretEncrypted" IS NOT NULL
           AND u."totpEnabledAt" IS NOT NULL
       )::int AS "minimumRecoveryCodesRemaining"
     FROM "TenantMembership" m
     JOIN "User" u ON u."id" = m."userId"
     JOIN "Tenant" t ON t."id" = m."tenantId"
     WHERE t."status" = 'ACTIVE'
       AND m."role" = 'SYSTEM_ADMIN'`,
  );
  const row = result.rows[0] ?? {};
  const enrollment = {
    systemAdminsTotal: Number(row.systemAdminsTotal ?? 0),
    systemAdminsEnrolled: Number(row.systemAdminsEnrolled ?? 0),
    unenrolledRequiredAdmins: Number(row.unenrolledRequiredAdmins ?? 0),
    recoveryCodesPerEnrollment,
  };
  const minimumRecoveryCodesRemaining = Number(row.minimumRecoveryCodesRemaining ?? 0);

  for (const [key, value] of Object.entries(enrollment)) {
    if (!Number.isInteger(value) || value < 0) {
      fail([`enrollment.${key} negatif olmayan tam sayı olmalı.`]);
    }
  }
  if (enrollment.systemAdminsTotal < 1) {
    fail(["enrollment.systemAdminsTotal staging/prod kanıtı için en az 1 olmalı."]);
  }
  if (enrollment.systemAdminsEnrolled !== enrollment.systemAdminsTotal) {
    fail([`SYSTEM_ADMIN MFA enrollment eksik: ${enrollment.systemAdminsEnrolled}/${enrollment.systemAdminsTotal}.`]);
  }
  if (enrollment.unenrolledRequiredAdmins !== 0) {
    fail([`enrollment.unenrolledRequiredAdmins 0 olmalı: ${enrollment.unenrolledRequiredAdmins}.`]);
  }
  if (minimumRecoveryCodesRemaining < 1) {
    fail(["Enrolled admin hesaplarında en az 1 recovery code hash'i kalmalı."]);
  }

  return enrollment;
}

function runCommand(command) {
  const commandEnv = {
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
  for (const key of ["DATABASE_URL", "DIRECT_DATABASE_URL", "IDEMPOTENCY_STORE", "QUEUE_PREFIX"]) {
    delete commandEnv[key];
  }
  const result = spawnSync("sh", ["-lc", command], {
    env: commandEnv,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail([`${command} başarısız oldu.`]);
  }
}

function runCheck(filePath) {
  const result = spawnSync("pnpm", ["admin-mfa:check"], {
    env: {
      ...process.env,
      ADMIN_MFA_EVIDENCE_TARGET: pathToFileURL(filePath).href,
    },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(["pnpm admin-mfa:check başarısız oldu."]);
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

function requireTrue(value, label, output) {
  if (value !== "true") {
    output.push(`${label} true olmalı.`);
  }
}

function requireSecretValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
    return;
  }
  if (hasPlaceholderToken(value) || value.length < 32) {
    output.push(`${label} gerçek secret değeri olmalı; placeholder/redacted/test içeremez ve en az 32 karakter olmalı.`);
  }
}

function requireEvidenceReference(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
    return;
  }
  if (hasPlaceholderToken(value)) {
    output.push(`${label} gerçek artifact/log/run referansı olmalı; placeholder/example/redacted/test içeremez.`);
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
    ".invalid",
    "localhost",
    "127.0.0.1",
    "todo",
    "tbd",
    "???",
  ].some((token) => normalized.includes(token));
}

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) {
    fail(["ADMIN_MFA_OUTPUT lokal temp path olmamalı."]);
  }
  if (isLocalSmokePath(filePath)) {
    fail(["ADMIN_MFA_OUTPUT artifacts/local altında olmamalı."]);
  }

  assertParentPathAllowed(dirname(filePath));

  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail(["ADMIN_MFA_OUTPUT symlink olmayan file artifact olmalı."]);
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
      fail(["ADMIN_MFA_OUTPUT parent dizini symlink olmayan dizin olmalı."]);
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

function isLocalSmokePath(filePath) {
  const normalized = filePath.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized.endsWith("/artifacts/local") || normalized.includes("/artifacts/local/");
}

function fail(messages) {
  console.error("Admin MFA kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
