import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import {
  ISEM_OPTICAL_PIPELINE_FIXTURE,
  ISEM_OPTICAL_PIPELINE_INPUT_MANIFEST,
} from "./isem-optical-pipeline-contract.mjs";

export async function writeSmokeEvidence(filePath, payload) {
  if (!filePath) return;
  const resolvedPath = resolve(filePath);
  const finalPayload = {
    generatedAt: new Date().toISOString(),
    ...payload,
  };
  const payloadFailures = validateSmokeEvidencePayload(finalPayload, { label: "Smoke evidence output" });
  if (payloadFailures.length > 0) {
    throw new Error(`SMOKE_EVIDENCE_PAYLOAD_INVALID: ${payloadFailures.join("; ")}`);
  }
  await validateSmokeEvidenceOutputPath(resolvedPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await assertParentDirectoryAllowed(dirname(resolvedPath));
  await assertExistingFileArtifact(resolvedPath);
  await writeFile(resolvedPath, `${JSON.stringify(finalPayload, null, 2)}\n`, "utf8");
  await assertExistingFileArtifact(resolvedPath);
}

export async function validateSmokeEvidenceOutputTarget(filePath) {
  if (!filePath) return;
  await validateSmokeEvidenceOutputPath(resolve(filePath));
}

export function validateSmokeEvidencePayload(
  payload,
  { expectedCheck, allowedEnvironments, label = "Smoke kanıt", allowExampleEvidence = false } = {},
) {
  const failures = [];

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [`${label} nesnesi zorunlu.`];
  }

  if (payload.result !== "PASS") {
    failures.push(`${label}.result PASS olmalı.`);
  }

  if (expectedCheck && payload.check !== expectedCheck) {
    failures.push(`${label}.check ${expectedCheck} olmalı.`);
  }

  if (allowedEnvironments) {
    requireAllowedEnvironment(payload, failures, `${label}.environment`, allowedEnvironments);
  }

  requireDateNotInFuture(payload, failures, `${label}.generatedAt`, "generatedAt", allowExampleEvidence);
  validateCheckSpecificPayload(payload, failures, label, allowExampleEvidence);

  return failures;
}

export function validateReusedNotificationSmokePayload(payload, { notBefore, email, pushTo } = {}) {
  const failures = validateSmokeEvidencePayload(payload, {
    expectedCheck: "notification_provider_smoke",
    allowedEnvironments: ["staging", "production"],
    label: "Reused notification smoke",
  });
  const notBeforeTimestamp = Date.parse(notBefore ?? "");

  if (!notBefore || Number.isNaN(notBeforeTimestamp)) {
    failures.push("NOTIFICATION_SMOKE_NOT_BEFORE geçerli cutover tarihi olmalı.");
    return failures;
  }

  if (Date.parse(payload?.checkedAt ?? "") < notBeforeTimestamp) {
    failures.push("Reused notification smoke checkedAt cutover zamanından eski olamaz.");
  }
  if (Date.parse(payload?.generatedAt ?? "") < notBeforeTimestamp) {
    failures.push("Reused notification smoke generatedAt cutover zamanından eski olamaz.");
  }
  if (payload?.provider !== "http") {
    failures.push("Reused notification smoke provider http olmalı.");
  }
  if (!Array.isArray(payload?.channels) || payload.channels.length !== 1 || payload.channels[0] !== "EMAIL") {
    failures.push("Reused notification smoke yalnız EMAIL kanalını içermeli.");
  }
  if (pushTo) {
    failures.push("Reused notification smoke için NOTIFICATION_SMOKE_PUSH_TO boş olmalı.");
  }
  const expectedRecipient = typeof email === "string" && email ? maskRecipient(email) : undefined;
  if (!expectedRecipient || payload?.recipients?.length !== 1 || payload.recipients[0] !== expectedRecipient) {
    failures.push("Reused notification smoke alıcısı configured email maskesiyle eşleşmeli.");
  }

  return failures;
}

export function redactedUrl(value) {
  const url = value instanceof URL ? new URL(value.href) : new URL(value);
  url.username = "";
  url.password = "";
  url.hash = "";
  return url.href;
}

function maskRecipient(value) {
  const visible = value.slice(-4);
  return `${"*".repeat(Math.max(0, value.length - visible.length))}${visible}`;
}

async function validateSmokeEvidenceOutputPath(filePath) {
  if (isLocalTempPath(filePath)) {
    throw new Error("SMOKE_EVIDENCE_FILE lokal temp path olmamalı.");
  }

  await assertParentPathAllowed(dirname(filePath));
  await assertExistingFileArtifact(filePath);
}

async function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);

    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("SMOKE_EVIDENCE_FILE parent directory symlink olmayan dizin olmalı.");
    }
  }
}

async function assertParentDirectoryAllowed(parentPath) {
  const stat = await lstat(parentPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("SMOKE_EVIDENCE_FILE parent directory symlink olmayan dizin olmalı.");
  }
}

async function assertExistingFileArtifact(filePath) {
  let stat;
  try {
    stat = await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("SMOKE_EVIDENCE_FILE symlink olmayan file artifact olmalı.");
  }
}

function isLocalTempPath(filePath) {
  return (
    filePath === "/tmp" ||
    filePath.startsWith("/tmp/") ||
    filePath === "/var/tmp" ||
    filePath.startsWith("/var/tmp/") ||
    filePath === "/private/tmp" ||
    filePath.startsWith("/private/tmp/")
  );
}

function requireDateNotInFuture(scope, failures, label, key, allowExampleEvidence = false) {
  const value = scope[key];
  const timestamp = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(timestamp)) {
    failures.push(`${label} geçerli tarih olmalı.`);
    return;
  }

  if (allowExampleEvidence) return;

  const clockSkewMs = 5 * 60 * 1000;
  if (timestamp > Date.now() + clockSkewMs) {
    failures.push(`${label} gelecekte olamaz.`);
  }
}

function requireAllowedEnvironment(scope, failures, label, allowedEnvironments) {
  const value = scope.environment;
  const allowed = new Set(allowedEnvironments.map((environment) => environment.toLowerCase()));
  if (typeof value !== "string" || !allowed.has(value.toLowerCase())) {
    failures.push(`${label} ${[...allowed].join("/")} olmalı.`);
  }
}

function validateCheckSpecificPayload(payload, failures, label, allowExampleEvidence) {
  switch (payload.check) {
    case "traefik_https_smoke":
      requireObjectKeySet(payload, failures, label, "traefikHttpsSmoke", [
        "generatedAt",
        "result",
        "check",
        "environment",
        "checkedAt",
        "url",
        "expectedStatus",
        "statusCode",
        "strictTransportSecurity",
        "commandsPassed",
        "gaps",
      ]);
      requireSmokeRunMetadata(payload, failures, label, "pnpm traefik:https:smoke", allowExampleEvidence);
      requireHttpsUrl(payload, failures, `${label}.url`, "url", allowExampleEvidence);
      requireStatus2xx(payload, failures, `${label}.expectedStatus`, "expectedStatus");
      requireStatus2xx(payload, failures, `${label}.statusCode`, "statusCode");
      if (Number.isInteger(payload.expectedStatus)) {
        requireEqual(payload, failures, `${label}.statusCode`, "statusCode", payload.expectedStatus);
      }
      requireString(payload, failures, `${label}.strictTransportSecurity`, "strictTransportSecurity");
      break;
    case "sms_provider_smoke":
      requireObjectKeySet(payload, failures, label, "smsProviderSmoke", [
        "generatedAt",
        "result",
        "check",
        "environment",
        "checkedAt",
        "provider",
        "recipient",
        "segments",
        "providerMessageId",
        "commandsPassed",
        "gaps",
      ]);
      requireSmokeRunMetadata(payload, failures, label, "pnpm sms:smoke", allowExampleEvidence);
      requireProvider(payload, failures, `${label}.provider`, "provider", allowExampleEvidence);
      requireMaskedRecipient(payload, failures, `${label}.recipient`, "recipient", allowExampleEvidence);
      requireIntegerAtLeast(payload, failures, `${label}.segments`, "segments", 0);
      requireString(payload, failures, `${label}.providerMessageId`, "providerMessageId");
      requireNonPlaceholderString(payload, failures, `${label}.providerMessageId`, "providerMessageId", allowExampleEvidence);
      break;
    case "notification_provider_smoke":
      requireObjectKeySet(payload, failures, label, "notificationProviderSmoke", [
        "generatedAt",
        "result",
        "check",
        "environment",
        "checkedAt",
        "provider",
        "channels",
        "recipients",
        "commandsPassed",
        "gaps",
      ]);
      requireSmokeRunMetadata(payload, failures, label, "pnpm notification:smoke", allowExampleEvidence);
      requireProvider(payload, failures, `${label}.provider`, "provider", allowExampleEvidence);
      requireStringArray(payload, failures, `${label}.channels`, "channels");
      requireStringArray(payload, failures, `${label}.recipients`, "recipients");
      if (Array.isArray(payload.recipients)) {
        for (const [index, recipient] of payload.recipients.entries()) {
          requireMaskedRecipientValue(recipient, failures, `${label}.recipients.${index}`, allowExampleEvidence);
        }
      }
      break;
    case "sentry_smoke":
      requireObjectKeySet(payload, failures, label, "sentrySmoke", [
        "generatedAt",
        "result",
        "check",
        "environment",
        "checkedAt",
        "dsn",
        "eventId",
        "commandsPassed",
        "gaps",
      ]);
      requireSmokeRunMetadata(payload, failures, label, "pnpm sentry:smoke", allowExampleEvidence);
      requireHttpsUrl(payload, failures, `${label}.dsn`, "dsn", allowExampleEvidence);
      requireString(payload, failures, `${label}.eventId`, "eventId");
      requireNonPlaceholderString(payload, failures, `${label}.eventId`, "eventId", allowExampleEvidence);
      break;
    case "alert_webhook_smoke":
      requireObjectKeySet(payload, failures, label, "alertWebhookSmoke", [
        "generatedAt",
        "result",
        "check",
        "environment",
        "checkedAt",
        "webhookUrl",
        "statusCode",
        "authorizationScheme",
        "commandsPassed",
        "gaps",
      ]);
      requireSmokeRunMetadata(payload, failures, label, "pnpm alert:webhook:smoke", allowExampleEvidence);
      requireHttpsUrl(payload, failures, `${label}.webhookUrl`, "webhookUrl", allowExampleEvidence);
      requireStatus2xx(payload, failures, `${label}.statusCode`, "statusCode");
      requireEqual(payload, failures, `${label}.authorizationScheme`, "authorizationScheme", "bearer");
      break;
    case "backup_offsite_smoke":
      requireObjectKeySet(payload, failures, label, "backupOffsiteSmoke", [
        "generatedAt",
        "result",
        "check",
        "environment",
        "checkedAt",
        "target",
        "markerSha256",
        "commandsPassed",
        "gaps",
      ]);
      requireSmokeRunMetadata(payload, failures, label, "pnpm backup:offsite:smoke", allowExampleEvidence);
      requireSmokeTarget(payload, failures, `${label}.target`, "target", allowExampleEvidence);
      requireSha256(payload, failures, `${label}.markerSha256`, "markerSha256");
      break;
    case "wal_archive_smoke":
      requireObjectKeySet(payload, failures, label, "walArchiveSmoke", [
        "generatedAt",
        "result",
        "check",
        "environment",
        "checkedAt",
        "target",
        "markerSha256",
        "postgresWalArchive",
        "commandsPassed",
        "gaps",
      ]);
      requireSmokeRunMetadata(payload, failures, label, "pnpm wal:archive:smoke", allowExampleEvidence);
      requireSmokeTarget(payload, failures, `${label}.target`, "target", allowExampleEvidence);
      requireSha256(payload, failures, `${label}.markerSha256`, "markerSha256");
      requirePostgresWalArchive(payload.postgresWalArchive, failures, `${label}.postgresWalArchive`);
      break;
    case "backup_restore_smoke":
      requireBackupRestoreSmoke(payload, failures, label, allowExampleEvidence);
      break;
    case "backup_offsite_restore_smoke":
      requireBackupOffsiteRestoreSmoke(payload, failures, label, allowExampleEvidence);
      break;
    case "rate_limit_redis_smoke":
      requireRateLimitRedisSmoke(payload, failures, label, allowExampleEvidence);
      break;
    case "rls_load_smoke":
      requireRlsLoadSmoke(payload, failures, label, allowExampleEvidence);
      break;
    case "report_generation_smoke":
      requireReportGenerationSmoke(payload, failures, label, allowExampleEvidence);
      break;
    case "isem_optical_pipeline_smoke":
      requireIsemOpticalPipelineSmoke(payload, failures, label, allowExampleEvidence);
      break;
    case "live_ui_worker_report_smoke":
      requireLiveUiWorkerReportSmoke(payload, failures, label, allowExampleEvidence);
      break;
    default:
      break;
  }
}

function requireBackupRestoreSmoke(payload, failures, label, allowExampleEvidence) {
  requireObjectKeySet(payload, failures, label, "backupRestoreSmoke", [
    "generatedAt",
    "result",
    "check",
    "environment",
    "checkedAt",
    "restoreDatabaseHash",
    "dumpFormat",
    "tableCounts",
    "durationMs",
    "commandsPassed",
    "gaps",
  ]);
  requireSmokeRunMetadata(payload, failures, label, "pnpm backup:restore:smoke", allowExampleEvidence);
  requireSha256(payload, failures, `${label}.restoreDatabaseHash`, "restoreDatabaseHash");
  requireLiteral(payload, failures, `${label}.dumpFormat`, "dumpFormat", "custom");
  requireIntegerAtLeast(payload, failures, `${label}.durationMs`, "durationMs", 0);
  requireBackupRestoreTableCounts(payload.tableCounts, failures, `${label}.tableCounts`);
  requireNoForbiddenKeys(payload, failures, label, ["restoreDb", "databaseUrl", "directDatabaseUrl", "dumpPath", "password"]);
}

function requireBackupOffsiteRestoreSmoke(payload, failures, label, allowExampleEvidence) {
  requireObjectKeySet(payload, failures, label, "backupOffsiteRestoreSmoke", [
    "generatedAt",
    "result",
    "check",
    "environment",
    "checkedAt",
    "target",
    "backupSha256",
    "restoreDatabaseHash",
    "dumpFormat",
    "tableCounts",
    "durationMs",
    "commandsPassed",
    "gaps",
  ]);
  requireSmokeRunMetadata(payload, failures, label, "pnpm backup:offsite-restore:smoke", allowExampleEvidence);
  requireSmokeTarget(payload, failures, `${label}.target`, "target", allowExampleEvidence);
  requireSha256(payload, failures, `${label}.backupSha256`, "backupSha256");
  requireSha256(payload, failures, `${label}.restoreDatabaseHash`, "restoreDatabaseHash");
  requireLiteral(payload, failures, `${label}.dumpFormat`, "dumpFormat", "custom");
  requireIntegerAtLeast(payload, failures, `${label}.durationMs`, "durationMs", 0);
  requireBackupRestoreTableCounts(payload.tableCounts, failures, `${label}.tableCounts`);
  requireNoForbiddenKeys(payload, failures, label, ["restoreDb", "databaseUrl", "directDatabaseUrl", "dumpPath", "password", "objectKey"]);
}

function requireBackupRestoreTableCounts(tableCounts, failures, label) {
  if (
    !requireObjectKeySet(tableCounts, failures, label, "tableCounts", [
      "Tenant",
      "AuditLog",
      "ReportSnapshot",
      "_prisma_migrations",
    ])
  ) {
    return;
  }

  requireIntegerAtLeast(tableCounts, failures, `${label}.Tenant`, "Tenant", 0);
  requireIntegerAtLeast(tableCounts, failures, `${label}.AuditLog`, "AuditLog", 0);
  requireIntegerAtLeast(tableCounts, failures, `${label}.ReportSnapshot`, "ReportSnapshot", 0);
  requireIntegerAtLeast(tableCounts, failures, `${label}._prisma_migrations`, "_prisma_migrations", 1);
}

function requireRateLimitRedisSmoke(payload, failures, label, allowExampleEvidence) {
  requireDateNotInFuture(payload, failures, `${label}.checkedAt`, "checkedAt", allowExampleEvidence);
  requireRateLimitConfig(payload.config, failures, `${label}.config`);
  requireRateLimitInstances(payload.instances, failures, `${label}.instances`, allowExampleEvidence);
  requireRateLimitApiResult(payload.apiRateLimit, payload.config, failures, `${label}.apiRateLimit`);
  requireRateLimitLoginResult(payload.loginAttemptLimiter, payload.config, failures, `${label}.loginAttemptLimiter`);
  requireExactStringList(payload.commandsPassed, failures, `${label}.commandsPassed`, [
    "pnpm rate-limit:smoke",
    "pnpm rate-limit:check",
  ]);
  requireStringArray(payload, failures, `${label}.evidenceReferences`, "evidenceReferences");
  requireEmptyArray(payload, failures, `${label}.gaps`, "gaps");
  requireNoForbiddenKeys(payload, failures, label, ["clientIp", "loginClientIp", "otherLoginIp", "loginName", "tenantSlug", "nationalId", "email"]);
}

function requireRateLimitConfig(config, failures, label) {
  if (!requireObjectKeySet(config, failures, label, "config", [
    "apiRateLimitEnabled",
    "apiRateLimitStore",
    "loginAttemptLimiterStore",
    "windowMs",
    "maxRequests",
    "loginMaxAttempts",
    "keyIncludesClientIpHash",
    "excludedPaths",
  ])) {
    return;
  }

  requireEqual(config, failures, `${label}.apiRateLimitEnabled`, "apiRateLimitEnabled", true);
  requireLiteral(config, failures, `${label}.apiRateLimitStore`, "apiRateLimitStore", "redis");
  requireLiteral(config, failures, `${label}.loginAttemptLimiterStore`, "loginAttemptLimiterStore", "redis");
  requireIntegerAtLeast(config, failures, `${label}.windowMs`, "windowMs", 1);
  requireIntegerAtLeast(config, failures, `${label}.maxRequests`, "maxRequests", 1);
  requireIntegerAtLeast(config, failures, `${label}.loginMaxAttempts`, "loginMaxAttempts", 1);
  requireEqual(config, failures, `${label}.keyIncludesClientIpHash`, "keyIncludesClientIpHash", true);
  requireExactStringList(config.excludedPaths, failures, `${label}.excludedPaths`, ["/health", "/metrics"]);
}

function requireRateLimitInstances(instances, failures, label, allowExampleEvidence) {
  if (!Array.isArray(instances)) {
    failures.push(`${label} listesi zorunlu.`);
    return;
  }
  if (instances.length !== 2) {
    failures.push(`${label} tam 2 API instance kanıtı içermeli.`);
  }

  for (const [index, instance] of instances.entries()) {
    const itemLabel = `${label}.${index}`;
    if (!requireObjectKeySet(instance, failures, itemLabel, "instance", ["label", "baseUrl"])) {
      continue;
    }
    requireString(instance, failures, `${itemLabel}.label`, "label");
    requireHttpUrl(instance, failures, `${itemLabel}.baseUrl`, "baseUrl", allowExampleEvidence);
  }
}

function requireRateLimitApiResult(apiRateLimit, config, failures, label) {
  if (!requireObjectKeySet(apiRateLimit, failures, label, "apiRateLimit", [
    "clientIpHash",
    "requestsSent",
    "allowedBeforeLimit",
    "limitedAtRequest",
    "limitStatusCode",
    "errorCode",
    "retryAfterHeaderPresent",
    "secondInstanceLimitObserved",
    "healthEndpointExcluded",
    "metricsEndpointExcluded",
  ])) {
    return;
  }

  requireSha256(apiRateLimit, failures, `${label}.clientIpHash`, "clientIpHash");
  requireIntegerAtLeast(apiRateLimit, failures, `${label}.requestsSent`, "requestsSent", 1);
  requireIntegerAtLeast(apiRateLimit, failures, `${label}.allowedBeforeLimit`, "allowedBeforeLimit", 0);
  requireIntegerAtLeast(apiRateLimit, failures, `${label}.limitedAtRequest`, "limitedAtRequest", 1);
  requireEqual(apiRateLimit, failures, `${label}.limitStatusCode`, "limitStatusCode", 429);
  requireLiteral(apiRateLimit, failures, `${label}.errorCode`, "errorCode", "RATE_LIMITED");
  requireEqual(apiRateLimit, failures, `${label}.retryAfterHeaderPresent`, "retryAfterHeaderPresent", true);
  requireEqual(apiRateLimit, failures, `${label}.secondInstanceLimitObserved`, "secondInstanceLimitObserved", true);
  requireEqual(apiRateLimit, failures, `${label}.healthEndpointExcluded`, "healthEndpointExcluded", true);
  requireEqual(apiRateLimit, failures, `${label}.metricsEndpointExcluded`, "metricsEndpointExcluded", true);

  if (Number.isInteger(config?.maxRequests)) {
    if (apiRateLimit.allowedBeforeLimit !== config.maxRequests) {
      failures.push(`${label}.allowedBeforeLimit config.maxRequests ile eşleşmeli.`);
    }
    if (apiRateLimit.limitedAtRequest !== config.maxRequests + 1) {
      failures.push(`${label}.limitedAtRequest config.maxRequests + 1 olmalı.`);
    }
    if (apiRateLimit.requestsSent !== config.maxRequests + 1) {
      failures.push(`${label}.requestsSent config.maxRequests + 1 olmalı.`);
    }
  }
}

function requireRateLimitLoginResult(loginAttemptLimiter, config, failures, label) {
  if (!requireObjectKeySet(loginAttemptLimiter, failures, label, "loginAttemptLimiter", [
    "clientIpHash",
    "loginNameHash",
    "attemptsSent",
    "lockStatusCode",
    "errorCode",
    "sharedAcrossInstances",
    "tenantAndLoginNameAndIpScoped",
    "differentIpNotLocked",
  ])) {
    return;
  }

  requireSha256(loginAttemptLimiter, failures, `${label}.clientIpHash`, "clientIpHash");
  requireSha256(loginAttemptLimiter, failures, `${label}.loginNameHash`, "loginNameHash");
  requireIntegerAtLeast(loginAttemptLimiter, failures, `${label}.attemptsSent`, "attemptsSent", 1);
  requireEqual(loginAttemptLimiter, failures, `${label}.lockStatusCode`, "lockStatusCode", 429);
  requireLiteral(loginAttemptLimiter, failures, `${label}.errorCode`, "errorCode", "LOGIN_LOCKED");
  requireEqual(loginAttemptLimiter, failures, `${label}.sharedAcrossInstances`, "sharedAcrossInstances", true);
  requireEqual(loginAttemptLimiter, failures, `${label}.tenantAndLoginNameAndIpScoped`, "tenantAndLoginNameAndIpScoped", true);
  requireEqual(loginAttemptLimiter, failures, `${label}.differentIpNotLocked`, "differentIpNotLocked", true);

  if (Number.isInteger(config?.loginMaxAttempts) && loginAttemptLimiter.attemptsSent < config.loginMaxAttempts + 1) {
    failures.push(`${label}.attemptsSent config.loginMaxAttempts + 1 veya daha fazla olmalı.`);
  }
}

function requireSmokeRunMetadata(payload, failures, label, expectedCommand, allowExampleEvidence) {
  requireDateNotInFuture(payload, failures, `${label}.checkedAt`, "checkedAt", allowExampleEvidence);
  requireExactStringList(payload.commandsPassed, failures, `${label}.commandsPassed`, [expectedCommand]);
  requireEmptyArray(payload, failures, `${label}.gaps`, "gaps");
}

function requireReportGenerationSmoke(payload, failures, label, allowExampleEvidence) {
  requireObjectKeySet(payload, failures, label, "reportGenerationSmoke", [
    "generatedAt",
    "result",
    "check",
    "environment",
    "checkedAt",
    "reportType",
    "status",
    "resultCount",
    "studentCount",
    "classCount",
    "branchCount",
    "expectedClassCount",
    "seedDurationMs",
    "generationDurationMs",
    "hashes",
    "thresholds",
    "commandsPassed",
    "gaps",
  ]);
  requireDateNotInFuture(payload, failures, `${label}.checkedAt`, "checkedAt", allowExampleEvidence);
  requireLiteral(payload, failures, `${label}.reportType`, "reportType", "EXAM_RESULT_SUMMARY");
  requireLiteral(payload, failures, `${label}.status`, "status", "READY");
  requireIntegerAtLeast(payload, failures, `${label}.resultCount`, "resultCount", 1);
  requireIntegerAtLeast(payload, failures, `${label}.studentCount`, "studentCount", 1);
  requireIntegerAtLeast(payload, failures, `${label}.classCount`, "classCount", 1);
  requireIntegerAtLeast(payload, failures, `${label}.branchCount`, "branchCount", 1);
  requireIntegerAtLeast(payload, failures, `${label}.expectedClassCount`, "expectedClassCount", 1);
  requireIntegerAtLeast(payload, failures, `${label}.seedDurationMs`, "seedDurationMs", 0);
  requireIntegerAtLeast(payload, failures, `${label}.generationDurationMs`, "generationDurationMs", 0);

  if (Number.isInteger(payload.resultCount) && payload.studentCount !== payload.resultCount) {
    failures.push(`${label}.studentCount resultCount ile eşleşmeli.`);
  }
  if (Number.isInteger(payload.expectedClassCount) && payload.classCount !== payload.expectedClassCount) {
    failures.push(`${label}.classCount expectedClassCount ile eşleşmeli.`);
  }

  const hashes = payload.hashes;
  if (
    requireObjectKeySet(hashes, failures, `${label}.hashes`, "hashes", [
      "tenantHash",
      "userHash",
      "emailHash",
      "examHash",
      "snapshotHash",
      "firstStudentHash",
      "contentHash",
      "queuedJobIdHash",
    ])
  ) {
    for (const key of [
      "tenantHash",
      "userHash",
      "emailHash",
      "examHash",
      "snapshotHash",
      "firstStudentHash",
      "contentHash",
      "queuedJobIdHash",
    ]) {
      requireSha256(hashes, failures, `${label}.hashes.${key}`, key);
    }
  }

  const thresholds = payload.thresholds;
  if (
    requireObjectKeySet(thresholds, failures, `${label}.thresholds`, "thresholds", [
      "resultCountMatches",
      "generationDurationMsMax",
      "generationDurationPassed",
    ])
  ) {
    requireEqual(thresholds, failures, `${label}.thresholds.resultCountMatches`, "resultCountMatches", true);
    requireIntegerAtLeast(thresholds, failures, `${label}.thresholds.generationDurationMsMax`, "generationDurationMsMax", 1);
    requireEqual(thresholds, failures, `${label}.thresholds.generationDurationPassed`, "generationDurationPassed", true);
    if (
      Number.isInteger(payload.generationDurationMs) &&
      Number.isInteger(thresholds.generationDurationMsMax) &&
      payload.generationDurationMs > thresholds.generationDurationMsMax
    ) {
      failures.push(`${label}.generationDurationMs eşik değerini aşmamalı.`);
    }
  }

  requireAllowedSingleCommand(payload.commandsPassed, failures, `${label}.commandsPassed`, [
    "pnpm report-generation:smoke",
    "pnpm report-generation:perf",
  ]);
  requireEmptyArray(payload, failures, `${label}.gaps`, "gaps");

  for (const forbiddenKey of ["email", "password", "tenantId", "userId", "examId", "snapshotId", "firstStudentId"]) {
    if (Object.hasOwn(payload, forbiddenKey)) {
      failures.push(`${label}.${forbiddenKey} ham tanımlayıcı/credential içermemeli.`);
    }
  }
}

function requireIsemOpticalPipelineSmoke(payload, failures, label, allowExampleEvidence) {
  requireObjectKeySet(payload, failures, label, "isemOpticalPipelineSmoke", [
    "generatedAt",
    "result",
    "check",
    "environment",
    "fixtureId",
    "checkedAt",
    "parserConfigVersion",
    "answerKeyVersion",
    "answerKeyQuestionCount",
    "bookletVariantCount",
    "counts",
    "pipeline",
    "quarantineProbe",
    "sampleScores",
    "hashes",
    "thresholds",
    "pipelineDurationMs",
    "commandsPassed",
    "gaps",
  ]);
  requireDateNotInFuture(payload, failures, `${label}.checkedAt`, "checkedAt", allowExampleEvidence);
  requireEqual(payload, failures, `${label}.fixtureId`, "fixtureId", ISEM_OPTICAL_PIPELINE_INPUT_MANIFEST.fixtureId);
  requireString(payload, failures, `${label}.parserConfigVersion`, "parserConfigVersion");
  requireNonPlaceholderString(payload, failures, `${label}.parserConfigVersion`, "parserConfigVersion", allowExampleEvidence);
  requireString(payload, failures, `${label}.answerKeyVersion`, "answerKeyVersion");
  requireNonPlaceholderString(payload, failures, `${label}.answerKeyVersion`, "answerKeyVersion", allowExampleEvidence);
  requireEqual(
    payload,
    failures,
    `${label}.answerKeyQuestionCount`,
    "answerKeyQuestionCount",
    ISEM_OPTICAL_PIPELINE_FIXTURE.answerKeyQuestionCount,
  );
  requireEqual(
    payload,
    failures,
    `${label}.bookletVariantCount`,
    "bookletVariantCount",
    ISEM_OPTICAL_PIPELINE_FIXTURE.bookletVariantCount,
  );
  requireIntegerAtLeast(payload, failures, `${label}.pipelineDurationMs`, "pipelineDurationMs", 0);

  const counts = payload.counts;
  if (
    requireObjectKeySet(counts, failures, `${label}.counts`, "counts", [
      "studentCount",
      "participantCount",
      "matchedCount",
      "quarantineCount",
      "examResultCount",
      "reportResultCount",
      "studentPortalUserLinkCount",
      "guardianPortalUserLinkCount",
      "guardianLinkCount",
    ])
  ) {
    requireEqual(counts, failures, `${label}.counts.studentCount`, "studentCount", ISEM_OPTICAL_PIPELINE_FIXTURE.studentCount);
    requireEqual(
      counts,
      failures,
      `${label}.counts.participantCount`,
      "participantCount",
      ISEM_OPTICAL_PIPELINE_FIXTURE.participantCount,
    );
    requireEqual(counts, failures, `${label}.counts.matchedCount`, "matchedCount", ISEM_OPTICAL_PIPELINE_FIXTURE.matchedCount);
    requireEqual(
      counts,
      failures,
      `${label}.counts.quarantineCount`,
      "quarantineCount",
      ISEM_OPTICAL_PIPELINE_FIXTURE.quarantineCount,
    );
    requireEqual(
      counts,
      failures,
      `${label}.counts.examResultCount`,
      "examResultCount",
      ISEM_OPTICAL_PIPELINE_FIXTURE.examResultCount,
    );
    requireEqual(
      counts,
      failures,
      `${label}.counts.reportResultCount`,
      "reportResultCount",
      ISEM_OPTICAL_PIPELINE_FIXTURE.reportResultCount,
    );
    requireIntegerAtLeast(counts, failures, `${label}.counts.studentPortalUserLinkCount`, "studentPortalUserLinkCount", 1);
    requireIntegerAtLeast(counts, failures, `${label}.counts.guardianPortalUserLinkCount`, "guardianPortalUserLinkCount", 1);
    requireIntegerAtLeast(counts, failures, `${label}.counts.guardianLinkCount`, "guardianLinkCount", 1);

    if (
      Number.isInteger(counts.participantCount) &&
      Number.isInteger(counts.quarantineCount) &&
      counts.matchedCount + counts.quarantineCount !== counts.participantCount
    ) {
      failures.push(`${label}.counts.matchedCount + quarantineCount participantCount ile eşleşmeli.`);
    }
    if (Number.isInteger(counts.matchedCount) && counts.examResultCount !== counts.matchedCount) {
      failures.push(`${label}.counts.examResultCount matchedCount ile eşleşmeli.`);
    }
    if (Number.isInteger(counts.examResultCount) && counts.reportResultCount !== counts.examResultCount) {
      failures.push(`${label}.counts.reportResultCount examResultCount ile eşleşmeli.`);
    }
  }

  const pipeline = payload.pipeline;
  if (
    requireObjectKeySet(pipeline, failures, `${label}.pipeline`, "pipeline", [
      "answerKeyImported",
      "opticalImportCommitted",
      "rawImportArchived",
      "evaluationQueued",
      "quarantinePathVerified",
      "reportGenerated",
      "reportReady",
    ])
  ) {
    for (const key of [
      "answerKeyImported",
      "opticalImportCommitted",
      "rawImportArchived",
      "evaluationQueued",
      "quarantinePathVerified",
      "reportGenerated",
      "reportReady",
    ]) {
      requireEqual(pipeline, failures, `${label}.pipeline.${key}`, key, true);
    }
  }

  const quarantineProbe = payload.quarantineProbe;
  if (
    requireObjectKeySet(quarantineProbe, failures, `${label}.quarantineProbe`, "quarantineProbe", [
      "openCount",
      "resolvedCount",
      "examResultCount",
      "reportResultCount",
      "idempotentReplayVerified",
      "studentReportVerified",
      "excelExportVerified",
      "pdfExportVerified",
      "reportReady",
      "reportJobQueued",
    ])
  ) {
    for (const key of ["openCount", "resolvedCount", "examResultCount", "reportResultCount"]) {
      requireEqual(quarantineProbe, failures, `${label}.quarantineProbe.${key}`, key, 1);
    }
    for (const key of [
      "idempotentReplayVerified",
      "studentReportVerified",
      "excelExportVerified",
      "pdfExportVerified",
      "reportReady",
      "reportJobQueued",
    ]) {
      requireEqual(quarantineProbe, failures, `${label}.quarantineProbe.${key}`, key, true);
    }
  }

  requireIsemSampleScores(payload.sampleScores, failures, `${label}.sampleScores`);

  const hashes = payload.hashes;
  if (
    requireObjectKeySet(hashes, failures, `${label}.hashes`, "hashes", [
      "tenantHash",
      "userHash",
      "emailHash",
      "examHash",
      "rawImportHash",
      "answerKeyHash",
      "reportSnapshotHash",
      "firstStudentHash",
      "opticalTxtSha256",
      "answerKeyFileSha256",
      "parseJobHash",
      "reportJobHash",
    ])
  ) {
    for (const key of [
      "tenantHash",
      "userHash",
      "emailHash",
      "examHash",
      "rawImportHash",
      "answerKeyHash",
      "reportSnapshotHash",
      "firstStudentHash",
      "opticalTxtSha256",
      "answerKeyFileSha256",
      "parseJobHash",
      "reportJobHash",
    ]) {
      requireSha256(hashes, failures, `${label}.hashes.${key}`, key);
    }
    requireEqual(
      hashes,
      failures,
      `${label}.hashes.opticalTxtSha256`,
      "opticalTxtSha256",
      ISEM_OPTICAL_PIPELINE_INPUT_MANIFEST.inputs.opticalTxt.sha256,
    );
    requireEqual(
      hashes,
      failures,
      `${label}.hashes.answerKeyFileSha256`,
      "answerKeyFileSha256",
      ISEM_OPTICAL_PIPELINE_INPUT_MANIFEST.inputs.answerKey.sha256,
    );
  }

  const thresholds = payload.thresholds;
  if (
    requireObjectKeySet(thresholds, failures, `${label}.thresholds`, "thresholds", [
      "participantCountMatches",
      "matchedCountMatches",
      "examResultCountMatches",
      "reportResultCountMatches",
      "sampleScoreCountMatches",
      "pipelineDurationMsMax",
      "pipelineDurationPassed",
    ])
  ) {
    for (const key of [
      "participantCountMatches",
      "matchedCountMatches",
      "examResultCountMatches",
      "reportResultCountMatches",
      "sampleScoreCountMatches",
      "pipelineDurationPassed",
    ]) {
      requireEqual(thresholds, failures, `${label}.thresholds.${key}`, key, true);
    }
    requireIntegerAtLeast(thresholds, failures, `${label}.thresholds.pipelineDurationMsMax`, "pipelineDurationMsMax", 1);
    if (
      Number.isInteger(payload.pipelineDurationMs) &&
      Number.isInteger(thresholds.pipelineDurationMsMax) &&
      payload.pipelineDurationMs > thresholds.pipelineDurationMsMax
    ) {
      failures.push(`${label}.pipelineDurationMs eşik değerini aşmamalı.`);
    }
  }

  requireExactStringList(payload.commandsPassed, failures, `${label}.commandsPassed`, ["pnpm isem-optical-pipeline:smoke"]);
  requireEmptyArray(payload, failures, `${label}.gaps`, "gaps");
  requireNoForbiddenKeys(payload, failures, label, ["email", "password", "tenantId", "userId", "examId", "rawImportId", "answerKeyId", "snapshotId", "studentId", "guardianId"]);
  requireNoRawEvidenceValues(payload, failures, label, [
    "contentbase64",
    "filebase64",
    "filename",
    "identitynumber",
    "nationalid",
    "objectkey",
    "rawanswer",
    "rawline",
    "rawrow",
    "rawtext",
    "s3key",
    "sourcefilename",
    "sourcefilepath",
    "studentname",
    "tckn",
    "tcno",
  ]);
}

function requireIsemSampleScores(value, failures, label) {
  if (!Array.isArray(value) || value.length < 2) {
    failures.push(`${label} en az 2 örnek skor içermeli.`);
    return;
  }

  for (const [index, sample] of value.entries()) {
    const itemLabel = `${label}.${index}`;
    if (!requireObjectKeySet(sample, failures, itemLabel, "sampleScore", ["studentNoHash", "correct", "wrong", "blank", "net"])) {
      continue;
    }
    requireSha256(sample, failures, `${itemLabel}.studentNoHash`, "studentNoHash");
    requireIntegerAtLeast(sample, failures, `${itemLabel}.correct`, "correct", 0);
    requireIntegerAtLeast(sample, failures, `${itemLabel}.wrong`, "wrong", 0);
    requireIntegerAtLeast(sample, failures, `${itemLabel}.blank`, "blank", 0);
    requireNumberAtLeast(sample, failures, `${itemLabel}.net`, "net", 0);
  }
}

function requireLiveUiWorkerReportSmoke(payload, failures, label, allowExampleEvidence) {
  requireObjectKeySet(payload, failures, label, "liveUiWorkerReportSmoke", [
    "generatedAt",
    "result",
    "check",
    "environment",
    "checkedAt",
    "examHash",
    "firstStudentHash",
    "reportStatus",
    "downloadedArtifacts",
    "karnePdfDownloaded",
    "excelDownloaded",
    "studentPortalViewed",
    "guardianPortalViewed",
    "sessionLogoutVerified",
    "commandsPassed",
    "gaps",
  ]);
  requireSmokeRunMetadata(payload, failures, label, "pnpm live:ui-worker:smoke", allowExampleEvidence);
  requireSha256(payload, failures, `${label}.examHash`, "examHash");
  requireSha256(payload, failures, `${label}.firstStudentHash`, "firstStudentHash");
  requireLiteral(payload, failures, `${label}.reportStatus`, "reportStatus", "READY");
  requireExactStringList(payload.downloadedArtifacts, failures, `${label}.downloadedArtifacts`, ["xlsx", "pdf"]);
  for (const key of ["karnePdfDownloaded", "excelDownloaded", "studentPortalViewed", "guardianPortalViewed", "sessionLogoutVerified"]) {
    requireEqual(payload, failures, `${label}.${key}`, key, true);
  }
  requireNoForbiddenKeys(payload, failures, label, ["email", "password", "tenantId", "userId", "examId", "firstStudentId", "guardianId"]);
}

function requireRlsLoadSmoke(payload, failures, label, allowExampleEvidence) {
  requireDateNotInFuture(payload, failures, `${label}.checkedAt`, "checkedAt", allowExampleEvidence);

  const loadSmoke = payload.loadSmoke;
  if (
    requireObjectKeySet(loadSmoke, failures, `${label}.loadSmoke`, "loadSmoke", [
      "targetRps",
      "actualRps",
      "durationSeconds",
      "concurrency",
      "seedStudentsPerTenant",
      "queriesCompleted",
      "failures",
    ])
  ) {
    requireIntegerAtLeast(loadSmoke, failures, `${label}.loadSmoke.targetRps`, "targetRps", 200);
    requireNumberAtLeast(loadSmoke, failures, `${label}.loadSmoke.actualRps`, "actualRps", loadSmoke.targetRps ?? 200);
    requireIntegerAtLeast(loadSmoke, failures, `${label}.loadSmoke.durationSeconds`, "durationSeconds", 1);
    requireIntegerAtLeast(loadSmoke, failures, `${label}.loadSmoke.concurrency`, "concurrency", 1);
    requireIntegerAtLeast(loadSmoke, failures, `${label}.loadSmoke.seedStudentsPerTenant`, "seedStudentsPerTenant", 1);
    requireIntegerAtLeast(loadSmoke, failures, `${label}.loadSmoke.queriesCompleted`, "queriesCompleted", 1);
    requireEqual(loadSmoke, failures, `${label}.loadSmoke.failures`, "failures", 0);
  }

  const isolation = payload.isolation;
  if (requireObjectKeySet(isolation, failures, `${label}.isolation`, "isolation", ["tenantAHash", "tenantBHash", "crossTenantReadRows"])) {
    requireSha256(isolation, failures, `${label}.isolation.tenantAHash`, "tenantAHash");
    requireSha256(isolation, failures, `${label}.isolation.tenantBHash`, "tenantBHash");
    requireEqual(isolation, failures, `${label}.isolation.crossTenantReadRows`, "crossTenantReadRows", 0);
  }

  requireExactStringList(payload.commandsPassed, failures, `${label}.commandsPassed`, ["pnpm rls:load:smoke"]);
  requireEmptyArray(payload, failures, `${label}.gaps`, "gaps");
  requireNoForbiddenKeys(payload, failures, label, ["tenantA", "tenantB", "tenantId", "studentId"]);
}

function requirePostgresWalArchive(value, failures, label) {
  if (
    !requireObjectKeySet(value, failures, label, "postgresWalArchive", [
      "archiveMode",
      "walLevel",
      "archiveCommandSha256",
      "switchedWalFileNameHash",
      "archivedWalFileSha256",
    ])
  ) {
    return;
  }

  if (!["on", "always"].includes(value.archiveMode)) {
    failures.push(`${label}.archiveMode on veya always olmalı.`);
  }
  if (!["replica", "logical"].includes(value.walLevel)) {
    failures.push(`${label}.walLevel replica veya logical olmalı.`);
  }
  requireSha256(value, failures, `${label}.archiveCommandSha256`, "archiveCommandSha256");
  requireSha256(value, failures, `${label}.switchedWalFileNameHash`, "switchedWalFileNameHash");
  requireSha256(value, failures, `${label}.archivedWalFileSha256`, "archivedWalFileSha256");
}

function requireString(scope, failures, label, key) {
  if (typeof scope[key] !== "string" || scope[key].trim() === "") {
    failures.push(`${label} boş olmayan metin olmalı.`);
  }
}

function requireProvider(scope, failures, label, key, allowExampleEvidence) {
  requireString(scope, failures, label, key);
  if (scope[key] === "noop") {
    failures.push(`${label} noop olmamalı.`);
  }
  requireNonPlaceholderString(scope, failures, label, key, allowExampleEvidence);
}

function requireNonPlaceholderString(scope, failures, label, key, allowExampleEvidence) {
  if (allowExampleEvidence) return;

  const value = scope[key];
  if (typeof value !== "string" || value.trim() === "") return;
  if (hasPlaceholderToken(value)) {
    failures.push(`${label} production için ornek/placeholder/redacted deger olmamalı.`);
  }
}

function requireStringArray(scope, failures, label, key) {
  const value = scope[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    failures.push(`${label} boş olmayan metin listesi olmalı.`);
  }
}

function requireMaskedRecipient(scope, failures, label, key, allowExampleEvidence) {
  requireString(scope, failures, label, key);
  requireMaskedRecipientValue(scope[key], failures, label, allowExampleEvidence);
}

function requireMaskedRecipientValue(value, failures, label, allowExampleEvidence) {
  if (typeof value !== "string" || value.trim() === "") return;
  if (!value.includes("*")) {
    failures.push(`${label} maskeli recipient olmalı.`);
  }
  if (!allowExampleEvidence && hasPlaceholderToken(value)) {
    failures.push(`${label} production için ornek/placeholder/redacted deger olmamalı.`);
  }
  if (value.includes("@") || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value)) {
    failures.push(`${label} ham e-posta taşımamalı.`);
  }
  if (/(?:\+?90[\s-]?)?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/.test(value)) {
    failures.push(`${label} ham telefon taşımamalı.`);
  }
  if (/https?:\/\//i.test(value)) {
    failures.push(`${label} ham push endpoint taşımamalı.`);
  }
}

function requireObjectKeySet(value, failures, label, valueName, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} ${valueName} nesnesi zorunlu.`);
    return false;
  }

  const actualKeys = Object.keys(value);
  const expectedSet = new Set(expectedKeys);
  if (actualKeys.length !== expectedKeys.length) {
    failures.push(`${label} tam ${expectedKeys.length} alan içermeli.`);
  }
  for (const key of actualKeys) {
    if (!expectedSet.has(key)) {
      failures.push(`${label}.${key} beklenmeyen alan.`);
    }
  }
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) {
      failures.push(`${label}.${key} eksik.`);
    }
  }

  return true;
}

function requireStatus2xx(scope, failures, label, key) {
  const value = scope[key];
  if (!Number.isInteger(value) || value < 200 || value > 299) {
    failures.push(`${label} 2xx HTTP durum kodu olmalı.`);
  }
}

function requireIntegerAtLeast(scope, failures, label, key, min) {
  const value = scope[key];
  if (!Number.isInteger(value) || value < min) {
    failures.push(`${label} en az ${min} tam sayı olmalı.`);
  }
}

function requireNumberAtLeast(scope, failures, label, key, min) {
  const value = scope[key];
  if (typeof value !== "number" || Number.isNaN(value) || value < min) {
    failures.push(`${label} en az ${min} sayı olmalı.`);
  }
}

function requireEqual(scope, failures, label, key, expected) {
  if (scope[key] !== expected) {
    failures.push(`${label} ${expected} olmalı.`);
  }
}

function requireLiteral(scope, failures, label, key, expected) {
  if (scope[key] !== expected) {
    failures.push(`${label} ${expected} olmalı.`);
  }
}

function requireEmptyArray(scope, failures, label, key) {
  const value = scope[key];
  if (!Array.isArray(value)) {
    failures.push(`${label} listesi zorunlu.`);
    return;
  }
  if (value.length > 0) {
    failures.push(`${label} boş olmalı.`);
  }
}

function requireAllowedSingleCommand(value, failures, label, allowedCommands) {
  if (!Array.isArray(value)) {
    failures.push(`${label} listesi zorunlu.`);
    return;
  }
  if (value.length !== 1) {
    failures.push(`${label} tam 1 komut içermeli.`);
    return;
  }
  if (!allowedCommands.includes(value[0])) {
    failures.push(`${label} beklenen komutlardan biri olmalı.`);
  }
}

function requireExactStringList(value, failures, label, expected) {
  if (!Array.isArray(value)) {
    failures.push(`${label} listesi zorunlu.`);
    return;
  }
  if (value.length !== expected.length) {
    failures.push(`${label} tam ${expected.length} metin içermeli.`);
  }
  const seen = new Set();
  const expectedSet = new Set(expected);
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label} boş olmayan metinlerden oluşmalı.`);
      continue;
    }
    if (seen.has(item)) {
      failures.push(`${label} tekrarlı metin içeriyor: ${item}`);
    }
    seen.add(item);
    if (!expectedSet.has(item)) {
      failures.push(`${label} beklenmeyen metin içeriyor: ${item}`);
    }
  }
  for (const item of expectedSet) {
    if (!seen.has(item)) {
      failures.push(`${label} eksik: ${item}`);
    }
  }
}

function requireSha256(scope, failures, label, key) {
  const value = scope[key];
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    failures.push(`${label} 64 karakter hex sha256 olmalı.`);
  }
}

function requireHttpsUrl(scope, failures, label, key, allowExampleEvidence) {
  const value = scope[key];
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      failures.push(`${label} https URL olmalı.`);
      return;
    }
    if (!allowExampleEvidence && isPlaceholderHost(url.hostname)) {
      failures.push(`${label} production için gerçek host olmalı.`);
    }
  } catch {
    failures.push(`${label} geçerli URL olmalı.`);
  }
}

function requireHttpUrl(scope, failures, label, key, allowExampleEvidence) {
  const value = scope[key];
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      failures.push(`${label} http veya https URL olmalı.`);
      return;
    }
    if (!allowExampleEvidence && isPlaceholderHost(url.hostname)) {
      failures.push(`${label} production için gerçek host olmalı.`);
    }
  } catch {
    failures.push(`${label} geçerli URL olmalı.`);
  }
}

function requireSmokeTarget(scope, failures, label, key, allowExampleEvidence) {
  const target = scope[key];
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return;
  }

  if (!["file", "s3"].includes(target.protocol)) {
    failures.push(`${label}.protocol file veya s3 olmalı.`);
    return;
  }

  if (target.protocol === "file") {
    requireObjectKeySet(target, failures, label, "smokeFileTarget", ["protocol", "pathRedacted"]);
    if (target.pathRedacted !== true) {
      failures.push(`${label}.pathRedacted true olmalı.`);
    }
    return;
  }

  requireObjectKeySet(target, failures, label, "smokeS3Target", ["protocol", "bucket", "prefix"]);
  requireString(target, failures, `${label}.bucket`, "bucket");
  requireNonPlaceholderString(target, failures, `${label}.bucket`, "bucket", allowExampleEvidence);
  if (typeof target.prefix !== "string") {
    failures.push(`${label}.prefix metin olmalı.`);
  }
  if (typeof target.prefix === "string" && target.prefix.trim() !== "") {
    requireNonPlaceholderString(target, failures, `${label}.prefix`, "prefix", allowExampleEvidence);
  }
}

function requireNoForbiddenKeys(value, failures, label, forbiddenKeys, path = "") {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      requireNoForbiddenKeys(item, failures, label, forbiddenKeys, path ? `${path}.${index}` : `${index}`);
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (forbiddenKeys.includes(key)) {
      failures.push(`${label}.${childPath} ham IP/e-posta/T.C. kimlik içermemeli.`);
    }
    requireNoForbiddenKeys(child, failures, label, forbiddenKeys, childPath);
  }
}

function requireNoRawEvidenceValues(value, failures, label, forbiddenKeyFragments, path = "") {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      requireNoRawEvidenceValues(item, failures, label, forbiddenKeyFragments, path ? `${path}.${index}` : `${index}`);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      const normalizedKey = key.toLowerCase();
      if (forbiddenKeyFragments.some((fragment) => normalizedKey.includes(fragment))) {
        failures.push(`${label}.${childPath} ham PII/TXT evidence alanı taşımamalı.`);
      }
      requireNoRawEvidenceValues(child, failures, label, forbiddenKeyFragments, childPath);
    }
    return;
  }

  if (typeof value !== "string") return;

  const normalized = value.toLowerCase();
  if (normalized.includes("ornek-veriler") || /\bisem\s*\.txt\b/.test(normalized) || /\.txt(\b|$)/.test(normalized)) {
    failures.push(`${label}.${path} ham TXT dosya adı veya yolu taşımamalı.`);
  }

  if (isHashPath(path)) return;

  if (/\b\d{11}\b/.test(value)) {
    failures.push(`${label}.${path} TCKN benzeri 11 haneli değer taşımamalı.`);
  }
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(value)) {
    failures.push(`${label}.${path} ham e-posta taşımamalı.`);
  }
  if (/(?:\+?90[\s-]?)?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/.test(value)) {
    failures.push(`${label}.${path} ham telefon taşımamalı.`);
  }
  if (/\d{12,}/.test(value) && /[ABCDE]{5,}/i.test(value)) {
    failures.push(`${label}.${path} ham optik satır veya cevap dizisi taşımamalı.`);
  }
}

function isHashPath(path) {
  const normalized = path.toLowerCase();
  return normalized.includes("hash") || normalized.includes("sha256");
}

function isPlaceholderHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".test") ||
    normalized.includes("example") ||
    normalized.includes("__set")
  );
}

function hasPlaceholderToken(value) {
  if (typeof value !== "string") return false;

  const normalized = value.toLowerCase();
  return (
    normalized.includes("example") ||
    normalized.includes("placeholder") ||
    normalized.includes("change-me") ||
    normalized.includes("replace-me") ||
    normalized.includes("redacted") ||
    normalized.includes("__set") ||
    normalized.includes("localhost") ||
    normalized.includes(".test") ||
    normalized.includes(".example") ||
    normalized.includes(".invalid") ||
    normalized.includes("test-token") ||
    normalized.includes("test-message-id") ||
    normalized.includes("dummy") ||
    normalized.includes("fake") ||
    normalized.includes("sms-provider-message") ||
    normalized.includes("backup-bucket") ||
    normalized.includes("provider-console-or-contract-reference")
  );
}
