import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateSmokeEvidencePayload } from "./smoke-evidence.mjs";

const env = { ...process.env, ...readEnvFileArg() };
const summaryFile = readArgValue("--summary-file");
const summaryOutputFile = summaryFile ? validateSummaryOutputFile(summaryFile) : undefined;
const summarySmokeEnvironments = ["staging", "production"];
const evidenceTargetKeys = [
  "DEPLOYMENT_ROLLBACK_TARGET",
  "GITHUB_CI_EVIDENCE_TARGET",
  "RESTORE_DRILL_TARGET",
  "KVKK_INVENTORY_TARGET",
  "IDENTITY_MIGRATION_TARGET",
  "FINANCIAL_RETENTION_TARGET",
  "UPLOAD_AV_TARGET",
  "OBSERVABILITY_UAT_TARGET",
  "ADMIN_MFA_EVIDENCE_TARGET",
  "SECURITY_AUDIT_TARGET",
  "UAT_EVIDENCE_TARGET",
  "LIVE_EXAM_CYCLE_TARGET",
  "ISEM_OPTICAL_PIPELINE_TARGET",
  "LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET",
  "UI_UX_REDESIGN_EVIDENCE_TARGET",
  "INLINE_UPLOAD_CONTENT_MIGRATION_TARGET",
  "AUDIT_NULL_TENANT_EVIDENCE_TARGET",
  "RATE_LIMIT_EVIDENCE_TARGET",
  "RLS_LIVE_EVIDENCE_TARGET",
  "PILOT_EVIDENCE_TARGET",
  "GO_LIVE_EVIDENCE_TARGET",
  "LIVE_STATUS_EVIDENCE_TARGET",
];
const smokeEvidenceFileDefaults = {
  TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE: "traefik-https.json",
  SMS_PROVIDER_SMOKE_EVIDENCE_FILE: "sms-provider.json",
  NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE: "notification-provider.json",
  SENTRY_SMOKE_EVIDENCE_FILE: "sentry-event.json",
  ALERT_WEBHOOK_SMOKE_EVIDENCE_FILE: "alert-webhook.json",
  WAL_ARCHIVE_SMOKE_EVIDENCE_FILE: "wal-archive.json",
  REPORT_GENERATION_SMOKE_EVIDENCE_FILE: "report-generation.json",
  SECRET_DELIVERY_OUTBOX_SMOKE_EVIDENCE_FILE: "secret-delivery-outbox.json",
};

if (summaryOutputFile) {
  applySmokeEvidenceDefaults(summaryOutputFile);
}

const checks = [
  ["Production env", "scripts/check-prod-env.mjs"],
  ["Traefik HTTPS", "scripts/smoke-traefik-https.mjs"],
  ["SMS disabled path", "scripts/smoke-sms-provider.mjs"],
  ["Notification provider", "scripts/smoke-notification-provider.mjs"],
  ["Sentry test event", "scripts/smoke-sentry-event.mjs"],
  ["Alert webhook", "scripts/smoke-alert-webhook.mjs"],
  ["WAL archive target", "scripts/smoke-wal-archive-target.mjs"],
  ["Report generation smoke", "scripts/smoke-report-generation-live.mjs"],
  ["Secret delivery outbox evidence", "scripts/check-secret-delivery-outbox-evidence.mjs"],
  ["Deployment rollback evidence", "scripts/check-deployment-rollback-evidence.mjs"],
  ["GitHub CI evidence", "scripts/check-github-ci-evidence.mjs"],
  ["Restore drill evidence", "scripts/check-restore-drill-evidence.mjs"],
  ["KVKK inventory evidence", "scripts/check-kvkk-inventory-evidence.mjs"],
  ["Identity migration evidence", "scripts/check-identity-migration-evidence.mjs"],
  ["Financial retention evidence", "scripts/check-financial-retention-evidence.mjs"],
  ["Upload AV evidence", "scripts/check-upload-av-evidence.mjs"],
  ["Observability UAT evidence", "scripts/check-observability-uat-evidence.mjs"],
  ["Admin MFA evidence", "scripts/check-admin-mfa-evidence.mjs"],
  ["Security audit evidence", "scripts/check-security-audit-evidence.mjs"],
  ["Live exam cycle evidence", "scripts/check-live-exam-cycle-evidence.mjs"],
  ["iSEM optical pipeline evidence", "scripts/check-isem-optical-pipeline-evidence.mjs"],
  ["Live UI-worker result evidence", "scripts/check-live-ui-worker-result-evidence.mjs"],
  ["UI/UX redesign evidence", "scripts/check-ui-ux-redesign-evidence.mjs"],
  ["Inline upload migration evidence", "scripts/check-inline-upload-content-migration-evidence.mjs"],
  ["Audit null tenant evidence", "scripts/check-audit-null-tenant-evidence.mjs"],
  ["Rate limit Redis evidence", "scripts/check-rate-limit-evidence.mjs"],
  ["RLS live evidence", "scripts/check-rls-live-evidence.mjs"],
  ["UAT evidence", "scripts/check-uat-evidence.mjs"],
];
const reportArtifacts = {
  restoreDrill: "restore-drill.json",
  deploymentRollback: "deployment-rollback.json",
  githubCi: "github-ci.json",
  kvkkInventory: "kvkk-inventory.json",
  identityMigration: "identity-migration.json",
  financialRetention: "financial-retention.json",
  uploadAv: "upload-av.json",
  observabilityUat: "observability-uat.json",
  adminMfa: "admin-mfa.json",
  securityAudit: "security-audit.json",
  liveExamCycle: "live-exam-cycle.json",
  isemOpticalPipeline: "isem-optical-pipeline.json",
  liveUiWorkerResult: "live-ui-worker-result.json",
  uiUxRedesign: "ui-ux-redesign.json",
  inlineUploadMigration: "inline-upload-content-migration.json",
  auditNullTenant: "audit-null-tenant.json",
  rateLimit: "rate-limit.json",
  rlsLive: "rls-live.json",
  uat: "uat.json",
};

requireSmokeEvidenceFileTargets();
requireNoExampleEvidenceFlags();
requireEvidenceTargetUrls();

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

if (summaryOutputFile) {
  writeSummary(summaryOutputFile);
  validateSummaryFile(summaryOutputFile);
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

function requireEvidenceTargetUrls() {
  const failures = [];
  for (const key of evidenceTargetKeys) {
    if (!env[key]) continue;
    const url = toOptionalEvidenceTargetUrl(env[key]);
    if (!url || !isAllowedEvidenceTargetUrl(url)) {
      failures.push(`${key} file:// veya https:// URL olmalı.`);
      continue;
    }
    if (hasSecretBearingUrlParts(url)) {
      failures.push(`${key} production evidence target URL userinfo, query veya fragment içeremez.`);
    }
    if (url.protocol === "https:" && isPlaceholderHost(url.hostname)) {
      failures.push(`${key} production için gerçek https host olmalı.`);
    }
    if (url.protocol === "file:" && isLocalTempFileUrl(url)) {
      failures.push(`${key} production için lokal temp path olmamalı.`);
    }
    if (url.protocol === "file:" && isLocalSmokeEvidenceFileUrl(url)) {
      failures.push(`${key} production için artifacts/local altında olmamalı.`);
    }
    if (url.protocol === "file:" && !isFileUrlParentPathAllowed(url)) {
      failures.push(`${key} production için parent dizini symlink olmayan dizin olmalı.`);
    }
    if (url.protocol === "file:" && !isRegularNonSymlinkFileUrl(url)) {
      failures.push(`${key} production için symlink olmayan file artifact olmalı.`);
    }
  }

  if (failures.length > 0) {
    fail(failures);
  }
}

function requireNoExampleEvidenceFlags() {
  const enabledFlags = Object.entries(env)
    .filter(([key, value]) => key.endsWith("_ALLOW_EXAMPLE_EVIDENCE") && value === "1")
    .map(([key]) => key)
    .sort();

  if (enabledFlags.length === 0) return;

  fail(enabledFlags.map((key) => `${key}=1 prod:evidence:check kapısında kullanılamaz.`));
}

function writeSummary(file) {
  validateSummaryOutputFile(file);
  const smokeEvidence = {
    traefikHttps: readSmokeEvidence("TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE", "traefik_https_smoke"),
    smsProvider: readSmokeEvidence("SMS_PROVIDER_SMOKE_EVIDENCE_FILE", "sms_provider_smoke"),
    notificationProvider: readSmokeEvidence("NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE", "notification_provider_smoke"),
    sentryEvent: readSmokeEvidence("SENTRY_SMOKE_EVIDENCE_FILE", "sentry_smoke"),
    alertWebhook: readSmokeEvidence("ALERT_WEBHOOK_SMOKE_EVIDENCE_FILE", "alert_webhook_smoke"),
    walArchive: readSmokeEvidence("WAL_ARCHIVE_SMOKE_EVIDENCE_FILE", "wal_archive_smoke"),
    reportGeneration: readSmokeEvidence("REPORT_GENERATION_SMOKE_EVIDENCE_FILE", "report_generation_smoke"),
    secretDeliveryOutbox: readSmokeEvidence("SECRET_DELIVERY_OUTBOX_SMOKE_EVIDENCE_FILE", "secret_delivery_outbox_staging_smoke"),
  };
  const reports = {
    restoreDrill: readJsonTarget(env.RESTORE_DRILL_TARGET),
    deploymentRollback: readJsonTarget(env.DEPLOYMENT_ROLLBACK_TARGET),
    githubCi: readJsonTarget(env.GITHUB_CI_EVIDENCE_TARGET),
    kvkkInventory: readJsonTarget(env.KVKK_INVENTORY_TARGET),
    identityMigration: readJsonTarget(env.IDENTITY_MIGRATION_TARGET),
    financialRetention: readJsonTarget(env.FINANCIAL_RETENTION_TARGET),
    uploadAv: readJsonTarget(env.UPLOAD_AV_TARGET),
    observabilityUat: readJsonTarget(env.OBSERVABILITY_UAT_TARGET),
    adminMfa: readJsonTarget(env.ADMIN_MFA_EVIDENCE_TARGET),
    securityAudit: readJsonTarget(env.SECURITY_AUDIT_TARGET),
    liveExamCycle: readJsonTarget(env.LIVE_EXAM_CYCLE_TARGET),
    isemOpticalPipeline: readJsonTarget(env.ISEM_OPTICAL_PIPELINE_TARGET),
    liveUiWorkerResult: readJsonTarget(env.LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET),
    uiUxRedesign: readJsonTarget(env.UI_UX_REDESIGN_EVIDENCE_TARGET),
    inlineUploadMigration: readJsonTarget(env.INLINE_UPLOAD_CONTENT_MIGRATION_TARGET),
    auditNullTenant: readJsonTarget(env.AUDIT_NULL_TENANT_EVIDENCE_TARGET),
    rateLimit: readJsonTarget(env.RATE_LIMIT_EVIDENCE_TARGET),
    rlsLive: readJsonTarget(env.RLS_LIVE_EVIDENCE_TARGET),
    uat: readJsonTarget(env.UAT_EVIDENCE_TARGET),
  };
  requireReleaseSourceBinding(reports);

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
      deploymentRollback: {
        schemaVersion: reports.deploymentRollback.schemaVersion,
        environment: reports.deploymentRollback.environment,
        checkedAt: reports.deploymentRollback.checkedAt,
        releaseCandidate: reports.deploymentRollback.releaseCandidate,
        rollbackImageTag: reports.deploymentRollback.rollbackImageTag,
        drill: reports.deploymentRollback.drill,
        migrationRollbackSafe: reports.deploymentRollback.migrationRollbackSafe,
        commandsPassed: reports.deploymentRollback.commandsPassed,
        servicesVerified: reports.deploymentRollback.servicesVerified,
        approval: reports.deploymentRollback.approval,
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
        whatsappConsent: reports.kvkkInventory.whatsappConsent,
        auditActionsVerified: reports.kvkkInventory.auditActionsVerified,
        auditDiffRedactionVerified: reports.kvkkInventory.auditDiffRedactionVerified,
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
        alertDelivery: reports.observabilityUat.alertDelivery,
        evidenceReferences: reports.observabilityUat.evidenceReferences,
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
      isemOpticalPipeline: {
        generatedAt: reports.isemOpticalPipeline.generatedAt,
        environment: reports.isemOpticalPipeline.environment,
        checkedAt: reports.isemOpticalPipeline.checkedAt,
        parserConfigVersion: reports.isemOpticalPipeline.parserConfigVersion,
        answerKeyVersion: reports.isemOpticalPipeline.answerKeyVersion,
        answerKeyQuestionCount: reports.isemOpticalPipeline.answerKeyQuestionCount,
        bookletVariantCount: reports.isemOpticalPipeline.bookletVariantCount,
        counts: reports.isemOpticalPipeline.counts,
        pipeline: reports.isemOpticalPipeline.pipeline,
        sampleScores: reports.isemOpticalPipeline.sampleScores,
        hashes: reports.isemOpticalPipeline.hashes,
        thresholds: reports.isemOpticalPipeline.thresholds,
        pipelineDurationMs: reports.isemOpticalPipeline.pipelineDurationMs,
        commandsPassed: reports.isemOpticalPipeline.commandsPassed,
      },
      liveUiWorkerResult: {
        generatedAt: reports.liveUiWorkerResult.generatedAt,
        result: reports.liveUiWorkerResult.result,
        check: reports.liveUiWorkerResult.check,
        environment: reports.liveUiWorkerResult.environment,
        checkedAt: reports.liveUiWorkerResult.checkedAt,
        examHash: reports.liveUiWorkerResult.examHash,
        firstStudentHash: reports.liveUiWorkerResult.firstStudentHash,
        reportStatus: reports.liveUiWorkerResult.reportStatus,
        downloadedArtifacts: reports.liveUiWorkerResult.downloadedArtifacts,
        karnePdfDownloaded: reports.liveUiWorkerResult.karnePdfDownloaded,
        excelDownloaded: reports.liveUiWorkerResult.excelDownloaded,
        studentPortalViewed: reports.liveUiWorkerResult.studentPortalViewed,
        guardianPortalViewed: reports.liveUiWorkerResult.guardianPortalViewed,
        sessionLogoutVerified: reports.liveUiWorkerResult.sessionLogoutVerified,
        commandsPassed: reports.liveUiWorkerResult.commandsPassed,
        gaps: reports.liveUiWorkerResult.gaps,
      },
      uiUxRedesign: {
        schemaVersion: reports.uiUxRedesign.schemaVersion,
        result: reports.uiUxRedesign.result,
        environment: reports.uiUxRedesign.environment,
        checkedAt: reports.uiUxRedesign.checkedAt,
        releaseCandidate: reports.uiUxRedesign.releaseCandidate,
        sourceCommitSha: reports.uiUxRedesign.sourceCommitSha,
        githubCi: reports.uiUxRedesign.githubCi,
        allowedEvidenceHosts: reports.uiUxRedesign.allowedEvidenceHosts,
        redesignPlanPath: reports.uiUxRedesign.redesignPlanPath,
        localStaticEvidence: reports.uiUxRedesign.localStaticEvidence,
        stagingProductionEvidence: reports.uiUxRedesign.stagingProductionEvidence,
        phaseEvidence: reports.uiUxRedesign.phaseEvidence,
        viewportCoverage: reports.uiUxRedesign.viewportCoverage,
        artifacts: reports.uiUxRedesign.artifacts,
        privacy: reports.uiUxRedesign.privacy,
        approvals: reports.uiUxRedesign.approvals,
        openRisks: reports.uiUxRedesign.openRisks,
      },
      inlineUploadMigration: {
        environment: reports.inlineUploadMigration.environment,
        checkedAt: reports.inlineUploadMigration.checkedAt,
        storageMode: reports.inlineUploadMigration.storageMode,
        dryRun: reports.inlineUploadMigration.dryRun,
        migration: reports.inlineUploadMigration.migration,
        orphanAudit: reports.inlineUploadMigration.orphanAudit,
        commandsPassed: reports.inlineUploadMigration.commandsPassed,
        evidenceReferences: reports.inlineUploadMigration.evidenceReferences,
      },
      auditNullTenant: {
        environment: reports.auditNullTenant.environment,
        checkedAt: reports.auditNullTenant.checkedAt,
        auditNullTenant: reports.auditNullTenant.auditNullTenant,
        commandsPassed: reports.auditNullTenant.commandsPassed,
        evidenceReferences: reports.auditNullTenant.evidenceReferences,
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
        tenantFkPreflight: reports.rlsLive.tenantFkPreflight,
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
  assertExistingFileArtifact(file, "--summary-file");
  mkdirSync(dirname(file), { recursive: true });
  validateManagedSiblingDirectory(file, "reports");
  validateManagedSiblingDirectory(file, "smoke");
  assertExistingFileArtifact(file, "--summary-file");
  writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
  assertExistingFileArtifact(file, "--summary-file");
  console.log(`Production evidence summary yazıldı: ${file}`);
}

function requireReleaseSourceBinding(reports) {
  const releaseCandidateTag = reports.uiUxRedesign.releaseCandidate?.match(/:([a-f0-9]{40})$/i)?.[1];
  const sourceCommitSha = reports.uiUxRedesign.sourceCommitSha;
  const githubCommitSha = reports.githubCi.commitSha;
  if (
    !releaseCandidateTag ||
    typeof sourceCommitSha !== "string" ||
    !/^[a-f0-9]{40}$/i.test(sourceCommitSha) ||
    typeof githubCommitSha !== "string" ||
    !/^[a-f0-9]{40}$/i.test(githubCommitSha) ||
    releaseCandidateTag.toLowerCase() !== sourceCommitSha.toLowerCase() ||
    sourceCommitSha.toLowerCase() !== githubCommitSha.toLowerCase()
  ) {
    fail(["UI/UX releaseCandidate tag'i, sourceCommitSha ve GitHub CI commitSha aynı 40 karakter SHA olmalı."]);
  }
}

function writeReportArtifacts(summaryFilePath, reports) {
  const reportsDir = join(dirname(summaryFilePath), "reports");
  validateManagedSiblingDirectory(summaryFilePath, "reports");
  mkdirSync(reportsDir, { recursive: true });
  validateManagedSiblingDirectory(summaryFilePath, "reports");

  for (const [key, fileName] of Object.entries(reportArtifacts)) {
    const reportFile = join(reportsDir, fileName);
    assertExistingFileArtifact(reportFile, `reports/${fileName}`);
    writeFileSync(reportFile, `${JSON.stringify(reports[key], null, 2)}\n`);
    assertExistingFileArtifact(reportFile, `reports/${fileName}`);
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
  validateManagedSiblingDirectory(file, "smoke");
  mkdirSync(directory, { recursive: true });
  validateManagedSiblingDirectory(file, "smoke");

  for (const [key, fileName] of Object.entries(smokeEvidenceFileDefaults)) {
    env[key] ||= join(directory, fileName);
  }
  env.SECRET_DELIVERY_OUTBOX_EVIDENCE_TARGET ||= pathToFileURL(resolve(env.SECRET_DELIVERY_OUTBOX_SMOKE_EVIDENCE_FILE)).href;
}

function validateSummaryOutputFile(file) {
  const resolvedFile = resolve(file);
  if (isLocalTempPath(resolvedFile)) {
    fail(["--summary-file lokal temp path olmamalı."]);
  }

  assertParentPathAllowed(dirname(resolvedFile), "--summary-file parent dizini");
  assertExistingFileArtifact(resolvedFile, "--summary-file");
  validateManagedSiblingDirectory(resolvedFile, "reports");
  validateManagedSiblingDirectory(resolvedFile, "smoke");
  return resolvedFile;
}

function validateManagedSiblingDirectory(summaryFilePath, name) {
  const directory = join(dirname(summaryFilePath), name);
  if (!existsSync(directory)) return;

  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail([`--summary-file ${name} dizini symlink olmayan dizin olmalı.`]);
  }
}

function assertParentPathAllowed(parentPath, label, failureMessage = `${label} symlink olmayan dizin olmalı.`) {
  if (!isParentPathAllowed(parentPath)) {
    fail([failureMessage]);
  }
}

function isParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;

    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return false;
    }
  }

  return true;
}

function assertExistingFileArtifact(filePath, label) {
  if (!existsSync(filePath)) return;

  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail([`${label} symlink olmayan file artifact olmalı.`]);
  }
}

function requireSmokeEvidenceFileTargets() {
  for (const key of Object.keys(smokeEvidenceFileDefaults)) {
    const file = env[key];
    if (!file) continue;
    validateSmokeEvidenceFileTarget(key, file);
  }
}

function validateSmokeEvidenceFileTarget(key, file, { requireExisting = false } = {}) {
  const resolvedFile = resolve(file);
  if (isLocalTempPath(resolvedFile)) {
    fail([`${key} production için lokal temp path olmamalı.`]);
  }
  if (isLocalSmokeArtifactPath(resolvedFile)) {
    fail([`${key} production için artifacts/local altında olmamalı.`]);
  }

  assertParentPathAllowed(
    dirname(resolvedFile),
    `${key} parent dizini`,
    `${key} parent dizini symlink olmayan dizin olmalı.`,
  );
  assertSmokeEvidenceFileArtifact(resolvedFile, key, { requireExisting, originalFile: file });
  return resolvedFile;
}

function assertSmokeEvidenceFileArtifact(filePath, key, { requireExisting = false, originalFile = filePath } = {}) {
  if (!existsSync(filePath)) {
    if (requireExisting) {
      fail([`Smoke kanıt dosyası eksik: ${key}=${originalFile}`]);
    }
    return;
  }

  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail([`${key} production için symlink olmayan smoke artifact olmalı.`]);
  }
}

function readSmokeEvidence(key, expectedCheck) {
  const file = env[key];
  if (!file) {
    fail([`${key} boş bırakılamaz.`]);
  }
  const resolvedFile = validateSmokeEvidenceFileTarget(key, file, { requireExisting: true });

  try {
    const payload = JSON.parse(readFileSync(resolvedFile, "utf8"));
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
  const url = toEvidenceTargetUrl(target, "Evidence target");
  if (url.protocol === "file:") {
    return JSON.parse(readEvidenceFile(url, "Evidence target"));
  }

  if (url.protocol === "https:") {
    const response = fetchSync(url);
    return JSON.parse(response);
  }

  throw new Error(`Desteklenmeyen evidence target: ${target}`);
}

function readEvidenceFile(url, label) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = lstatSync(filePath);
  } catch {
    throw new Error(`${label} okunabilir file:// artifact olmalı.`);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} symlink olmayan file:// artifact olmalı.`);
  }

  return readFileSync(filePath, "utf8");
}

function toEvidenceTargetUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} file:// veya https:// URL olmalı.`);
  }

  if (!isAllowedEvidenceTargetUrl(url)) {
    throw new Error(`${label} file:// veya https:// URL olmalı.`);
  }
  if (url.protocol === "file:" && isLocalSmokeEvidenceFileUrl(url)) {
    throw new Error(`${label} production için artifacts/local altında olmamalı.`);
  }

  return url;
}

function toOptionalEvidenceTargetUrl(value) {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isAllowedEvidenceTargetUrl(url) {
  return ["file:", "https:"].includes(url.protocol);
}

function isLocalTempFileUrl(url) {
  const path = decodeURIComponent(url.pathname).replace(/\/+$/g, "") || "/";
  return (
    path === "/tmp" ||
    path.startsWith("/tmp/") ||
    path === "/var/tmp" ||
    path.startsWith("/var/tmp/") ||
    path === "/private/tmp" ||
    path.startsWith("/private/tmp/")
  );
}

function isLocalSmokeEvidenceFileUrl(url) {
  const path = decodeURIComponent(url.pathname).replace(/\/+$/g, "") || "/";
  return path.includes("/artifacts/local/");
}

function isLocalTempPath(path) {
  const normalized = path.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

function isLocalSmokeArtifactPath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized.endsWith("/artifacts/local") || normalized.includes("/artifacts/local/");
}

function isRegularNonSymlinkFileUrl(url) {
  try {
    const stat = lstatSync(fileURLToPath(url));
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isFileUrlParentPathAllowed(url) {
  return isParentPathAllowed(dirname(fileURLToPath(url)));
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

function hasSecretBearingUrlParts(url) {
  return url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "";
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
