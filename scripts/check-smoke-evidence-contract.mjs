import { readFileSync } from "node:fs";
import { validateSmokeEvidencePayload } from "./smoke-evidence.mjs";

const summary = JSON.parse(readFileSync("docs/evidence-templates/production-evidence-summary.example.json", "utf8"));

const smokeChecks = [
  ["traefikHttps", "traefik_https_smoke"],
  ["smsProvider", "sms_provider_smoke"],
  ["notificationProvider", "notification_provider_smoke"],
  ["sentryEvent", "sentry_smoke"],
  ["alertWebhook", "alert_webhook_smoke"],
  ["backupOffsite", "backup_offsite_smoke"],
  ["walArchive", "wal_archive_smoke"],
];

const failures = [];

if (!summary.smokeEvidence || typeof summary.smokeEvidence !== "object" || Array.isArray(summary.smokeEvidence)) {
  failures.push("production-evidence-summary.example.json smokeEvidence nesnesi zorunlu.");
} else {
  for (const [key, expectedCheck] of smokeChecks) {
    failures.push(
      ...validateSmokeEvidencePayload(summary.smokeEvidence[key], {
        expectedCheck,
        allowedEnvironments: ["staging", "production"],
        label: `smokeEvidence.${key}`,
        allowExampleEvidence: true,
      }),
    );
  }
}

const negativeCases = [
  [
    "traefik https olmayan URL reddedilir",
    {
      ...summary.smokeEvidence?.traefikHttps,
      url: "http://prod.example.com/",
    },
    "traefik_https_smoke",
  ],
  [
    "alert webhook 5xx reddedilir",
    {
      ...summary.smokeEvidence?.alertWebhook,
      statusCode: 500,
    },
    "alert_webhook_smoke",
  ],
  [
    "Traefik beklenen status sapması reddedilir",
    {
      ...summary.smokeEvidence?.traefikHttps,
      expectedStatus: 204,
      statusCode: 200,
    },
    "traefik_https_smoke",
  ],
  [
    "Traefik beklenmeyen alan reddedilir",
    {
      ...summary.smokeEvidence?.traefikHttps,
      responseBody: "{\"status\":\"ok\"}",
    },
    "traefik_https_smoke",
  ],
  [
    "Alert webhook yanlış komut reddedilir",
    {
      ...summary.smokeEvidence?.alertWebhook,
      commandsPassed: ["pnpm smoke"],
    },
    "alert_webhook_smoke",
  ],
  [
    "Alert webhook auth scheme sapması reddedilir",
    {
      ...summary.smokeEvidence?.alertWebhook,
      authorizationScheme: "none",
    },
    "alert_webhook_smoke",
  ],
  [
    "Alert webhook beklenmeyen alan reddedilir",
    {
      ...summary.smokeEvidence?.alertWebhook,
      responseBody: "ok",
    },
    "alert_webhook_smoke",
  ],
  [
    "backup marker sha256 reddedilir",
    {
      ...summary.smokeEvidence?.backupOffsite,
      markerSha256: "not-a-sha256",
    },
    "backup_offsite_smoke",
  ],
  [
    "Backup dolu gaps reddedilir",
    {
      ...summary.smokeEvidence?.backupOffsite,
      gaps: ["offsite hedefi manuel doğrulanmadı"],
    },
    "backup_offsite_smoke",
  ],
  [
    "Backup beklenmeyen alan reddedilir",
    {
      ...summary.smokeEvidence?.backupOffsite,
      markerName: "uzman-hocam-offsite-smoke.txt",
    },
    "backup_offsite_smoke",
  ],
  [
    "WAL checkedAt geçersiz reddedilir",
    {
      ...summary.smokeEvidence?.walArchive,
      checkedAt: "not-a-date",
    },
    "wal_archive_smoke",
  ],
  [
    "WAL beklenmeyen alan reddedilir",
    {
      ...summary.smokeEvidence?.walArchive,
      markerName: "uzman-hocam-wal-archive-smoke.wal",
    },
    "wal_archive_smoke",
  ],
  [
    "noop SMS provider reddedilir",
    {
      ...summary.smokeEvidence?.smsProvider,
      provider: "noop",
    },
    "sms_provider_smoke",
  ],
  [
    "SMS yanlış komut reddedilir",
    {
      ...summary.smokeEvidence?.smsProvider,
      commandsPassed: ["pnpm sms"],
    },
    "sms_provider_smoke",
  ],
  [
    "SMS segments geçersiz reddedilir",
    {
      ...summary.smokeEvidence?.smsProvider,
      segments: "1",
    },
    "sms_provider_smoke",
  ],
  [
    "SMS beklenmeyen alan reddedilir",
    {
      ...summary.smokeEvidence?.smsProvider,
      rawRecipient: "+905551112233",
    },
    "sms_provider_smoke",
  ],
  [
    "Notification dolu gaps reddedilir",
    {
      ...summary.smokeEvidence?.notificationProvider,
      gaps: ["provider teslimatı manuel doğrulanmadı"],
    },
    "notification_provider_smoke",
  ],
  [
    "Notification beklenmeyen alan reddedilir",
    {
      ...summary.smokeEvidence?.notificationProvider,
      providerMessageId: "notification-message-001",
    },
    "notification_provider_smoke",
  ],
  [
    "Sentry checkedAt geçersiz reddedilir",
    {
      ...summary.smokeEvidence?.sentryEvent,
      checkedAt: "not-a-date",
    },
    "sentry_smoke",
  ],
  [
    "Sentry beklenmeyen alan reddedilir",
    {
      ...summary.smokeEvidence?.sentryEvent,
      message: "Uzman Hocam Sentry smoke",
    },
    "sentry_smoke",
  ],
  [
    "Rate limit status sapması reddedilir",
    {
      ...rateLimitRedisSmokePayload(),
      apiRateLimit: {
        ...rateLimitRedisSmokePayload().apiRateLimit,
        limitStatusCode: 200,
      },
    },
    "rate_limit_redis_smoke",
  ],
  [
    "Rate limit ham email reddedilir",
    {
      ...rateLimitRedisSmokePayload(),
      loginAttemptLimiter: {
        ...rateLimitRedisSmokePayload().loginAttemptLimiter,
        email: "rate-limit-smoke@example.invalid",
      },
    },
    "rate_limit_redis_smoke",
  ],
  [
    "Rate limit dolu gaps reddedilir",
    {
      ...rateLimitRedisSmokePayload(),
      gaps: ["iki instance Redis pencere kanıtı eksik"],
    },
    "rate_limit_redis_smoke",
  ],
  [
    "RLS load target altı actualRps reddedilir",
    {
      ...rlsLoadSmokePayload(),
      loadSmoke: {
        ...rlsLoadSmokePayload().loadSmoke,
        targetRps: 200,
        actualRps: 199,
      },
    },
    "rls_load_smoke",
  ],
  [
    "RLS load checkedAt geçersiz reddedilir",
    {
      ...rlsLoadSmokePayload(),
      checkedAt: "not-a-date",
    },
    "rls_load_smoke",
  ],
  [
    "RLS load dolu gaps reddedilir",
    {
      ...rlsLoadSmokePayload(),
      gaps: ["load smoke artifact'i arşivlenmedi"],
    },
    "rls_load_smoke",
  ],
  [
    "RLS load raw tenant reddedilir",
    {
      ...rlsLoadSmokePayload(),
      isolation: {
        ...rlsLoadSmokePayload().isolation,
        tenantId: "tenant-rls-load-a-raw",
      },
    },
    "rls_load_smoke",
  ],
  [
    "Report generation eşik aşımı reddedilir",
    {
      generatedAt: "2026-05-31T11:30:00.000Z",
      result: "PASS",
      check: "report_generation_smoke",
      environment: "staging",
      checkedAt: "2026-05-31T11:30:00.000Z",
      reportType: "EXAM_RESULT_SUMMARY",
      status: "READY",
      resultCount: 10000,
      studentCount: 10000,
      classCount: 20,
      branchCount: 2,
      expectedClassCount: 20,
      seedDurationMs: 1200,
      generationDurationMs: 60001,
      hashes: reportGenerationHashes(),
      thresholds: {
        resultCountMatches: true,
        generationDurationMsMax: 60000,
        generationDurationPassed: true,
      },
      commandsPassed: ["pnpm report-generation:perf"],
      gaps: [],
    },
    "report_generation_smoke",
  ],
  [
    "Report generation ham credential reddedilir",
    {
      ...reportGenerationSmokePayload(),
      email: "report-smoke@example.test",
      password: "password",
    },
    "report_generation_smoke",
  ],
  [
    "Report generation nested raw credential reddedilir",
    {
      ...reportGenerationSmokePayload(),
      hashes: {
        ...reportGenerationSmokePayload().hashes,
        email: "report-smoke@example.test",
      },
    },
    "report_generation_smoke",
  ],
  [
    "Report generation dolu gaps reddedilir",
    {
      ...reportGenerationSmokePayload(),
      gaps: ["10k performans eşiği manuel doğrulanmadı"],
    },
    "report_generation_smoke",
  ],
  [
    "Report generation beklenmeyen alan reddedilir",
    {
      ...reportGenerationSmokePayload(),
      notes: "manual override",
    },
    "report_generation_smoke",
  ],
];

failures.push(
  ...validateSmokeEvidencePayload(rlsLoadSmokePayload(), {
    expectedCheck: "rls_load_smoke",
    allowedEnvironments: ["staging", "production"],
    label: "rlsLoadSmoke",
    allowExampleEvidence: true,
  }),
);
failures.push(
  ...validateSmokeEvidencePayload(reportGenerationSmokePayload(), {
    expectedCheck: "report_generation_smoke",
    allowedEnvironments: ["staging", "production"],
    label: "reportGenerationSmoke",
    allowExampleEvidence: true,
  }),
);
failures.push(
  ...validateSmokeEvidencePayload(rateLimitRedisSmokePayload(), {
    expectedCheck: "rate_limit_redis_smoke",
    allowedEnvironments: ["staging", "production"],
    label: "rateLimitRedisSmoke",
    allowExampleEvidence: true,
  }),
);

for (const [label, payload, expectedCheck] of negativeCases) {
  const caseFailures = validateSmokeEvidencePayload(payload, {
    expectedCheck,
    allowedEnvironments: ["staging", "production"],
    label,
    allowExampleEvidence: true,
  });
  if (caseFailures.length === 0) {
    failures.push(`${label}: negatif senaryo hata üretmedi.`);
  }
}

if (failures.length > 0) {
  console.error("Smoke evidence contract kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Smoke evidence contract kontrolü geçti.");

function rlsLoadSmokePayload() {
  return {
    generatedAt: "2026-05-31T11:30:00.000Z",
    result: "PASS",
    check: "rls_load_smoke",
    environment: "staging",
    checkedAt: "2026-05-31T11:30:00.000Z",
    loadSmoke: {
      targetRps: 200,
      actualRps: 240.5,
      durationSeconds: 3,
      concurrency: 16,
      seedStudentsPerTenant: 80,
      queriesCompleted: 600,
      failures: 0,
    },
    isolation: {
      tenantAHash: "a".repeat(64),
      tenantBHash: "b".repeat(64),
      crossTenantReadRows: 0,
    },
    commandsPassed: ["pnpm rls:load:smoke"],
    gaps: [],
  };
}

function reportGenerationSmokePayload() {
  return {
    generatedAt: "2026-05-31T11:30:00.000Z",
    result: "PASS",
    check: "report_generation_smoke",
    environment: "staging",
    checkedAt: "2026-05-31T11:30:00.000Z",
    reportType: "EXAM_RESULT_SUMMARY",
    status: "READY",
    resultCount: 10000,
    studentCount: 10000,
    classCount: 20,
    branchCount: 2,
    expectedClassCount: 20,
    seedDurationMs: 1200,
    generationDurationMs: 25000,
    hashes: reportGenerationHashes(),
    thresholds: {
      resultCountMatches: true,
      generationDurationMsMax: 60000,
      generationDurationPassed: true,
    },
    commandsPassed: ["pnpm report-generation:perf"],
    gaps: [],
  };
}

function reportGenerationHashes() {
  return {
    tenantHash: "a".repeat(64),
    userHash: "b".repeat(64),
    emailHash: "c".repeat(64),
    examHash: "d".repeat(64),
    snapshotHash: "e".repeat(64),
    firstStudentHash: "f".repeat(64),
    contentHash: "1".repeat(64),
    queuedJobIdHash: "2".repeat(64),
  };
}

function rateLimitRedisSmokePayload() {
  return {
    generatedAt: "2026-05-31T11:30:00.000Z",
    result: "PASS",
    check: "rate_limit_redis_smoke",
    environment: "staging",
    checkedAt: "2026-05-31T11:30:00.000Z",
    config: {
      apiRateLimitEnabled: true,
      apiRateLimitStore: "redis",
      loginAttemptLimiterStore: "redis",
      windowMs: 60000,
      maxRequests: 300,
      loginMaxAttempts: 5,
      keyIncludesClientIpHash: true,
      excludedPaths: ["/health", "/metrics"],
    },
    instances: [
      { label: "api-instance-a", baseUrl: "https://staging-api-a.example.test/api/v1/__rate-limit-smoke" },
      { label: "api-instance-b", baseUrl: "https://staging-api-b.example.test/api/v1/__rate-limit-smoke" },
    ],
    apiRateLimit: {
      clientIpHash: "3".repeat(64),
      requestsSent: 301,
      allowedBeforeLimit: 300,
      limitedAtRequest: 301,
      limitStatusCode: 429,
      errorCode: "RATE_LIMITED",
      retryAfterHeaderPresent: true,
      secondInstanceLimitObserved: true,
      healthEndpointExcluded: true,
      metricsEndpointExcluded: true,
    },
    loginAttemptLimiter: {
      clientIpHash: "4".repeat(64),
      emailHash: "5".repeat(64),
      attemptsSent: 6,
      lockStatusCode: 429,
      errorCode: "LOGIN_LOCKED",
      sharedAcrossInstances: true,
      emailAndIpScoped: true,
      differentIpNotLocked: true,
    },
    commandsPassed: ["pnpm rate-limit:smoke", "pnpm rate-limit:check"],
    evidenceReferences: ["rate-limit-smoke-output", "redis-shared-window-observation"],
    gaps: [],
  };
}
