import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateSmokeEvidenceOutputTarget, validateSmokeEvidencePayload, writeSmokeEvidence } from "./smoke-evidence.mjs";

const summary = JSON.parse(readFileSync("docs/evidence-templates/production-evidence-summary.example.json", "utf8"));
const isemOpticalPipeline = JSON.parse(readFileSync("docs/evidence-templates/isem-optical-pipeline.example.json", "utf8"));

const smokeChecks = [
  ["traefikHttps", "traefik_https_smoke"],
  ["smsProvider", "sms_provider_smoke"],
  ["notificationProvider", "notification_provider_smoke"],
  ["sentryEvent", "sentry_smoke"],
  ["alertWebhook", "alert_webhook_smoke"],
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

failures.push(
  ...validateSmokeEvidencePayload(isemOpticalPipeline, {
    expectedCheck: "isem_optical_pipeline_smoke",
    allowedEnvironments: ["staging", "production"],
    label: "isemOpticalPipeline",
    allowExampleEvidence: true,
  }),
);
failures.push(
  ...validateSmokeEvidencePayload(liveUiWorkerResultPayload(), {
    expectedCheck: "live_ui_worker_report_smoke",
    allowedEnvironments: ["staging", "production"],
    label: "liveUiWorkerResult",
    allowExampleEvidence: true,
  }),
);

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
    "iSEM optik ham examId reddedilir",
    {
      ...isemOpticalPipeline,
      examId: "exam-isem-optical-smoke-example",
    },
    "isem_optical_pipeline_smoke",
  ],
  [
    "iSEM optik eksik skor reddedilir",
    {
      ...isemOpticalPipeline,
      sampleScores: [isemOpticalPipeline.sampleScores[0]],
    },
    "isem_optical_pipeline_smoke",
  ],
  [
    "iSEM optik eksik katilimci sayisi reddedilir",
    {
      ...isemOpticalPipeline,
      counts: {
        ...isemOpticalPipeline.counts,
        participantCount: 253,
      },
    },
    "isem_optical_pipeline_smoke",
  ],
  [
    "iSEM optik quarantine sapmasi reddedilir",
    {
      ...isemOpticalPipeline,
      counts: {
        ...isemOpticalPipeline.counts,
        quarantineCount: 1,
      },
    },
    "isem_optical_pipeline_smoke",
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
  [
    "Backup restore migration count reddedilir",
    {
      ...backupRestoreSmokePayload(),
      tableCounts: {
        ...backupRestoreSmokePayload().tableCounts,
        _prisma_migrations: 0,
      },
    },
    "backup_restore_smoke",
  ],
  [
    "Backup restore yanlış komut reddedilir",
    {
      ...backupRestoreSmokePayload(),
      commandsPassed: ["pnpm backup:restore"],
    },
    "backup_restore_smoke",
  ],
  [
    "Backup restore ham DB adı reddedilir",
    {
      ...backupRestoreSmokePayload(),
      restoreDb: "uzman_hocam_restore_smoke_20260614",
    },
    "backup_restore_smoke",
  ],
  [
    "Backup restore beklenmeyen alan reddedilir",
    {
      ...backupRestoreSmokePayload(),
      dumpPath: "/tmp/uzman_hocam_restore_smoke.dump",
    },
    "backup_restore_smoke",
  ],
  [
    "Live UI-worker result raw student id reddedilir",
    {
      ...liveUiWorkerResultPayload(),
      firstStudentId: "student-report-smoke-20260614-00001",
    },
    "live_ui_worker_report_smoke",
  ],
  [
    "Live UI-worker result portal eksigi reddedilir",
    {
      ...liveUiWorkerResultPayload(),
      studentPortalViewed: false,
    },
    "live_ui_worker_report_smoke",
  ],
  [
    "Live UI-worker result eksik download reddedilir",
    {
      ...liveUiWorkerResultPayload(),
      downloadedArtifacts: ["xlsx"],
    },
    "live_ui_worker_report_smoke",
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
failures.push(
  ...validateSmokeEvidencePayload(backupRestoreSmokePayload(), {
    expectedCheck: "backup_restore_smoke",
    allowedEnvironments: ["staging", "production"],
    label: "backupRestoreSmoke",
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

await runSmokeEvidenceOutputNegativeChecks(failures);
runFileTargetNegativeChecks(failures);

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

function backupRestoreSmokePayload() {
  return {
    generatedAt: "2026-05-31T11:30:00.000Z",
    result: "PASS",
    check: "backup_restore_smoke",
    environment: "staging",
    checkedAt: "2026-05-31T11:30:00.000Z",
    restoreDatabaseHash: "6".repeat(64),
    dumpFormat: "custom",
    tableCounts: {
      Tenant: 2,
      AuditLog: 1,
      ReportSnapshot: 1,
      _prisma_migrations: 56,
    },
    durationMs: 1250,
    commandsPassed: ["pnpm backup:restore:smoke"],
    gaps: [],
  };
}

function liveUiWorkerResultPayload() {
  return {
    result: "PASS",
    check: "live_ui_worker_report_smoke",
    generatedAt: "2026-06-15T09:45:00.000Z",
    environment: "staging",
    checkedAt: "2026-06-15T09:45:00.000Z",
    examHash: "1111111111111111111111111111111111111111111111111111111111111111",
    firstStudentHash: "2222222222222222222222222222222222222222222222222222222222222222",
    reportStatus: "READY",
    downloadedArtifacts: ["xlsx", "pdf"],
    karnePdfDownloaded: true,
    excelDownloaded: true,
    studentPortalViewed: true,
    guardianPortalViewed: true,
    commandsPassed: ["pnpm live:ui-worker:smoke"],
    gaps: [],
  };
}

async function runSmokeEvidenceOutputNegativeChecks(output) {
  const fixtureRoot = resolve("artifacts/prod-evidence-template-check/smoke-output-contract");
  const tempOutputPath = "/tmp/smoke-evidence-output-temp-negative.json";
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(tempOutputPath, { force: true });
  mkdirSync(fixtureRoot, { recursive: true });

  try {
    await expectValidateSmokeEvidenceOutputTargetFailure(
      tempOutputPath,
      "SMOKE_EVIDENCE_FILE lokal temp path olmamalı.",
      "smoke evidence preflight temp path negative",
      output,
    );

    await expectWriteSmokeEvidenceFailure(
      tempOutputPath,
      "SMOKE_EVIDENCE_FILE lokal temp path olmamalı.",
      "smoke evidence output temp path negative",
      output,
    );

    const positiveOutput = resolve(fixtureRoot, "positive.json");
    await writeSmokeEvidence(positiveOutput, { result: "PASS", check: "smoke_output_contract_positive" });

    await expectWriteSmokeEvidenceFailure(
      resolve(fixtureRoot, "invalid-payload.json"),
      "SMOKE_EVIDENCE_PAYLOAD_INVALID",
      "smoke evidence writer invalid payload negative",
      output,
      {
        result: "PASS",
        check: "sms_provider_smoke",
        environment: "staging",
        checkedAt: "2026-05-31T11:30:00.000Z",
        provider: "noop",
        recipient: "*******1234",
        segments: 1,
        providerMessageId: "sms-provider-message-001",
        commandsPassed: ["pnpm sms:smoke"],
        gaps: [],
      },
    );

    const realFile = resolve(fixtureRoot, "real.json");
    const symlinkFile = resolve(fixtureRoot, "symlink.json");
    writeFileSync(realFile, "{}\n");
    symlinkSync(realFile, symlinkFile);
    await expectWriteSmokeEvidenceFailure(
      symlinkFile,
      "SMOKE_EVIDENCE_FILE symlink olmayan file artifact olmalı.",
      "smoke evidence output symlink file negative",
      output,
    );

    const realDirectory = resolve(fixtureRoot, "real-dir");
    const symlinkDirectory = resolve(fixtureRoot, "symlink-dir");
    mkdirSync(realDirectory, { recursive: true });
    symlinkSync(realDirectory, symlinkDirectory, "dir");
    await expectWriteSmokeEvidenceFailure(
      resolve(symlinkDirectory, "nested", "evidence.json"),
      "SMOKE_EVIDENCE_FILE parent directory symlink olmayan dizin olmalı.",
      "smoke evidence output symlink parent negative",
      output,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
    rmSync(tempOutputPath, { force: true });
  }
}

async function expectValidateSmokeEvidenceOutputTargetFailure(filePath, expectedMessage, label, output) {
  try {
    await validateSmokeEvidenceOutputTarget(filePath);
    output.push(`${label}: negatif senaryo hata üretmedi.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expectedMessage)) {
      output.push(`${label}: beklenen hata yok (${expectedMessage}); alınan: ${message}`);
    }
  }
}

async function expectWriteSmokeEvidenceFailure(
  filePath,
  expectedMessage,
  label,
  output,
  payload = { result: "PASS", check: "smoke_output_contract_negative" },
) {
  try {
    await writeSmokeEvidence(filePath, payload);
    output.push(`${label}: negatif senaryo hata üretmedi.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expectedMessage)) {
      output.push(`${label}: beklenen hata yok (${expectedMessage}); alınan: ${message}`);
    }
  }
}

function runFileTargetNegativeChecks(output) {
  const root = resolve("artifacts/prod-evidence-template-check/smoke-file-target-contract");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  try {
    for (const smoke of fileTargetSmokeChecks()) {
      expectSmokeFileTargetFailure(
        smoke,
        `file:///tmp/${smoke.envKey.toLowerCase()}-negative`,
        smoke.tempError,
        smoke.tempNegativeLabel,
        output,
      );

      const realDirectory = join(root, `${smoke.envKey.toLowerCase()}-real`);
      const symlinkDirectory = join(root, `${smoke.envKey.toLowerCase()}-symlink`);
      mkdirSync(realDirectory, { recursive: true });
      symlinkSync(realDirectory, symlinkDirectory, "dir");
      expectSmokeFileTargetFailure(
        smoke,
        pathToFileURL(symlinkDirectory).href,
        smoke.symlinkError,
        smoke.symlinkNegativeLabel,
        output,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function fileTargetSmokeChecks() {
  return [
    {
      label: "Backup offsite smoke",
      tempNegativeLabel: "Backup offsite smoke temp file target negative",
      symlinkNegativeLabel: "Backup offsite smoke symlink file target negative",
      script: "scripts/smoke-backup-offsite.mjs",
      envKey: "BACKUP_OFFSITE_TARGET",
      tempError: "BACKUP_OFFSITE_TARGET file:// hedefi lokal temp/root path olmamalı.",
      symlinkError: "BACKUP_OFFSITE_TARGET file:// hedefi symlink olmayan dizin olmalı.",
    },
    {
      label: "WAL archive smoke",
      tempNegativeLabel: "WAL archive smoke temp file target negative",
      symlinkNegativeLabel: "WAL archive smoke symlink file target negative",
      script: "scripts/smoke-wal-archive-target.mjs",
      envKey: "WAL_ARCHIVE_TARGET",
      tempError: "WAL_ARCHIVE_TARGET file:// hedefi lokal temp/root path olmamalı.",
      symlinkError: "WAL_ARCHIVE_TARGET file:// hedefi symlink olmayan dizin olmalı.",
    },
  ];
}

function expectSmokeFileTargetFailure(smoke, target, expectedMessage, label, output) {
  const result = spawnSync(process.execPath, [smoke.script], {
    env: {
      ...process.env,
      [smoke.envKey]: target,
    },
    encoding: "utf8",
  });
  const message = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    output.push(`${label}: negatif senaryo hata üretmedi.`);
    return;
  }

  if (!message.includes(expectedMessage)) {
    output.push(`${label}: beklenen hata yok (${expectedMessage}); alınan: ${message}`);
  }
}
