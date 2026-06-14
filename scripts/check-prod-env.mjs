import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const contractIndex = args.indexOf("--contract");
const envFileIndex = args.indexOf("--env-file");

const evidenceTargetKeys = [
  "DEPLOYMENT_REGION_TARGET",
  "DEPLOYMENT_ROLLBACK_TARGET",
  "GITHUB_CI_EVIDENCE_TARGET",
  "RESTORE_DRILL_TARGET",
  "KVKK_INVENTORY_TARGET",
  "IDENTITY_MIGRATION_TARGET",
  "FINANCIAL_RETENTION_TARGET",
  "UPLOAD_AV_TARGET",
  "OBSERVABILITY_UAT_TARGET",
  "EXTERNAL_MONITORING_TARGET",
  "ADMIN_MFA_EVIDENCE_TARGET",
  "AI_REPORT_SUMMARY_EVIDENCE_TARGET",
  "SECURITY_AUDIT_TARGET",
  "UAT_EVIDENCE_TARGET",
  "LIVE_EXAM_CYCLE_TARGET",
  "INLINE_UPLOAD_CONTENT_MIGRATION_TARGET",
  "RATE_LIMIT_EVIDENCE_TARGET",
  "RLS_LIVE_EVIDENCE_TARGET",
  "PILOT_EVIDENCE_TARGET",
  "GO_LIVE_EVIDENCE_TARGET",
  "LIVE_STATUS_EVIDENCE_TARGET",
];

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
    "ADMIN_MFA_MODE",
    "ADMIN_MFA_SECRET_ENCRYPTION_KEY",
    "ADMIN_MFA_RECOVERY_HASH_KEY",
    "ADMIN_MFA_CHALLENGE_SECRET",
    "ADMIN_MFA_ISSUER",
    "AI_REPORT_SUMMARY_PROVIDER",
    "COOKIE_DOMAIN",
    "COOKIE_SECURE",
    "LOG_LEVEL",
    "LOG_ENABLED",
    "OPENAPI_UI_ENABLED",
    "API_RATE_LIMIT_ENABLED",
    "API_RATE_LIMIT_STORE",
    "API_RATE_LIMIT_WINDOW_MS",
    "API_RATE_LIMIT_MAX",
    "IDEMPOTENCY_STORE",
    "REPORT_PDF_RENDERER",
    "REPORT_PDF_RENDER_TIMEOUT_MS",
    "PERSISTENCE_DRIVER",
    "QUEUE_METRICS_ENABLED",
    "QUEUE_BOARD_BASIC_AUTH_USER",
    "QUEUE_BOARD_BASIC_AUTH_PASSWORD",
    "SMS_PROVIDER",
    "SMS_ALLOW_NOOP_IN_PRODUCTION",
    "SMS_SMOKE_TO",
    "SMS_SMOKE_BODY",
    "SMS_SMOKE_CONFIRM",
    "SMS_PROVIDER_SMOKE_EVIDENCE_FILE",
    "NOTIFICATION_PROVIDER",
    "NOTIFICATION_ALLOW_NOOP_IN_PRODUCTION",
    "NOTIFICATION_HTTP_ENDPOINT",
    "NOTIFICATION_HTTP_BEARER_TOKEN",
    "NOTIFICATION_SMOKE_EMAIL_TO",
    "NOTIFICATION_SMOKE_PUSH_TO",
    "NOTIFICATION_SMOKE_SUBJECT",
    "NOTIFICATION_SMOKE_BODY",
    "NOTIFICATION_SMOKE_CONFIRM",
    "NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "SUPPORT_ATTACHMENT_STORAGE",
    "HOMEWORK_MATERIAL_FILE_STORAGE",
    "UPLOAD_AV_SCANNER",
    "CLAMAV_HOST",
    "CLAMAV_PORT",
    "CLAMAV_TIMEOUT_MS",
    "SENTRY_DSN",
    "NEXT_PUBLIC_SENTRY_DSN",
    "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE",
    "SENTRY_SEND_DEFAULT_PII",
    "SENTRY_SMOKE_CONFIRM",
    "SENTRY_SMOKE_MESSAGE",
    "SENTRY_SMOKE_EVIDENCE_FILE",
    "TRAEFIK_HTTPS_SMOKE_URL",
    "TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE",
    "BACKUP_PATH",
    "BACKUP_RETENTION_DAYS",
    "BACKUP_OFFSITE_TARGET",
    "BACKUP_OFFSITE_SMOKE_EVIDENCE_FILE",
    "WAL_ARCHIVE_TARGET",
    "WAL_ARCHIVE_SMOKE_EVIDENCE_FILE",
    "DEPLOYMENT_REGION_TARGET",
    "DEPLOYMENT_ROLLBACK_TARGET",
    "GITHUB_CI_EVIDENCE_TARGET",
    "RESTORE_DRILL_TARGET",
    "KVKK_INVENTORY_TARGET",
    "IDENTITY_MIGRATION_TARGET",
    "FINANCIAL_RETENTION_TARGET",
    "UPLOAD_AV_TARGET",
    "OBSERVABILITY_UAT_TARGET",
    "EXTERNAL_MONITORING_TARGET",
    "ADMIN_MFA_EVIDENCE_TARGET",
    "AI_REPORT_SUMMARY_EVIDENCE_TARGET",
    "SECURITY_AUDIT_TARGET",
    "UAT_EVIDENCE_TARGET",
    "LIVE_EXAM_CYCLE_TARGET",
    "INLINE_UPLOAD_CONTENT_MIGRATION_TARGET",
    "RATE_LIMIT_EVIDENCE_TARGET",
    "RLS_LIVE_EVIDENCE_TARGET",
    "PILOT_EVIDENCE_TARGET",
    "GO_LIVE_EVIDENCE_TARGET",
    "LIVE_STATUS_EVIDENCE_TARGET",
    "ALERT_WEBHOOK_URL",
    "ALERT_WEBHOOK_TOKEN",
    "ALERT_WEBHOOK_SMOKE_EVIDENCE_FILE",
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

  requireNoExampleEvidenceBypass(env, failures);
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
  requireOneOf(env, failures, "ADMIN_MFA_MODE", ["optional", "required"]);
  requireSecret(env, failures, "ADMIN_MFA_SECRET_ENCRYPTION_KEY");
  requireSecret(env, failures, "ADMIN_MFA_RECOVERY_HASH_KEY");
  requireSecret(env, failures, "ADMIN_MFA_CHALLENGE_SECRET");
  requireSet(env, failures, "ADMIN_MFA_ISSUER");
  requireNoPlaceholderValue(env, failures, "ADMIN_MFA_ISSUER");
  requireEqual(env, failures, "AI_REPORT_SUMMARY_PROVIDER", "disabled");
  if (env.JWT_ACCESS_SECRET && env.JWT_REFRESH_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    failures.push("JWT_ACCESS_SECRET ve JWT_REFRESH_SECRET farklı olmalı.");
  }
  if (env.STUDENT_PII_ENCRYPTION_KEY && env.STUDENT_PII_HASH_KEY && env.STUDENT_PII_ENCRYPTION_KEY === env.STUDENT_PII_HASH_KEY) {
    failures.push("STUDENT_PII_ENCRYPTION_KEY ve STUDENT_PII_HASH_KEY farklı olmalı.");
  }
  if (env.ADMIN_MFA_SECRET_ENCRYPTION_KEY && env.ADMIN_MFA_RECOVERY_HASH_KEY && env.ADMIN_MFA_SECRET_ENCRYPTION_KEY === env.ADMIN_MFA_RECOVERY_HASH_KEY) {
    failures.push("ADMIN_MFA_SECRET_ENCRYPTION_KEY ve ADMIN_MFA_RECOVERY_HASH_KEY farklı olmalı.");
  }
  if (env.ADMIN_MFA_CHALLENGE_SECRET && env.JWT_ACCESS_SECRET && env.ADMIN_MFA_CHALLENGE_SECRET === env.JWT_ACCESS_SECRET) {
    failures.push("ADMIN_MFA_CHALLENGE_SECRET ve JWT_ACCESS_SECRET farklı olmalı.");
  }
  requireEqual(env, failures, "COOKIE_SECURE", "true");
  requireNotContains(env, failures, "COOKIE_DOMAIN", ["localhost", "127.0.0.1"]);
  requireNoPlaceholderValue(env, failures, "COOKIE_DOMAIN");
  requireHttpsUrl(env, failures, "TRAEFIK_HTTPS_SMOKE_URL");
  requireMatchingUrlOrigin(env, failures, "TRAEFIK_HTTPS_SMOKE_URL", "WEB_URL");
  requireOneOf(env, failures, "LOG_LEVEL", ["info", "warn", "error"]);
  requireEqual(env, failures, "LOG_ENABLED", "true");
  requireEqual(env, failures, "OPENAPI_UI_ENABLED", "false");
  requireEqual(env, failures, "API_RATE_LIMIT_ENABLED", "true");
  requireEqual(env, failures, "API_RATE_LIMIT_STORE", "redis");
  requirePositiveInteger(env, failures, "API_RATE_LIMIT_WINDOW_MS");
  requirePositiveInteger(env, failures, "API_RATE_LIMIT_MAX");
  requireEqual(env, failures, "IDEMPOTENCY_STORE", "postgres");
  requireEqual(env, failures, "REPORT_PDF_RENDERER", "worker");
  requirePositiveInteger(env, failures, "REPORT_PDF_RENDER_TIMEOUT_MS");

  requireEqual(env, failures, "PERSISTENCE_DRIVER", "postgres");
  requireEqual(env, failures, "QUEUE_METRICS_ENABLED", "true");
  requireSet(env, failures, "QUEUE_BOARD_BASIC_AUTH_USER");
  requireNoPlaceholderValue(env, failures, "QUEUE_BOARD_BASIC_AUTH_USER");
  requireSecret(env, failures, "QUEUE_BOARD_BASIC_AUTH_PASSWORD");

  requireEqual(env, failures, "SMS_PROVIDER", "netgsm");
  requireEqual(env, failures, "SMS_ALLOW_NOOP_IN_PRODUCTION", "false");
  requireSet(env, failures, "SMS_SMOKE_TO");
  requireNoPlaceholderValue(env, failures, "SMS_SMOKE_TO");
  requireSet(env, failures, "SMS_SMOKE_BODY");
  requireNoPlaceholderValue(env, failures, "SMS_SMOKE_BODY");
  requireEqual(env, failures, "SMS_SMOKE_CONFIRM", "send");
  for (const key of ["NETGSM_USERCODE", "NETGSM_PASSWORD", "NETGSM_MSG_HEADER"]) {
    requireProviderCredential(env, failures, key);
  }

  requireEqual(env, failures, "NOTIFICATION_PROVIDER", "http");
  requireEqual(env, failures, "NOTIFICATION_ALLOW_NOOP_IN_PRODUCTION", "false");
  requireHttpsUrl(env, failures, "NOTIFICATION_HTTP_ENDPOINT");
  requireSecret(env, failures, "NOTIFICATION_HTTP_BEARER_TOKEN");
  requireSet(env, failures, "NOTIFICATION_SMOKE_EMAIL_TO");
  requireSet(env, failures, "NOTIFICATION_SMOKE_PUSH_TO");
  requireSet(env, failures, "NOTIFICATION_SMOKE_SUBJECT");
  requireNoPlaceholderValue(env, failures, "NOTIFICATION_SMOKE_SUBJECT");
  requireSet(env, failures, "NOTIFICATION_SMOKE_BODY");
  requireNoPlaceholderValue(env, failures, "NOTIFICATION_SMOKE_BODY");
  requireEqual(env, failures, "NOTIFICATION_SMOKE_CONFIRM", "send");

  requireEqual(env, failures, "SUPPORT_ATTACHMENT_STORAGE", "s3");
  requireEqual(env, failures, "HOMEWORK_MATERIAL_FILE_STORAGE", "s3");
  requireEqual(env, failures, "UPLOAD_AV_SCANNER", "clamav");
  requireSet(env, failures, "CLAMAV_HOST");
  requirePositiveInteger(env, failures, "CLAMAV_PORT");
  requirePositiveInteger(env, failures, "CLAMAV_TIMEOUT_MS");
  requireSet(env, failures, "S3_BUCKET");
  requireNoPlaceholderValue(env, failures, "S3_BUCKET");
  requireHttpsUrl(env, failures, "S3_ENDPOINT");
  requireNotContains(env, failures, "S3_ENDPOINT", ["localhost", "127.0.0.1", "minio"]);
  requireProviderCredential(env, failures, "S3_ACCESS_KEY_ID");
  requireProviderCredential(env, failures, "S3_SECRET_ACCESS_KEY");
  requireNotContains(env, failures, "S3_ACCESS_KEY_ID", ["minio"]);
  requireNotContains(env, failures, "S3_SECRET_ACCESS_KEY", ["minio123"]);

  requireSet(env, failures, "SENTRY_DSN");
  requireHttpsUrl(env, failures, "SENTRY_DSN");
  requireSet(env, failures, "NEXT_PUBLIC_SENTRY_DSN");
  requireHttpsUrl(env, failures, "NEXT_PUBLIC_SENTRY_DSN");
  requireNoPlaceholderValue(env, failures, "NEXT_PUBLIC_SENTRY_DSN");
  requireNumberBetween(env, failures, "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", 0, 1);
  requireEqual(env, failures, "SENTRY_SEND_DEFAULT_PII", "false");
  requireEqual(env, failures, "SENTRY_SMOKE_CONFIRM", "send");
  requireSet(env, failures, "SENTRY_SMOKE_MESSAGE");
  requireNoPlaceholderValue(env, failures, "SENTRY_SMOKE_MESSAGE");
  requireSet(env, failures, "BACKUP_PATH");
  requireSet(env, failures, "BACKUP_RETENTION_DAYS");
  requireBackupTarget(env, failures, "BACKUP_OFFSITE_TARGET");
  requireBackupTarget(env, failures, "WAL_ARCHIVE_TARGET");
  requireDistinctBackupTargets(env, failures, "BACKUP_OFFSITE_TARGET", "WAL_ARCHIVE_TARGET");
  for (const key of evidenceTargetKeys) {
    requireEvidenceTargetUrl(env, failures, key);
  }
  requireSet(env, failures, "ALERT_WEBHOOK_URL");
  requireHttpsUrl(env, failures, "ALERT_WEBHOOK_URL");
  requireSecret(env, failures, "ALERT_WEBHOOK_TOKEN");
  requireSet(env, failures, "ROLLBACK_IMAGE_TAG");
  requireNoPlaceholderValue(env, failures, "ROLLBACK_IMAGE_TAG");

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

function requireOneOf(env, failures, key, expectedValues) {
  if (!expectedValues.includes(env[key])) {
    failures.push(`${key} şu değerlerden biri olmalı: ${expectedValues.join(", ")}.`);
  }
}

function requireNotContains(env, failures, key, forbiddenValues) {
  const value = (env[key] ?? "").toLowerCase();
  for (const forbidden of forbiddenValues) {
    if (value.includes(forbidden.toLowerCase())) {
      failures.push(`${key} production için güvenli görünmüyor.`);
      return;
    }
  }
}

function requireNoPlaceholderValue(env, failures, key) {
  const value = env[key] ?? "";
  if (!value || !hasPlaceholderToken(value)) {
    return;
  }

  failures.push(`${key} production için placeholder/test/example değer içermemeli.`);
}

function requireProviderCredential(env, failures, key) {
  requireSet(env, failures, key);
  requireNoPlaceholderValue(env, failures, key);
}

function requireNoExampleEvidenceBypass(env, failures) {
  for (const [key, value] of Object.entries(env)) {
    if (key.endsWith("_ALLOW_EXAMPLE_EVIDENCE") && value === "1") {
      failures.push(`${key} production evidence kontrolünde açık bırakılamaz.`);
    }
  }
}

function requireSecret(env, failures, key) {
  const value = env[key] ?? "";
  if (value.length < 32 || hasPlaceholderToken(value)) {
    failures.push(`${key} en az 32 karakterlik gerçek secret olmalı.`);
  }
}

function requirePositiveInteger(env, failures, key) {
  const value = Number(env[key]);
  if (!Number.isInteger(value) || value <= 0) {
    failures.push(`${key} pozitif tam sayı olmalı.`);
  }
}

function requireNumberBetween(env, failures, key, min, max) {
  const value = Number(env[key]);
  if (!Number.isFinite(value) || value < min || value > max) {
    failures.push(`${key} ${min}-${max} arasında sayı olmalı.`);
  }
}

function requireHttpsUrl(env, failures, key) {
  const value = env[key] ?? "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || isPlaceholderHost(url.hostname)) {
      failures.push(`${key} production için https ve gerçek host olmalı.`);
    }
  } catch {
    failures.push(`${key} geçerli URL olmalı.`);
  }
}

function requireMatchingUrlOrigin(env, failures, firstKey, secondKey) {
  const first = env[firstKey];
  const second = env[secondKey];
  if (typeof first !== "string" || typeof second !== "string") return;

  try {
    if (new URL(first).origin !== new URL(second).origin) {
      failures.push(`${firstKey} ${secondKey} origin'i ile eşleşmeli.`);
    }
  } catch {
    // URL format errors are reported by the field-specific URL validators.
  }
}

function requireEvidenceTargetUrl(env, failures, key) {
  const value = env[key] ?? "";
  if (!value) {
    failures.push(`${key} boş bırakılamaz.`);
    return;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    failures.push(`${key} file:// veya https:// URL olmalı.`);
    return;
  }

  if (!["file:", "https:"].includes(url.protocol)) {
    failures.push(`${key} file:// veya https:// URL olmalı.`);
    return;
  }

  if (hasPlaceholderToken(value)) {
    failures.push(`${key} production için placeholder/test/example değer içermemeli.`);
  }

  if (url.protocol === "https:" && isPlaceholderHost(url.hostname)) {
    failures.push(`${key} production için gerçek https host olmalı.`);
  }

  if (url.protocol === "file:") {
    const path = decodeURIComponent(url.pathname).replace(/\/+$/g, "") || "/";
    if (path === "/" || path === "/tmp" || path.startsWith("/tmp/") || path === "/var/tmp" || path.startsWith("/var/tmp/")) {
      failures.push(`${key} production için lokal temp path olmamalı.`);
    }
  }
}

function requireBackupTarget(env, failures, key) {
  const value = env[key] ?? "";
  let url;
  try {
    url = new URL(value);
  } catch {
    failures.push(`${key} s3:// veya file:// URL olmalı.`);
    return;
  }

  if (!["s3:", "file:"].includes(url.protocol)) {
    failures.push(`${key} s3:// veya file:// URL olmalı.`);
    return;
  }

  if (hasBackupPlaceholderToken(value)) {
    failures.push(`${key} production için gerçek off-host hedef olmalı.`);
  }

  if (url.protocol === "s3:") {
    const prefix = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!url.hostname || !prefix) {
      failures.push(`${key} s3://bucket/prefix biçiminde olmalı.`);
    }
  }

  if (url.protocol === "file:") {
    const path = decodeURIComponent(url.pathname).replace(/\/+$/g, "") || "/";
    if (path === "/" || path === "/tmp" || path.startsWith("/tmp/") || path === "/var/tmp" || path.startsWith("/var/tmp/")) {
      failures.push(`${key} production için lokal temp path olmamalı.`);
    }
  }
}

function requireDistinctBackupTargets(env, failures, firstKey, secondKey) {
  const first = normalizeBackupTarget(env[firstKey]);
  const second = normalizeBackupTarget(env[secondKey]);
  if (!first || !second) return;

  if (first === second) {
    failures.push(`${firstKey} ve ${secondKey} ayrı bucket veya path olmalı.`);
  }
}

function normalizeBackupTarget(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol === "s3:") {
      const prefix = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
      return `s3://${url.hostname.toLowerCase()}/${prefix}`;
    }
    if (url.protocol === "file:") {
      const path = decodeURIComponent(url.pathname).replace(/\/+$/g, "") || "/";
      return `file://${url.hostname.toLowerCase()}${path}`;
    }
  } catch {
    return "";
  }
  return "";
}

function isPlaceholderHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".test") ||
    normalized.endsWith(".example") ||
    normalized.endsWith(".invalid") ||
    normalized === "example.com" ||
    normalized.endsWith(".example.com") ||
    normalized.includes("example") ||
    normalized.includes("__set") ||
    normalized.includes("placeholder")
  );
}

function hasPlaceholderToken(value) {
  const normalized = value.toLowerCase();
  return [
    "__set",
    "change-me",
    "replace-me",
    "placeholder",
    "localhost",
    "127.0.0.1",
    ".test",
    ".example",
    ".invalid",
    "example",
  ].some((token) => normalized.includes(token));
}

function hasBackupPlaceholderToken(value) {
  const normalized = value.toLowerCase();
  return (
    hasPlaceholderToken(value) ||
    ["backup-bucket", "wal-bucket", "minio", "local", "dummy"].some((token) => normalized.includes(token))
  );
}

function fail(failures) {
  console.error("Production env kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
