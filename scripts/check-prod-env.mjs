import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const contractIndex = args.indexOf("--contract");
const envFileIndex = args.indexOf("--env-file");

if (contractIndex !== -1) {
  const file = args[contractIndex + 1];
  if (!file) {
    fail(["--contract için dosya yolu gerekli."]);
  }
  checkContract(file);
} else {
  const env = envFileIndex === -1 ? process.env : readEnvFile(args[envFileIndex + 1]);
  checkProductionEnv(env);
}

function checkContract(file) {
  const contents = readFileSync(file, "utf8");
  const requiredKeys = [
    "NODE_ENV",
    "APP_URL",
    "API_URL",
    "WEB_URL",
    "DATABASE_URL",
    "DIRECT_DATABASE_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "STUDENT_PII_ENCRYPTION_KEY",
    "STUDENT_PII_HASH_KEY",
    "COOKIE_DOMAIN",
    "COOKIE_SECURE",
    "STUDENT_STORE",
    "TEACHER_STORE",
    "GUARDIAN_STORE",
    "GUARDIAN_STUDENT_STORE",
    "PAYMENT_PLAN_STORE",
    "SMS_PROVIDER",
    "SMS_ALLOW_NOOP_IN_PRODUCTION",
    "SMS_SMOKE_TO",
    "SMS_SMOKE_BODY",
    "SMS_SMOKE_CONFIRM",
    "NOTIFICATION_PROVIDER",
    "NOTIFICATION_ALLOW_NOOP_IN_PRODUCTION",
    "NOTIFICATION_HTTP_ENDPOINT",
    "NOTIFICATION_HTTP_BEARER_TOKEN",
    "NOTIFICATION_SMOKE_EMAIL_TO",
    "NOTIFICATION_SMOKE_PUSH_TO",
    "NOTIFICATION_SMOKE_SUBJECT",
    "NOTIFICATION_SMOKE_BODY",
    "NOTIFICATION_SMOKE_CONFIRM",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "SUPPORT_ATTACHMENT_STORAGE",
    "SENTRY_DSN",
    "SENTRY_SEND_DEFAULT_PII",
    "SENTRY_SMOKE_CONFIRM",
    "SENTRY_SMOKE_MESSAGE",
    "TRAEFIK_HTTPS_SMOKE_URL",
    "BACKUP_PATH",
    "BACKUP_RETENTION_DAYS",
    "BACKUP_OFFSITE_TARGET",
    "WAL_ARCHIVE_TARGET",
    "DEPLOYMENT_REGION_TARGET",
    "RESTORE_DRILL_TARGET",
    "KVKK_INVENTORY_TARGET",
    "IDENTITY_MIGRATION_TARGET",
    "FINANCIAL_RETENTION_TARGET",
    "UPLOAD_AV_TARGET",
    "OBSERVABILITY_UAT_TARGET",
    "SECURITY_AUDIT_TARGET",
    "UAT_EVIDENCE_TARGET",
    "ALERT_WEBHOOK_URL",
    "ALERT_WEBHOOK_TOKEN",
    "ROLLBACK_IMAGE_TAG",
  ];

  const missing = requiredKeys.filter((key) => !contents.includes(`${key}=`));
  if (missing.length > 0) {
    fail(missing.map((key) => `.env sözleşmesinde eksik: ${key}`));
  }

  console.log("Production env sözleşme kontrolü geçti.");
}

function checkProductionEnv(env) {
  const failures = [];

  requireEqual(env, failures, "NODE_ENV", "production");
  requireHttpsUrl(env, failures, "APP_URL");
  requireHttpsUrl(env, failures, "API_URL");
  requireHttpsUrl(env, failures, "WEB_URL");
  requireSet(env, failures, "DATABASE_URL");
  requireSet(env, failures, "DIRECT_DATABASE_URL");
  requireNotContains(env, failures, "DATABASE_URL", ["localhost", "127.0.0.1", "app:app"]);
  requireNotContains(env, failures, "DIRECT_DATABASE_URL", ["localhost", "127.0.0.1", "migration:migration"]);
  requireSecret(env, failures, "JWT_ACCESS_SECRET");
  requireSecret(env, failures, "JWT_REFRESH_SECRET");
  requireSecret(env, failures, "STUDENT_PII_ENCRYPTION_KEY");
  requireSecret(env, failures, "STUDENT_PII_HASH_KEY");
  if (env.JWT_ACCESS_SECRET && env.JWT_REFRESH_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    failures.push("JWT_ACCESS_SECRET ve JWT_REFRESH_SECRET farklı olmalı.");
  }
  if (env.STUDENT_PII_ENCRYPTION_KEY && env.STUDENT_PII_HASH_KEY && env.STUDENT_PII_ENCRYPTION_KEY === env.STUDENT_PII_HASH_KEY) {
    failures.push("STUDENT_PII_ENCRYPTION_KEY ve STUDENT_PII_HASH_KEY farklı olmalı.");
  }
  requireEqual(env, failures, "COOKIE_SECURE", "true");
  requireNotContains(env, failures, "COOKIE_DOMAIN", ["localhost", "127.0.0.1"]);
  requireHttpsUrl(env, failures, "TRAEFIK_HTTPS_SMOKE_URL");

  for (const storeKey of [
    "CLASS_STORE",
    "STUDENT_STORE",
    "TEACHER_STORE",
    "GUARDIAN_STORE",
    "GUARDIAN_STUDENT_STORE",
    "SCHEDULE_STORE",
    "STUDY_SESSION_STORE",
    "HOMEWORK_STORE",
    "PAYMENT_PLAN_STORE",
    "REPORT_SNAPSHOT_STORE",
  ]) {
    requireNotEqual(env, failures, storeKey, "in-memory");
  }

  requireEqual(env, failures, "SMS_PROVIDER", "netgsm");
  requireEqual(env, failures, "SMS_ALLOW_NOOP_IN_PRODUCTION", "false");
  for (const key of ["NETGSM_USERCODE", "NETGSM_PASSWORD", "NETGSM_MSG_HEADER"]) {
    requireSet(env, failures, key);
  }

  requireEqual(env, failures, "NOTIFICATION_PROVIDER", "http");
  requireEqual(env, failures, "NOTIFICATION_ALLOW_NOOP_IN_PRODUCTION", "false");
  requireHttpsUrl(env, failures, "NOTIFICATION_HTTP_ENDPOINT");
  requireSecret(env, failures, "NOTIFICATION_HTTP_BEARER_TOKEN");
  requireSet(env, failures, "NOTIFICATION_SMOKE_EMAIL_TO");
  requireSet(env, failures, "NOTIFICATION_SMOKE_PUSH_TO");
  requireEqual(env, failures, "NOTIFICATION_SMOKE_CONFIRM", "send");

  requireEqual(env, failures, "SUPPORT_ATTACHMENT_STORAGE", "s3");
  requireSet(env, failures, "S3_BUCKET");
  requireHttpsUrl(env, failures, "S3_ENDPOINT");
  requireNotContains(env, failures, "S3_ENDPOINT", ["localhost", "127.0.0.1", "minio"]);
  requireNotContains(env, failures, "S3_ACCESS_KEY_ID", ["minio"]);
  requireNotContains(env, failures, "S3_SECRET_ACCESS_KEY", ["minio123"]);

  requireSet(env, failures, "SENTRY_DSN");
  requireHttpsUrl(env, failures, "SENTRY_DSN");
  requireEqual(env, failures, "SENTRY_SEND_DEFAULT_PII", "false");
  requireSet(env, failures, "BACKUP_PATH");
  requireSet(env, failures, "BACKUP_RETENTION_DAYS");
  requireSet(env, failures, "BACKUP_OFFSITE_TARGET");
  requireSet(env, failures, "WAL_ARCHIVE_TARGET");
  requireSet(env, failures, "DEPLOYMENT_REGION_TARGET");
  requireSet(env, failures, "RESTORE_DRILL_TARGET");
  requireSet(env, failures, "KVKK_INVENTORY_TARGET");
  requireSet(env, failures, "IDENTITY_MIGRATION_TARGET");
  requireSet(env, failures, "FINANCIAL_RETENTION_TARGET");
  requireSet(env, failures, "UPLOAD_AV_TARGET");
  requireSet(env, failures, "OBSERVABILITY_UAT_TARGET");
  requireSet(env, failures, "SECURITY_AUDIT_TARGET");
  requireSet(env, failures, "UAT_EVIDENCE_TARGET");
  requireSet(env, failures, "ALERT_WEBHOOK_URL");
  requireHttpsUrl(env, failures, "ALERT_WEBHOOK_URL");
  requireSet(env, failures, "ROLLBACK_IMAGE_TAG");

  if (failures.length > 0) {
    fail(failures);
  }

  console.log("Production env güvenlik kontrolü geçti.");
}

function readEnvFile(file) {
  if (!file) {
    fail(["--env-file için dosya yolu gerekli."]);
  }

  const env = {};
  const contents = readFileSync(file, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1).replace(/^["']|["']$/g, "");
    env[key] = value;
  }
  return env;
}

function requireSet(env, failures, key) {
  if (!env[key]) {
    failures.push(`${key} boş bırakılamaz.`);
  }
}

function requireEqual(env, failures, key, expected) {
  if (env[key] !== expected) {
    failures.push(`${key} ${expected} olmalı.`);
  }
}

function requireNotEqual(env, failures, key, value) {
  if (env[key] === value) {
    failures.push(`${key} ${value} olamaz.`);
  }
}

function requireNotContains(env, failures, key, forbiddenValues) {
  const value = env[key] ?? "";
  for (const forbidden of forbiddenValues) {
    if (value.includes(forbidden)) {
      failures.push(`${key} production için güvenli görünmüyor.`);
      return;
    }
  }
}

function requireSecret(env, failures, key) {
  const value = env[key] ?? "";
  if (value.length < 32 || value === "change-me") {
    failures.push(`${key} en az 32 karakterlik gerçek secret olmalı.`);
  }
}

function requireHttpsUrl(env, failures, key) {
  const value = env[key] ?? "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      failures.push(`${key} production için https ve gerçek host olmalı.`);
    }
  } catch {
    failures.push(`${key} geçerli URL olmalı.`);
  }
}

function fail(failures) {
  console.error("Production env kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
