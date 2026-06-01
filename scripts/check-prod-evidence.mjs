import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const env = { ...process.env, ...readEnvFileArg() };
const summaryFile = readArgValue("--summary-file");

const checks = [
  ["Production env", "scripts/check-prod-env.mjs"],
  ["Traefik HTTPS", "scripts/smoke-traefik-https.mjs"],
  ["SMS provider", "scripts/smoke-sms-provider.mjs"],
  ["Sentry test event", "scripts/smoke-sentry-event.mjs"],
  ["Alert webhook", "scripts/smoke-alert-webhook.mjs"],
  ["Off-host backup target", "scripts/smoke-backup-offsite.mjs"],
  ["WAL archive target", "scripts/smoke-wal-archive-target.mjs"],
  ["Deployment region evidence", "scripts/check-deployment-region-evidence.mjs"],
  ["Restore drill evidence", "scripts/check-restore-drill-evidence.mjs"],
  ["KVKK inventory evidence", "scripts/check-kvkk-inventory-evidence.mjs"],
  ["Identity migration evidence", "scripts/check-identity-migration-evidence.mjs"],
  ["Financial retention evidence", "scripts/check-financial-retention-evidence.mjs"],
  ["Upload AV evidence", "scripts/check-upload-av-evidence.mjs"],
  ["Observability UAT evidence", "scripts/check-observability-uat-evidence.mjs"],
  ["Security audit evidence", "scripts/check-security-audit-evidence.mjs"],
  ["UAT evidence", "scripts/check-uat-evidence.mjs"],
];

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
  const reports = {
    restoreDrill: readJsonTarget(env.RESTORE_DRILL_TARGET),
    deploymentRegion: readJsonTarget(env.DEPLOYMENT_REGION_TARGET),
    kvkkInventory: readJsonTarget(env.KVKK_INVENTORY_TARGET),
    identityMigration: readJsonTarget(env.IDENTITY_MIGRATION_TARGET),
    financialRetention: readJsonTarget(env.FINANCIAL_RETENTION_TARGET),
    uploadAv: readJsonTarget(env.UPLOAD_AV_TARGET),
    observabilityUat: readJsonTarget(env.OBSERVABILITY_UAT_TARGET),
    securityAudit: readJsonTarget(env.SECURITY_AUDIT_TARGET),
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
        servicesVerified: reports.deploymentRegion.servicesVerified,
      },
      kvkkInventory: {
        environment: reports.kvkkInventory.environment,
        checkedAt: reports.kvkkInventory.checkedAt,
        inventorySource: reports.kvkkInventory.inventorySource,
        dataSubjectCounts: reports.kvkkInventory.dataSubjectCounts,
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
      },
      securityAudit: {
        environment: reports.securityAudit.environment,
        checkedAt: reports.securityAudit.checkedAt,
        prodEnvCheckOk: reports.securityAudit.prodEnvCheckOk,
        httpsOk: reports.securityAudit.httpsOk,
        rlsLiveCheckOk: reports.securityAudit.rlsLiveCheckOk,
        noCriticalFindings: reports.securityAudit.noCriticalFindings,
      },
      uat: {
        environment: reports.uat.environment,
        checkedAt: reports.uat.checkedAt,
        releaseCandidate: reports.uat.releaseCandidate,
        rollbackImageTag: reports.uat.rollbackImageTag,
        restoreBackupReference: reports.uat.restoreBackupReference,
        flowsVerified: reports.uat.flowsVerified,
        commandsPassed: reports.uat.commandsPassed,
      },
    },
  };

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Production evidence summary yazıldı: ${file}`);
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
