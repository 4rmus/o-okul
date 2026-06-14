import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateSmokeEvidencePayload } from "./smoke-evidence.mjs";

const env = { ...process.env, ...readEnvFileArg() };
const summaryFile = readArgValue("--summary-file");
const summarySmokeEnvironments = ["staging", "production"];

if (summaryFile) {
  applySmokeEvidenceDefaults(summaryFile);
}

const checks = [
  ["Production env", "scripts/check-prod-env.mjs"],
  ["Traefik HTTPS", "scripts/smoke-traefik-https.mjs"],
  ["SMS provider", "scripts/smoke-sms-provider.mjs"],
  ["Notification provider", "scripts/smoke-notification-provider.mjs"],
  ["Sentry test event", "scripts/smoke-sentry-event.mjs"],
  ["Alert webhook", "scripts/smoke-alert-webhook.mjs"],
  ["Off-host backup target", "scripts/smoke-backup-offsite.mjs"],
  ["WAL archive target", "scripts/smoke-wal-archive-target.mjs"],
  ["Deployment region evidence", "scripts/check-deployment-region-evidence.mjs"],
  ["Deployment rollback evidence", "scripts/check-deployment-rollback-evidence.mjs"],
  ["GitHub CI evidence", "scripts/check-github-ci-evidence.mjs"],
  ["Restore drill evidence", "scripts/check-restore-drill-evidence.mjs"],
  ["KVKK inventory evidence", "scripts/check-kvkk-inventory-evidence.mjs"],
  ["Identity migration evidence", "scripts/check-identity-migration-evidence.mjs"],
  ["Financial retention evidence", "scripts/check-financial-retention-evidence.mjs"],
  ["Upload AV evidence", "scripts/check-upload-av-evidence.mjs"],
  ["Observability UAT evidence", "scripts/check-observability-uat-evidence.mjs"],
  ["External monitoring evidence", "scripts/check-external-monitoring-evidence.mjs"],
  ["Admin MFA evidence", "scripts/check-admin-mfa-evidence.mjs"],
  ["AI report summary evidence", "scripts/check-ai-report-summary-evidence.mjs"],
  ["Security audit evidence", "scripts/check-security-audit-evidence.mjs"],
  ["Live exam cycle evidence", "scripts/check-live-exam-cycle-evidence.mjs"],
  ["Inline upload migration evidence", "scripts/check-inline-upload-content-migration-evidence.mjs"],
  ["Rate limit Redis evidence", "scripts/check-rate-limit-evidence.mjs"],
  ["RLS live evidence", "scripts/check-rls-live-evidence.mjs"],
  ["UAT evidence", "scripts/check-uat-evidence.mjs"],
];
const reportArtifacts = {
  restoreDrill: "restore-drill.json",
  deploymentRegion: "deployment-region.json",
  deploymentRollback: "deployment-rollback.json",
  githubCi: "github-ci.json",
  kvkkInventory: "kvkk-inventory.json",
  identityMigration: "identity-migration.json",
  financialRetention: "financial-retention.json",
  uploadAv: "upload-av.json",
  observabilityUat: "observability-uat.json",
  externalMonitoring: "external-monitoring.json",
  adminMfa: "admin-mfa.json",
  aiReportSummary: "ai-report-summary.json",
  securityAudit: "security-audit.json",
  liveExamCycle: "live-exam-cycle.json",
  inlineUploadMigration: "inline-upload-content-migration.json",
  rateLimit: "rate-limit.json",
  rlsLive: "rls-live.json",
  uat: "uat.json",
};

for (const [label, script] of checks) {
  const result = spawnSync(process.execPath, [script], {
    env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(`Production evidence kontrolü başarısız: ${label}`);
    process.exit(result.status ?? 1);
  }
}

if (summaryFile) {
  writeSummary(summaryFile);
  validateSummaryFile(summaryFile);
}

console.log("Production evidence kontrolü geçti.");

function readEnvFileArg() {
  const file = readArgValue("--env-file");
  if (!file) {
    return {};
  }

  const envFromFile = {};
  const contents = readFileSync(file, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1).replace(/^["']|["']$/g, "");
    envFromFile[key] = value;
  }
  return envFromFile;
}

function readArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const value = process.argv[index + 1];
  if (!value) {
    console.error("Production evidence kontrolü başarısız:");
    console.error(`- ${name} için değer gerekli.`);
    process.exit(1);
  }
  return value;
}

function writeSummary(file) {
  const smokeEvidence = {
    traefikHttps: readSmokeEvidence("TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE", "traefik_https_smoke"),
    smsProvider: readSmokeEvidence("SMS_PROVIDER_SMOKE_EVIDENCE_FILE", "sms_provider_smoke"),
    notificationProvider: readSmokeEvidence("NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE", "notification_provider_smoke"),
    sentryEvent: readSmokeEvidence("SENTRY_SMOKE_EVIDENCE_FILE", "sentry_smoke"),
    alertWebhook: readSmokeEvidence("ALERT_WEBHOOK_SMOKE_EVIDENCE_FILE", "alert_webhook_smoke"),
    backupOffsite: readSmokeEvidence("BACKUP_OFFSITE_SMOKE_EVIDENCE_FILE", "backup_offsite_smoke"),
    walArchive: readSmokeEvidence("WAL_ARCHIVE_SMOKE_EVIDENCE_FILE", "wal_archive_smoke"),
  };
  const reports = {
    restoreDrill: readJsonTarget(env.RESTORE_DRILL_TARGET),
    deploymentRegion: readJsonTarget(env.DEPLOYMENT_REGION_TARGET),
    deploymentRollback: readJsonTarget(env.DEPLOYMENT_ROLLBACK_TARGET),
    githubCi: readJsonTarget(env.GITHUB_CI_EVIDENCE_TARGET),
    kvkkInventory: readJsonTarget(env.KVKK_INVENTORY_TARGET),
    identityMigration: readJsonTarget(env.IDENTITY_MIGRATION_TARGET),
    financialRetention: readJsonTarget(env.FINANCIAL_RETENTION_TARGET),
    uploadAv: readJsonTarget(env.UPLOAD_AV_TARGET),
    observabilityUat: readJsonTarget(env.OBSERVABILITY_UAT_TARGET),
    externalMonitoring: readJsonTarget(env.EXTERNAL_MONITORING_TARGET),
    adminMfa: readJsonTarget(env.ADMIN_MFA_EVIDENCE_TARGET),
    aiReportSummary: readJsonTarget(env.AI_REPORT_SUMMARY_EVIDENCE_TARGET),
    securityAudit: readJsonTarget(env.SECURITY_AUDIT_TARGET),
    liveExamCycle: readJsonTarget(env.LIVE_EXAM_CYCLE_TARGET),
    inlineUploadMigration: readJsonTarget(env.INLINE_UPLOAD_CONTENT_MIGRATION_TARGET),
    rateLimit: readJsonTarget(env.RATE_LIMIT_EVIDENCE_TARGET),
    rlsLive: readJsonTarget(env.RLS_LIVE_EVIDENCE_TARGET),
    uat: readJsonTarget(env.UAT_EVIDENCE_TARGET),
  };

  const summary = {
    result: "PASS",
    generatedAt: new Date().toISOString(),
    nodeEnv: env.NODE_ENV,
    appUrl: env.APP_URL,
    apiUrl: env.API_URL,
    webUrl: env.WEB_URL,
    checks: checks.map(([label, script]) => ({ label, script, status: "PASS" })),
    smokeEvidence,
    reports: {
      restoreDrill: {
        environment: reports.restoreDrill.environment,
        drillDate: reports.restoreDrill.drillDate,
        sourceBackup: reports.restoreDrill.sourceBackup,
        targetDatabase: reports.restoreDrill.targetDatabase,
        tableCounts: reports.restoreDrill.tableCounts,
      },
      deploymentRegion: {
        environment: reports.deploymentRegion.environment,
        checkedAt: reports.deploymentRegion.checkedAt,
        provider: reports.deploymentRegion.provider,
        region: reports.deploymentRegion.region,
        datacenterCountryCode: reports.deploymentRegion.datacenterCountryCode,
        evidenceReference: reports.deploymentRegion.evidenceReference,
        servicesVerified: reports.deploymentRegion.servicesVerified,
      },
      deploymentRollback: {
        environment: reports.deploymentRollback.environment,
        checkedAt: reports.deploymentRollback.checkedAt,
        releaseCandidate: reports.deploymentRollback.releaseCandidate,
        failedImageTag: reports.deploymentRollback.failedImageTag,
        rollbackImageTag: reports.deploymentRollback.rollbackImageTag,
        failureInjected: reports.deploymentRollback.failureInjected,
        failureMode: reports.deploymentRollback.failureMode,
        migrationRollbackSafe: reports.deploymentRollback.migrationRollbackSafe,
        commandsPassed: reports.deploymentRollback.commandsPassed,
        servicesVerified: reports.deploymentRollback.servicesVerified,
        evidenceReferences: reports.deploymentRollback.evidenceReferences,
      },
      githubCi: {
        environment: reports.githubCi.environment,
        checkedAt: reports.githubCi.checkedAt,
        repository: reports.githubCi.repository,
        commitSha: reports.githubCi.commitSha,
        branch: reports.githubCi.branch,
        workflow: reports.githubCi.workflow,
        command: reports.githubCi.command,
        jobs: reports.githubCi.jobs,
        commandsPassed: reports.githubCi.commandsPassed,
        evidenceReferences: reports.githubCi.evidenceReferences,
      },
      kvkkInventory: {
        environment: reports.kvkkInventory.environment,
        checkedAt: reports.kvkkInventory.checkedAt,
        inventorySource: reports.kvkkInventory.inventorySource,
        dataSubjectCounts: reports.kvkkInventory.dataSubjectCounts,
        purgeCoverage: reports.kvkkInventory.purgeCoverage,
        auditActionsVerified: reports.kvkkInventory.auditActionsVerified,
      },
      identityMigration: {
        environment: reports.identityMigration.environment,
        checkedAt: reports.identityMigration.checkedAt,
        migrationDecision: reports.identityMigration.migrationDecision,
        subjects: reports.identityMigration.subjects,
        invitationFlow: reports.identityMigration.invitationFlow,
        verifications: reports.identityMigration.verifications,
      },
      financialRetention: {
        environment: reports.financialRetention.environment,
        checkedAt: reports.financialRetention.checkedAt,
        policyDecision: reports.financialRetention.policyDecision,
        financialRecords: reports.financialRetention.financialRecords,
        purgeBehaviorVerified: reports.financialRetention.purgeBehaviorVerified,
      },
      uploadAv: {
        environment: reports.uploadAv.environment,
        checkedAt: reports.uploadAv.checkedAt,
        scannerDecision: reports.uploadAv.scannerDecision,
        uploadSurfaces: reports.uploadAv.uploadSurfaces,
        scanResults: reports.uploadAv.scanResults,
      },
      observabilityUat: {
        environment: reports.observabilityUat.environment,
        checkedAt: reports.observabilityUat.checkedAt,
        prometheusScrapeOk: reports.observabilityUat.prometheusScrapeOk,
        grafanaDashboardOk: reports.observabilityUat.grafanaDashboardOk,
        lokiLogPanelOk: reports.observabilityUat.lokiLogPanelOk,
        alertWebhookStatus: reports.observabilityUat.alertWebhookStatus,
        alertsVerified: reports.observabilityUat.alertsVerified,
        evidenceReferences: reports.observabilityUat.evidenceReferences,
      },
      externalMonitoring: {
        environment: reports.externalMonitoring.environment,
        checkedAt: reports.externalMonitoring.checkedAt,
        provider: reports.externalMonitoring.provider,
        monitoringNode: reports.externalMonitoring.monitoringNode,
        monitorsVerified: reports.externalMonitoring.monitorsVerified,
        outageDrill: reports.externalMonitoring.outageDrill,
        evidenceReferences: reports.externalMonitoring.evidenceReferences,
      },
      adminMfa: {
        environment: reports.adminMfa.environment,
        checkedAt: reports.adminMfa.checkedAt,
        policy: reports.adminMfa.policy,
        enrollment: reports.adminMfa.enrollment,
        loginVerification: reports.adminMfa.loginVerification,
        commandsPassed: reports.adminMfa.commandsPassed,
        evidenceReferences: reports.adminMfa.evidenceReferences,
      },
      aiReportSummary: {
        environment: reports.aiReportSummary.environment,
        checkedAt: reports.aiReportSummary.checkedAt,
        provider: reports.aiReportSummary.provider,
        kvkk: reports.aiReportSummary.kvkk,
        externalAiStopRule: reports.aiReportSummary.externalAiStopRule,
        generation: reports.aiReportSummary.generation,
        validation: reports.aiReportSummary.validation,
        commandsPassed: reports.aiReportSummary.commandsPassed,
        evidenceReferences: reports.aiReportSummary.evidenceReferences,
      },
      securityAudit: {
        environment: reports.securityAudit.environment,
        checkedAt: reports.securityAudit.checkedAt,
        prodEnvCheckOk: reports.securityAudit.prodEnvCheckOk,
        httpsOk: reports.securityAudit.httpsOk,
        rlsLiveCheckOk: reports.securityAudit.rlsLiveCheckOk,
        noCriticalFindings: reports.securityAudit.noCriticalFindings,
        evidenceReferences: reports.securityAudit.evidenceReferences,
      },
      liveExamCycle: {
        environment: reports.liveExamCycle.environment,
        checkedAt: reports.liveExamCycle.checkedAt,
        tester: reports.liveExamCycle.tester,
        releaseCandidate: reports.liveExamCycle.releaseCandidate,
        appUrl: reports.liveExamCycle.appUrl,
        apiUrl: reports.liveExamCycle.apiUrl,
        commandsPassed: reports.liveExamCycle.commandsPassed,
        examCycle: reports.liveExamCycle.examCycle,
        evidenceReferences: reports.liveExamCycle.evidenceReferences,
      },
      inlineUploadMigration: {
        environment: reports.inlineUploadMigration.environment,
        checkedAt: reports.inlineUploadMigration.checkedAt,
        storageMode: reports.inlineUploadMigration.storageMode,
        dryRun: reports.inlineUploadMigration.dryRun,
        migration: reports.inlineUploadMigration.migration,
        commandsPassed: reports.inlineUploadMigration.commandsPassed,
        evidenceReferences: reports.inlineUploadMigration.evidenceReferences,
      },
      rateLimit: {
        environment: reports.rateLimit.environment,
        checkedAt: reports.rateLimit.checkedAt,
        config: reports.rateLimit.config,
        instances: reports.rateLimit.instances,
        apiRateLimit: reports.rateLimit.apiRateLimit,
        loginAttemptLimiter: reports.rateLimit.loginAttemptLimiter,
        commandsPassed: reports.rateLimit.commandsPassed,
        evidenceReferences: reports.rateLimit.evidenceReferences,
      },
      rlsLive: {
        environment: reports.rlsLive.environment,
        checkedAt: reports.rlsLive.checkedAt,
        schema: reports.rlsLive.schema,
        isolation: reports.rlsLive.isolation,
        loadSmoke: reports.rlsLive.loadSmoke,
        commandsPassed: reports.rlsLive.commandsPassed,
        evidenceReferences: reports.rlsLive.evidenceReferences,
      },
      uat: {
        environment: reports.uat.environment,
        checkedAt: reports.uat.checkedAt,
        tester: reports.uat.tester,
        releaseCandidate: reports.uat.releaseCandidate,
        rollbackImageTag: reports.uat.rollbackImageTag,
        restoreBackupReference: reports.uat.restoreBackupReference,
        liveExamCyclePassed: reports.uat.commandsPassed.includes("pnpm live:exam-cycle:check"),
        flowsVerified: reports.uat.flowsVerified,
        journeyScenariosVerified: reports.uat.journeyScenariosVerified,
        commandsPassed: reports.uat.commandsPassed,
      },
    },
  };

  writeReportArtifacts(file, reports);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Production evidence summary yazıldı: ${file}`);
}

function writeReportArtifacts(summaryFilePath, reports) {
  const reportsDir = join(dirname(summaryFilePath), "reports");
  mkdirSync(reportsDir, { recursive: true });

  for (const [key, fileName] of Object.entries(reportArtifacts)) {
    writeFileSync(join(reportsDir, fileName), `${JSON.stringify(reports[key], null, 2)}\n`);
  }
}

function validateSummaryFile(file) {
  const result = spawnSync(process.execPath, ["scripts/check-production-evidence-summary.mjs"], {
    env: {
      ...env,
      PRODUCTION_EVIDENCE_SUMMARY_TARGET: pathToFileURL(resolve(file)).href,
    },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error("Production evidence kontrolü başarısız: production evidence summary sözleşmesi");
    process.exit(result.status ?? 1);
  }
}

function applySmokeEvidenceDefaults(file) {
  const directory = join(dirname(file), "smoke");
  const defaults = {
    TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE: "traefik-https.json",
    SMS_PROVIDER_SMOKE_EVIDENCE_FILE: "sms-provider.json",
    NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE: "notification-provider.json",
    SENTRY_SMOKE_EVIDENCE_FILE: "sentry-event.json",
    ALERT_WEBHOOK_SMOKE_EVIDENCE_FILE: "alert-webhook.json",
    BACKUP_OFFSITE_SMOKE_EVIDENCE_FILE: "backup-offsite.json",
    WAL_ARCHIVE_SMOKE_EVIDENCE_FILE: "wal-archive.json",
  };

  for (const [key, fileName] of Object.entries(defaults)) {
    env[key] ||= join(directory, fileName);
  }
}

function readSmokeEvidence(key, expectedCheck) {
  const file = env[key];
  if (!file) {
    fail([`${key} boş bırakılamaz.`]);
  }
  if (!existsSync(file)) {
    fail([`Smoke kanıt dosyası eksik: ${key}=${file}`]);
  }

  try {
    const payload = JSON.parse(readFileSync(file, "utf8"));
    const failures = validateSmokeEvidencePayload(payload, {
      expectedCheck,
      allowedEnvironments: summarySmokeEnvironments,
      label: key,
    });
    if (failures.length > 0) {
      fail(failures);
    }
    return payload;
  } catch {
    fail([`Smoke kanıt dosyası geçerli JSON olmalı: ${key}=${file}`]);
  }
}

function readJsonTarget(target) {
  const url = new URL(target);
  if (url.protocol === "file:") {
    return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    const response = fetchSync(url);
    return JSON.parse(response);
  }

  throw new Error(`Desteklenmeyen evidence target: ${target}`);
}

function fetchSync(url) {
  const result = spawnSync(process.execPath, ["-e", `fetch(${JSON.stringify(url.href)}).then(async r => {
    if (!r.ok) process.exit(1);
    process.stdout.write(await r.text());
  }).catch(() => process.exit(1));`], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`Evidence target okunamadı: ${url.href}`);
  }
  return result.stdout;
}

function fail(failures) {
  console.error("Production evidence kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
