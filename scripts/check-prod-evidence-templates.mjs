import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const templateChecks = [
  [
    "Deployment cutover template",
    "DEPLOYMENT_CUTOVER_EVIDENCE_TARGET",
    "docs/evidence-templates/deployment-cutover.example.json",
    "scripts/check-deployment-cutover-evidence.mjs",
    { DEPLOYMENT_CUTOVER_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Secret delivery outbox staging template",
    "SECRET_DELIVERY_OUTBOX_EVIDENCE_TARGET",
    "docs/evidence-templates/secret-delivery-outbox-staging.example.json",
    "scripts/check-secret-delivery-outbox-evidence.mjs",
    { SECRET_DELIVERY_OUTBOX_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Restore drill template",
    "RESTORE_DRILL_TARGET",
    "docs/evidence-templates/restore-drill.example.json",
    "scripts/check-restore-drill-evidence.mjs",
    { RESTORE_DRILL_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "KVKK inventory template",
    "KVKK_INVENTORY_TARGET",
    "docs/evidence-templates/kvkk-inventory.example.json",
    "scripts/check-kvkk-inventory-evidence.mjs",
    { KVKK_INVENTORY_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Identity migration template",
    "IDENTITY_MIGRATION_TARGET",
    "docs/evidence-templates/identity-migration.example.json",
    "scripts/check-identity-migration-evidence.mjs",
    { IDENTITY_MIGRATION_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Account management preflight template",
    "ACCOUNT_MANAGEMENT_PREFLIGHT_TARGET",
    "docs/evidence-templates/account-management-preflight.example.json",
    "scripts/check-account-management-preflight.mjs",
    { ACCOUNT_MANAGEMENT_PREFLIGHT_ALLOW_EXAMPLE: "1" },
  ],
  [
    "Account management backfill template",
    "ACCOUNT_MANAGEMENT_BACKFILL_TARGET",
    "docs/evidence-templates/account-management-backfill.example.json",
    "scripts/check-account-management-backfill.mjs",
    { ACCOUNT_MANAGEMENT_BACKFILL_ALLOW_EXAMPLE: "1" },
  ],
  [
    "LicenseTerm backfill template",
    "LICENSE_TERM_BACKFILL_TARGET",
    "docs/evidence-templates/license-term-backfill.example.json",
    "scripts/check-license-term-backfill.mjs",
    { LICENSE_TERM_BACKFILL_ALLOW_EXAMPLE: "1" },
  ],
  [
    "Financial retention template",
    "FINANCIAL_RETENTION_TARGET",
    "docs/evidence-templates/financial-retention.example.json",
    "scripts/check-financial-retention-evidence.mjs",
    { FINANCIAL_RETENTION_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Upload AV template",
    "UPLOAD_AV_TARGET",
    "docs/evidence-templates/upload-av.example.json",
    "scripts/check-upload-av-evidence.mjs",
    { UPLOAD_AV_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Observability UAT template",
    "OBSERVABILITY_UAT_TARGET",
    "docs/evidence-templates/observability-uat.example.json",
    "scripts/check-observability-uat-evidence.mjs",
    { OBSERVABILITY_UAT_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "External monitoring template",
    "EXTERNAL_MONITORING_TARGET",
    "docs/evidence-templates/external-monitoring.example.json",
    "scripts/check-external-monitoring-evidence.mjs",
    { EXTERNAL_MONITORING_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Admin MFA template",
    "ADMIN_MFA_EVIDENCE_TARGET",
    "docs/evidence-templates/admin-mfa.example.json",
    "scripts/check-admin-mfa-evidence.mjs",
    { ADMIN_MFA_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Deployment region template",
    "DEPLOYMENT_REGION_TARGET",
    "docs/evidence-templates/deployment-region.example.json",
    "scripts/check-deployment-region-evidence.mjs",
    { DEPLOYMENT_REGION_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Deployment rollback template",
    "DEPLOYMENT_ROLLBACK_TARGET",
    "docs/evidence-templates/deployment-rollback.example.json",
    "scripts/check-deployment-rollback-evidence.mjs",
    { DEPLOYMENT_ROLLBACK_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "GitHub CI template",
    "GITHUB_CI_EVIDENCE_TARGET",
    "docs/evidence-templates/github-ci.example.json",
    "scripts/check-github-ci-evidence.mjs",
    { GITHUB_CI_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Security audit template",
    "SECURITY_AUDIT_TARGET",
    "docs/evidence-templates/security-audit.example.json",
    "scripts/check-security-audit-evidence.mjs",
    { SECURITY_AUDIT_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "UAT template",
    "UAT_EVIDENCE_TARGET",
    "docs/evidence-templates/uat.example.json",
    "scripts/check-uat-evidence.mjs",
    { UAT_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Live exam cycle template",
    "LIVE_EXAM_CYCLE_TARGET",
    "docs/evidence-templates/live-exam-cycle.example.json",
    "scripts/check-live-exam-cycle-evidence.mjs",
    { LIVE_EXAM_CYCLE_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "iSEM optical pipeline template",
    "ISEM_OPTICAL_PIPELINE_TARGET",
    "docs/evidence-templates/isem-optical-pipeline.example.json",
    "scripts/check-isem-optical-pipeline-evidence.mjs",
    { ISEM_OPTICAL_PIPELINE_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Live UI-worker result template",
    "LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET",
    "docs/evidence-templates/live-ui-worker-result.example.json",
    "scripts/check-live-ui-worker-result-evidence.mjs",
    { LIVE_UI_WORKER_RESULT_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "UI/UX redesign template",
    "UI_UX_REDESIGN_EVIDENCE_TARGET",
    "docs/evidence-templates/ui-ux-redesign.example.json",
    "scripts/check-ui-ux-redesign-evidence.mjs",
    { UI_UX_REDESIGN_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Inline upload content migration template",
    "INLINE_UPLOAD_CONTENT_MIGRATION_TARGET",
    "docs/evidence-templates/inline-upload-content-migration.example.json",
    "scripts/check-inline-upload-content-migration-evidence.mjs",
    { INLINE_UPLOAD_CONTENT_MIGRATION_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Audit null tenant template",
    "AUDIT_NULL_TENANT_EVIDENCE_TARGET",
    "docs/evidence-templates/audit-null-tenant.example.json",
    "scripts/check-audit-null-tenant-evidence.mjs",
    { AUDIT_NULL_TENANT_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Rate limit Redis template",
    "RATE_LIMIT_EVIDENCE_TARGET",
    "docs/evidence-templates/rate-limit.example.json",
    "scripts/check-rate-limit-evidence.mjs",
    { RATE_LIMIT_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "RLS live template",
    "RLS_LIVE_EVIDENCE_TARGET",
    "docs/evidence-templates/rls-live.example.json",
    "scripts/check-rls-live-evidence.mjs",
    { RLS_LIVE_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Pilot template",
    "PILOT_EVIDENCE_TARGET",
    "docs/evidence-templates/pilot.example.json",
    "scripts/check-pilot-evidence.mjs",
    { PILOT_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Go-live template",
    "GO_LIVE_EVIDENCE_TARGET",
    "docs/evidence-templates/go-live.example.json",
    "scripts/check-go-live-evidence.mjs",
    { GO_LIVE_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Production evidence summary template",
    "PRODUCTION_EVIDENCE_SUMMARY_TARGET",
    "docs/evidence-templates/production-evidence-summary.example.json",
    "scripts/check-production-evidence-summary.mjs",
    { PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE: "1" },
  ],
  [
    "Live status evidence template",
    "LIVE_STATUS_EVIDENCE_TARGET",
    "docs/evidence-templates/live-status.example.json",
    "scripts/check-live-status-evidence.mjs",
    {
      LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE: "1",
      LIVE_STATUS_READINESS_PATH: "docs/evidence-templates/live-status-pass-readiness.example.md",
    },
  ],
];

const contractChecks = [
  ["Production env contract", "scripts/check-prod-env.mjs", ["--contract", ".env.example"], ".env.example"],
  [
    "Smoke evidence payload contract",
    "scripts/check-smoke-evidence-contract.mjs",
    [],
    "docs/evidence-templates/production-evidence-summary.example.json",
  ],
  [
    "Staging evidence env contract",
    "scripts/check-staging-evidence-env.mjs",
    [],
    "docs/evidence-templates/staging-evidence.env.example",
  ],
];

const linkedTemplateFiles = [
  "docs/evidence-templates/production-evidence-summary.example.json",
  "docs/evidence-templates/live-status.example.json",
];

for (const [label, envKey, templatePath, script, extraEnv = {}] of templateChecks) {
  const result = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      ...extraEnv,
      [envKey]: pathToFileURL(templatePath).href,
    },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(`Production evidence template kontrolü başarısız: ${label}`);
    process.exit(result.status ?? 1);
  }
}

runEvidenceTargetProtocolNegativeChecks();
runEvidenceTargetPlaceholderHostNegativeChecks();
runEvidenceTargetTempFileNegativeChecks();
runEvidenceTargetSymlinkFileNegativeChecks();

for (const file of linkedTemplateFiles) {
  try {
    JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.error(`Production evidence template kontrolü başarısız: geçerli JSON değil (${file})`);
    process.exit(1);
  }
}

function runEvidenceTargetProtocolNegativeChecks() {
  for (const [label, envKey, , script, extraEnv = {}] of templateChecks) {
    const result = spawnSync(process.execPath, [script], {
      env: {
        ...process.env,
        ...extraEnv,
        [envKey]: `http://evidence.o-okul.com/${envKey.toLowerCase().replaceAll("_", "-")}.json`,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} HTTP target negative beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(label === "Deployment cutover template" ? "yalnız file://" : "file:// veya https://")) {
      console.error(`Production evidence template kontrolü başarısız: ${label} HTTP target negative beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  }
}

function runEvidenceTargetPlaceholderHostNegativeChecks() {
  for (const [label, envKey, , script, extraEnv = {}] of templateChecks) {
    const result = spawnSync(process.execPath, [script], {
      env: {
        ...process.env,
        ...extraEnv,
        [envKey]: `https://localhost/${envKey.toLowerCase().replaceAll("_", "-")}.json`,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(
        `Production evidence template kontrolü başarısız: ${label} placeholder host target negative beklenen şekilde kırılmadı.`,
      );
      process.exit(1);
    }
    if (!output.includes("gercek https host") && !output.includes("gerçek https host") && !output.includes(label === "Deployment cutover template" ? "yalnız file://" : "file:// veya https://")) {
      console.error(
        `Production evidence template kontrolü başarısız: ${label} placeholder host target negative beklenen hata yok.`,
      );
      console.error(output);
      process.exit(1);
    }
  }
}

function runEvidenceTargetTempFileNegativeChecks() {
  for (const [label, envKey, , script, extraEnv = {}] of templateChecks) {
    for (const tempRoot of ["/tmp", "/private/tmp"]) {
      const result = spawnSync(process.execPath, [script], {
        env: {
          ...process.env,
          ...extraEnv,
          [envKey]: `file://${tempRoot}/${envKey.toLowerCase().replaceAll("_", "-")}.json`,
        },
        encoding: "utf8",
      });

      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      if (result.status === 0) {
        console.error(
          `Production evidence template kontrolü başarısız: ${label} ${tempRoot} temp file target negative beklenen şekilde kırılmadı.`,
        );
        process.exit(1);
      }
      if (!output.includes("lokal temp path") && !output.includes(label === "Deployment cutover template" ? "yalnız file://" : "file:// veya https://")) {
        console.error(
          `Production evidence template kontrolü başarısız: ${label} ${tempRoot} temp file target negative beklenen hata yok.`,
        );
        console.error(output);
        process.exit(1);
      }
    }
  }
}

function runEvidenceTargetSymlinkFileNegativeChecks() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "evidence-target-symlink-"));

  try {
    for (const [label, envKey, templatePath, script, extraEnv = {}] of templateChecks) {
      const linkPath = join(root, `${envKey.toLowerCase()}.json`);
      symlinkSync(resolve(templatePath), linkPath);
      const result = spawnSync(process.execPath, [script], {
        env: {
          ...process.env,
          ...extraEnv,
          [envKey]: pathToFileURL(linkPath).href,
        },
        encoding: "utf8",
      });

      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      if (result.status === 0) {
        console.error(
          `Production evidence template kontrolü başarısız: ${label} symlink file target negative beklenen şekilde kırılmadı.`,
        );
        process.exit(1);
      }
      if (!output.includes("symlink olmayan file:// artifact")) {
        console.error(
          `Production evidence template kontrolü başarısız: ${label} symlink file target negative beklenen hata yok.`,
        );
        console.error(output);
        process.exit(1);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

runInlineUploadMigrationReportOutputNegativeChecks();
runGithubCiGeneratorOutputNegativeChecks();
await runGithubCiGeneratorContractCheck();
runStagingEvidenceEnvNegativeCheck();
runStagingFirstGatesFixtureCheck();
runStagingFirstGatesTargetNegativeCheck();
runStagingFirstGatesOutputDirNegativeCheck();
runProdEnvValidCheck();
runProdEnvHttpEvidenceTargetNegativeCheck();
runProdEnvSecretEvidenceTargetNegativeCheck();
runProdEnvLocalEvidenceTargetNegativeCheck();
runProdEvidenceSummaryOutputNegativeChecks();
runFinalExternalEvidenceMissingTargetNegativeCheck();
runFinalExternalEvidenceExampleFlagNegativeCheck();
runFinalExternalEvidenceReadinessOverrideNegativeCheck();
runProdEvidenceExampleFlagNegativeCheck();
runProdEvidenceSmokeEvidenceFileNegativeChecks();
runProdEvidenceHttpEvidenceTargetNegativeCheck();
runProdEvidencePlaceholderEvidenceTargetNegativeCheck();
runProdEvidenceSecretEvidenceTargetNegativeCheck();
runProdEvidenceTempFileEvidenceTargetNegativeCheck();
runProdEvidenceSymlinkEvidenceTargetNegativeCheck();
runProdEvidenceSymlinkParentEvidenceTargetNegativeCheck();
runProdEnvTraefikOriginNegativeCheck();
runProdEnvTrustedForwarderNegativeCheck();
runProdEnvProxyTopologyNegativeCheck();
runProdEnvMissingAlertWebhookTokenNegativeCheck();
runProdEnvMissingSmsSmokeConfirmNegativeCheck();
runProdEnvMissingSentrySmokeConfirmNegativeCheck();
runProdEnvWhatsappEnabledNegativeCheck();
runProdEnvPlaceholderNetgsmPasswordNegativeCheck();
runProdEnvPlaceholderNotificationEmailNegativeCheck();
runProdEnvNotificationPushEnabledNegativeCheck();
runProdEnvMissingS3SecretNegativeCheck();
runAlertWebhookMissingTokenNegativeCheck();
runAlertWebhookHttpUrlNegativeCheck();
runAlertWebhookSecretUrlNegativeCheck();
runAlertWebhookLocalHostNegativeCheck();
runTraefikInsecureEvidenceFileNegativeCheck();
runStagingReleaseArtifactsBundleCheck();

const generatedLiveStatusPath = "docs/evidence-templates/live-status.generated.tmp.json";
const adminMfaFixturePath = "docs/evidence-templates/admin-mfa.example.json";
const deploymentRegionFixturePath = "docs/evidence-templates/deployment-region.example.json";
const deploymentRollbackFixturePath = "docs/evidence-templates/deployment-rollback.example.json";
const externalMonitoringFixturePath = "docs/evidence-templates/external-monitoring.example.json";
const financialRetentionFixturePath = "docs/evidence-templates/financial-retention.example.json";
const githubCiFixturePath = "docs/evidence-templates/github-ci.example.json";
const identityMigrationFixturePath = "docs/evidence-templates/identity-migration.example.json";
const inlineUploadMigrationFixturePath = "docs/evidence-templates/inline-upload-content-migration.example.json";
const auditNullTenantFixturePath = "docs/evidence-templates/audit-null-tenant.example.json";
const kvkkInventoryFixturePath = "docs/evidence-templates/kvkk-inventory.example.json";
const liveExamCycleFixturePath = "docs/evidence-templates/live-exam-cycle.example.json";
const observabilityUatFixturePath = "docs/evidence-templates/observability-uat.example.json";
const rateLimitFixturePath = "docs/evidence-templates/rate-limit.example.json";
const restoreDrillFixturePath = "docs/evidence-templates/restore-drill.example.json";
const rlsLiveFixturePath = "docs/evidence-templates/rls-live.example.json";
const securityAuditFixturePath = "docs/evidence-templates/security-audit.example.json";
const uploadAvFixturePath = "docs/evidence-templates/upload-av.example.json";
const productionSummaryFixturePath = "docs/evidence-templates/production-evidence-summary.example.json";
const goLiveFixturePath = "docs/evidence-templates/go-live.example.json";
const pilotFixturePath = "docs/evidence-templates/pilot.example.json";
const uatFixturePath = "docs/evidence-templates/uat.example.json";
const liveStatusFixturePath = "docs/evidence-templates/live-status.example.json";
const liveStatusReadinessPath = "docs/evidence-templates/live-status-pass-readiness.example.md";
runFinalExternalEvidenceTargetHygieneNegativeChecks();
const liveStatusGeneration = spawnSync(
  process.execPath,
  [
    "scripts/generate-live-status-evidence.mjs",
    "--summary-target",
    "docs/evidence-templates/production-evidence-summary.example.json",
    "--go-live-target",
    "docs/evidence-templates/go-live.example.json",
    "--pilot-target",
    "docs/evidence-templates/pilot.example.json",
    "--output",
    generatedLiveStatusPath,
    "--readiness-path",
    liveStatusReadinessPath,
  ],
  {
    env: {
      ...process.env,
      LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE: "1",
    },
    stdio: "inherit",
  },
);

if (liveStatusGeneration.status !== 0) {
  console.error("Production evidence template kontrolü başarısız: Live status evidence generation");
  process.exit(liveStatusGeneration.status ?? 1);
}

try {
  const expected = readFileSync(liveStatusFixturePath, "utf8");
  const generated = readFileSync(generatedLiveStatusPath, "utf8");
  if (generated !== expected) {
    console.error("Production evidence template kontrolü başarısız: live-status template generator çıktısıyla eşleşmiyor.");
    process.exit(1);
  }
} finally {
  try {
    unlinkSync(generatedLiveStatusPath);
  } catch {
    // Ignore cleanup errors; the mismatch/generation failure above is the actionable signal.
  }
}

const liveStatusFixture = JSON.parse(readFileSync(liveStatusFixturePath, "utf8"));
const deploymentRegionFixture = JSON.parse(readFileSync(deploymentRegionFixturePath, "utf8"));
const deploymentRollbackFixture = JSON.parse(readFileSync(deploymentRollbackFixturePath, "utf8"));
const adminMfaFixture = JSON.parse(readFileSync(adminMfaFixturePath, "utf8"));
const externalMonitoringFixture = JSON.parse(readFileSync(externalMonitoringFixturePath, "utf8"));
const financialRetentionFixture = JSON.parse(readFileSync(financialRetentionFixturePath, "utf8"));
const githubCiFixture = JSON.parse(readFileSync(githubCiFixturePath, "utf8"));
const identityMigrationFixture = JSON.parse(readFileSync(identityMigrationFixturePath, "utf8"));
const inlineUploadMigrationFixture = JSON.parse(readFileSync(inlineUploadMigrationFixturePath, "utf8"));
const auditNullTenantFixture = JSON.parse(readFileSync(auditNullTenantFixturePath, "utf8"));
const kvkkInventoryFixture = JSON.parse(readFileSync(kvkkInventoryFixturePath, "utf8"));
const liveExamCycleFixture = JSON.parse(readFileSync(liveExamCycleFixturePath, "utf8"));
const observabilityUatFixture = JSON.parse(readFileSync(observabilityUatFixturePath, "utf8"));
const rateLimitFixture = JSON.parse(readFileSync(rateLimitFixturePath, "utf8"));
const restoreDrillFixture = JSON.parse(readFileSync(restoreDrillFixturePath, "utf8"));
const rlsLiveFixture = JSON.parse(readFileSync(rlsLiveFixturePath, "utf8"));
const securityAuditFixture = JSON.parse(readFileSync(securityAuditFixturePath, "utf8"));
const uploadAvFixture = JSON.parse(readFileSync(uploadAvFixturePath, "utf8"));
const productionSummaryFixture = JSON.parse(readFileSync(productionSummaryFixturePath, "utf8"));
const goLiveFixture = JSON.parse(readFileSync(goLiveFixturePath, "utf8"));
const pilotFixture = JSON.parse(readFileSync(pilotFixturePath, "utf8"));
const uatFixture = JSON.parse(readFileSync(uatFixturePath, "utf8"));

runFinalExternalEvidenceTargetMismatchNegativeCheck();
runRemoteFinalEvidenceReadinessBehaviorChecks();

const nonEmptyGapsNegativeChecks = [
  {
    label: "Financial retention non-empty gaps negative",
    path: "docs/evidence-templates/financial-retention.non-empty-gaps.tmp.json",
    expectedFailure: "gaps boş olmalı.",
    runner: runFinancialRetentionNegativeCheck,
  },
  {
    label: "Identity migration non-empty gaps negative",
    path: "docs/evidence-templates/identity-migration.non-empty-gaps.tmp.json",
    expectedFailure: "gaps boş olmalı.",
    runner: runIdentityMigrationNegativeCheck,
  },
  {
    label: "KVKK inventory non-empty gaps negative",
    path: "docs/evidence-templates/kvkk-inventory.non-empty-gaps.tmp.json",
    expectedFailure: "gaps boş olmalı.",
    runner: runKvkkInventoryNegativeCheck,
  },
  {
    label: "Observability UAT non-empty gaps negative",
    path: "docs/evidence-templates/observability-uat.non-empty-gaps.tmp.json",
    expectedFailure: "gaps boş olmalı.",
    runner: runObservabilityUatNegativeCheck,
  },
  {
    label: "External monitoring non-empty gaps negative",
    path: "docs/evidence-templates/external-monitoring.non-empty-gaps.tmp.json",
    expectedFailure: "gaps boş olmalı.",
    runner: runExternalMonitoringNegativeCheck,
  },
  {
    label: "Admin MFA non-empty gaps negative",
    path: "docs/evidence-templates/admin-mfa.non-empty-gaps.tmp.json",
    expectedFailure: "gaps boş olmalı.",
    runner: runAdminMfaNegativeCheck,
  },
  {
    label: "Upload AV non-empty gaps negative",
    path: "docs/evidence-templates/upload-av.non-empty-gaps.tmp.json",
    expectedFailure: "gaps boş olmalı.",
    runner: runUploadAvNegativeCheck,
  },
  {
    label: "GitHub CI non-empty gaps negative",
    path: "docs/evidence-templates/github-ci.non-empty-gaps.tmp.json",
    expectedFailure: "gaps bos olmali.",
    runner: runGithubCiNegativeCheck,
  },
  {
    label: "Live exam cycle non-empty gaps negative",
    path: "docs/evidence-templates/live-exam-cycle.non-empty-gaps.tmp.json",
    expectedFailure: "gaps bos olmali.",
    runner: runLiveExamCycleNegativeCheck,
  },
  {
    label: "Inline upload migration non-empty gaps negative",
    path: "docs/evidence-templates/inline-upload-content-migration.non-empty-gaps.tmp.json",
    expectedFailure: "gaps bos olmali.",
    runner: runInlineUploadMigrationNegativeCheck,
  },
  {
    label: "Audit null tenant non-empty gaps negative",
    path: "docs/evidence-templates/audit-null-tenant.non-empty-gaps.tmp.json",
    expectedFailure: "gaps bos olmali.",
    runner: runAuditNullTenantNegativeCheck,
  },
  {
    label: "Rate limit non-empty gaps negative",
    path: "docs/evidence-templates/rate-limit.non-empty-gaps.tmp.json",
    expectedFailure: "gaps bos olmali.",
    runner: runRateLimitNegativeCheck,
  },
  {
    label: "RLS live non-empty gaps negative",
    path: "docs/evidence-templates/rls-live.non-empty-gaps.tmp.json",
    expectedFailure: "gaps bos olmali.",
    runner: runRlsLiveNegativeCheck,
  },
  {
    label: "Pilot non-empty gaps negative",
    path: "docs/evidence-templates/pilot.non-empty-gaps.tmp.json",
    expectedFailure: "gaps boş olmalı.",
    runner: runPilotNegativeCheck,
  },
  {
    label: "Deployment region non-empty gaps negative",
    path: "docs/evidence-templates/deployment-region.non-empty-gaps.tmp.json",
    expectedFailure: "gaps boş olmalı.",
    runner: runDeploymentRegionNegativeCheck,
  },
  {
    label: "Deployment rollback non-empty gaps negative",
    path: "docs/evidence-templates/deployment-rollback.non-empty-gaps.tmp.json",
    expectedFailure: "gaps boş olmalı.",
    runner: runDeploymentRollbackNegativeCheck,
  },
];

for (const { label, path, expectedFailure, runner } of nonEmptyGapsNegativeChecks) {
  runner({
    label,
    path,
    expectedFailure,
    mutate: (fixture) => {
      fixture.gaps = ["unexpected open evidence gap"];
    },
  });
}

runFinancialRetentionNegativeCheck({
  label: "Financial retention extra top-level key negative",
  path: "docs/evidence-templates/financial-retention.extra-top-level.tmp.json",
  expectedFailure: "financialRetention tam 7 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runFinancialRetentionNegativeCheck({
  label: "Financial retention extra policy field negative",
  path: "docs/evidence-templates/financial-retention.extra-policy-field.tmp.json",
  expectedFailure: "policyDecision tam 5 alan içermeli.",
  mutate: (fixture) => {
    fixture.policyDecision.unexpectedField = true;
  },
});
runFinancialRetentionNegativeCheck({
  label: "Financial retention extra records field negative",
  path: "docs/evidence-templates/financial-retention.extra-records-field.tmp.json",
  expectedFailure: "financialRecords tam 2 alan içermeli.",
  mutate: (fixture) => {
    fixture.financialRecords.unexpectedField = 1;
  },
});
runFinancialRetentionNegativeCheck({
  label: "Financial retention extra purge behavior negative",
  path: "docs/evidence-templates/financial-retention.extra-purge-behavior.tmp.json",
  expectedFailure: "purgeBehaviorVerified tam 2 doğrulama içermeli.",
  mutate: (fixture) => {
    fixture.purgeBehaviorVerified.push("unexpected_financial_purge_verification");
  },
});
runFinancialRetentionNegativeCheck({
  label: "Financial retention invalid gaps negative",
  path: "docs/evidence-templates/financial-retention.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runFinancialRetentionSymlinkParentTargetNegativeCheck();
runIdentityMigrationNegativeCheck({
  label: "Identity migration extra top-level key negative",
  path: "docs/evidence-templates/identity-migration.extra-top-level.tmp.json",
  expectedFailure: "identityMigration tam 8 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runIdentityMigrationNegativeCheck({
  label: "Identity migration extra decision field negative",
  path: "docs/evidence-templates/identity-migration.extra-decision-field.tmp.json",
  expectedFailure: "migrationDecision tam 3 alan içermeli.",
  mutate: (fixture) => {
    fixture.migrationDecision.unexpectedField = true;
  },
});
runIdentityMigrationNegativeCheck({
  label: "Identity migration extra subject negative",
  path: "docs/evidence-templates/identity-migration.extra-subject.tmp.json",
  expectedFailure: "subjects tam 3 subject içermeli.",
  mutate: (fixture) => {
    fixture.subjects.push({
      role: "ALUMNI",
      sourceRecords: 1,
      linkedUsers: 1,
      tenantMembershipsCreated: 1,
    });
  },
});
runIdentityMigrationNegativeCheck({
  label: "Identity migration extra subject field negative",
  path: "docs/evidence-templates/identity-migration.extra-subject-field.tmp.json",
  expectedFailure: "subjects.STUDENT tam 4 alan içermeli.",
  mutate: (fixture) => {
    fixture.subjects[0].unexpectedField = true;
  },
});
runIdentityMigrationNegativeCheck({
  label: "Identity migration extra invitation field negative",
  path: "docs/evidence-templates/identity-migration.extra-invitation-field.tmp.json",
  expectedFailure: "invitationFlow tam 3 alan içermeli.",
  mutate: (fixture) => {
    fixture.invitationFlow.unexpectedField = true;
  },
});
runIdentityMigrationNegativeCheck({
  label: "Identity migration extra verification negative",
  path: "docs/evidence-templates/identity-migration.extra-verification.tmp.json",
  expectedFailure: "verifications tam 4 doğrulama içermeli.",
  mutate: (fixture) => {
    fixture.verifications.push("unexpected_identity_verification");
  },
});
runIdentityMigrationNegativeCheck({
  label: "Identity migration invalid gaps negative",
  path: "docs/evidence-templates/identity-migration.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runIdentityMigrationSymlinkParentTargetNegativeCheck();
runKvkkInventoryFixtureTargetNegativeCheck();
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory extra top-level key negative",
  path: "docs/evidence-templates/kvkk-inventory.extra-top-level.tmp.json",
  expectedFailure: "kvkkInventory tam 10 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory missing WhatsApp consent negative",
  path: "docs/evidence-templates/kvkk-inventory.missing-whatsapp-consent.tmp.json",
  expectedFailure: "kvkkInventory tam 10 alan içermeli.",
  mutate: (fixture) => {
    delete fixture.whatsappConsent;
  },
});
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory WhatsApp consent record count negative",
  path: "docs/evidence-templates/kvkk-inventory.whatsapp-consent-record-count.tmp.json",
  expectedFailure: "whatsappConsent.recordCount 0 olmalı.",
  mutate: (fixture) => {
    fixture.whatsappConsent.recordCount = 1;
  },
});
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory WhatsApp consent event record count negative",
  path: "docs/evidence-templates/kvkk-inventory.whatsapp-consent-event-record-count.tmp.json",
  expectedFailure: "whatsappConsent.eventRecordCount 0 olmalı.",
  mutate: (fixture) => {
    fixture.whatsappConsent.eventRecordCount = 1;
  },
});
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory WhatsApp consent stored field negative",
  path: "docs/evidence-templates/kvkk-inventory.whatsapp-consent-stored-field.tmp.json",
  expectedFailure: "whatsappConsent.piiRelevantStoredFields tam 8 alan içermeli.",
  mutate: (fixture) => {
    fixture.whatsappConsent.piiRelevantStoredFields = fixture.whatsappConsent.piiRelevantStoredFields.filter((field) => field !== "withdrawnAt");
  },
});
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory WhatsApp consent event stored field negative",
  path: "docs/evidence-templates/kvkk-inventory.whatsapp-consent-event-stored-field.tmp.json",
  expectedFailure: "whatsappConsent.piiRelevantEventStoredFields tam 10 alan içermeli.",
  mutate: (fixture) => {
    fixture.whatsappConsent.piiRelevantEventStoredFields = fixture.whatsappConsent.piiRelevantEventStoredFields.filter((field) => field !== "requestHash");
  },
});
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory WhatsApp consent policy negative",
  path: "docs/evidence-templates/kvkk-inventory.whatsapp-consent-policy.tmp.json",
  expectedFailure: "whatsappConsent.policy.featureEnabled false olmalı.",
  mutate: (fixture) => {
    fixture.whatsappConsent.policy.featureEnabled = true;
  },
});
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory extra count field negative",
  path: "docs/evidence-templates/kvkk-inventory.extra-count-field.tmp.json",
  expectedFailure: "dataSubjectCounts tam 4 alan içermeli.",
  mutate: (fixture) => {
    fixture.dataSubjectCounts.unexpectedSubject = 1;
  },
});
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory extra coverage subject negative",
  path: "docs/evidence-templates/kvkk-inventory.extra-coverage-subject.tmp.json",
  expectedFailure: "purgeCoverage tam 4 subject içermeli.",
  mutate: (fixture) => {
    fixture.purgeCoverage.unexpectedSubject = ["email"];
  },
});
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory extra student field negative",
  path: "docs/evidence-templates/kvkk-inventory.extra-student-field.tmp.json",
  expectedFailure: "purgeCoverage.student tam 7 alan içermeli.",
  mutate: (fixture) => {
    fixture.purgeCoverage.student.push("unexpectedField");
  },
});
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory extra audit action negative",
  path: "docs/evidence-templates/kvkk-inventory.extra-audit-action.tmp.json",
  expectedFailure: "auditActionsVerified tam 4 action içermeli.",
  mutate: (fixture) => {
    fixture.auditActionsVerified.push("kvkk.unexpected_pii_purged");
  },
});
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory missing audit diff redaction control negative",
  path: "docs/evidence-templates/kvkk-inventory.missing-audit-diff-redaction-control.tmp.json",
  expectedFailure: "auditDiffRedactionVerified.negativeControls tam 21 kontrol içermeli.",
  mutate: (fixture) => {
    fixture.auditDiffRedactionVerified.negativeControls = fixture.auditDiffRedactionVerified.negativeControls.filter((item) => item !== "title");
  },
});
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory missing raw row redaction control negative",
  path: "docs/evidence-templates/kvkk-inventory.missing-raw-row-redaction-control.tmp.json",
  expectedFailure: "auditDiffRedactionVerified.negativeControls tam 21 kontrol içermeli.",
  mutate: (fixture) => {
    fixture.auditDiffRedactionVerified.negativeControls = fixture.auditDiffRedactionVerified.negativeControls.filter((item) => item !== "rawRow");
  },
});
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory invalid audit diff redaction command negative",
  path: "docs/evidence-templates/kvkk-inventory.invalid-audit-diff-command.tmp.json",
  expectedFailure: "auditDiffRedactionVerified.command audit-log doğrulama komutu içermeli.",
  mutate: (fixture) => {
    fixture.auditDiffRedactionVerified.command = "pnpm test";
  },
});
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory invalid gaps negative",
  path: "docs/evidence-templates/kvkk-inventory.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runKvkkInventorySymlinkParentTargetNegativeCheck();
runRestoreDrillNegativeCheck({
  label: "Restore drill extra top-level key negative",
  path: "docs/evidence-templates/restore-drill.extra-top-level.tmp.json",
  expectedFailure: "restoreDrill tam 7 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runRestoreDrillNegativeCheck({
  label: "Restore drill extra table count key negative",
  path: "docs/evidence-templates/restore-drill.extra-table-count.tmp.json",
  expectedFailure: "tableCounts tam 4 alan içermeli.",
  mutate: (fixture) => {
    fixture.tableCounts.UnexpectedTable = 1;
  },
});
runRestoreDrillSymlinkParentTargetNegativeCheck();
runObservabilityUatNegativeCheck({
  label: "Observability UAT extra top-level key negative",
  path: "docs/evidence-templates/observability-uat.extra-top-level.tmp.json",
  expectedFailure: "observabilityUat tam 11 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runObservabilityUatNegativeCheck({
  label: "Observability UAT extra dashboard panel negative",
  path: "docs/evidence-templates/observability-uat.extra-dashboard-panel.tmp.json",
  expectedFailure: "dashboardPanelsVerified tam 5 panel içermeli.",
  mutate: (fixture) => {
    fixture.dashboardPanelsVerified.push("Unexpected panel");
  },
});
runObservabilityUatNegativeCheck({
  label: "Observability UAT extra alert negative",
  path: "docs/evidence-templates/observability-uat.extra-alert.tmp.json",
  expectedFailure: "alertsVerified tam 4 alert içermeli.",
  mutate: (fixture) => {
    fixture.alertsVerified.push("UnexpectedAlert");
  },
});
runObservabilityUatNegativeCheck({
  label: "Observability UAT invalid gaps negative",
  path: "docs/evidence-templates/observability-uat.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runObservabilityUatSecretTargetNegativeCheck();
runObservabilityUatLocalArtifactTargetNegativeCheck();
runObservabilityUatGeneratorLocalArtifactNegativeChecks();
runObservabilityUatSymlinkParentTargetNegativeCheck();
runSecurityAuditNegativeCheck({
  label: "Security audit extra top-level key negative",
  path: "docs/evidence-templates/security-audit.extra-top-level.tmp.json",
  expectedFailure: "securityAudit tam 14 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runSecurityAuditNegativeCheck({
  label: "Security audit extra security header negative",
  path: "docs/evidence-templates/security-audit.extra-security-header.tmp.json",
  expectedFailure: "securityHeadersVerified tam 6 header içermeli.",
  mutate: (fixture) => {
    fixture.securityHeadersVerified.push("Unexpected-Security-Header");
  },
});
runSecurityAuditNegativeCheck({
  label: "Security audit extra auth control negative",
  path: "docs/evidence-templates/security-audit.extra-auth-control.tmp.json",
  expectedFailure: "authControlsVerified tam 4 auth kontrolü içermeli.",
  mutate: (fixture) => {
    fixture.authControlsVerified.push("unexpected auth control");
  },
});
runSecurityAuditNegativeCheck({
  label: "Security audit extra data control negative",
  path: "docs/evidence-templates/security-audit.extra-data-control.tmp.json",
  expectedFailure: "dataControlsVerified tam 4 data kontrolü içermeli.",
  mutate: (fixture) => {
    fixture.dataControlsVerified.push("unexpected data control");
  },
});
runSecurityAuditSymlinkParentTargetNegativeCheck();
runExternalMonitoringNegativeCheck({
  label: "External monitoring extra top-level key negative",
  path: "docs/evidence-templates/external-monitoring.extra-top-level.tmp.json",
  expectedFailure: "externalMonitoring tam 10 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runExternalMonitoringNegativeCheck({
  label: "External monitoring extra node field negative",
  path: "docs/evidence-templates/external-monitoring.extra-node-field.tmp.json",
  expectedFailure: "monitoringNode tam 3 alan içermeli.",
  mutate: (fixture) => {
    fixture.monitoringNode.unexpectedField = true;
  },
});
runExternalMonitoringNegativeCheck({
  label: "External monitoring extra HTTP monitor field negative",
  path: "docs/evidence-templates/external-monitoring.extra-http-monitor-field.tmp.json",
  expectedFailure: "monitorsVerified.API /health tam 5 alan içermeli.",
  mutate: (fixture) => {
    fixture.monitorsVerified[0].unexpectedField = true;
  },
});
runExternalMonitoringNegativeCheck({
  label: "External monitoring extra certificate monitor field negative",
  path: "docs/evidence-templates/external-monitoring.extra-certificate-monitor-field.tmp.json",
  expectedFailure: "monitorsVerified.Traefik TLS certificate tam 5 alan içermeli.",
  mutate: (fixture) => {
    fixture.monitorsVerified[3].unexpectedField = true;
  },
});
runExternalMonitoringNegativeCheck({
  label: "External monitoring extra monitor negative",
  path: "docs/evidence-templates/external-monitoring.extra-monitor.tmp.json",
  expectedFailure: "monitorsVerified tam 4 monitor içermeli.",
  mutate: (fixture) => {
    fixture.monitorsVerified.push({
      name: "Unexpected monitor",
      type: "http",
      url: "https://staging.example.test/unexpected",
      status: "UP",
      responseTimeMs: 120,
    });
  },
});
runExternalMonitoringNegativeCheck({
  label: "External monitoring extra outage drill field negative",
  path: "docs/evidence-templates/external-monitoring.extra-outage-drill-field.tmp.json",
  expectedFailure: "outageDrill tam 6 alan içermeli.",
  mutate: (fixture) => {
    fixture.outageDrill.unexpectedField = true;
  },
});
runExternalMonitoringNegativeCheck({
  label: "External monitoring outage drill chronology negative",
  path: "docs/evidence-templates/external-monitoring.outage-drill-chronology.tmp.json",
  expectedFailure: "outageDrill.detectedAt outageDrill.webhookDeliveredAt sonrasında olamaz.",
  mutate: (fixture) => {
    fixture.outageDrill.webhookDeliveredAt = "2026-05-30T09:01:00.000Z";
  },
});
runExternalMonitoringNegativeCheck({
  label: "External monitoring outage drill latency mismatch negative",
  path: "docs/evidence-templates/external-monitoring.outage-drill-latency-mismatch.tmp.json",
  expectedFailure: "outageDrill.detectionLatencySeconds inducedAt/detectedAt farkıyla eşleşmeli.",
  mutate: (fixture) => {
    fixture.outageDrill.detectionLatencySeconds = 74;
  },
});
runExternalMonitoringNegativeCheck({
  label: "External monitoring invalid gaps negative",
  path: "docs/evidence-templates/external-monitoring.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runExternalMonitoringSymlinkParentTargetNegativeCheck();
runAdminMfaNegativeCheck({
  label: "Admin MFA extra top-level key negative",
  path: "docs/evidence-templates/admin-mfa.extra-top-level.tmp.json",
  expectedFailure: "adminMfa tam 9 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runAdminMfaNegativeCheck({
  label: "Admin MFA extra policy field negative",
  path: "docs/evidence-templates/admin-mfa.extra-policy-field.tmp.json",
  expectedFailure: "policy tam 7 alan içermeli.",
  mutate: (fixture) => {
    fixture.policy.unexpectedField = true;
  },
});
runAdminMfaNegativeCheck({
  label: "Admin MFA extra enrollment field negative",
  path: "docs/evidence-templates/admin-mfa.extra-enrollment-field.tmp.json",
  expectedFailure: "enrollment tam 6 alan içermeli.",
  mutate: (fixture) => {
    fixture.enrollment.unexpectedField = true;
  },
});
runAdminMfaNegativeCheck({
  label: "Admin MFA extra login verification field negative",
  path: "docs/evidence-templates/admin-mfa.extra-login-verification-field.tmp.json",
  expectedFailure: "loginVerification tam 8 alan içermeli.",
  mutate: (fixture) => {
    fixture.loginVerification.unexpectedField = true;
  },
});
runAdminMfaNegativeCheck({
  label: "Admin MFA invalid gaps negative",
  path: "docs/evidence-templates/admin-mfa.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runAdminMfaSymlinkParentTargetNegativeCheck();
runUploadAvNegativeCheck({
  label: "Upload AV extra top-level key negative",
  path: "docs/evidence-templates/upload-av.extra-top-level.tmp.json",
  expectedFailure: "uploadAv tam 7 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runUploadAvNegativeCheck({
  label: "Upload AV extra scanner decision field negative",
  path: "docs/evidence-templates/upload-av.extra-scanner-decision-field.tmp.json",
  expectedFailure: "scannerDecision tam 6 alan içermeli.",
  mutate: (fixture) => {
    fixture.scannerDecision.unexpectedField = true;
  },
});
runUploadAvNegativeCheck({
  label: "Upload AV extra surface negative",
  path: "docs/evidence-templates/upload-av.extra-surface.tmp.json",
  expectedFailure: "uploadSurfaces tam 2 surface içermeli.",
  mutate: (fixture) => {
    fixture.uploadSurfaces.push("unexpected_surface");
  },
});
runUploadAvNegativeCheck({
  label: "Upload AV extra scan result field negative",
  path: "docs/evidence-templates/upload-av.extra-scan-result-field.tmp.json",
  expectedFailure: "scanResults tam 3 alan içermeli.",
  mutate: (fixture) => {
    fixture.scanResults.unexpectedField = true;
  },
});
runUploadAvNegativeCheck({
  label: "Upload AV invalid gaps negative",
  path: "docs/evidence-templates/upload-av.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runUploadAvSymlinkParentTargetNegativeCheck();
runGithubCiNegativeCheck({
  label: "GitHub CI extra top-level key negative",
  path: "docs/evidence-templates/github-ci.extra-top-level.tmp.json",
  expectedFailure: "githubCi tam 12 alan icermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runGithubCiNegativeCheck({
  label: "GitHub CI extra workflow field negative",
  path: "docs/evidence-templates/github-ci.extra-workflow-field.tmp.json",
  expectedFailure: "workflow tam 9 alan icermeli.",
  mutate: (fixture) => {
    fixture.workflow.unexpectedField = true;
  },
});
runGithubCiNegativeCheck({
  label: "GitHub CI extra job field negative",
  path: "docs/evidence-templates/github-ci.extra-job-field.tmp.json",
  expectedFailure: "jobs.0 tam 6 alan icermeli.",
  mutate: (fixture) => {
    fixture.jobs[0].unexpectedField = true;
  },
});
runGithubCiNegativeCheck({
  label: "GitHub CI extra command negative",
  path: "docs/evidence-templates/github-ci.extra-command.tmp.json",
  expectedFailure: "commandsPassed tam 2 komut icermeli.",
  mutate: (fixture) => {
    fixture.commandsPassed.push("pnpm unexpected:ci");
  },
});
runGithubCiNegativeCheck({
  label: "GitHub CI invalid gaps negative",
  path: "docs/evidence-templates/github-ci.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runGithubCiNegativeCheck({
  label: "GitHub CI workflow run URL repository mismatch negative",
  path: "docs/evidence-templates/github-ci.run-url-repository-mismatch.tmp.json",
  expectedFailure: "workflow.runUrl repository ile eslesmeli.",
  mutate: (fixture) => {
    fixture.workflow.runUrl = "https://github.com/other/o-okul/actions/runs/1234567890";
    fixture.evidenceReferences[0] = fixture.workflow.runUrl;
  },
});
runGithubCiNegativeCheck({
  label: "GitHub CI workflow run URL runId mismatch negative",
  path: "docs/evidence-templates/github-ci.run-url-runid-mismatch.tmp.json",
  expectedFailure: "workflow.runUrl runId ile eslesmeli.",
  mutate: (fixture) => {
    fixture.workflow.runUrl = "https://github.com/example/o-okul/actions/runs/1234567891";
    fixture.evidenceReferences[0] = fixture.workflow.runUrl;
  },
});
runGithubCiNegativeCheck({
  label: "GitHub CI evidence reference run mismatch negative",
  path: "docs/evidence-templates/github-ci.evidence-reference-run-mismatch.tmp.json",
  expectedFailure: "evidenceReferences.0 runId ile eslesmeli.",
  mutate: (fixture) => {
    fixture.evidenceReferences[0] = "https://github.com/example/o-okul/actions/runs/1234567891";
  },
});
runGithubCiSymlinkParentTargetNegativeCheck();
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle extra top-level key negative",
  path: "docs/evidence-templates/live-exam-cycle.extra-top-level.tmp.json",
  expectedFailure: "liveExamCycle tam 11 alan icermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle extra examCycle field negative",
  path: "docs/evidence-templates/live-exam-cycle.extra-exam-cycle-field.tmp.json",
  expectedFailure: "examCycle tam 27 alan icermeli.",
  mutate: (fixture) => {
    fixture.examCycle.unexpectedField = true;
  },
});
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle participant count exact negative",
  path: "docs/evidence-templates/live-exam-cycle.participant-count.tmp.json",
  expectedFailure: "examCycle.participantCount 21 olmali.",
  mutate: (fixture) => {
    fixture.examCycle.participantCount = 20;
  },
});
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle quarantine count exact negative",
  path: "docs/evidence-templates/live-exam-cycle.quarantine-count.tmp.json",
  expectedFailure: "examCycle.quarantineCount 0 olmali.",
  mutate: (fixture) => {
    fixture.examCycle.quarantineCount = 1;
  },
});
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle extra command negative",
  path: "docs/evidence-templates/live-exam-cycle.extra-command.tmp.json",
  expectedFailure: "commandsPassed tam 5 komut icermeli.",
  mutate: (fixture) => {
    fixture.commandsPassed.push("pnpm unexpected:smoke");
  },
});
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle weak evidence reference negative",
  path: "docs/evidence-templates/live-exam-cycle.weak-evidence-reference.tmp.json",
  expectedFailure:
    "evidenceReferences[0] artifact:, run:, log:, url:, https://, file:// veya s3:// ile baslayan kalici referans olmali.",
  mutate: (fixture) => {
    fixture.evidenceReferences[0] = "manual staging note";
  },
});
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle missing iSEM optical reference negative",
  path: "docs/evidence-templates/live-exam-cycle.missing-isem-reference.tmp.json",
  expectedFailure: "evidenceReferences iSEM optical pipeline kaniti isem-optical-pipeline.json veya isem-optical-pipeline.log dosyasina baglanmali.",
  mutate: (fixture) => {
    fixture.evidenceReferences = fixture.evidenceReferences.map((reference) =>
      reference.includes("isem-optical-pipeline")
        ? "artifact:artifacts/example/live-exam-cycle/raw-import-smoke.log"
        : reference,
    );
  },
});
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle missing UI-worker reference negative",
  path: "docs/evidence-templates/live-exam-cycle.missing-ui-worker-reference.tmp.json",
  expectedFailure: "evidenceReferences live-ui-worker kaniti live-ui-worker-result.json veya live-ui-worker-report.json dosyasina baglanmali.",
  mutate: (fixture) => {
    fixture.evidenceReferences = fixture.evidenceReferences.map((reference) =>
      reference.includes("live-ui-worker")
        ? "artifact:artifacts/example/live-exam-cycle/report-generation-smoke.json"
        : reference,
    );
  },
});
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle substring-spoof evidence reference negative",
  path: "docs/evidence-templates/live-exam-cycle.substring-spoof-reference.tmp.json",
  expectedFailure: "evidenceReferences iSEM optical pipeline kaniti isem-optical-pipeline.json veya isem-optical-pipeline.log dosyasina baglanmali.",
  mutate: (fixture) => {
    fixture.evidenceReferences = [
      "artifact:artifacts/staging/live-exam-cycle/unrelated-isem-optical-pipeline-marker.json",
      "artifact:artifacts/staging/live-exam-cycle/unrelated-live-ui-worker-marker.json",
    ];
  },
});
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle local artifact reference negative",
  path: "docs/evidence-templates/live-exam-cycle.local-artifact-reference.tmp.json",
  expectedFailure: "evidenceReferences[0] local smoke artifact referansi tasimamali.",
  mutate: (fixture) => {
    fixture.evidenceReferences[0] = "artifact:artifacts/local/isem-optical-pipeline.json";
  },
});
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle invalid gaps negative",
  path: "docs/evidence-templates/live-exam-cycle.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle raw TXT path negative",
  path: "docs/evidence-templates/live-exam-cycle.raw-txt-path.tmp.json",
  expectedFailure: "evidenceReferences[0] ham TXT dosya adi veya yolu tasimamali.",
  mutate: (fixture) => {
    fixture.evidenceReferences[0] = "artifact:ornek-veriler/iSEM .txt";
  },
});
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle TCKN-like value negative",
  path: "docs/evidence-templates/live-exam-cycle.tckn-like.tmp.json",
  expectedFailure: "examCycle.firstStudentId TCKN benzeri 11 haneli deger tasimamali.",
  mutate: (fixture) => {
    fixture.examCycle.firstStudentId = "12345678901";
  },
});
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle raw PII field negative",
  path: "docs/evidence-templates/live-exam-cycle.raw-pii-field.tmp.json",
  expectedFailure: "examCycle.studentName ham PII/TXT evidence alani tasimamali.",
  mutate: (fixture) => {
    fixture.examCycle.studentName = "Ogrenci Adi";
  },
});
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle raw row field negative",
  path: "docs/evidence-templates/live-exam-cycle.raw-row-field.tmp.json",
  expectedFailure: "examCycle.rawRow ham PII/TXT evidence alani tasimamali.",
  mutate: (fixture) => {
    fixture.examCycle.rawRow = "0000000000012345678901AABCDE";
  },
});
runLiveExamCycleNegativeCheck({
  label: "Live exam cycle file name field negative",
  path: "docs/evidence-templates/live-exam-cycle.file-name-field.tmp.json",
  expectedFailure: "examCycle.fileName ham PII/TXT evidence alani tasimamali.",
  mutate: (fixture) => {
    fixture.examCycle.fileName = "iSEM .txt";
  },
});
runLiveExamCycleSymlinkParentTargetNegativeCheck();
runIsemOpticalPipelineLocalArtifactTargetNegativeCheck();
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration extra top-level key negative",
  path: "docs/evidence-templates/inline-upload-content-migration.extra-top-level.tmp.json",
  expectedFailure: "inlineUploadMigration tam 10 alan icermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration extra storageMode field negative",
  path: "docs/evidence-templates/inline-upload-content-migration.extra-storage-mode-field.tmp.json",
  expectedFailure: "storageMode tam 6 alan icermeli.",
  mutate: (fixture) => {
    fixture.storageMode.unexpectedField = true;
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration extra dryRun field negative",
  path: "docs/evidence-templates/inline-upload-content-migration.extra-dry-run-field.tmp.json",
  expectedFailure: "dryRun tam 4 alan icermeli.",
  mutate: (fixture) => {
    fixture.dryRun.unexpectedField = true;
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration extra dryRun subject field negative",
  path: "docs/evidence-templates/inline-upload-content-migration.extra-dry-run-subject-field.tmp.json",
  expectedFailure: "dryRun.subjects.homework_material_files tam 7 alan icermeli.",
  mutate: (fixture) => {
    fixture.dryRun.subjects[0].unexpectedField = true;
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration extra migration field negative",
  path: "docs/evidence-templates/inline-upload-content-migration.extra-migration-field.tmp.json",
  expectedFailure: "migration tam 7 alan icermeli.",
  mutate: (fixture) => {
    fixture.migration.unexpectedField = true;
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration extra migration subject field negative",
  path: "docs/evidence-templates/inline-upload-content-migration.extra-migration-subject-field.tmp.json",
  expectedFailure: "migration.subjects.homework_material_files tam 7 alan icermeli.",
  mutate: (fixture) => {
    fixture.migration.subjects[0].unexpectedField = true;
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration extra migrated item field negative",
  path: "docs/evidence-templates/inline-upload-content-migration.extra-migrated-field.tmp.json",
  expectedFailure: "migration.migrated.homework_material_files tam 3 alan icermeli.",
  mutate: (fixture) => {
    fixture.migration.migrated[0].unexpectedField = true;
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration extra command negative",
  path: "docs/evidence-templates/inline-upload-content-migration.extra-command.tmp.json",
  expectedFailure: "commandsPassed tam 3 komut icermeli.",
  mutate: (fixture) => {
    fixture.commandsPassed.push("pnpm unexpected:migrate");
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration contentBase64 write enabled negative",
  path: "docs/evidence-templates/inline-upload-content-migration.content-base64-enabled.tmp.json",
  expectedFailure: "storageMode.contentBase64WriteDisabled true olmali.",
  mutate: (fixture) => {
    fixture.storageMode.contentBase64WriteDisabled = false;
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration download TTL negative",
  path: "docs/evidence-templates/inline-upload-content-migration.download-ttl.tmp.json",
  expectedFailure: "storageMode.downloadUrlExpiresInSeconds en fazla 300 olmali.",
  mutate: (fixture) => {
    fixture.storageMode.downloadUrlExpiresInSeconds = 301;
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration pending rows negative",
  path: "docs/evidence-templates/inline-upload-content-migration.pending-rows.tmp.json",
  expectedFailure: "migration.subjects.homework_material_files.pendingRows 0 olmali.",
  mutate: (fixture) => {
    fixture.migration.subjects[0].pendingRows = 1;
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration pending bytes negative",
  path: "docs/evidence-templates/inline-upload-content-migration.pending-bytes.tmp.json",
  expectedFailure: "migration.subjects.homework_material_files.pendingBase64Characters 0 olmali.",
  mutate: (fixture) => {
    fixture.migration.subjects[0].pendingBase64Characters = 1;
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration migrated rows less than pending negative",
  path: "docs/evidence-templates/inline-upload-content-migration.migrated-rows-less-than-pending.tmp.json",
  expectedFailure: "migration.migrated homework_material_files dry-run pendingRows degerinden az olamaz.",
  mutate: (fixture) => {
    fixture.migration.migrated[0].migratedRows = fixture.dryRun.subjects[0].pendingRows - 1;
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration invalid gaps negative",
  path: "docs/evidence-templates/inline-upload-content-migration.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration secret evidence reference negative",
  path: "docs/evidence-templates/inline-upload-content-migration.secret-reference.tmp.json",
  expectedFailure: "evidenceReferences.0 userinfo, query veya fragment tasimamali.",
  mutate: (fixture) => {
    fixture.evidenceReferences[0] =
      "https://user:secret@evidence.o-okul.com/inline-upload-content-migration.json?token=secret#fragment";
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration raw storage key reference negative",
  path: "docs/evidence-templates/inline-upload-content-migration.raw-storage-key-reference.tmp.json",
  expectedFailure: "evidenceReferences.0 ham upload icerigi, storage key veya signed URL tasimamali.",
  mutate: (fixture) => {
    fixture.evidenceReferences[0] = "s3://bucket/support-ticket-attachments/tenant-ticket/raw-file.pdf";
  },
});
runInlineUploadMigrationSecretTargetNegativeCheck();
runInlineUploadMigrationSymlinkParentTargetNegativeCheck();
runAuditNullTenantNegativeCheck({
  label: "Audit null tenant extra top-level key negative",
  path: "docs/evidence-templates/audit-null-tenant.extra-top-level.tmp.json",
  expectedFailure: "auditNullTenantEvidence tam 7 alan icermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runAuditNullTenantNegativeCheck({
  label: "Audit null tenant unknown count negative",
  path: "docs/evidence-templates/audit-null-tenant.unknown-count.tmp.json",
  expectedFailure: "auditNullTenant.nullTenantBreakdown.unknown.count 0 olmali.",
  mutate: (fixture) => {
    fixture.auditNullTenant.nullTenantBreakdown.unknown.count = 1;
    fixture.auditNullTenant.nullTenantRows += 1;
  },
});
runAuditNullTenantNegativeCheck({
  label: "Audit null tenant total mismatch negative",
  path: "docs/evidence-templates/audit-null-tenant.total-mismatch.tmp.json",
  expectedFailure: "auditNullTenant.totalRows tenantRows + nullTenantRows toplamına esit olmali.",
  mutate: (fixture) => {
    fixture.auditNullTenant.totalRows += 1;
  },
});
runAuditNullTenantNegativeCheck({
  label: "Audit null tenant breakdown mismatch negative",
  path: "docs/evidence-templates/audit-null-tenant.breakdown-mismatch.tmp.json",
  expectedFailure: "auditNullTenant.nullTenantBreakdown count toplami nullTenantRows degerine esit olmali.",
  mutate: (fixture) => {
    fixture.auditNullTenant.nullTenantBreakdown.system.count += 1;
  },
});
runAuditNullTenantSymlinkParentTargetNegativeCheck();
runRateLimitNegativeCheck({
  label: "Rate limit extra top-level key negative",
  path: "docs/evidence-templates/rate-limit.extra-top-level.tmp.json",
  expectedFailure: "rateLimit tam 12 alan icermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runRateLimitNegativeCheck({
  label: "Rate limit extra config field negative",
  path: "docs/evidence-templates/rate-limit.extra-config-field.tmp.json",
  expectedFailure: "config tam 8 alan icermeli.",
  mutate: (fixture) => {
    fixture.config.unexpectedField = true;
  },
});
runRateLimitNegativeCheck({
  label: "Rate limit extra instance field negative",
  path: "docs/evidence-templates/rate-limit.extra-instance-field.tmp.json",
  expectedFailure: "instances.0 tam 2 alan icermeli.",
  mutate: (fixture) => {
    fixture.instances[0].unexpectedField = true;
  },
});
runRateLimitNegativeCheck({
  label: "Rate limit extra API field negative",
  path: "docs/evidence-templates/rate-limit.extra-api-field.tmp.json",
  expectedFailure: "apiRateLimit tam 10 alan icermeli.",
  mutate: (fixture) => {
    fixture.apiRateLimit.unexpectedField = true;
  },
});
runRateLimitNegativeCheck({
  label: "Rate limit extra login field negative",
  path: "docs/evidence-templates/rate-limit.extra-login-field.tmp.json",
  expectedFailure: "loginAttemptLimiter tam 8 alan icermeli.",
  mutate: (fixture) => {
    fixture.loginAttemptLimiter.unexpectedField = true;
  },
});
runRateLimitNegativeCheck({
  label: "Rate limit extra command negative",
  path: "docs/evidence-templates/rate-limit.extra-command.tmp.json",
  expectedFailure: "commandsPassed tam 2 komut icermeli.",
  mutate: (fixture) => {
    fixture.commandsPassed.push("pnpm unexpected:rate-limit");
  },
});
runRateLimitNegativeCheck({
  label: "Rate limit extra excluded path negative",
  path: "docs/evidence-templates/rate-limit.extra-excluded-path.tmp.json",
  expectedFailure: "config.excludedPaths tam 2 path icermeli.",
  mutate: (fixture) => {
    fixture.config.excludedPaths.push("/unexpected");
  },
});
runRateLimitNegativeCheck({
  label: "Rate limit invalid gaps negative",
  path: "docs/evidence-templates/rate-limit.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runRateLimitNegativeCheck({
  label: "Rate limit duplicate instance label negative",
  path: "docs/evidence-templates/rate-limit.duplicate-instance-label.tmp.json",
  expectedFailure: "instances iki farkli API instance label'i icermeli.",
  mutate: (fixture) => {
    fixture.instances[1].label = fixture.instances[0].label;
  },
});
runRateLimitNegativeCheck({
  label: "Rate limit duplicate instance URL negative",
  path: "docs/evidence-templates/rate-limit.duplicate-instance-url.tmp.json",
  expectedFailure: "instances iki farkli API instance URL'i icermeli.",
  mutate: (fixture) => {
    fixture.instances[1].baseUrl = fixture.instances[0].baseUrl;
  },
});
runRateLimitNegativeCheck({
  label: "Rate limit secret instance URL negative",
  path: "docs/evidence-templates/rate-limit.secret-instance-url.tmp.json",
  expectedFailure: "instances.0.baseUrl userinfo, query veya fragment tasimamali.",
  mutate: (fixture) => {
    fixture.instances[0].baseUrl = "https://user:secret@staging-api-a.example.test/api/v1/__rate-limit-smoke?token=secret#fragment";
  },
});
runRateLimitNegativeCheck({
  label: "Rate limit secret evidence reference negative",
  path: "docs/evidence-templates/rate-limit.secret-evidence-reference.tmp.json",
  expectedFailure: "evidenceReferences.0 userinfo, query veya fragment tasimamali.",
  mutate: (fixture) => {
    fixture.evidenceReferences[0] = "https://user:secret@evidence.o-okul.com/rate-limit.json?token=secret#fragment";
  },
});
runRateLimitNegativeCheck({
  label: "Rate limit missing egress hash reference negative",
  path: "docs/evidence-templates/rate-limit.missing-egress-hash-reference.tmp.json",
  expectedFailure: "evidenceReferences tam bir rate-limit-egress-ip: 64-hex hash referansı içermeli.",
  mutate: (fixture) => {
    fixture.evidenceReferences = fixture.evidenceReferences.filter((reference) => !reference.startsWith("rate-limit-egress-ip:"));
  },
});
runRateLimitSecretTargetNegativeCheck();
runRateLimitLocalArtifactTargetNegativeCheck();
runRateLimitGeneratorLocalArtifactNegativeChecks();
runRateLimitSymlinkParentTargetNegativeCheck();
runRlsLiveNegativeCheck({
  label: "RLS live extra top-level key negative",
  path: "docs/evidence-templates/rls-live.extra-top-level.tmp.json",
  expectedFailure: "rlsLive tam 10 alan icermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runRlsLiveNegativeCheck({
  label: "RLS live extra schema field negative",
  path: "docs/evidence-templates/rls-live.extra-schema-field.tmp.json",
  expectedFailure: "schema tam 5 alan icermeli.",
  mutate: (fixture) => {
    fixture.schema.unexpectedField = true;
  },
});
runRlsLiveNegativeCheck({
  label: "RLS live extra isolation field negative",
  path: "docs/evidence-templates/rls-live.extra-isolation-field.tmp.json",
  expectedFailure: "isolation tam 8 alan icermeli.",
  mutate: (fixture) => {
    fixture.isolation.unexpectedField = true;
  },
});
runRlsLiveNegativeCheck({
  label: "RLS live extra load smoke field negative",
  path: "docs/evidence-templates/rls-live.extra-load-smoke-field.tmp.json",
  expectedFailure: "loadSmoke tam 6 alan icermeli.",
  mutate: (fixture) => {
    fixture.loadSmoke.unexpectedField = true;
  },
});
runRlsLiveNegativeCheck({
  label: "RLS live extra tenant FK preflight field negative",
  path: "docs/evidence-templates/rls-live.extra-tenant-fk-preflight-field.tmp.json",
  expectedFailure: "tenantFkPreflight tam 7 alan icermeli.",
  mutate: (fixture) => {
    fixture.tenantFkPreflight.unexpectedField = true;
  },
});
runRlsLiveNegativeCheck({
  label: "RLS live tenant FK missing relation negative",
  path: "docs/evidence-templates/rls-live.missing-tenant-fk-relation.tmp.json",
  expectedFailure: "tenantFkPreflight.relationsVerified tam 32 relation icermeli.",
  mutate: (fixture) => {
    fixture.tenantFkPreflight.relationsVerified = fixture.tenantFkPreflight.relationsVerified.filter(
      (relation) => relation !== "Student.responsibleTeacher",
    );
  },
});
runRlsLiveNegativeCheck({
  label: "RLS live tenant FK orphan rows negative",
  path: "docs/evidence-templates/rls-live.tenant-fk-orphan-rows.tmp.json",
  expectedFailure: "tenantFkPreflight.orphanRows 0 olmali.",
  mutate: (fixture) => {
    fixture.tenantFkPreflight.orphanRows = 1;
  },
});
runRlsLiveNegativeCheck({
  label: "RLS live extra command negative",
  path: "docs/evidence-templates/rls-live.extra-command.tmp.json",
  expectedFailure: "commandsPassed tam 4 komut icermeli.",
  mutate: (fixture) => {
    fixture.commandsPassed.push("pnpm unexpected:rls");
  },
});
runRlsLiveNegativeCheck({
  label: "RLS live extra table negative",
  path: "docs/evidence-templates/rls-live.extra-table.tmp.json",
  expectedFailure: "schema.tablesVerified tam 64 tablo icermeli.",
  mutate: (fixture) => {
    fixture.schema.tablesVerified.push("UnexpectedTenantTable");
  },
});
runRlsLiveNegativeCheck({
  label: "RLS live missing load smoke artifact negative",
  path: "docs/evidence-templates/rls-live.missing-load-smoke-artifact.tmp.json",
  expectedFailure: "evidenceReferences rls-load-smoke kanıt artifact'ini içermeli.",
  mutate: (fixture) => {
    fixture.evidenceReferences = fixture.evidenceReferences.filter((reference) => !reference.includes("rls-load-smoke"));
  },
});
runRlsLiveNegativeCheck({
  label: "RLS live local artifact reference negative",
  path: "docs/evidence-templates/rls-live.local-artifact-reference.tmp.json",
  expectedFailure: "evidenceReferences.0 local smoke artifact referansi tasimamali.",
  mutate: (fixture) => {
    fixture.evidenceReferences[0] = "artifacts/local/rls-live/db-rls-check.log";
  },
});
runRlsLiveNegativeCheck({
  label: "RLS live invalid evidence reference prefix negative",
  path: "docs/evidence-templates/rls-live.invalid-reference-prefix.tmp.json",
  expectedFailure: "evidenceReferences.0 artifact:, run:, log:, url:, https://, file://, s3:// veya artifacts/ ile baslayan kalici referans olmali.",
  mutate: (fixture) => {
    fixture.evidenceReferences[0] = "manual staging note db-rls-check.log";
  },
});
runRlsLiveNegativeCheck({
  label: "RLS live secret evidence reference negative",
  path: "docs/evidence-templates/rls-live.secret-reference.tmp.json",
  expectedFailure: "evidenceReferences.0 userinfo, query veya fragment tasimamali.",
  mutate: (fixture) => {
    fixture.evidenceReferences[0] = "https://user:secret@evidence.o-okul.com/rls-live/db-rls-check.log?token=secret";
  },
});
runRlsLiveNegativeCheck({
  label: "RLS live invalid gaps negative",
  path: "docs/evidence-templates/rls-live.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runRlsLiveLocalArtifactTargetNegativeCheck();
runRlsLiveSecretTargetNegativeCheck();
runRlsLiveSymlinkParentTargetNegativeCheck();
runUatNegativeCheck({
  label: "UAT extra top-level key negative",
  path: "docs/evidence-templates/uat.extra-top-level.tmp.json",
  expectedFailure: "uat tam 11 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runUatNegativeCheck({
  label: "UAT extra command negative",
  path: "docs/evidence-templates/uat.extra-command.tmp.json",
  expectedFailure: "commandsPassed tam 12 komut içermeli.",
  mutate: (fixture) => {
    fixture.commandsPassed.push("pnpm unexpected:smoke");
  },
});
runUatNegativeCheck({
  label: "UAT extra journey scenario negative",
  path: "docs/evidence-templates/uat.extra-journey-scenario.tmp.json",
  expectedFailure: "journeyScenariosVerified tam 21 senaryo içermeli.",
  mutate: (fixture) => {
    fixture.journeyScenariosVerified.push({
      id: "UAT-UNEXPECTED-01",
      persona: "TENANT_ADMIN",
      status: "PASS",
      evidence: ["unexpected UAT scenario evidence"],
    });
  },
});
runUatNegativeCheck({
  label: "UAT extra journey field negative",
  path: "docs/evidence-templates/uat.extra-journey-field.tmp.json",
  expectedFailure: "journeyScenariosVerified.UAT-SYS-01 tam 4 alan içermeli.",
  mutate: (fixture) => {
    fixture.journeyScenariosVerified[0].unexpectedField = true;
  },
});
runUatNegativeCheck({
  label: "UAT plain evidence reference negative",
  path: "docs/evidence-templates/uat.plain-evidence-reference.tmp.json",
  expectedFailure: "UAT-SYS-01.evidence production kanıtı kalıcı artifact/run/log/url referansı içermeli.",
  allowExampleEvidence: false,
  mutate: (fixture) => {
    fixture.tester = "release-owner";
    fixture.rollbackImageTag = "ghcr.io/o-okul/api:rollback-2026-05-30";
    fixture.restoreBackupReference = "s3://o-okul-prod-backups/base/2026-05-30.dump";
    fixture.journeyScenariosVerified[0].evidence = ["release owner observed staging screen"];
  },
});
runUatNegativeCheck({
  label: "UAT secret restore backup reference negative",
  path: "docs/evidence-templates/uat.secret-restore-reference.tmp.json",
  expectedFailure: "restoreBackupReference userinfo, query veya fragment tasimamali.",
  mutate: (fixture) => {
    fixture.restoreBackupReference = "s3://backup-bucket/base/2026-05-30.dump?token=secret#fragment";
  },
});
runUatNegativeCheck({
  label: "UAT secret journey evidence reference negative",
  path: "docs/evidence-templates/uat.secret-journey-evidence.tmp.json",
  expectedFailure: "UAT-SYS-01.evidence userinfo, query veya fragment tasimamali.",
  mutate: (fixture) => {
    fixture.journeyScenariosVerified[0].evidence[0] =
      "https://user:secret@evidence.o-okul.com/uat/sys-01.json?token=secret#fragment";
  },
});
runUatLocalArtifactTargetNegativeCheck();
runUatGeneratorLocalArtifactNegativeChecks();
runUatSecretTargetNegativeCheck();
runUatSymlinkParentTargetNegativeCheck();
runPilotNegativeCheck({
  label: "Pilot extra top-level key negative",
  path: "docs/evidence-templates/pilot.extra-top-level.tmp.json",
  expectedFailure: "pilot tam 18 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runPilotNegativeCheck({
  label: "Pilot extra real-data import field negative",
  path: "docs/evidence-templates/pilot.extra-real-data-import-field.tmp.json",
  expectedFailure: "realDataImport tam 6 alan içermeli.",
  mutate: (fixture) => {
    fixture.realDataImport.unexpectedField = true;
  },
});
runPilotNegativeCheck({
  label: "Pilot extra assessment field negative",
  path: "docs/evidence-templates/pilot.extra-assessment-field.tmp.json",
  expectedFailure: "assessmentCriteria.AC-01 tam 3 alan içermeli.",
  mutate: (fixture) => {
    fixture.assessmentCriteria[0].unexpectedField = true;
  },
});
runPilotNegativeCheck({
  label: "Pilot unexpected assessment criterion negative",
  path: "docs/evidence-templates/pilot.unexpected-assessment-criterion.tmp.json",
  expectedFailure: "assessmentCriteria beklenmeyen madde içeriyor: AC-99",
  mutate: (fixture) => {
    fixture.assessmentCriteria[9].id = "AC-99";
  },
});
runPilotNegativeCheck({
  label: "Pilot invalid gaps negative",
  path: "docs/evidence-templates/pilot.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runPilotLocalArtifactTargetNegativeCheck();
runPilotSecretUrlTargetNegativeCheck();
runPilotSymlinkParentTargetNegativeCheck();
runDeploymentRegionNegativeCheck({
  label: "Deployment region extra top-level key negative",
  path: "docs/evidence-templates/deployment-region.extra-top-level.tmp.json",
  expectedFailure: "deploymentRegion tam 10 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runDeploymentRegionNegativeCheck({
  label: "Deployment region extra service negative",
  path: "docs/evidence-templates/deployment-region.extra-service.tmp.json",
  expectedFailure: "servicesVerified tam 5 servis içermeli.",
  mutate: (fixture) => {
    fixture.servicesVerified.push("queue-board");
  },
});
runDeploymentRegionNegativeCheck({
  label: "Deployment region invalid gaps negative",
  path: "docs/evidence-templates/deployment-region.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runDeploymentRegionNegativeCheck({
  label: "Deployment region secret evidence reference negative",
  path: "docs/evidence-templates/deployment-region.secret-reference.tmp.json",
  expectedFailure: "evidenceReference userinfo, query veya fragment tasimamali.",
  mutate: (fixture) => {
    fixture.evidenceReference = "https://user:secret@evidence.o-okul.com/deployment-region.json?token=secret#fragment";
  },
});
runDeploymentRegionNegativeCheck({
  label: "Deployment region public IP lookup reference negative",
  path: "docs/evidence-templates/deployment-region.public-ip-lookup.tmp.json",
  expectedFailure: "evidenceReference provider console, sözleşme veya kalıcı first-party artifact olmalı; public IP lookup tek başına yeterli değil.",
  mutate: (fixture) => {
    fixture.provider = "HOSTING DUNYAM";
    fixture.region = "Istanbul";
    fixture.evidenceReference = "url:https://ipinfo.io/212.108.107.190";
  },
});
runDeploymentRegionSecretTargetNegativeCheck();
runDeploymentRegionSymlinkParentTargetNegativeCheck();
runDeploymentRollbackNegativeCheck({
  label: "Deployment rollback extra top-level key negative",
  path: "docs/evidence-templates/deployment-rollback.extra-top-level.tmp.json",
  expectedFailure: "deploymentRollback tam 15 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runDeploymentRollbackNegativeCheck({
  label: "Deployment rollback extra service field negative",
  path: "docs/evidence-templates/deployment-rollback.extra-service-field.tmp.json",
  expectedFailure: "servicesVerified.web tam 4 alan içermeli.",
  mutate: (fixture) => {
    fixture.servicesVerified[0].unexpectedField = true;
  },
});
runDeploymentRollbackNegativeCheck({
  label: "Deployment rollback extra service negative",
  path: "docs/evidence-templates/deployment-rollback.extra-service.tmp.json",
  expectedFailure: "servicesVerified tam 4 servis içermeli.",
  mutate: (fixture) => {
    fixture.servicesVerified.push({
      service: "scheduler",
      status: "healthy",
      imageTag: "ghcr.io/example/o-okul/scheduler:previous-pass",
      evidenceReference: "docker compose ps scheduler",
    });
  },
});
runDeploymentRollbackNegativeCheck({
  label: "Deployment rollback extra command negative",
  path: "docs/evidence-templates/deployment-rollback.extra-command.tmp.json",
  expectedFailure: "commandsPassed tam 4 madde içermeli.",
  mutate: (fixture) => {
    fixture.commandsPassed.push("pnpm unexpected:rollback:shortcut");
  },
});
runDeploymentRollbackNegativeCheck({
  label: "Deployment rollback completed before started negative",
  path: "docs/evidence-templates/deployment-rollback.completed-before-started.tmp.json",
  expectedFailure: "drillStartedAt drillCompletedAt sonrasında olamaz.",
  mutate: (fixture) => {
    fixture.drillCompletedAt = "2026-05-30T10:10:00.000Z";
  },
});
runDeploymentRollbackNegativeCheck({
  label: "Deployment rollback completed after checkedAt negative",
  path: "docs/evidence-templates/deployment-rollback.completed-after-checked-at.tmp.json",
  expectedFailure: "drillCompletedAt checkedAt sonrasında olamaz.",
  mutate: (fixture) => {
    fixture.checkedAt = "2026-05-30T10:20:00.000Z";
  },
});
runDeploymentRollbackNegativeCheck({
  label: "Deployment rollback invalid gaps negative",
  path: "docs/evidence-templates/deployment-rollback.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runDeploymentRollbackNegativeCheck({
  label: "Deployment rollback release equals rollback image negative",
  path: "docs/evidence-templates/deployment-rollback.release-equals-rollback.tmp.json",
  expectedFailure: "releaseCandidate ve rollbackImageTag farklı olmalı.",
  mutate: (fixture) => {
    fixture.rollbackImageTag = fixture.releaseCandidate;
  },
});
runDeploymentRollbackNegativeCheck({
  label: "Deployment rollback service image version mismatch negative",
  path: "docs/evidence-templates/deployment-rollback.service-image-version-mismatch.tmp.json",
  expectedFailure: "web.imageTag rollbackImageTag versiyonuyla eşleşmeli.",
  mutate: (fixture) => {
    fixture.servicesVerified[0].imageTag = "ghcr.io/example/o-okul/web:stale-pass";
  },
});
runDeploymentRollbackNegativeCheck({
  label: "Deployment rollback secret service evidence reference negative",
  path: "docs/evidence-templates/deployment-rollback.secret-service-reference.tmp.json",
  expectedFailure: "web.evidenceReference userinfo, query veya fragment tasimamali.",
  mutate: (fixture) => {
    fixture.servicesVerified[0].evidenceReference =
      "https://user:secret@evidence.o-okul.com/rollback/web?token=secret#fragment";
  },
});
runDeploymentRollbackNegativeCheck({
  label: "Deployment rollback secret evidence reference negative",
  path: "docs/evidence-templates/deployment-rollback.secret-reference.tmp.json",
  expectedFailure: "evidenceReferences userinfo, query veya fragment tasimamali.",
  mutate: (fixture) => {
    fixture.evidenceReferences[0] = "https://user:secret@evidence.o-okul.com/rollback.json?token=secret#fragment";
  },
});
runDeploymentRollbackLocalArtifactTargetNegativeCheck();
runDeploymentRollbackSecretTargetNegativeCheck();
runDeploymentRollbackSymlinkParentTargetNegativeCheck();
runProductionSummaryHttpTargetNegativeCheck();
runProductionSummarySecretUrlTargetNegativeCheck();
runProductionSummarySymlinkParentTargetNegativeCheck();
runStagingOutboxProductionSummaryModeChecks();
runProductionSummaryNegativeCheck({
  label: "Production summary extra check negative",
  path: "docs/evidence-templates/production-evidence-summary.extra-check.tmp.json",
  expectedFailure: "checks tam 29 madde içermeli.",
  mutate: (fixture) => {
    fixture.checks.push({
      label: "Beklenmeyen production check",
      script: "scripts/check-unexpected-production-evidence.mjs",
      status: "PASS",
    });
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary extra top-level key negative",
  path: "docs/evidence-templates/production-evidence-summary.extra-top-level.tmp.json",
  expectedFailure: "summary tam 9 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary extra check field negative",
  path: "docs/evidence-templates/production-evidence-summary.extra-check-field.tmp.json",
  expectedFailure: "checks.Production env tam 3 alan içermeli.",
  mutate: (fixture) => {
    fixture.checks[0].unexpectedField = true;
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary failed check status negative",
  path: "docs/evidence-templates/production-evidence-summary.failed-check-status.tmp.json",
  expectedFailure: "checks.Production env PASS olmalı.",
  mutate: (fixture) => {
    fixture.checks[0].status = "FAIL";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary wrong check script negative",
  path: "docs/evidence-templates/production-evidence-summary.wrong-check-script.tmp.json",
  expectedFailure: "checks.Production env.script scripts/check-prod-env.mjs olmalı.",
  mutate: (fixture) => {
    fixture.checks[0].script = "scripts/check-prod-env-drifted.mjs";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary duplicate check label negative",
  path: "docs/evidence-templates/production-evidence-summary.duplicate-check.tmp.json",
  expectedFailure: "checks tekrarlı madde içeriyor: Production env",
  mutate: (fixture) => {
    fixture.checks.push({ ...fixture.checks[0] });
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary extra smoke evidence negative",
  path: "docs/evidence-templates/production-evidence-summary.extra-smoke-evidence.tmp.json",
  expectedFailure: "smokeEvidence tam 8 alan içermeli.",
  mutate: (fixture) => {
    fixture.smokeEvidence.unexpectedSmoke = { ...fixture.smokeEvidence.alertWebhook };
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary smoke staging environment negative",
  path: "docs/evidence-templates/production-evidence-summary.smoke-staging-environment.tmp.json",
  expectedFailure: "smokeEvidence.traefikHttps.environment production olmalı.",
  mutate: (fixture) => {
    fixture.smokeEvidence.traefikHttps.environment = "staging";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary report generation threshold negative",
  path: "docs/evidence-templates/production-evidence-summary.report-generation-threshold.tmp.json",
  expectedFailure: "smokeEvidence.reportGeneration.thresholds.generationDurationPassed true olmalı.",
  mutate: (fixture) => {
    fixture.smokeEvidence.reportGeneration.thresholds.generationDurationPassed = false;
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary report generation command negative",
  path: "docs/evidence-templates/production-evidence-summary.report-generation-command.tmp.json",
  expectedFailure: "smokeEvidence.reportGeneration.commandsPassed beklenen komutlardan biri olmalı.",
  mutate: (fixture) => {
    fixture.smokeEvidence.reportGeneration.commandsPassed = ["pnpm report-generation:local"];
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary Traefik smoke URL origin mismatch negative",
  path: "docs/evidence-templates/production-evidence-summary.traefik-url-origin-mismatch.tmp.json",
  expectedFailure: "smokeEvidence.traefikHttps.url webUrl origin'i ile eşleşmeli.",
  mutate: (fixture) => {
    fixture.smokeEvidence.traefikHttps.url = "https://other-staging.example.test/";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary external monitoring URL origin mismatch negative",
  path: "docs/evidence-templates/production-evidence-summary.external-monitoring-url-origin-mismatch.tmp.json",
  expectedFailure: "reports.externalMonitoring.monitorsVerified.Web login.url webUrl origin'i ile eşleşmeli.",
  mutate: (fixture) => {
    const monitor = fixture.reports.externalMonitoring.monitorsVerified.find((item) => item.name === "Web login");
    monitor.url = "https://other-staging.example.test/login";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary external monitoring outage drill chronology negative",
  path: "docs/evidence-templates/production-evidence-summary.external-monitoring-outage-drill-chronology.tmp.json",
  expectedFailure:
    "reports.externalMonitoring.outageDrill.detectedAt reports.externalMonitoring.outageDrill.webhookDeliveredAt sonrasında olamaz.",
  mutate: (fixture) => {
    fixture.reports.externalMonitoring.outageDrill.webhookDeliveredAt = "2026-05-30T09:01:00.000Z";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary external monitoring outage drill latency mismatch negative",
  path: "docs/evidence-templates/production-evidence-summary.external-monitoring-outage-drill-latency-mismatch.tmp.json",
  expectedFailure: "reports.externalMonitoring.outageDrill.detectionLatencySeconds inducedAt/detectedAt farkıyla eşleşmeli.",
  mutate: (fixture) => {
    fixture.reports.externalMonitoring.outageDrill.detectionLatencySeconds = 74;
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary extra report negative",
  path: "docs/evidence-templates/production-evidence-summary.extra-report.tmp.json",
  expectedFailure: "reports tam 20 alan içermeli.",
  mutate: (fixture) => {
    fixture.reports.unexpectedReport = { ...fixture.reports.securityAudit };
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary extra report field negative",
  path: "docs/evidence-templates/production-evidence-summary.extra-report-field.tmp.json",
  expectedFailure: "reports.deploymentRollback tam 11 alan içermeli.",
  mutate: (fixture) => {
    fixture.reports.deploymentRollback.unexpectedField = true;
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary smoke after summary negative",
  path: "docs/evidence-templates/production-evidence-summary.smoke-after-summary.tmp.json",
  expectedFailure: "smokeEvidence.traefikHttps.generatedAt generatedAt tarihinden sonra olamaz.",
  mutate: (fixture) => {
    fixture.smokeEvidence.traefikHttps.generatedAt = "2026-06-15T10:30:00.000Z";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary report after summary negative",
  path: "docs/evidence-templates/production-evidence-summary.report-after-summary.tmp.json",
  expectedFailure: "reports.deploymentRollback.checkedAt generatedAt tarihinden sonra olamaz.",
  mutate: (fixture) => {
    fixture.reports.deploymentRollback.checkedAt = "2026-06-15T10:30:00.000Z";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary UAT command set negative",
  path: "docs/evidence-templates/production-evidence-summary.uat-command-set.tmp.json",
  expectedFailure: "reports.uat.commandsPassed eksik: pnpm raw-import:smoke",
  mutate: (fixture) => {
    fixture.reports.uat.commandsPassed = fixture.reports.uat.commandsPassed.filter((command) => command !== "pnpm raw-import:smoke");
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary KVKK raw row redaction control negative",
  path: "docs/evidence-templates/production-evidence-summary.kvkk-raw-row-redaction-control.tmp.json",
  expectedFailure: "reports.kvkkInventory.auditDiffRedactionVerified.negativeControls tam 21 madde içermeli.",
  mutate: (fixture) => {
    fixture.reports.kvkkInventory.auditDiffRedactionVerified.negativeControls =
      fixture.reports.kvkkInventory.auditDiffRedactionVerified.negativeControls.filter((item) => item !== "rawRow");
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary KVKK WhatsApp consent record count negative",
  path: "docs/evidence-templates/production-evidence-summary.kvkk-whatsapp-consent-record-count.tmp.json",
  expectedFailure: "reports.kvkkInventory.whatsappConsent.recordCount 0 olmalı.",
  mutate: (fixture) => {
    fixture.reports.kvkkInventory.whatsappConsent.recordCount = 1;
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary KVKK WhatsApp consent event record count negative",
  path: "docs/evidence-templates/production-evidence-summary.kvkk-whatsapp-consent-event-record-count.tmp.json",
  expectedFailure: "reports.kvkkInventory.whatsappConsent.eventRecordCount 0 olmalı.",
  mutate: (fixture) => {
    fixture.reports.kvkkInventory.whatsappConsent.eventRecordCount = 1;
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary RLS tenant FK missing relation negative",
  path: "docs/evidence-templates/production-evidence-summary.rls-tenant-fk-missing-relation.tmp.json",
  expectedFailure: "reports.rlsLive.tenantFkPreflight.relationsVerified tam 32 madde içermeli.",
  mutate: (fixture) => {
    fixture.reports.rlsLive.tenantFkPreflight.relationsVerified = fixture.reports.rlsLive.tenantFkPreflight.relationsVerified.filter(
      (relation) => relation !== "Student.responsibleTeacher",
    );
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary RLS local artifact reference negative",
  path: "docs/evidence-templates/production-evidence-summary.rls-local-artifact-reference.tmp.json",
  expectedFailure: "reports.rlsLive.evidenceReferences.0 local smoke artifact referansi tasimamali.",
  mutate: (fixture) => {
    fixture.reports.rlsLive.evidenceReferences[0] = "artifacts/local/rls-live/db-rls-check.log";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary RLS invalid evidence reference prefix negative",
  path: "docs/evidence-templates/production-evidence-summary.rls-invalid-reference-prefix.tmp.json",
  expectedFailure: "reports.rlsLive.evidenceReferences.0 artifact:, run:, log:, url:, https://, file://, s3:// veya artifacts/ ile baslayan kalici referans olmali.",
  mutate: (fixture) => {
    fixture.reports.rlsLive.evidenceReferences[0] = "manual staging note db-rls-check.log";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary UAT live exam cycle flag negative",
  path: "docs/evidence-templates/production-evidence-summary.uat-live-exam-cycle-flag.tmp.json",
  expectedFailure: "reports.uat.liveExamCyclePassed true olmalı.",
  mutate: (fixture) => {
    fixture.reports.uat.liveExamCyclePassed = false;
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary live exam cycle release mismatch negative",
  path: "docs/evidence-templates/production-evidence-summary.live-exam-cycle-release-mismatch.tmp.json",
  expectedFailure: "reports.liveExamCycle.releaseCandidate reports.uat.releaseCandidate ile eşleşmeli.",
  mutate: (fixture) => {
    fixture.reports.liveExamCycle.releaseCandidate = "ghcr.io/example/o-okul/api:unexpected-live-exam-release";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary live exam cycle app URL mismatch negative",
  path: "docs/evidence-templates/production-evidence-summary.live-exam-cycle-app-url-mismatch.tmp.json",
  expectedFailure: "reports.liveExamCycle.appUrl appUrl ile eşleşmeli.",
  mutate: (fixture) => {
    fixture.reports.liveExamCycle.appUrl = "https://other-staging.example.test";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary live exam cycle API URL mismatch negative",
  path: "docs/evidence-templates/production-evidence-summary.live-exam-cycle-api-url-mismatch.tmp.json",
  expectedFailure: "reports.liveExamCycle.apiUrl apiUrl ile eşleşmeli.",
  mutate: (fixture) => {
    fixture.reports.liveExamCycle.apiUrl = "https://other-staging-api.example.test";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary live exam cycle iSEM count mismatch negative",
  path: "docs/evidence-templates/production-evidence-summary.live-exam-cycle-isem-count-mismatch.tmp.json",
  expectedFailure:
    "reports.liveExamCycle.examCycle.participantCount reports.isemOpticalPipeline.counts.participantCount ile eşleşmeli.",
  mutate: (fixture) => {
    fixture.reports.liveExamCycle.examCycle.participantCount = 20;
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary live exam cycle parser version mismatch negative",
  path: "docs/evidence-templates/production-evidence-summary.live-exam-cycle-parser-version-mismatch.tmp.json",
  expectedFailure:
    "reports.liveExamCycle.examCycle.parserConfigVersion reports.isemOpticalPipeline.parserConfigVersion ile eşleşmeli.",
  mutate: (fixture) => {
    fixture.reports.liveExamCycle.examCycle.parserConfigVersion = "optik-7108-lgs-v2";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary UAT release candidate mismatch negative",
  path: "docs/evidence-templates/production-evidence-summary.uat-release-candidate-mismatch.tmp.json",
  expectedFailure: "reports.uat.releaseCandidate reports.deploymentRollback.releaseCandidate ile eşleşmeli.",
  mutate: (fixture) => {
    fixture.reports.uat.releaseCandidate = "ghcr.io/example/o-okul/api:unexpected-release";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary release SHA mismatch negative",
  path: "docs/evidence-templates/production-evidence-summary.release-sha-mismatch.tmp.json",
  expectedFailure:
    "reports.uiUxRedesign releaseCandidate tag'i, sourceCommitSha ve reports.githubCi.commitSha aynı 40 karakter SHA olmalı.",
  mutate: (fixture) => {
    fixture.reports.githubCi.commitSha = "2".repeat(40);
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary UI/UX empty artifact manifest negative",
  path: "docs/evidence-templates/production-evidence-summary.ui-ux-empty-artifacts.tmp.json",
  expectedFailure: "reports.uiUxRedesign.artifacts boş olmayan schema v2 manifesti olmalı.",
  mutate: (fixture) => {
    fixture.reports.uiUxRedesign.artifacts = [];
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary UI/UX nested GitHub CI drift negative",
  path: "docs/evidence-templates/production-evidence-summary.ui-ux-github-drift.tmp.json",
  expectedFailure: "reports.uiUxRedesign.githubCi standalone GitHub CI kanıtıyla exact SHA/run/job bağı kurmalı.",
  mutate: (fixture) => {
    fixture.reports.uiUxRedesign.githubCi.runId = "9999999999";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary UI/UX self-expanded allowlist negative",
  path: "docs/evidence-templates/production-evidence-summary.ui-ux-allowlist-drift.tmp.json",
  expectedFailure: "reports.uiUxRedesign.allowedEvidenceHosts güvenilir UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS ile birebir eşleşmeli.",
  mutate: (fixture) => {
    fixture.reports.uiUxRedesign.allowedEvidenceHosts = ["attacker-controlled.example.net"];
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary UAT rollback image mismatch negative",
  path: "docs/evidence-templates/production-evidence-summary.uat-rollback-image-mismatch.tmp.json",
  expectedFailure: "reports.uat.rollbackImageTag reports.deploymentRollback.rollbackImageTag ile eşleşmeli.",
  mutate: (fixture) => {
    fixture.reports.uat.rollbackImageTag = "ghcr.io/example/o-okul/api:unexpected-rollback";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary UAT restore backup mismatch negative",
  path: "docs/evidence-templates/production-evidence-summary.uat-restore-backup-mismatch.tmp.json",
  expectedFailure: "reports.uat.restoreBackupReference reports.restoreDrill.sourceBackup ile eşleşmeli.",
  mutate: (fixture) => {
    fixture.reports.uat.restoreBackupReference = "s3://backup-bucket/base/unexpected.dump";
  },
});
runLiveStatusGenerationNegativeCheck({
  label: "Live status invalid summary source negative",
  sourcePath: "docs/evidence-templates/production-evidence-summary.invalid-live-status-source.tmp.json",
  outputPath: "docs/evidence-templates/live-status.invalid-summary-source.tmp.json",
  expectedFailure: "result PASS olmalı.",
  source: "summary",
  mutate: (fixture) => {
    fixture.result = "FAIL";
  },
});
runLiveStatusGenerationNegativeCheck({
  label: "Live status invalid pilot source negative",
  sourcePath: "docs/evidence-templates/pilot.invalid-live-status-source.tmp.json",
  outputPath: "docs/evidence-templates/live-status.invalid-pilot-source.tmp.json",
  expectedFailure: "goLiveDecision APPROVED olmalı.",
  source: "pilot",
  mutate: (fixture) => {
    fixture.goLiveDecision = "REJECTED";
  },
});
runLiveStatusGenerationNegativeCheck({
  label: "Live status invalid go-live source negative",
  sourcePath: "docs/evidence-templates/go-live.invalid-live-status-source.tmp.json",
  outputPath: "docs/evidence-templates/live-status.invalid-go-live-source.tmp.json",
  expectedFailure: "goLiveDecision APPROVED olmali.",
  source: "goLive",
  mutate: (fixture) => {
    fixture.goLiveDecision = "REJECTED";
  },
});
runLiveStatusGeneratorHttpTargetNegativeCheck();
runLiveStatusGeneratorSymlinkTargetNegativeCheck();
runLiveStatusGeneratorSymlinkParentTargetNegativeCheck();
runLiveStatusGeneratorOutputTargetNegativeChecks();
runLiveStatusEvidenceLocalArtifactTargetNegativeCheck();
runLiveStatusEvidenceSymlinkParentTargetNegativeCheck();
runLiveStatusNegativeCheck({
  label: "Live status duplicate gate negative",
  path: "docs/evidence-templates/live-status.duplicate-gate.tmp.json",
  expectedFailure: "gates tekrarlı satır içeriyor: Traefik HTTPS smoke",
  mutate: (fixture) => {
    fixture.gates.push({ ...fixture.gates[0] });
  },
});
runLiveStatusNegativeCheck({
  label: "Live status extra top-level field negative",
  path: "docs/evidence-templates/live-status.extra-top-level.tmp.json",
  expectedFailure: "liveStatusEvidence tam 7 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runLiveStatusNegativeCheck({
  label: "Live status extra gate field negative",
  path: "docs/evidence-templates/live-status.extra-gate-field.tmp.json",
  expectedFailure: "gates.Traefik HTTPS smoke tam 6 alan içermeli.",
  mutate: (fixture) => {
    fixture.gates[0].unexpectedField = true;
  },
});
runLiveStatusNegativeCheck({
  label: "Live status NOT_RUN wrong command negative",
  path: "docs/evidence-templates/live-status.not-run-wrong-command.tmp.json",
  readinessPath: "docs/evidence-templates/live-status.not-run-wrong-command.readiness.tmp.md",
  expectedFailure: "gates.Traefik HTTPS smoke.command pnpm traefik:https:smoke olmalı.",
  mutate: (fixture) => {
    fixture.gates[0].status = "NOT_RUN";
    fixture.gates[0].command = "pnpm wrong:command";
  },
  mutateReadiness: (readiness) =>
    readiness.replace("- Traefik HTTPS smoke: `PASS`", "- Traefik HTTPS smoke: `NOT_RUN`"),
});
runLiveStatusNegativeCheck({
  label: "Live status NOT_RUN wrong source negative",
  path: "docs/evidence-templates/live-status.not-run-wrong-source.tmp.json",
  readinessPath: "docs/evidence-templates/live-status.not-run-wrong-source.readiness.tmp.md",
  expectedFailure:
    "gates.Traefik HTTPS smoke.source productionEvidenceSummary.smokeEvidence.traefikHttps olmalı.",
  mutate: (fixture) => {
    fixture.gates[0].status = "NOT_RUN";
    fixture.gates[0].source = "productionEvidenceSummary.smokeEvidence.wrong";
  },
  mutateReadiness: (readiness) =>
    readiness.replace("- Traefik HTTPS smoke: `PASS`", "- Traefik HTTPS smoke: `NOT_RUN`"),
});
runLiveStatusNegativeCheck({
  label: "Live status NOT_RUN invalid checkedAt negative",
  path: "docs/evidence-templates/live-status.not-run-invalid-checked-at.tmp.json",
  readinessPath: "docs/evidence-templates/live-status.not-run-invalid-checked-at.readiness.tmp.md",
  expectedFailure: "gates.Traefik HTTPS smoke.checkedAt geçerli tarih olmalı.",
  mutate: (fixture) => {
    fixture.gates[0].status = "NOT_RUN";
    fixture.gates[0].checkedAt = "not-a-date";
  },
  mutateReadiness: (readiness) =>
    readiness.replace("- Traefik HTTPS smoke: `PASS`", "- Traefik HTTPS smoke: `NOT_RUN`"),
});
runLiveStatusNegativeCheck({
  label: "Live status NOT_RUN blank evidence reference negative",
  path: "docs/evidence-templates/live-status.not-run-blank-evidence-reference.tmp.json",
  readinessPath: "docs/evidence-templates/live-status.not-run-blank-evidence-reference.readiness.tmp.md",
  expectedFailure: "gates.Traefik HTTPS smoke.evidenceReference boş olmayan string olmalı.",
  mutate: (fixture) => {
    fixture.gates[0].status = "NOT_RUN";
    fixture.gates[0].evidenceReference = "";
  },
  mutateReadiness: (readiness) =>
    readiness.replace("- Traefik HTTPS smoke: `PASS`", "- Traefik HTTPS smoke: `NOT_RUN`"),
});
runLiveStatusNegativeCheck({
  label: "Live status late gate negative",
  path: "docs/evidence-templates/live-status.late-gate.tmp.json",
  expectedFailure: "gates.Traefik HTTPS smoke.checkedAt generatedAt tarihinden sonra olamaz.",
  mutate: (fixture) => {
    fixture.gates[0].checkedAt = "2026-06-16T00:00:00.000Z";
  },
});
runLiveStatusNegativeCheck({
  label: "Live status source date mismatch negative",
  path: "docs/evidence-templates/live-status.source-date-mismatch.tmp.json",
  expectedFailure: "gates.Traefik HTTPS smoke.checkedAt productionEvidenceSummary.smokeEvidence.traefikHttps.generatedAt ile eslesmeli.",
  mutate: (fixture) => {
    fixture.gates[0].checkedAt = "2026-06-15T08:59:00.000Z";
  },
});
runLiveStatusNegativeCheck({
  label: "Live status source evidence reference mismatch negative",
  path: "docs/evidence-templates/live-status.source-reference-mismatch.tmp.json",
  expectedFailure:
    "gates.Traefik HTTPS smoke.evidenceReference productionEvidenceSummary.smokeEvidence.traefikHttps kaynak referansı ile eslesmeli.",
  mutate: (fixture) => {
    fixture.gates[0].evidenceReference = "artifacts/example/production/wrong-traefik-reference.json";
  },
});
runLiveStatusNegativeCheck({
  label: "Live status source result negative",
  path: "docs/evidence-templates/live-status.source-result.tmp.json",
  expectedFailure: "gates.Traefik HTTPS smoke.source.result PASS olmalı.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.live-status-source-result.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.smokeEvidence.traefikHttps.result = "FAIL";
    fixture.productionEvidenceSummaryTarget = "production-evidence-summary.live-status-source-result.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runLiveStatusNegativeCheck({
  label: "Live status source environment negative",
  path: "docs/evidence-templates/live-status.source-environment.tmp.json",
  expectedFailure: "gates.Traefik HTTPS smoke.source.environment production olmalı.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.live-status-source-environment.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.smokeEvidence.traefikHttps.environment = "staging";
    fixture.productionEvidenceSummaryTarget = "production-evidence-summary.live-status-source-environment.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runLiveStatusNegativeCheck({
  label: "Live status HTTP summary target negative",
  path: "docs/evidence-templates/live-status.http-summary-target.tmp.json",
  expectedFailure: "productionEvidenceSummaryTarget file:// veya https:// URL olmalı.",
  mutate: (fixture) => {
    fixture.productionEvidenceSummaryTarget = "http://evidence.o-okul.com/production-summary.json";
  },
});
runGoLiveSecretUrlTargetNegativeCheck();
runGoLiveNegativeCheck({
  label: "Go-live linked production summary secret URL target negative",
  path: "docs/evidence-templates/go-live.linked-summary-secret-url-target.tmp.json",
  expectedFailure: "productionEvidenceSummary.summaryTarget target URL userinfo, query veya fragment iceremez.",
  mutate: (fixture) => {
    fixture.productionEvidenceSummary.summaryTarget =
      "https://ops:secret@evidence.o-okul.com/production-summary.json?token=secret#proof";
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked pilot secret URL target negative",
  path: "docs/evidence-templates/go-live.linked-pilot-secret-url-target.tmp.json",
  expectedFailure: "pilot.pilotEvidenceReference target URL userinfo, query veya fragment iceremez.",
  mutate: (fixture) => {
    fixture.pilot.pilotEvidenceReference = "https://ops:secret@evidence.o-okul.com/pilot.json?token=secret#proof";
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked live-status secret URL target negative",
  path: "docs/evidence-templates/go-live.linked-live-status-secret-url-target.tmp.json",
  expectedFailure: "liveStatusEvidence.evidenceTarget target URL userinfo, query veya fragment iceremez.",
  mutate: (fixture) => {
    fixture.liveStatusEvidence.evidenceTarget =
      "https://ops:secret@evidence.o-okul.com/live-status.json?token=secret#proof";
  },
});
runGoLiveNegativeCheck({
  label: "Go-live HTTP live-status target negative",
  path: "docs/evidence-templates/go-live.http-live-status-target.tmp.json",
  expectedFailure: "liveStatusEvidence.evidenceTarget file:// veya https:// URL olmali.",
  mutate: (fixture) => {
    fixture.liveStatusEvidence.evidenceTarget = "http://evidence.o-okul.com/live-status.json";
  },
});
runGoLiveNegativeCheck({
  label: "Go-live extra gatesPassed negative",
  path: "docs/evidence-templates/go-live.extra-gates-passed.tmp.json",
  expectedFailure: "liveStatusEvidence.gatesPassed tam 17 gate içermeli.",
  mutate: (fixture) => {
    fixture.liveStatusEvidence.gatesPassed.push("Beklenmeyen gate");
  },
});
runGoLiveNegativeCheck({
  label: "Go-live extra top-level key negative",
  path: "docs/evidence-templates/go-live.extra-top-level.tmp.json",
  expectedFailure: "goLive tam 17 alan icermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runGoLiveNegativeCheck({
  label: "Go-live extra production summary field negative",
  path: "docs/evidence-templates/go-live.extra-production-summary-field.tmp.json",
  expectedFailure: "productionEvidenceSummary tam 5 alan icermeli.",
  mutate: (fixture) => {
    fixture.productionEvidenceSummary.unexpectedField = true;
  },
});
runGoLiveNegativeCheck({
  label: "Go-live extra deployment field negative",
  path: "docs/evidence-templates/go-live.extra-deployment-field.tmp.json",
  expectedFailure: "deployment tam 12 alan icermeli.",
  mutate: (fixture) => {
    fixture.deployment.unexpectedField = true;
  },
});
runGoLiveNegativeCheck({
  label: "Go-live extra approval role negative",
  path: "docs/evidence-templates/go-live.extra-approval-role.tmp.json",
  expectedFailure: "approvals tam 4 onay icermeli.",
  mutate: (fixture) => {
    fixture.approvals.push({
      role: "unexpected",
      decision: "APPROVED",
      approver: "ops-extra-approver",
      approvedAt: fixture.checkedAt,
    });
  },
});
runGoLiveNegativeCheck({
  label: "Go-live extra approval field negative",
  path: "docs/evidence-templates/go-live.extra-approval-field.tmp.json",
  expectedFailure: "approvals.product tam 4 alan icermeli.",
  mutate: (fixture) => {
    fixture.approvals[0].unexpectedField = true;
  },
});
runGoLiveNegativeCheck({
  label: "Go-live extra checksPassed negative",
  path: "docs/evidence-templates/go-live.extra-checks-passed.tmp.json",
  expectedFailure: "productionEvidenceSummary.checksPassed tam 29 madde icermeli.",
  mutate: (fixture) => {
    fixture.productionEvidenceSummary.checksPassed.push("Beklenmeyen production check");
  },
});
runGoLiveNegativeCheck({
  label: "Go-live summary after decision negative",
  path: "docs/evidence-templates/go-live.summary-after-decision.tmp.json",
  expectedFailure: "productionEvidenceSummary.generatedAt checkedAt tarihinden sonra olamaz.",
  mutate: (fixture) => {
    fixture.productionEvidenceSummary.generatedAt = "2026-06-15T14:00:00.000Z";
  },
});
runGoLiveNegativeCheck({
  label: "Go-live live-status after decision negative",
  path: "docs/evidence-templates/go-live.live-status-after-decision.tmp.json",
  expectedFailure: "liveStatusEvidence.generatedAt checkedAt tarihinden sonra olamaz.",
  mutate: (fixture) => {
    fixture.liveStatusEvidence.generatedAt = "2026-06-15T14:00:00.000Z";
  },
});
runGoLiveNegativeCheck({
  label: "Go-live cutover before decision negative",
  path: "docs/evidence-templates/go-live.cutover-before-decision.tmp.json",
  expectedFailure: "checkedAt cutover.scheduledAt tarihinden sonra olamaz.",
  mutate: (fixture) => {
    fixture.cutover.scheduledAt = "2026-06-15T13:00:00.000Z";
  },
});
runGoLiveNegativeCheck({
  label: "Go-live approval after decision negative",
  path: "docs/evidence-templates/go-live.approval-after-decision.tmp.json",
  expectedFailure: "product.approvedAt checkedAt tarihinden sonra olamaz.",
  mutate: (fixture) => {
    fixture.approvals[0].approvedAt = "2026-06-15T13:45:00.000Z";
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked invalid pilot gaps negative",
  path: "docs/evidence-templates/go-live.linked-invalid-pilot-gaps.tmp.json",
  expectedFailure: "pilotEvidence.gaps listesi zorunlu.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/pilot.invalid-gaps-for-go-live.tmp.json";
    const linkedPilot = structuredClone(pilotFixture);
    linkedPilot.gaps = "none";
    fixture.pilot.pilotEvidenceReference = "pilot.invalid-gaps-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedPilot, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked non-empty pilot gaps negative",
  path: "docs/evidence-templates/go-live.linked-non-empty-pilot-gaps.tmp.json",
  expectedFailure: "pilotEvidence.gaps bos olmali.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/pilot.non-empty-gaps-for-go-live.tmp.json";
    const linkedPilot = structuredClone(pilotFixture);
    linkedPilot.gaps = ["unexpected open pilot gap"];
    fixture.pilot.pilotEvidenceReference = "pilot.non-empty-gaps-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedPilot, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked duplicate summary check negative",
  path: "docs/evidence-templates/go-live.linked-duplicate-summary-check.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary.checks tam 29 madde icermeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.duplicate-check-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.checks.push({ ...linkedSummary.checks[0] });
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.duplicate-check-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked extra summary top-level negative",
  path: "docs/evidence-templates/go-live.linked-extra-summary-top-level.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary tam 9 alan icermeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.extra-top-level-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.unexpectedTopLevel = true;
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.extra-top-level-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked extra summary check field negative",
  path: "docs/evidence-templates/go-live.linked-extra-summary-check-field.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary.checks.Production env tam 3 alan icermeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.extra-check-field-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.checks[0].unexpectedField = true;
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.extra-check-field-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked extra summary smoke negative",
  path: "docs/evidence-templates/go-live.linked-extra-summary-smoke.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary.smokeEvidence tam 8 alan icermeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.extra-smoke-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.smokeEvidence.unexpectedSmoke = { ...linkedSummary.smokeEvidence.alertWebhook };
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.extra-smoke-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked alert webhook auth scheme negative",
  path: "docs/evidence-templates/go-live.linked-alert-webhook-auth-scheme.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary.smokeEvidence.alertWebhook.authorizationScheme bearer olmali.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.alert-webhook-auth-scheme-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.smokeEvidence.alertWebhook.authorizationScheme = "none";
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.alert-webhook-auth-scheme-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary report generation smoke command negative",
  path: "docs/evidence-templates/go-live.linked-summary-report-generation-smoke-command.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.commandsPassed tek pnpm report-generation:perf komutu icermeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.report-generation-smoke-command-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.smokeEvidence.reportGeneration.commandsPassed = ["pnpm report-generation:smoke"];
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.report-generation-smoke-command-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary report generation below 10k negative",
  path: "docs/evidence-templates/go-live.linked-summary-report-generation-below-10k.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.resultCount en az 10000 tam sayi olmali.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.report-generation-below-10k-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.smokeEvidence.reportGeneration.resultCount = 9_999;
    linkedSummary.smokeEvidence.reportGeneration.studentCount = 9_999;
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.report-generation-below-10k-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary report generation max threshold negative",
  path: "docs/evidence-templates/go-live.linked-summary-report-generation-max-threshold.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.thresholds.generationDurationMsMax 60000 olmali.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.report-generation-max-threshold-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.smokeEvidence.reportGeneration.thresholds.generationDurationMsMax = 120_000;
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.report-generation-max-threshold-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary SMS raw recipient negative",
  path: "docs/evidence-templates/go-live.linked-summary-sms-raw-recipient.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary.smokeEvidence.smsProvider.recipient maskeli recipient olmali.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.sms-raw-recipient-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.smokeEvidence.smsProvider.recipient = "+905551112233";
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.sms-raw-recipient-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary notification raw recipient negative",
  path: "docs/evidence-templates/go-live.linked-summary-notification-raw-recipient.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary.smokeEvidence.notificationProvider.recipients.0 maskeli recipient olmali.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.notification-raw-recipient-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.smokeEvidence.notificationProvider.recipients = ["ops@o-okul.com"];
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.notification-raw-recipient-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary Traefik smoke URL origin mismatch negative",
  path: "docs/evidence-templates/go-live.linked-summary-traefik-url-origin-mismatch.tmp.json",
  expectedFailure:
    "productionEvidenceSummary.summary.smokeEvidence.traefikHttps.url productionEvidenceSummary.summary.webUrl origin'i ile eslesmeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.traefik-url-origin-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.smokeEvidence.traefikHttps.url = "https://other-staging.example.test/";
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.traefik-url-origin-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary external monitoring URL origin mismatch negative",
  path: "docs/evidence-templates/go-live.linked-summary-external-monitoring-url-origin-mismatch.tmp.json",
  expectedFailure:
    "productionEvidenceSummary.summary.reports.externalMonitoring.monitorsVerified.Web login.url productionEvidenceSummary.summary.webUrl origin'i ile eslesmeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.external-monitoring-url-origin-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    const monitor = linkedSummary.reports.externalMonitoring.monitorsVerified.find((item) => item.name === "Web login");
    monitor.url = "https://other-staging.example.test/login";
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.external-monitoring-url-origin-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary external monitoring outage drill chronology negative",
  path: "docs/evidence-templates/go-live.linked-summary-external-monitoring-outage-drill-chronology.tmp.json",
  expectedFailure:
    "productionEvidenceSummary.summary.reports.externalMonitoring.outageDrill.detectedAt productionEvidenceSummary.summary.reports.externalMonitoring.outageDrill.webhookDeliveredAt sonrasinda olamaz.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.external-monitoring-outage-drill-chronology-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.externalMonitoring.outageDrill.webhookDeliveredAt = "2026-05-30T09:01:00.000Z";
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.external-monitoring-outage-drill-chronology-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary external monitoring outage drill latency mismatch negative",
  path: "docs/evidence-templates/go-live.linked-summary-external-monitoring-outage-drill-latency-mismatch.tmp.json",
  expectedFailure:
    "productionEvidenceSummary.summary.reports.externalMonitoring.outageDrill.detectionLatencySeconds inducedAt/detectedAt farkiyla eslesmeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.external-monitoring-outage-drill-latency-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.externalMonitoring.outageDrill.detectionLatencySeconds = 74;
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.external-monitoring-outage-drill-latency-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked extra summary report negative",
  path: "docs/evidence-templates/go-live.linked-extra-summary-report.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary.reports tam 20 alan icermeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.extra-report-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.unexpectedReport = { ...linkedSummary.reports.securityAudit };
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.extra-report-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked extra summary report field negative",
  path: "docs/evidence-templates/go-live.linked-extra-summary-report-field.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary.reports.deploymentRollback tam 11 alan icermeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.extra-report-field-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.deploymentRollback.unexpectedField = true;
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.extra-report-field-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary release SHA mismatch negative",
  path: "docs/evidence-templates/go-live.linked-summary-release-sha-mismatch.tmp.json",
  expectedFailure:
    "productionEvidenceSummary.summary UI/UX releaseCandidate tag'i, sourceCommitSha ve GitHub CI commitSha aynı 40 karakter SHA olmalı.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.release-sha-mismatch-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.githubCi.commitSha = "2".repeat(40);
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.release-sha-mismatch-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary UI/UX empty artifact manifest negative",
  path: "docs/evidence-templates/go-live.linked-summary-ui-ux-empty-artifacts.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary.reports.uiUxRedesign.artifacts boş olmayan schema v2 manifesti olmalı.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.ui-ux-empty-artifacts-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.uiUxRedesign.artifacts = [];
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.ui-ux-empty-artifacts-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary UI/UX nested GitHub CI drift negative",
  path: "docs/evidence-templates/go-live.linked-summary-ui-ux-github-drift.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary.reports.uiUxRedesign.githubCi standalone GitHub CI kanıtıyla exact SHA/run/job bağı kurmalı.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.ui-ux-github-drift-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.uiUxRedesign.githubCi.runId = "9999999999";
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.ui-ux-github-drift-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary UI/UX self-expanded allowlist negative",
  path: "docs/evidence-templates/go-live.linked-summary-ui-ux-allowlist-drift.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary.reports.uiUxRedesign.allowedEvidenceHosts güvenilir UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS ile birebir eşleşmeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.ui-ux-allowlist-drift-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.uiUxRedesign.allowedEvidenceHosts = ["attacker-controlled.example.net"];
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.ui-ux-allowlist-drift-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary UAT live exam cycle flag negative",
  path: "docs/evidence-templates/go-live.linked-summary-uat-live-exam-cycle-flag.tmp.json",
  expectedFailure: "productionEvidenceSummary.summary.reports.uat.liveExamCyclePassed true olmali.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.uat-live-exam-cycle-flag-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.uat.liveExamCyclePassed = false;
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.uat-live-exam-cycle-flag-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary KVKK raw row redaction control negative",
  path: "docs/evidence-templates/go-live.linked-summary-kvkk-raw-row-redaction-control.tmp.json",
  expectedFailure:
    "productionEvidenceSummary.summary.reports.kvkkInventory.auditDiffRedactionVerified.negativeControls tam 21 madde icermeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.kvkk-raw-row-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.kvkkInventory.auditDiffRedactionVerified.negativeControls =
      linkedSummary.reports.kvkkInventory.auditDiffRedactionVerified.negativeControls.filter((item) => item !== "rawRow");
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.kvkk-raw-row-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary KVKK WhatsApp consent policy negative",
  path: "docs/evidence-templates/go-live.linked-summary-kvkk-whatsapp-consent-policy.tmp.json",
  expectedFailure:
    "productionEvidenceSummary.summary.reports.kvkkInventory.whatsappConsent.policy.retentionPeriodDays 0 olmali.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.kvkk-whatsapp-consent-policy-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.kvkkInventory.whatsappConsent.policy.retentionPeriodDays = 30;
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.kvkk-whatsapp-consent-policy-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary RLS tenant FK missing relation negative",
  path: "docs/evidence-templates/go-live.linked-summary-rls-tenant-fk-missing-relation.tmp.json",
  expectedFailure:
    "productionEvidenceSummary.summary.reports.rlsLive.tenantFkPreflight.relationsVerified tam 32 madde icermeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.rls-tenant-fk-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.rlsLive.tenantFkPreflight.relationsVerified =
      linkedSummary.reports.rlsLive.tenantFkPreflight.relationsVerified.filter(
        (relation) => relation !== "Student.responsibleTeacher",
      );
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.rls-tenant-fk-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary RLS local artifact reference negative",
  path: "docs/evidence-templates/go-live.linked-summary-rls-local-artifact-reference.tmp.json",
  expectedFailure:
    "productionEvidenceSummary.summary.reports.rlsLive.evidenceReferences.0 local smoke artifact referansi tasimamali.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.rls-local-artifact-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.rlsLive.evidenceReferences[0] = "artifacts/local/rls-live/db-rls-check.log";
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.rls-local-artifact-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary RLS invalid evidence reference prefix negative",
  path: "docs/evidence-templates/go-live.linked-summary-rls-invalid-reference-prefix.tmp.json",
  expectedFailure:
    "productionEvidenceSummary.summary.reports.rlsLive.evidenceReferences.0 artifact:, run:, log:, url:, https://, file://, s3:// veya artifacts/ ile baslayan kalici referans olmali.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.rls-invalid-reference-prefix-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.rlsLive.evidenceReferences[0] = "manual staging note db-rls-check.log";
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.rls-invalid-reference-prefix-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary live exam cycle app URL mismatch negative",
  path: "docs/evidence-templates/go-live.linked-summary-live-exam-cycle-app-url-mismatch.tmp.json",
  expectedFailure:
    "productionEvidenceSummary.summary.reports.liveExamCycle.appUrl productionEvidenceSummary.summary.appUrl ile eslesmeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.live-exam-cycle-app-url-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.liveExamCycle.appUrl = "https://other-staging.example.test";
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.live-exam-cycle-app-url-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked summary live exam cycle API URL mismatch negative",
  path: "docs/evidence-templates/go-live.linked-summary-live-exam-cycle-api-url-mismatch.tmp.json",
  expectedFailure:
    "productionEvidenceSummary.summary.reports.liveExamCycle.apiUrl productionEvidenceSummary.summary.apiUrl ile eslesmeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/production-evidence-summary.live-exam-cycle-api-url-for-go-live.tmp.json";
    const linkedSummary = structuredClone(productionSummaryFixture);
    linkedSummary.reports.liveExamCycle.apiUrl = "https://other-staging-api.example.test";
    fixture.productionEvidenceSummary.summaryTarget = "production-evidence-summary.live-exam-cycle-api-url-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedSummary, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked duplicate gate negative",
  path: "docs/evidence-templates/go-live.linked-duplicate-gate.tmp.json",
  expectedFailure: "liveStatusEvidence.gates tam 17 gate içermeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/live-status.duplicate-gate-for-go-live.tmp.json";
    const linkedLiveStatus = structuredClone(liveStatusFixture);
    linkedLiveStatus.goLiveEvidenceTarget = "go-live.linked-duplicate-gate.tmp.json";
    linkedLiveStatus.gates.push({ ...linkedLiveStatus.gates[0] });
    fixture.liveStatusEvidence.evidenceTarget = "live-status.duplicate-gate-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedLiveStatus, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked extra live-status top-level negative",
  path: "docs/evidence-templates/go-live.linked-extra-live-status-top-level.tmp.json",
  expectedFailure: "liveStatusEvidence tam 7 alan icermeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/live-status.extra-top-level-for-go-live.tmp.json";
    const linkedLiveStatus = structuredClone(liveStatusFixture);
    linkedLiveStatus.goLiveEvidenceTarget = "go-live.linked-extra-live-status-top-level.tmp.json";
    linkedLiveStatus.unexpectedTopLevel = true;
    fixture.liveStatusEvidence.evidenceTarget = "live-status.extra-top-level-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedLiveStatus, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked extra live-status gate field negative",
  path: "docs/evidence-templates/go-live.linked-extra-live-status-gate-field.tmp.json",
  expectedFailure: "liveStatusEvidence.gates.Traefik HTTPS smoke tam 6 alan icermeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/live-status.extra-gate-field-for-go-live.tmp.json";
    const linkedLiveStatus = structuredClone(liveStatusFixture);
    linkedLiveStatus.goLiveEvidenceTarget = "go-live.linked-extra-live-status-gate-field.tmp.json";
    linkedLiveStatus.gates[0].unexpectedField = true;
    fixture.liveStatusEvidence.evidenceTarget = "live-status.extra-gate-field-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedLiveStatus, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked live-status wrong summary target negative",
  path: "docs/evidence-templates/go-live.linked-live-status-wrong-summary-target.tmp.json",
  expectedFailure:
    "liveStatusEvidence.productionEvidenceSummaryTarget productionEvidenceSummary.summaryTarget ile ayni artifact hedefine baglanmali.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/live-status.wrong-summary-target-for-go-live.tmp.json";
    const linkedLiveStatus = structuredClone(liveStatusFixture);
    linkedLiveStatus.goLiveEvidenceTarget = "go-live.linked-live-status-wrong-summary-target.tmp.json";
    linkedLiveStatus.productionEvidenceSummaryTarget = "production-evidence-summary.drifted.tmp.json";
    fixture.liveStatusEvidence.evidenceTarget = "live-status.wrong-summary-target-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedLiveStatus, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked live-status wrong go-live target negative",
  path: "docs/evidence-templates/go-live.linked-live-status-wrong-go-live-target.tmp.json",
  expectedFailure: "liveStatusEvidence.goLiveEvidenceTarget GO_LIVE_EVIDENCE_TARGET ile ayni artifact hedefine baglanmali.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/live-status.wrong-go-live-target-for-go-live.tmp.json";
    const linkedLiveStatus = structuredClone(liveStatusFixture);
    linkedLiveStatus.goLiveEvidenceTarget = "go-live.drifted.tmp.json";
    fixture.liveStatusEvidence.evidenceTarget = "live-status.wrong-go-live-target-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedLiveStatus, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked live-status wrong pilot target negative",
  path: "docs/evidence-templates/go-live.linked-live-status-wrong-pilot-target.tmp.json",
  expectedFailure: "liveStatusEvidence.pilotEvidenceTarget pilot.pilotEvidenceReference ile ayni artifact hedefine baglanmali.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/live-status.wrong-pilot-target-for-go-live.tmp.json";
    const linkedLiveStatus = structuredClone(liveStatusFixture);
    linkedLiveStatus.goLiveEvidenceTarget = "go-live.linked-live-status-wrong-pilot-target.tmp.json";
    linkedLiveStatus.pilotEvidenceTarget = "pilot.drifted.tmp.json";
    fixture.liveStatusEvidence.evidenceTarget = "live-status.wrong-pilot-target-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedLiveStatus, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked live-status smoke date mismatch negative",
  path: "docs/evidence-templates/go-live.linked-live-status-smoke-date-mismatch.tmp.json",
  expectedFailure:
    "liveStatusEvidence.gates.Traefik HTTPS smoke.checkedAt productionEvidenceSummary.smokeEvidence.traefikHttps.generatedAt ile eslesmeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/live-status.smoke-date-mismatch-for-go-live.tmp.json";
    const linkedLiveStatus = structuredClone(liveStatusFixture);
    linkedLiveStatus.goLiveEvidenceTarget = "go-live.linked-live-status-smoke-date-mismatch.tmp.json";
    linkedLiveStatus.gates[0].checkedAt = "2026-06-15T08:59:00.000Z";
    fixture.liveStatusEvidence.evidenceTarget = "live-status.smoke-date-mismatch-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedLiveStatus, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked live-status report date mismatch negative",
  path: "docs/evidence-templates/go-live.linked-live-status-report-date-mismatch.tmp.json",
  expectedFailure:
    "liveStatusEvidence.gates.Live exam cycle kanıtı.checkedAt productionEvidenceSummary.reports.liveExamCycle.checkedAt ile eslesmeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/live-status.report-date-mismatch-for-go-live.tmp.json";
    const linkedLiveStatus = structuredClone(liveStatusFixture);
    linkedLiveStatus.goLiveEvidenceTarget = "go-live.linked-live-status-report-date-mismatch.tmp.json";
    linkedLiveStatus.gates[1].checkedAt = "2026-05-29";
    fixture.liveStatusEvidence.evidenceTarget = "live-status.report-date-mismatch-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedLiveStatus, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked live-status pilot date mismatch negative",
  path: "docs/evidence-templates/go-live.linked-live-status-pilot-date-mismatch.tmp.json",
  expectedFailure: "liveStatusEvidence.gates.Pilot kapanış kanıtı.checkedAt pilotEvidence.checkedAt ile eslesmeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/live-status.pilot-date-mismatch-for-go-live.tmp.json";
    const linkedLiveStatus = structuredClone(liveStatusFixture);
    linkedLiveStatus.goLiveEvidenceTarget = "go-live.linked-live-status-pilot-date-mismatch.tmp.json";
    linkedLiveStatus.gates[14].checkedAt = "2026-06-14";
    fixture.liveStatusEvidence.evidenceTarget = "live-status.pilot-date-mismatch-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedLiveStatus, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked live-status go-live date mismatch negative",
  path: "docs/evidence-templates/go-live.linked-live-status-go-live-date-mismatch.tmp.json",
  expectedFailure: "liveStatusEvidence.gates.Go-live karar paketi.checkedAt goLiveEvidence.checkedAt ile eslesmeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/live-status.go-live-date-mismatch-for-go-live.tmp.json";
    const linkedLiveStatus = structuredClone(liveStatusFixture);
    linkedLiveStatus.goLiveEvidenceTarget = "go-live.linked-live-status-go-live-date-mismatch.tmp.json";
    linkedLiveStatus.gates[15].checkedAt = "2026-06-15T13:00:00.000Z";
    fixture.liveStatusEvidence.evidenceTarget = "live-status.go-live-date-mismatch-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedLiveStatus, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked live-status summary evidence reference mismatch negative",
  path: "docs/evidence-templates/go-live.linked-live-status-summary-reference-mismatch.tmp.json",
  expectedFailure:
    "liveStatusEvidence.gates.Traefik HTTPS smoke.evidenceReference productionEvidenceSummary.smokeEvidence.traefikHttps kaynak referansı ile eslesmeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/live-status.summary-reference-mismatch-for-go-live.tmp.json";
    const linkedLiveStatus = structuredClone(liveStatusFixture);
    linkedLiveStatus.goLiveEvidenceTarget = "go-live.linked-live-status-summary-reference-mismatch.tmp.json";
    linkedLiveStatus.gates[0].evidenceReference = "artifacts/example/production/wrong-traefik-reference.json";
    fixture.liveStatusEvidence.evidenceTarget = "live-status.summary-reference-mismatch-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedLiveStatus, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked live-status report evidence reference mismatch negative",
  path: "docs/evidence-templates/go-live.linked-live-status-report-reference-mismatch.tmp.json",
  expectedFailure:
    "liveStatusEvidence.gates.Live exam cycle kanıtı.evidenceReference productionEvidenceSummary.reports.liveExamCycle kaynak referansı ile eslesmeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/live-status.report-reference-mismatch-for-go-live.tmp.json";
    const linkedLiveStatus = structuredClone(liveStatusFixture);
    linkedLiveStatus.goLiveEvidenceTarget = "go-live.linked-live-status-report-reference-mismatch.tmp.json";
    linkedLiveStatus.gates[1].evidenceReference = "artifacts/example/production/wrong-live-exam-cycle-reference.json";
    fixture.liveStatusEvidence.evidenceTarget = "live-status.report-reference-mismatch-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedLiveStatus, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked live-status pilot evidence reference mismatch negative",
  path: "docs/evidence-templates/go-live.linked-live-status-pilot-reference-mismatch.tmp.json",
  expectedFailure: "liveStatusEvidence.gates.Pilot kapanış kanıtı.evidenceReference pilotEvidence kaynak referansı ile eslesmeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/live-status.pilot-reference-mismatch-for-go-live.tmp.json";
    const linkedLiveStatus = structuredClone(liveStatusFixture);
    linkedLiveStatus.goLiveEvidenceTarget = "go-live.linked-live-status-pilot-reference-mismatch.tmp.json";
    linkedLiveStatus.gates[14].evidenceReference = "artifacts/example/pilot/wrong-pilot-reference.json";
    fixture.liveStatusEvidence.evidenceTarget = "live-status.pilot-reference-mismatch-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedLiveStatus, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveNegativeCheck({
  label: "Go-live linked live-status go-live evidence reference mismatch negative",
  path: "docs/evidence-templates/go-live.linked-live-status-go-live-reference-mismatch.tmp.json",
  expectedFailure: "liveStatusEvidence.gates.Go-live karar paketi.evidenceReference goLiveEvidence kaynak referansı ile eslesmeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/live-status.go-live-reference-mismatch-for-go-live.tmp.json";
    const linkedLiveStatus = structuredClone(liveStatusFixture);
    linkedLiveStatus.goLiveEvidenceTarget = "go-live.linked-live-status-go-live-reference-mismatch.tmp.json";
    linkedLiveStatus.gates[15].evidenceReference = "artifacts/example/production/wrong-go-live-reference.json";
    fixture.liveStatusEvidence.evidenceTarget = "live-status.go-live-reference-mismatch-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedLiveStatus, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
runGoLiveLinkedLiveStatusLocalArtifactTargetNegativeCheck();
runGoLiveLinkedLiveStatusSymlinkParentTargetNegativeCheck();

for (const [label, script, scriptArgs, contractPath] of contractChecks) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(`Production evidence template kontrolü başarısız: ${label} (${contractPath})`);
    process.exit(result.status ?? 1);
  }
}

const journeyCheck = spawnSync(process.execPath, ["scripts/check-product-journeys.mjs"], {
  env: process.env,
  stdio: "inherit",
});

if (journeyCheck.status !== 0) {
  console.error("Production evidence template kontrolü başarısız: Product journeys");
  process.exit(journeyCheck.status ?? 1);
}

console.log("Production evidence template kontrolü geçti.");

function runLiveStatusNegativeCheck({ label, path, readinessPath: readinessFixturePath, expectedFailure, mutate, mutateReadiness }) {
  const fixture = structuredClone(liveStatusFixture);
  const cleanupPaths = [path];
  mutate(fixture, cleanupPaths);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  let readinessPath = liveStatusReadinessPath;
  if (mutateReadiness) {
    readinessPath = readinessFixturePath ?? path.replace(/\.tmp\.json$/, ".readiness.tmp.md");
    writeFileSync(readinessPath, mutateReadiness(readFileSync(liveStatusReadinessPath, "utf8")));
    cleanupPaths.push(readinessPath);
  }

  try {
    const result = spawnSync(process.execPath, ["scripts/check-live-status-evidence.mjs"], {
      env: {
        ...process.env,
        LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE: "1",
        LIVE_STATUS_READINESS_PATH: readinessPath,
        LIVE_STATUS_EVIDENCE_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    for (const cleanupPath of cleanupPaths) {
      try {
        unlinkSync(cleanupPath);
      } catch {
        // Ignore cleanup errors; the negative-check failure above is the actionable signal.
      }
    }
  }
}

function runProductionSummaryNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(productionSummaryFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-production-evidence-summary.mjs"], {
      env: {
        ...process.env,
        PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE: "1",
        PRODUCTION_EVIDENCE_SUMMARY_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runStagingOutboxProductionSummaryModeChecks() {
  const path = "docs/evidence-templates/production-evidence-summary.staging-outbox.tmp.json";
  const fixture = structuredClone(productionSummaryFixture);
  fixture.smokeEvidence.secretDeliveryOutbox.environment = "staging";
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const baseEnv = {
      ...process.env,
      PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE: "1",
      PRODUCTION_EVIDENCE_SUMMARY_TARGET: pathToFileURL(path).href,
    };
    const rejected = spawnSync(process.execPath, ["scripts/check-production-evidence-summary.mjs"], {
      env: baseEnv,
      encoding: "utf8",
    });
    const rejectedOutput = `${rejected.stdout ?? ""}${rejected.stderr ?? ""}`;
    if (rejected.status === 0 || !rejectedOutput.includes("smokeEvidence.secretDeliveryOutbox.environment production olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: staging outbox summary flag olmadan kırılmalı.");
      console.error(rejectedOutput);
      process.exit(1);
    }

    const accepted = spawnSync(process.execPath, ["scripts/check-production-evidence-summary.mjs"], {
      env: { ...baseEnv, PRODUCTION_EVIDENCE_ALLOW_STAGING_OUTBOX: "1" },
      encoding: "utf8",
    });
    if (accepted.status !== 0) {
      console.error("Production evidence template kontrolü başarısız: explicit staging outbox summary modu geçmeli.");
      console.error(accepted.stdout);
      console.error(accepted.stderr);
      process.exit(accepted.status ?? 1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the contract result above is the actionable signal.
    }
  }
}

function runProductionSummaryHttpTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-production-evidence-summary.mjs"], {
    env: {
      ...process.env,
      PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE: "1",
      PRODUCTION_EVIDENCE_SUMMARY_TARGET: "http://evidence.o-okul.com/release-summary.json",
    },
    encoding: "utf8",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: production summary HTTP target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("PRODUCTION_EVIDENCE_SUMMARY_TARGET file:// veya https:// URL olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: production summary HTTP target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runProductionSummarySecretUrlTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-production-evidence-summary.mjs"], {
    env: {
      ...process.env,
      PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE: "1",
      PRODUCTION_EVIDENCE_SUMMARY_TARGET: "https://ops:secret@evidence.o-okul.com/release-summary.json?token=secret#proof",
    },
    encoding: "utf8",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: production summary secret URL target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("PRODUCTION_EVIDENCE_SUMMARY_TARGET production evidence target URL userinfo, query veya fragment içeremez.")) {
    console.error("Production evidence template kontrolü başarısız: production summary secret URL target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runProductionSummarySymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "production-summary-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const realNestedDirectory = join(realDirectory, "nested");
  mkdirSync(realNestedDirectory, { recursive: true });
  writeFileSync(join(realNestedDirectory, "release-summary.json"), readFileSync(productionSummaryFixturePath, "utf8"));
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(process.execPath, ["scripts/check-production-evidence-summary.mjs"], {
      env: {
        ...process.env,
        PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE: "1",
        PRODUCTION_EVIDENCE_SUMMARY_TARGET: pathToFileURL(join(symlinkDirectory, "nested", "release-summary.json")).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: production summary symlink parent target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("PRODUCTION_EVIDENCE_SUMMARY_TARGET parent dizini symlink olmayan dizin olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: production summary symlink parent target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runDeploymentRegionNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(deploymentRegionFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-deployment-region-evidence.mjs"], {
      env: {
        ...process.env,
        DEPLOYMENT_REGION_ALLOW_EXAMPLE_EVIDENCE: "1",
        DEPLOYMENT_REGION_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runDeploymentRegionSecretTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-deployment-region-evidence.mjs"], {
    env: {
      ...process.env,
      DEPLOYMENT_REGION_ALLOW_EXAMPLE_EVIDENCE: "1",
      DEPLOYMENT_REGION_TARGET: "https://user:secret@evidence.o-okul.com/deployment-region.json?token=secret#fragment",
    },
    encoding: "utf8",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: deployment region secret target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("DEPLOYMENT_REGION_TARGET userinfo, query veya fragment tasimamali.")) {
    console.error("Production evidence template kontrolü başarısız: deployment region secret target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runDeploymentRegionSymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "deployment-region-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const nestedDirectory = join(realDirectory, "nested");
  mkdirSync(nestedDirectory, { recursive: true });
  writeFileSync(join(nestedDirectory, "deployment-region.json"), `${JSON.stringify(deploymentRegionFixture, null, 2)}\n`);
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(process.execPath, ["scripts/check-deployment-region-evidence.mjs"], {
      env: {
        ...process.env,
        DEPLOYMENT_REGION_ALLOW_EXAMPLE_EVIDENCE: "1",
        DEPLOYMENT_REGION_TARGET: pathToFileURL(join(symlinkDirectory, "nested", "deployment-region.json")).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: deployment region symlink parent target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("DEPLOYMENT_REGION_TARGET parent dizini symlink olmayan dizin olmali.")) {
      console.error("Production evidence template kontrolü başarısız: deployment region symlink parent target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runGithubCiNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(githubCiFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-github-ci-evidence.mjs"], {
      env: {
        ...process.env,
        GITHUB_CI_ALLOW_EXAMPLE_EVIDENCE: "1",
        GITHUB_CI_EVIDENCE_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runUploadAvNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(uploadAvFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-upload-av-evidence.mjs"], {
      env: {
        ...process.env,
        UPLOAD_AV_ALLOW_EXAMPLE_EVIDENCE: "1",
        UPLOAD_AV_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runExternalMonitoringNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(externalMonitoringFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-external-monitoring-evidence.mjs"], {
      env: {
        ...process.env,
        EXTERNAL_MONITORING_ALLOW_EXAMPLE_EVIDENCE: "1",
        EXTERNAL_MONITORING_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runExternalMonitoringSymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "external-monitoring-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const nestedDirectory = join(realDirectory, "nested");
  mkdirSync(nestedDirectory, { recursive: true });
  writeFileSync(join(nestedDirectory, "external-monitoring.json"), `${JSON.stringify(externalMonitoringFixture, null, 2)}\n`);
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(process.execPath, ["scripts/check-external-monitoring-evidence.mjs"], {
      env: {
        ...process.env,
        EXTERNAL_MONITORING_ALLOW_EXAMPLE_EVIDENCE: "1",
        EXTERNAL_MONITORING_TARGET: pathToFileURL(join(symlinkDirectory, "nested", "external-monitoring.json")).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: external monitoring symlink parent target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("EXTERNAL_MONITORING_TARGET parent dizini symlink olmayan dizin olmali.")) {
      console.error("Production evidence template kontrolü başarısız: external monitoring symlink parent target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runObservabilityUatNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(observabilityUatFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-observability-uat-evidence.mjs"], {
      env: {
        ...process.env,
        OBSERVABILITY_UAT_ALLOW_EXAMPLE_EVIDENCE: "1",
        OBSERVABILITY_UAT_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runObservabilityUatSecretTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-observability-uat-evidence.mjs"], {
    env: {
      ...process.env,
      OBSERVABILITY_UAT_ALLOW_EXAMPLE_EVIDENCE: "1",
      OBSERVABILITY_UAT_TARGET: "https://user:secret@evidence.o-okul.com/observability-uat.json?token=secret#fragment",
    },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: observability UAT secret target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("OBSERVABILITY_UAT_TARGET userinfo, query veya fragment tasimamali.")) {
    console.error("Production evidence template kontrolü başarısız: observability UAT secret target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runObservabilityUatLocalArtifactTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-observability-uat-evidence.mjs"], {
    env: {
      ...process.env,
      OBSERVABILITY_UAT_ALLOW_EXAMPLE_EVIDENCE: "1",
      OBSERVABILITY_UAT_TARGET: pathToFileURL(resolve("artifacts/local/observability-uat-target-negative.json")).href,
    },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: observability UAT local artifact target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("OBSERVABILITY_UAT_TARGET production kaniti icin artifacts/local altinda olmamali.")) {
    console.error("Production evidence template kontrolü başarısız: observability UAT local artifact target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runObservabilityUatGeneratorLocalArtifactNegativeChecks() {
  const baseEnv = {
    ...process.env,
    STAGING_ENVIRONMENT: "staging",
    OBSERVABILITY_UAT_PROMETHEUS_URL: "https://prometheus.o-okul.com",
    OBSERVABILITY_UAT_GRAFANA_URL: "https://grafana.o-okul.com",
    OBSERVABILITY_UAT_LOKI_URL: "https://loki.o-okul.com",
    OBSERVABILITY_UAT_DASHBOARD_PANELS_VERIFIED: "API up,Request rate,Average duration,Readiness failures,Docker logs",
    OBSERVABILITY_UAT_ALERTS_VERIFIED:
      "OOkulApiDown,OOkulReadinessFailing,OOkulApiHighErrorRate,OOkulApiSlowRequests",
    OBSERVABILITY_UAT_PROMETHEUS_EVIDENCE_REFERENCE: "run:prometheus-ready-2026-06-24",
    OBSERVABILITY_UAT_GRAFANA_EVIDENCE_REFERENCE: "run:grafana-ready-2026-06-24",
    OBSERVABILITY_UAT_LOKI_EVIDENCE_REFERENCE: "run:loki-ready-2026-06-24",
    OBSERVABILITY_UAT_ALERT_WEBHOOK_EVIDENCE_REFERENCE: "run:alert-webhook-2026-06-24",
  };
  const cases = [
    {
      label: "Observability UAT generator local output negative",
      env: {
        OBSERVABILITY_UAT_OUTPUT: "artifacts/local/observability-uat-output-negative.json",
        OBSERVABILITY_UAT_ALERT_WEBHOOK_TARGET: pathToFileURL(resolve("artifacts/staging/first-gates/alert-webhook.json")).href,
      },
      expectedFailure: "OBSERVABILITY_UAT_OUTPUT artifacts/local altında olmamalı.",
    },
    {
      label: "Observability UAT generator local alert webhook target negative",
      env: {
        OBSERVABILITY_UAT_OUTPUT: "artifacts/staging/reports/observability-uat-generator-negative.json",
        OBSERVABILITY_UAT_ALERT_WEBHOOK_TARGET: pathToFileURL(resolve("artifacts/local/alert-webhook.json")).href,
      },
      expectedFailure: "OBSERVABILITY_UAT_ALERT_WEBHOOK_TARGET temp veya artifacts/local altında olmamalı.",
    },
  ];

  for (const item of cases) {
    const result = spawnSync(process.execPath, ["scripts/generate-observability-uat-evidence.mjs"], {
      env: {
        ...baseEnv,
        ...item.env,
      },
      encoding: "utf8",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${item.label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(item.expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${item.label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  }
}

function runObservabilityUatSymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "observability-uat-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const nestedDirectory = join(realDirectory, "nested");
  mkdirSync(nestedDirectory, { recursive: true });
  writeFileSync(join(nestedDirectory, "observability-uat.json"), `${JSON.stringify(observabilityUatFixture, null, 2)}\n`);
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(process.execPath, ["scripts/check-observability-uat-evidence.mjs"], {
      env: {
        ...process.env,
        OBSERVABILITY_UAT_ALLOW_EXAMPLE_EVIDENCE: "1",
        OBSERVABILITY_UAT_TARGET: pathToFileURL(join(symlinkDirectory, "nested", "observability-uat.json")).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: observability UAT symlink parent target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("OBSERVABILITY_UAT_TARGET parent dizini symlink olmayan dizin olmali.")) {
      console.error("Production evidence template kontrolü başarısız: observability UAT symlink parent target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runRestoreDrillNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(restoreDrillFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-restore-drill-evidence.mjs"], {
      env: {
        ...process.env,
        RESTORE_DRILL_ALLOW_EXAMPLE_EVIDENCE: "1",
        RESTORE_DRILL_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runKvkkInventoryNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(kvkkInventoryFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-kvkk-inventory-evidence.mjs"], {
      env: {
        ...process.env,
        KVKK_INVENTORY_TARGET: pathToFileURL(path).href,
        KVKK_INVENTORY_ALLOW_EXAMPLE_EVIDENCE: "1",
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runIdentityMigrationNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(identityMigrationFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-identity-migration-evidence.mjs"], {
      env: {
        ...process.env,
        IDENTITY_MIGRATION_ALLOW_EXAMPLE_EVIDENCE: "1",
        IDENTITY_MIGRATION_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runFinancialRetentionNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(financialRetentionFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-financial-retention-evidence.mjs"], {
      env: {
        ...process.env,
        FINANCIAL_RETENTION_ALLOW_EXAMPLE_EVIDENCE: "1",
        FINANCIAL_RETENTION_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runRestoreDrillSymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "restore-drill-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const nestedDirectory = join(realDirectory, "nested");
  mkdirSync(nestedDirectory, { recursive: true });
  writeFileSync(join(nestedDirectory, "restore-drill.json"), `${JSON.stringify(restoreDrillFixture, null, 2)}\n`);
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(process.execPath, ["scripts/check-restore-drill-evidence.mjs"], {
      env: {
        ...process.env,
        RESTORE_DRILL_ALLOW_EXAMPLE_EVIDENCE: "1",
        RESTORE_DRILL_TARGET: pathToFileURL(join(symlinkDirectory, "nested", "restore-drill.json")).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: restore drill symlink parent target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("RESTORE_DRILL_TARGET parent dizini symlink olmayan dizin olmali.")) {
      console.error("Production evidence template kontrolü başarısız: restore drill symlink parent target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runSecurityAuditNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(securityAuditFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-security-audit-evidence.mjs"], {
      env: {
        ...process.env,
        SECURITY_AUDIT_ALLOW_EXAMPLE_EVIDENCE: "1",
        SECURITY_AUDIT_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runSecurityAuditSymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "security-audit-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const nestedDirectory = join(realDirectory, "nested");
  mkdirSync(nestedDirectory, { recursive: true });
  writeFileSync(join(nestedDirectory, "security-audit.json"), `${JSON.stringify(securityAuditFixture, null, 2)}\n`);
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(process.execPath, ["scripts/check-security-audit-evidence.mjs"], {
      env: {
        ...process.env,
        SECURITY_AUDIT_ALLOW_EXAMPLE_EVIDENCE: "1",
        SECURITY_AUDIT_TARGET: pathToFileURL(join(symlinkDirectory, "nested", "security-audit.json")).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: security audit symlink parent target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("SECURITY_AUDIT_TARGET parent dizini symlink olmayan dizin olmali.")) {
      console.error("Production evidence template kontrolü başarısız: security audit symlink parent target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runAdminMfaNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(adminMfaFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-admin-mfa-evidence.mjs"], {
      env: {
        ...process.env,
        ADMIN_MFA_ALLOW_EXAMPLE_EVIDENCE: "1",
        ADMIN_MFA_EVIDENCE_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runInlineUploadMigrationNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(inlineUploadMigrationFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-inline-upload-content-migration-evidence.mjs"], {
      env: {
        ...process.env,
        INLINE_UPLOAD_CONTENT_MIGRATION_ALLOW_EXAMPLE_EVIDENCE: "1",
        INLINE_UPLOAD_CONTENT_MIGRATION_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runInlineUploadMigrationSecretTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-inline-upload-content-migration-evidence.mjs"], {
    env: {
      ...process.env,
      INLINE_UPLOAD_CONTENT_MIGRATION_TARGET:
        "https://user:secret@evidence.o-okul.com/inline-upload-content-migration.json?token=secret#fragment",
    },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    console.error(
      "Production evidence template kontrolü başarısız: Inline upload migration secret target negative beklenen şekilde kırılmadı.",
    );
    process.exit(1);
  }
  if (!output.includes("INLINE_UPLOAD_CONTENT_MIGRATION_TARGET userinfo, query veya fragment tasimamali.")) {
    console.error("Production evidence template kontrolü başarısız: Inline upload migration secret target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runAuditNullTenantNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(auditNullTenantFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-audit-null-tenant-evidence.mjs"], {
      env: {
        ...process.env,
        AUDIT_NULL_TENANT_ALLOW_EXAMPLE_EVIDENCE: "1",
        AUDIT_NULL_TENANT_EVIDENCE_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runRateLimitNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(rateLimitFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-rate-limit-evidence.mjs"], {
      env: {
        ...process.env,
        RATE_LIMIT_ALLOW_EXAMPLE_EVIDENCE: "1",
        RATE_LIMIT_EVIDENCE_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runRateLimitSecretTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-rate-limit-evidence.mjs"], {
    env: {
      ...process.env,
      RATE_LIMIT_EVIDENCE_TARGET: "https://user:secret@evidence.o-okul.com/rate-limit.json?token=secret#fragment",
    },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: Rate limit secret target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("RATE_LIMIT_EVIDENCE_TARGET userinfo, query veya fragment tasimamali.")) {
    console.error("Production evidence template kontrolü başarısız: Rate limit secret target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runRateLimitLocalArtifactTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-rate-limit-evidence.mjs"], {
    env: {
      ...process.env,
      RATE_LIMIT_ALLOW_EXAMPLE_EVIDENCE: "1",
      RATE_LIMIT_EVIDENCE_TARGET: pathToFileURL(resolve("artifacts/local/rate-limit-target-negative.json")).href,
    },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: Rate limit local artifact target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("RATE_LIMIT_EVIDENCE_TARGET production kaniti icin artifacts/local altinda olmamali.")) {
    console.error("Production evidence template kontrolü başarısız: Rate limit local artifact target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runRateLimitGeneratorLocalArtifactNegativeChecks() {
  const cases = [
    {
      label: "Rate limit generator local smoke input negative",
      env: {
        RATE_LIMIT_SMOKE_EVIDENCE_TARGET: pathToFileURL(resolve("artifacts/local/rate-limit-smoke-negative.json")).href,
        RATE_LIMIT_EVIDENCE_OUTPUT: "artifacts/staging/reports/rate-limit-generator-negative.json",
      },
      expectedFailure: "RATE_LIMIT_SMOKE_EVIDENCE_TARGET artifacts/local altında olmamalı.",
    },
    {
      label: "Rate limit generator local output negative",
      env: {
        RATE_LIMIT_SMOKE_EVIDENCE_TARGET: pathToFileURL(resolve("artifacts/staging/smoke/rate-limit-generator-negative.json")).href,
        RATE_LIMIT_EVIDENCE_OUTPUT: "artifacts/local/rate-limit-generator-output-negative.json",
      },
      expectedFailure: "RATE_LIMIT_EVIDENCE_OUTPUT artifacts/local altında olmamalı.",
    },
  ];

  for (const item of cases) {
    const result = spawnSync(process.execPath, ["scripts/generate-rate-limit-evidence.mjs"], {
      env: {
        ...process.env,
        ...item.env,
      },
      encoding: "utf8",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${item.label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(item.expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${item.label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  }
}

function runSymlinkParentTargetNegativeCheck({
  label,
  fixture,
  scriptPath,
  targetEnvName,
  allowEnvName,
  fileName,
  directoryPrefix,
  expectedFailure,
}) {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, directoryPrefix));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const nestedDirectory = join(realDirectory, "nested");
  mkdirSync(nestedDirectory, { recursive: true });
  writeFileSync(join(nestedDirectory, fileName), `${JSON.stringify(fixture, null, 2)}\n`);
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  const env = {
    ...process.env,
    [targetEnvName]: pathToFileURL(join(symlinkDirectory, "nested", fileName)).href,
  };
  if (allowEnvName) {
    env[allowEnvName] = "1";
  }

  try {
    const result = spawnSync(process.execPath, [scriptPath], {
      env,
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runFinancialRetentionSymlinkParentTargetNegativeCheck() {
  runSymlinkParentTargetNegativeCheck({
    label: "financial retention symlink parent target negative",
    fixture: financialRetentionFixture,
    scriptPath: "scripts/check-financial-retention-evidence.mjs",
    targetEnvName: "FINANCIAL_RETENTION_TARGET",
    allowEnvName: "FINANCIAL_RETENTION_ALLOW_EXAMPLE_EVIDENCE",
    fileName: "financial-retention.json",
    directoryPrefix: "financial-retention-parent-symlink-",
    expectedFailure: "FINANCIAL_RETENTION_TARGET parent dizini symlink olmayan dizin olmali.",
  });
}

function runKvkkInventoryFixtureTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-kvkk-inventory-evidence.mjs"], {
    env: {
      ...process.env,
      KVKK_INVENTORY_TARGET: pathToFileURL(kvkkInventoryFixturePath).href,
    },
    encoding: "utf8",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: KVKK inventory fixture target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("KVKK_INVENTORY_TARGET production kaniti icin docs/evidence-templates fixture hedefi olmamali.")) {
    console.error("Production evidence template kontrolü başarısız: KVKK inventory fixture target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runIdentityMigrationSymlinkParentTargetNegativeCheck() {
  runSymlinkParentTargetNegativeCheck({
    label: "identity migration symlink parent target negative",
    fixture: identityMigrationFixture,
    scriptPath: "scripts/check-identity-migration-evidence.mjs",
    targetEnvName: "IDENTITY_MIGRATION_TARGET",
    allowEnvName: "IDENTITY_MIGRATION_ALLOW_EXAMPLE_EVIDENCE",
    fileName: "identity-migration.json",
    directoryPrefix: "identity-migration-parent-symlink-",
    expectedFailure: "IDENTITY_MIGRATION_TARGET parent dizini symlink olmayan dizin olmali.",
  });
}

function runKvkkInventorySymlinkParentTargetNegativeCheck() {
  runSymlinkParentTargetNegativeCheck({
    label: "KVKK inventory symlink parent target negative",
    fixture: kvkkInventoryFixture,
    scriptPath: "scripts/check-kvkk-inventory-evidence.mjs",
    targetEnvName: "KVKK_INVENTORY_TARGET",
    allowEnvName: "KVKK_INVENTORY_ALLOW_EXAMPLE_EVIDENCE",
    fileName: "kvkk-inventory.json",
    directoryPrefix: "kvkk-inventory-parent-symlink-",
    expectedFailure: "KVKK_INVENTORY_TARGET parent dizini symlink olmayan dizin olmali.",
  });
}

function runAdminMfaSymlinkParentTargetNegativeCheck() {
  runSymlinkParentTargetNegativeCheck({
    label: "admin MFA symlink parent target negative",
    fixture: adminMfaFixture,
    scriptPath: "scripts/check-admin-mfa-evidence.mjs",
    targetEnvName: "ADMIN_MFA_EVIDENCE_TARGET",
    allowEnvName: "ADMIN_MFA_ALLOW_EXAMPLE_EVIDENCE",
    fileName: "admin-mfa.json",
    directoryPrefix: "admin-mfa-parent-symlink-",
    expectedFailure: "ADMIN_MFA_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmali.",
  });
}

function runUploadAvSymlinkParentTargetNegativeCheck() {
  runSymlinkParentTargetNegativeCheck({
    label: "upload AV symlink parent target negative",
    fixture: uploadAvFixture,
    scriptPath: "scripts/check-upload-av-evidence.mjs",
    targetEnvName: "UPLOAD_AV_TARGET",
    allowEnvName: "UPLOAD_AV_ALLOW_EXAMPLE_EVIDENCE",
    fileName: "upload-av.json",
    directoryPrefix: "upload-av-parent-symlink-",
    expectedFailure: "UPLOAD_AV_TARGET parent dizini symlink olmayan dizin olmali.",
  });
}

function runGithubCiSymlinkParentTargetNegativeCheck() {
  runSymlinkParentTargetNegativeCheck({
    label: "GitHub CI symlink parent target negative",
    fixture: githubCiFixture,
    scriptPath: "scripts/check-github-ci-evidence.mjs",
    targetEnvName: "GITHUB_CI_EVIDENCE_TARGET",
    allowEnvName: "GITHUB_CI_ALLOW_EXAMPLE_EVIDENCE",
    fileName: "github-ci.json",
    directoryPrefix: "github-ci-parent-symlink-",
    expectedFailure: "GITHUB_CI_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmali.",
  });
}

function runInlineUploadMigrationSymlinkParentTargetNegativeCheck() {
  runSymlinkParentTargetNegativeCheck({
    label: "inline upload migration symlink parent target negative",
    fixture: inlineUploadMigrationFixture,
    scriptPath: "scripts/check-inline-upload-content-migration-evidence.mjs",
    targetEnvName: "INLINE_UPLOAD_CONTENT_MIGRATION_TARGET",
    allowEnvName: "INLINE_UPLOAD_CONTENT_MIGRATION_ALLOW_EXAMPLE_EVIDENCE",
    fileName: "inline-upload-content-migration.json",
    directoryPrefix: "inline-upload-migration-parent-symlink-",
    expectedFailure: "INLINE_UPLOAD_CONTENT_MIGRATION_TARGET parent dizini symlink olmayan dizin olmali.",
  });
}

function runAuditNullTenantSymlinkParentTargetNegativeCheck() {
  runSymlinkParentTargetNegativeCheck({
    label: "audit null tenant symlink parent target negative",
    fixture: auditNullTenantFixture,
    scriptPath: "scripts/check-audit-null-tenant-evidence.mjs",
    targetEnvName: "AUDIT_NULL_TENANT_EVIDENCE_TARGET",
    allowEnvName: "AUDIT_NULL_TENANT_ALLOW_EXAMPLE_EVIDENCE",
    fileName: "audit-null-tenant.json",
    directoryPrefix: "audit-null-tenant-parent-symlink-",
    expectedFailure: "AUDIT_NULL_TENANT_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmali.",
  });
}

function runRateLimitSymlinkParentTargetNegativeCheck() {
  runSymlinkParentTargetNegativeCheck({
    label: "rate limit symlink parent target negative",
    fixture: rateLimitFixture,
    scriptPath: "scripts/check-rate-limit-evidence.mjs",
    targetEnvName: "RATE_LIMIT_EVIDENCE_TARGET",
    allowEnvName: "RATE_LIMIT_ALLOW_EXAMPLE_EVIDENCE",
    fileName: "rate-limit.json",
    directoryPrefix: "rate-limit-parent-symlink-",
    expectedFailure: "RATE_LIMIT_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmali.",
  });
}

function runLiveExamCycleNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(liveExamCycleFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-live-exam-cycle-evidence.mjs"], {
      env: {
        ...process.env,
        LIVE_EXAM_CYCLE_ALLOW_EXAMPLE_EVIDENCE: "1",
        LIVE_EXAM_CYCLE_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runLiveExamCycleSymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "live-exam-cycle-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const nestedDirectory = join(realDirectory, "nested");
  mkdirSync(nestedDirectory, { recursive: true });
  writeFileSync(join(nestedDirectory, "live-exam-cycle.json"), `${JSON.stringify(liveExamCycleFixture, null, 2)}\n`);
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(process.execPath, ["scripts/check-live-exam-cycle-evidence.mjs"], {
      env: {
        ...process.env,
        LIVE_EXAM_CYCLE_ALLOW_EXAMPLE_EVIDENCE: "1",
        LIVE_EXAM_CYCLE_TARGET: pathToFileURL(join(symlinkDirectory, "nested", "live-exam-cycle.json")).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: live exam cycle symlink parent target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("LIVE_EXAM_CYCLE_TARGET parent dizini symlink olmayan dizin olmali.")) {
      console.error("Production evidence template kontrolü başarısız: live exam cycle symlink parent target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runIsemOpticalPipelineLocalArtifactTargetNegativeCheck() {
  const localTargetPath = resolve("artifacts/local/isem-optical-pipeline-target-negative.json");
  const result = spawnSync(process.execPath, ["scripts/check-isem-optical-pipeline-evidence.mjs"], {
    env: {
      ...process.env,
      ISEM_OPTICAL_PIPELINE_ALLOW_EXAMPLE_EVIDENCE: "1",
      ISEM_OPTICAL_PIPELINE_TARGET: pathToFileURL(localTargetPath).href,
    },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: iSEM optical local artifact target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("ISEM_OPTICAL_PIPELINE_TARGET production kaniti icin artifacts/local altinda olmamali.")) {
    console.error("Production evidence template kontrolü başarısız: iSEM optical local artifact target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runRlsLiveLocalArtifactTargetNegativeCheck() {
  const localTargetPath = resolve("artifacts/local/rls-live-target-negative.json");
  const result = spawnSync(process.execPath, ["scripts/check-rls-live-evidence.mjs"], {
    env: {
      ...process.env,
      RLS_LIVE_ALLOW_EXAMPLE_EVIDENCE: "1",
      RLS_LIVE_EVIDENCE_TARGET: pathToFileURL(localTargetPath).href,
    },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: RLS live local artifact target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("RLS_LIVE_EVIDENCE_TARGET production kaniti icin artifacts/local altinda olmamali.")) {
    console.error("Production evidence template kontrolü başarısız: RLS live local artifact target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runRlsLiveSecretTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-rls-live-evidence.mjs"], {
    env: {
      ...process.env,
      RLS_LIVE_EVIDENCE_TARGET: "https://user:secret@evidence.o-okul.com/rls-live.json?token=secret#fragment",
    },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: RLS live secret target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("RLS_LIVE_EVIDENCE_TARGET userinfo, query veya fragment tasimamali.")) {
    console.error("Production evidence template kontrolü başarısız: RLS live secret target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runRlsLiveNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(rlsLiveFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-rls-live-evidence.mjs"], {
      env: {
        ...process.env,
        RLS_LIVE_ALLOW_EXAMPLE_EVIDENCE: "1",
        RLS_LIVE_EVIDENCE_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runRlsLiveSymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "rls-live-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const nestedDirectory = join(realDirectory, "nested");
  mkdirSync(nestedDirectory, { recursive: true });
  writeFileSync(join(nestedDirectory, "rls-live.json"), `${JSON.stringify(rlsLiveFixture, null, 2)}\n`);
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(process.execPath, ["scripts/check-rls-live-evidence.mjs"], {
      env: {
        ...process.env,
        RLS_LIVE_ALLOW_EXAMPLE_EVIDENCE: "1",
        RLS_LIVE_EVIDENCE_TARGET: pathToFileURL(join(symlinkDirectory, "nested", "rls-live.json")).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: RLS live symlink parent target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("RLS_LIVE_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmali.")) {
      console.error("Production evidence template kontrolü başarısız: RLS live symlink parent target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runUatNegativeCheck({ label, path, expectedFailure, mutate, allowExampleEvidence = true }) {
  const fixture = structuredClone(uatFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-uat-evidence.mjs"], {
      env: {
        ...process.env,
        ...(allowExampleEvidence ? { UAT_ALLOW_EXAMPLE_EVIDENCE: "1" } : {}),
        UAT_EVIDENCE_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runUatSecretTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-uat-evidence.mjs"], {
    env: {
      ...process.env,
      UAT_ALLOW_EXAMPLE_EVIDENCE: "1",
      UAT_EVIDENCE_TARGET: "https://user:secret@evidence.o-okul.com/uat.json?token=secret#fragment",
    },
    encoding: "utf8",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: UAT secret target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("UAT_EVIDENCE_TARGET userinfo, query veya fragment tasimamali.")) {
    console.error("Production evidence template kontrolü başarısız: UAT secret target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runUatSymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "uat-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const nestedDirectory = join(realDirectory, "nested");
  mkdirSync(nestedDirectory, { recursive: true });
  writeFileSync(join(nestedDirectory, "uat.json"), `${JSON.stringify(uatFixture, null, 2)}\n`);
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(process.execPath, ["scripts/check-uat-evidence.mjs"], {
      env: {
        ...process.env,
        UAT_ALLOW_EXAMPLE_EVIDENCE: "1",
        UAT_EVIDENCE_TARGET: pathToFileURL(join(symlinkDirectory, "nested", "uat.json")).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: UAT symlink parent target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("UAT_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmali.")) {
      console.error("Production evidence template kontrolü başarısız: UAT symlink parent target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runUatLocalArtifactTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-uat-evidence.mjs"], {
    env: {
      ...process.env,
      UAT_ALLOW_EXAMPLE_EVIDENCE: "1",
      UAT_EVIDENCE_TARGET: pathToFileURL(resolve("artifacts/local/uat-target-negative.json")).href,
    },
    encoding: "utf8",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: UAT local artifact target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("UAT_EVIDENCE_TARGET production kaniti icin artifacts/local altinda olmamali.")) {
    console.error("Production evidence template kontrolü başarısız: UAT local artifact target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runUatGeneratorLocalArtifactNegativeChecks() {
  const baseEnv = {
    ...process.env,
    STAGING_ENVIRONMENT: "staging",
    UAT_TESTER: "Ayse UAT",
    UAT_RELEASE_CANDIDATE: "ghcr.io/o-okul/api:2026-06-24.1",
    UAT_ROLLBACK_IMAGE_TAG: "ghcr.io/o-okul/api:2026-06-23.1",
    UAT_RESTORE_BACKUP_REFERENCE: "s3://uh-prod-backups/2026-06-24/base.dump",
  };
  const cases = [
    {
      label: "UAT generator local output negative",
      env: {
        UAT_OUTPUT: "artifacts/local/uat-output-negative.json",
        UAT_COMMAND_EVIDENCE_TARGET: pathToFileURL(resolve("artifacts/staging/uat/commands.json")).href,
        UAT_SCENARIOS_TARGET: pathToFileURL(resolve("artifacts/staging/uat/scenarios.json")).href,
      },
      expectedFailure: "UAT_OUTPUT artifacts/local altında olmamalı.",
    },
    {
      label: "UAT generator local command evidence negative",
      env: {
        UAT_OUTPUT: "artifacts/staging/reports/uat-generator-negative.json",
        UAT_COMMAND_EVIDENCE_TARGET: pathToFileURL(resolve("artifacts/local/uat/commands.json")).href,
        UAT_SCENARIOS_TARGET: pathToFileURL(resolve("artifacts/staging/uat/scenarios.json")).href,
      },
      expectedFailure: "UAT_COMMAND_EVIDENCE_TARGET temp veya artifacts/local altında olmamalı.",
    },
    {
      label: "UAT generator local scenarios negative",
      env: {
        UAT_OUTPUT: "artifacts/staging/reports/uat-generator-negative.json",
        UAT_COMMAND_EVIDENCE_TARGET: pathToFileURL(resolve("artifacts/staging/uat/commands.json")).href,
        UAT_SCENARIOS_TARGET: pathToFileURL(resolve("artifacts/local/uat/scenarios.json")).href,
      },
      expectedFailure: "UAT_SCENARIOS_TARGET temp veya artifacts/local altında olmamalı.",
    },
  ];

  for (const item of cases) {
    const result = spawnSync(process.execPath, ["scripts/generate-uat-evidence.mjs"], {
      env: {
        ...baseEnv,
        ...item.env,
      },
      encoding: "utf8",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${item.label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(item.expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${item.label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  }
}

function runPilotNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(pilotFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-pilot-evidence.mjs"], {
      env: {
        ...process.env,
        PILOT_ALLOW_EXAMPLE_EVIDENCE: "1",
        PILOT_EVIDENCE_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runPilotLocalArtifactTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-pilot-evidence.mjs"], {
    env: {
      ...process.env,
      PILOT_ALLOW_EXAMPLE_EVIDENCE: "1",
      PILOT_EVIDENCE_TARGET: pathToFileURL(resolve("artifacts/local/pilot-target-negative.json")).href,
    },
    encoding: "utf8",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: pilot local artifact target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("PILOT_EVIDENCE_TARGET production kaniti icin artifacts/local altinda olmamali.")) {
    console.error("Production evidence template kontrolü başarısız: pilot local artifact target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runPilotSecretUrlTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-pilot-evidence.mjs"], {
    env: {
      ...process.env,
      PILOT_ALLOW_EXAMPLE_EVIDENCE: "1",
      PILOT_EVIDENCE_TARGET: "https://ops:secret@evidence.o-okul.com/pilot.json?token=secret#proof",
    },
    encoding: "utf8",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: pilot secret URL target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("PILOT_EVIDENCE_TARGET production evidence target URL userinfo, query veya fragment içeremez.")) {
    console.error("Production evidence template kontrolü başarısız: pilot secret URL target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runPilotSymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "pilot-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const nestedDirectory = join(realDirectory, "nested");
  mkdirSync(nestedDirectory, { recursive: true });
  writeFileSync(join(nestedDirectory, "pilot.json"), `${JSON.stringify(pilotFixture, null, 2)}\n`);
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(process.execPath, ["scripts/check-pilot-evidence.mjs"], {
      env: {
        ...process.env,
        PILOT_ALLOW_EXAMPLE_EVIDENCE: "1",
        PILOT_EVIDENCE_TARGET: pathToFileURL(join(symlinkDirectory, "nested", "pilot.json")).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: pilot symlink parent target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("PILOT_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmali.")) {
      console.error("Production evidence template kontrolü başarısız: pilot symlink parent target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runDeploymentRollbackLocalArtifactTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-deployment-rollback-evidence.mjs"], {
    env: {
      ...process.env,
      DEPLOYMENT_ROLLBACK_ALLOW_EXAMPLE_EVIDENCE: "1",
      DEPLOYMENT_ROLLBACK_TARGET: pathToFileURL(resolve("artifacts/local/deployment-rollback-target-negative.json")).href,
    },
    encoding: "utf8",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.error(
      "Production evidence template kontrolü başarısız: deployment rollback local artifact target negative beklenen şekilde kırılmadı.",
    );
    process.exit(1);
  }
  if (!output.includes("DEPLOYMENT_ROLLBACK_TARGET production kaniti icin artifacts/local altinda olmamali.")) {
    console.error("Production evidence template kontrolü başarısız: deployment rollback local artifact target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runDeploymentRollbackNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(deploymentRollbackFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-deployment-rollback-evidence.mjs"], {
      env: {
        ...process.env,
        DEPLOYMENT_ROLLBACK_ALLOW_EXAMPLE_EVIDENCE: "1",
        DEPLOYMENT_ROLLBACK_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runDeploymentRollbackSecretTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-deployment-rollback-evidence.mjs"], {
    env: {
      ...process.env,
      DEPLOYMENT_ROLLBACK_ALLOW_EXAMPLE_EVIDENCE: "1",
      DEPLOYMENT_ROLLBACK_TARGET: "https://user:secret@evidence.o-okul.com/deployment-rollback.json?token=secret#fragment",
    },
    encoding: "utf8",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: deployment rollback secret target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("DEPLOYMENT_ROLLBACK_TARGET userinfo, query veya fragment tasimamali.")) {
    console.error("Production evidence template kontrolü başarısız: deployment rollback secret target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runDeploymentRollbackSymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "deployment-rollback-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const nestedDirectory = join(realDirectory, "nested");
  mkdirSync(nestedDirectory, { recursive: true });
  writeFileSync(join(nestedDirectory, "deployment-rollback.json"), `${JSON.stringify(deploymentRollbackFixture, null, 2)}\n`);
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(process.execPath, ["scripts/check-deployment-rollback-evidence.mjs"], {
      env: {
        ...process.env,
        DEPLOYMENT_ROLLBACK_ALLOW_EXAMPLE_EVIDENCE: "1",
        DEPLOYMENT_ROLLBACK_TARGET: pathToFileURL(join(symlinkDirectory, "nested", "deployment-rollback.json")).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: deployment rollback symlink parent target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("DEPLOYMENT_ROLLBACK_TARGET parent dizini symlink olmayan dizin olmali.")) {
      console.error("Production evidence template kontrolü başarısız: deployment rollback symlink parent target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runLiveStatusGenerationNegativeCheck({ label, sourcePath, outputPath, expectedFailure, source, mutate }) {
  const cleanupPaths = [sourcePath, outputPath];
  const summaryTarget = source === "summary" ? sourcePath : productionSummaryFixturePath;
  const pilotTarget = source === "pilot" ? sourcePath : pilotFixturePath;
  const goLiveTarget = source === "goLive" ? sourcePath : goLiveFixturePath;
  const fixture =
    source === "summary"
      ? structuredClone(productionSummaryFixture)
      : source === "pilot"
        ? structuredClone(pilotFixture)
        : structuredClone(goLiveFixture);

  mutate(fixture);
  writeFileSync(sourcePath, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/generate-live-status-evidence.mjs",
        "--summary-target",
        summaryTarget,
        "--go-live-target",
        goLiveTarget,
        "--pilot-target",
        pilotTarget,
        "--output",
        outputPath,
        "--readiness-path",
        liveStatusReadinessPath,
      ],
      {
        env: {
          ...process.env,
          LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE: "1",
        },
        encoding: "utf8",
      },
    );

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    for (const cleanupPath of cleanupPaths) {
      try {
        unlinkSync(cleanupPath);
      } catch {
        // Ignore cleanup errors; the negative-check failure above is the actionable signal.
      }
    }
  }
}

function runLiveStatusGeneratorHttpTargetNegativeCheck() {
  const outputPath = "docs/evidence-templates/live-status.http-source-target.tmp.json";

  try {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/generate-live-status-evidence.mjs",
        "--summary-target",
        "http://evidence.o-okul.com/production-summary.json",
        "--go-live-target",
        goLiveFixturePath,
        "--pilot-target",
        pilotFixturePath,
        "--output",
        outputPath,
        "--readiness-path",
        liveStatusReadinessPath,
      ],
      {
        env: {
          ...process.env,
          LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE: "1",
        },
        encoding: "utf8",
      },
    );

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: live status generator HTTP target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("PRODUCTION_EVIDENCE_SUMMARY_TARGET file:// veya https:// URL olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: live status generator HTTP target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(outputPath);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runLiveStatusGeneratorSymlinkTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "live-status-generator-symlink-"));
  const summaryLinkPath = join(root, "production-summary.json");
  const outputPath = join(root, "live-status.symlink-source-target.tmp.json");
  symlinkSync(resolve(productionSummaryFixturePath), summaryLinkPath);

  try {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/generate-live-status-evidence.mjs",
        "--summary-target",
        pathToFileURL(summaryLinkPath).href,
        "--go-live-target",
        goLiveFixturePath,
        "--pilot-target",
        pilotFixturePath,
        "--output",
        outputPath,
        "--readiness-path",
        liveStatusReadinessPath,
      ],
      {
        env: {
          ...process.env,
          LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE: "1",
        },
        encoding: "utf8",
      },
    );

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: live status generator symlink target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("Production evidence summary symlink olmayan file:// artifact olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: live status generator symlink target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runLiveStatusGeneratorSymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "live-status-generator-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const outputPath = join(root, "live-status.parent-symlink-source-target.tmp.json");
  const realNestedDirectory = join(realDirectory, "nested");
  mkdirSync(realNestedDirectory, { recursive: true });
  writeFileSync(join(realNestedDirectory, "production-summary.json"), readFileSync(productionSummaryFixturePath, "utf8"));
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/generate-live-status-evidence.mjs",
        "--summary-target",
        pathToFileURL(join(symlinkDirectory, "nested", "production-summary.json")).href,
        "--go-live-target",
        goLiveFixturePath,
        "--pilot-target",
        pilotFixturePath,
        "--output",
        outputPath,
        "--readiness-path",
        liveStatusReadinessPath,
      ],
      {
        env: {
          ...process.env,
          LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE: "1",
        },
        encoding: "utf8",
      },
    );

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(
        "Production evidence template kontrolü başarısız: live status generator symlink parent target negative beklenen şekilde kırılmadı.",
      );
      process.exit(1);
    }
    if (!output.includes("Production evidence summary parent dizini symlink olmayan dizin olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: live status generator symlink parent target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runLiveStatusGeneratorOutputTargetNegativeChecks() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "live-status-generator-output-"));
  const symlinkTargetPath = join(root, "live-status.real.json");
  const symlinkOutputPath = join(root, "live-status.symlink.json");
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  writeFileSync(symlinkTargetPath, "{}\n");
  symlinkSync(symlinkTargetPath, symlinkOutputPath);
  mkdirSync(realDirectory, { recursive: true });
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const tempResult = runLiveStatusGeneratorForOutput("/tmp/live-status-output-temp-negative.json");
    const tempOutput = `${tempResult.stdout ?? ""}${tempResult.stderr ?? ""}`;
    if (tempResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: live status generator output temp path negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!tempOutput.includes("LIVE_STATUS_EVIDENCE_OUTPUT lokal temp path olmamalı.")) {
      console.error("Production evidence template kontrolü başarısız: live status generator output temp path negative beklenen hata yok.");
      console.error(tempOutput);
      process.exit(1);
    }

    const localArtifactResult = runLiveStatusGeneratorForOutput("artifacts/local/live-status-output-negative.json");
    const localArtifactOutput = `${localArtifactResult.stdout ?? ""}${localArtifactResult.stderr ?? ""}`;
    if (localArtifactResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: live status generator output local artifact negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!localArtifactOutput.includes("LIVE_STATUS_EVIDENCE_OUTPUT artifacts/local altında olmamalı.")) {
      console.error("Production evidence template kontrolü başarısız: live status generator output local artifact negative beklenen hata yok.");
      console.error(localArtifactOutput);
      process.exit(1);
    }

    const symlinkResult = runLiveStatusGeneratorForOutput(symlinkOutputPath);
    const symlinkOutput = `${symlinkResult.stdout ?? ""}${symlinkResult.stderr ?? ""}`;
    if (symlinkResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: live status generator output symlink negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!symlinkOutput.includes("LIVE_STATUS_EVIDENCE_OUTPUT symlink olmayan file artifact olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: live status generator output symlink negative beklenen hata yok.");
      console.error(symlinkOutput);
      process.exit(1);
    }

    const symlinkParentResult = runLiveStatusGeneratorForOutput(join(symlinkDirectory, "nested", "live-status.json"));
    const symlinkParentOutput = `${symlinkParentResult.stdout ?? ""}${symlinkParentResult.stderr ?? ""}`;
    if (symlinkParentResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: live status generator output symlink parent negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!symlinkParentOutput.includes("LIVE_STATUS_EVIDENCE_OUTPUT parent dizini symlink olmayan dizin olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: live status generator output symlink parent negative beklenen hata yok.");
      console.error(symlinkParentOutput);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runLiveStatusEvidenceLocalArtifactTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-live-status-evidence.mjs"], {
    env: {
      ...process.env,
      LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE: "1",
      LIVE_STATUS_READINESS_PATH: liveStatusReadinessPath,
      LIVE_STATUS_EVIDENCE_TARGET: pathToFileURL(resolve("artifacts/local/live-status-target-negative.json")).href,
    },
    encoding: "utf8",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: live status local artifact target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("LIVE_STATUS_EVIDENCE_TARGET artifacts/local altında olmamalı.")) {
    console.error("Production evidence template kontrolü başarısız: live status local artifact target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runLiveStatusEvidenceSymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "live-status-evidence-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const realNestedDirectory = join(realDirectory, "nested");
  mkdirSync(realNestedDirectory, { recursive: true });
  writeFileSync(join(realNestedDirectory, "live-status.json"), readFileSync(liveStatusFixturePath, "utf8"));
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(process.execPath, ["scripts/check-live-status-evidence.mjs"], {
      env: {
        ...process.env,
        LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE: "1",
        LIVE_STATUS_READINESS_PATH: liveStatusReadinessPath,
        LIVE_STATUS_EVIDENCE_TARGET: pathToFileURL(join(symlinkDirectory, "nested", "live-status.json")).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: live status symlink parent target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("LIVE_STATUS_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: live status symlink parent target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runLiveStatusGeneratorForOutput(outputPath) {
  return spawnSync(
    process.execPath,
    [
      "scripts/generate-live-status-evidence.mjs",
      "--summary-target",
      productionSummaryFixturePath,
      "--go-live-target",
      goLiveFixturePath,
      "--pilot-target",
      pilotFixturePath,
      "--output",
      outputPath,
      "--readiness-path",
      liveStatusReadinessPath,
    ],
    {
      env: {
        ...process.env,
        LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE: "1",
      },
      encoding: "utf8",
    },
  );
}

function runGoLiveNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(goLiveFixture);
  const cleanupPaths = [path];
  mutate(fixture, cleanupPaths);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-go-live-evidence.mjs"], {
      env: {
        ...process.env,
        GO_LIVE_ALLOW_EXAMPLE_EVIDENCE: "1",
        GO_LIVE_EVIDENCE_TARGET: pathToFileURL(path).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    for (const cleanupPath of cleanupPaths) {
      try {
        unlinkSync(cleanupPath);
      } catch {
        // Ignore cleanup errors; the negative-check failure above is the actionable signal.
      }
    }
  }
}

function runGoLiveSecretUrlTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-go-live-evidence.mjs"], {
    env: {
      ...process.env,
      GO_LIVE_ALLOW_EXAMPLE_EVIDENCE: "1",
      GO_LIVE_EVIDENCE_TARGET: "https://ops:secret@evidence.o-okul.com/go-live.json?token=secret#proof",
    },
    encoding: "utf8",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: go-live secret URL target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("GO_LIVE_EVIDENCE_TARGET target URL userinfo, query veya fragment iceremez.")) {
    console.error("Production evidence template kontrolü başarısız: go-live secret URL target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runGoLiveLinkedLiveStatusLocalArtifactTargetNegativeCheck() {
  const goLivePath = "docs/evidence-templates/go-live.linked-live-status-local-artifact-target.tmp.json";
  const fixture = structuredClone(goLiveFixture);
  fixture.liveStatusEvidence.evidenceTarget = pathToFileURL(resolve("artifacts/local/live-status-for-go-live.json")).href;
  writeFileSync(goLivePath, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-go-live-evidence.mjs"], {
      env: {
        ...process.env,
        GO_LIVE_ALLOW_EXAMPLE_EVIDENCE: "1",
        GO_LIVE_EVIDENCE_TARGET: pathToFileURL(goLivePath).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(
        "Production evidence template kontrolü başarısız: go-live linked live-status local artifact target negative beklenen şekilde kırılmadı.",
      );
      process.exit(1);
    }
    if (!output.includes("liveStatusEvidence.evidenceTarget artifacts/local altinda olmamali.")) {
      console.error("Production evidence template kontrolü başarısız: go-live linked live-status local artifact target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(goLivePath);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
  }
}

function runGoLiveLinkedLiveStatusSymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "go-live-live-status-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const goLivePath = "docs/evidence-templates/go-live.linked-live-status-parent-symlink-target.tmp.json";
  const realNestedDirectory = join(realDirectory, "nested");
  mkdirSync(realNestedDirectory, { recursive: true });
  writeFileSync(join(realNestedDirectory, "live-status.json"), readFileSync(liveStatusFixturePath, "utf8"));
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  const fixture = structuredClone(goLiveFixture);
  fixture.liveStatusEvidence.evidenceTarget = pathToFileURL(join(symlinkDirectory, "nested", "live-status.json")).href;
  writeFileSync(goLivePath, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-go-live-evidence.mjs"], {
      env: {
        ...process.env,
        GO_LIVE_ALLOW_EXAMPLE_EVIDENCE: "1",
        GO_LIVE_EVIDENCE_TARGET: pathToFileURL(goLivePath).href,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(
        "Production evidence template kontrolü başarısız: go-live linked live-status symlink parent target negative beklenen şekilde kırılmadı.",
      );
      process.exit(1);
    }
    if (!output.includes("Live status evidence parent dizini symlink olmayan dizin olmali.")) {
      console.error("Production evidence template kontrolü başarısız: go-live linked live-status symlink parent target negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    try {
      unlinkSync(goLivePath);
    } catch {
      // Ignore cleanup errors; the negative-check failure above is the actionable signal.
    }
    rmSync(root, { recursive: true, force: true });
  }
}

function runStagingEvidenceEnvNegativeCheck() {
  const path = "docs/evidence-templates/staging-evidence.empty-required.tmp.env";
  const activationPath = "docs/evidence-templates/staging-evidence.activation.tmp.env";
  const activationLegacySourcePath = "docs/evidence-templates/staging-evidence.activation-legacy-source.tmp.env";
  const activationOriginMismatchPath = "docs/evidence-templates/staging-evidence.activation-origin-mismatch.tmp.env";
  const activationWhatsappPath = "docs/evidence-templates/staging-evidence.activation-whatsapp.tmp.env";
  const workflowPath = "docs/evidence-templates/staging-deploy.bad-order.tmp.yml";
  const contents = readFileSync("docs/evidence-templates/staging-evidence.env.example", "utf8").replace(
    /^S3_ACCESS_KEY_ID=.*$/m,
    "S3_ACCESS_KEY_ID=",
  );
  writeFileSync(path, contents);

  try {
    const activationContents = [
      "NODE_ENV=production",
      "SENTRY_ENVIRONMENT=staging",
      "WHATSAPP_ENABLED=false",
      "WEB_URL=https://staging.o-okul.com",
      "TRAEFIK_HTTPS_SMOKE_URL=https://staging.o-okul.com/health",
      "ALERT_WEBHOOK_URL=https://alerts.o-okul.com/staging",
      "ALERT_WEBHOOK_TOKEN=activation-alert-token-12345678901234567890",
      "",
    ].join("\n");
    writeFileSync(activationPath, activationContents);

    const activationResult = spawnSync(
      process.execPath,
      ["scripts/check-staging-evidence-env.mjs", "--mode", "activation", "--env-file", activationPath],
      { encoding: "utf8" },
    );
    const activationOutput = `${activationResult.stdout ?? ""}${activationResult.stderr ?? ""}`;
    if (activationResult.status !== 0 || !activationOutput.includes("Staging activation env değer kontrolü geçti.")) {
      console.error("Production evidence template kontrolü başarısız: activation env minimal sözleşmesi geçmedi.");
      console.error(activationOutput);
      process.exit(1);
    }

    writeFileSync(activationWhatsappPath, activationContents.replace("WHATSAPP_ENABLED=false", "WHATSAPP_ENABLED=true"));
    const activationWhatsappEnabledResult = spawnSync(
      process.execPath,
      ["scripts/check-staging-evidence-env.mjs", "--mode", "activation", "--env-file", activationWhatsappPath],
      { encoding: "utf8" },
    );
    const activationWhatsappEnabledOutput = `${activationWhatsappEnabledResult.stdout ?? ""}${activationWhatsappEnabledResult.stderr ?? ""}`;
    if (
      activationWhatsappEnabledResult.status === 0 ||
      !activationWhatsappEnabledOutput.includes("WHATSAPP_ENABLED activation için false olmalı.")
    ) {
      console.error("Production evidence template kontrolü başarısız: activation env enabled WhatsApp negative kırılmadı.");
      console.error(activationWhatsappEnabledOutput);
      process.exit(1);
    }

    writeFileSync(activationWhatsappPath, activationContents.replace(/^WHATSAPP_ENABLED=.*\n/m, ""));
    const activationWhatsappMissingResult = spawnSync(
      process.execPath,
      ["scripts/check-staging-evidence-env.mjs", "--mode", "activation", "--env-file", activationWhatsappPath],
      { encoding: "utf8" },
    );
    const activationWhatsappMissingOutput = `${activationWhatsappMissingResult.stdout ?? ""}${activationWhatsappMissingResult.stderr ?? ""}`;
    if (
      activationWhatsappMissingResult.status === 0 ||
      !activationWhatsappMissingOutput.includes("eksik env anahtarı: WHATSAPP_ENABLED")
    ) {
      console.error("Production evidence template kontrolü başarısız: activation env missing WhatsApp negative kırılmadı.");
      console.error(activationWhatsappMissingOutput);
      process.exit(1);
    }

    writeFileSync(activationOriginMismatchPath, activationContents.replace("WEB_URL=https://staging.o-okul.com", "WEB_URL=https://other.o-okul.com"));
    const activationOriginMismatchResult = spawnSync(
      process.execPath,
      ["scripts/check-staging-evidence-env.mjs", "--mode", "activation", "--env-file", activationOriginMismatchPath],
      { encoding: "utf8" },
    );
    const activationOriginMismatchOutput = `${activationOriginMismatchResult.stdout ?? ""}${activationOriginMismatchResult.stderr ?? ""}`;
    if (
      activationOriginMismatchResult.status === 0 ||
      !activationOriginMismatchOutput.includes("TRAEFIK_HTTPS_SMOKE_URL activation için WEB_URL origin'iyle eşleşmeli.")
    ) {
      console.error("Production evidence template kontrolü başarısız: activation env Traefik/Web origin negative kırılmadı.");
      console.error(activationOriginMismatchOutput);
      process.exit(1);
    }

    const activationFullResult = spawnSync(
      process.execPath,
      ["scripts/check-staging-evidence-env.mjs", "--mode", "full", "--env-file", activationPath],
      { encoding: "utf8" },
    );
    const activationFullOutput = `${activationFullResult.stdout ?? ""}${activationFullResult.stderr ?? ""}`;
    if (activationFullResult.status === 0 || !activationFullOutput.includes("SECRET_DELIVERY_OUTBOX_DATABASE_URL")) {
      console.error("Production evidence template kontrolü başarısız: full env sözleşmesi activation anahtarlarına düşürüldü.");
      console.error(activationFullOutput);
      process.exit(1);
    }

    writeFileSync(activationLegacySourcePath, `${activationContents}SECRET_DELIVERY_OUTBOX_SMOKE_SOURCE_ID=legacy-source-id\n`);
    const activationLegacySourceResult = spawnSync(
      process.execPath,
      ["scripts/check-staging-evidence-env.mjs", "--mode", "activation", "--env-file", activationLegacySourcePath],
      { encoding: "utf8" },
    );
    const activationLegacySourceOutput = `${activationLegacySourceResult.stdout ?? ""}${activationLegacySourceResult.stderr ?? ""}`;
    if (
      activationLegacySourceResult.status === 0 ||
      !activationLegacySourceOutput.includes("SECRET_DELIVERY_OUTBOX_SMOKE_SOURCE_ID içermemeli")
    ) {
      console.error("Production evidence template kontrolü başarısız: activation env legacy outbox source negative kırılmadı.");
      console.error(activationLegacySourceOutput);
      process.exit(1);
    }

    const result = spawnSync(process.execPath, ["scripts/check-staging-evidence-env.mjs", "--env-file", path], {
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging env empty required negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("boş env değeri içeriyor: S3_ACCESS_KEY_ID")) {
      console.error("Production evidence template kontrolü başarısız: staging env empty required negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }

    const missingAuditNullPath = "docs/evidence-templates/staging-evidence.missing-audit-null-tenant.tmp.env";
    writeFileSync(
      missingAuditNullPath,
      readFileSync("docs/evidence-templates/staging-evidence.env.example", "utf8").replace(
        /^AUDIT_NULL_TENANT_EVIDENCE_TARGET=.*\n?/m,
        "",
      ),
    );
    const missingAuditNullResult = spawnSync(
      process.execPath,
      ["scripts/check-staging-evidence-env.mjs", "--env-file", missingAuditNullPath],
      { encoding: "utf8" },
    );
    const missingAuditNullOutput = `${missingAuditNullResult.stdout ?? ""}${missingAuditNullResult.stderr ?? ""}`;
    if (missingAuditNullResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging env missing audit null tenant negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!missingAuditNullOutput.includes("eksik env anahtarı: AUDIT_NULL_TENANT_EVIDENCE_TARGET")) {
      console.error("Production evidence template kontrolü başarısız: staging env missing audit null tenant negative beklenen hata yok.");
      console.error(missingAuditNullOutput);
      process.exit(1);
    }

    const missingUiWorkerResultPath = "docs/evidence-templates/staging-evidence.missing-ui-worker-result.tmp.env";
    writeFileSync(
      missingUiWorkerResultPath,
      readFileSync("docs/evidence-templates/staging-evidence.env.example", "utf8").replace(
        /^LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET=.*\n?/m,
        "",
      ),
    );
    const missingUiWorkerResult = spawnSync(
      process.execPath,
      ["scripts/check-staging-evidence-env.mjs", "--env-file", missingUiWorkerResultPath],
      { encoding: "utf8" },
    );
    const missingUiWorkerResultOutput = `${missingUiWorkerResult.stdout ?? ""}${missingUiWorkerResult.stderr ?? ""}`;
    if (missingUiWorkerResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging env missing UI-worker result negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!missingUiWorkerResultOutput.includes("eksik env anahtarı: LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET")) {
      console.error("Production evidence template kontrolü başarısız: staging env missing UI-worker result negative beklenen hata yok.");
      console.error(missingUiWorkerResultOutput);
      process.exit(1);
    }

    const defaultedSmokePath = "docs/evidence-templates/staging-evidence.defaulted-smoke.tmp.env";
    writeFileSync(
      defaultedSmokePath,
      `${readFileSync("docs/evidence-templates/staging-evidence.env.example", "utf8")}\nREPORT_GENERATION_SMOKE_EVIDENCE_FILE=artifacts/staging/smoke/report-generation.json\n`,
    );
    const defaultedSmokeResult = spawnSync(process.execPath, ["scripts/check-staging-evidence-env.mjs", "--env-file", defaultedSmokePath], {
      encoding: "utf8",
    });
    const defaultedSmokeOutput = `${defaultedSmokeResult.stdout ?? ""}${defaultedSmokeResult.stderr ?? ""}`;
    if (defaultedSmokeResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging env defaulted smoke negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!defaultedSmokeOutput.includes("REPORT_GENERATION_SMOKE_EVIDENCE_FILE içermemeli; workflow veya --summary-file bu değeri üretir.")) {
      console.error("Production evidence template kontrolü başarısız: staging env defaulted smoke negative beklenen hata yok.");
      console.error(defaultedSmokeOutput);
      process.exit(1);
    }

    const legacySourcePath = "docs/evidence-templates/staging-evidence.legacy-outbox-source.tmp.env";
    writeFileSync(
      legacySourcePath,
      `${readFileSync("docs/evidence-templates/staging-evidence.env.example", "utf8")}\nSECRET_DELIVERY_OUTBOX_SMOKE_SOURCE_ID=legacy-source-id\n`,
    );
    const legacySourceResult = spawnSync(
      process.execPath,
      ["scripts/check-staging-evidence-env.mjs", "--env-file", legacySourcePath],
      { encoding: "utf8" },
    );
    const legacySourceOutput = `${legacySourceResult.stdout ?? ""}${legacySourceResult.stderr ?? ""}`;
    if (legacySourceResult.status === 0 || !legacySourceOutput.includes("SECRET_DELIVERY_OUTBOX_SMOKE_SOURCE_ID içermemeli")) {
      console.error("Production evidence template kontrolü başarısız: legacy outbox source staging secret negative kırılmadı.");
      console.error(legacySourceOutput);
      process.exit(1);
    }

    const workflow = readFileSync(".github/workflows/staging-deploy.yml", "utf8");
    const cleanupBlock = `      - name: Cleanup staging evidence env
        if: always()
        shell: bash
        run: rm -f .staging-evidence.env`;
    const uploadBlock = `      - uses: actions/upload-artifact@v4
        if: \${{ success() }}
        with:
          name: staging-deployment-cutover-\${{ github.run_id }}
          path: artifacts/staging/reports/deployment-cutover.json
          if-no-files-found: error

      - uses: actions/upload-artifact@v4
        if: \${{ always() }}
        with:
          name: staging-activation-evidence-\${{ needs.build-images.outputs.image-tag }}
          path: artifacts/staging
          if-no-files-found: ignore`;
    const expectedSequence = `${cleanupBlock}\n\n${uploadBlock}`;
    if (!workflow.includes(expectedSequence)) {
      console.error("Production evidence template kontrolü başarısız: staging workflow cleanup/upload fixture bulunamadı.");
      process.exit(1);
    }
    writeFileSync(workflowPath, workflow.replace(expectedSequence, `${uploadBlock}\n\n${cleanupBlock}`));
    const orderResult = spawnSync(process.execPath, ["scripts/check-staging-evidence-env.mjs"], {
      env: {
        ...process.env,
        STAGING_DEPLOY_WORKFLOW_PATH: workflowPath,
      },
      encoding: "utf8",
    });
    const orderOutput = `${orderResult.stdout ?? ""}${orderResult.stderr ?? ""}`;
    if (orderResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging workflow order negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!orderOutput.includes("staging evidence bundle order sırası bozuk veya eksik")) {
      console.error("Production evidence template kontrolü başarısız: staging workflow order negative beklenen hata yok.");
      console.error(orderOutput);
      process.exit(1);
    }
  } finally {
    for (const cleanupPath of [
      path,
      activationPath,
      activationLegacySourcePath,
      activationOriginMismatchPath,
      activationWhatsappPath,
      "docs/evidence-templates/staging-evidence.missing-audit-null-tenant.tmp.env",
      "docs/evidence-templates/staging-evidence.missing-ui-worker-result.tmp.env",
      "docs/evidence-templates/staging-evidence.defaulted-smoke.tmp.env",
      "docs/evidence-templates/staging-evidence.legacy-outbox-source.tmp.env",
      workflowPath,
    ]) {
      try {
        unlinkSync(cleanupPath);
      } catch {
        // Ignore cleanup errors; the negative-check failure above is the actionable signal.
      }
    }
  }
}

function runStagingFirstGatesFixtureCheck() {
  const manifestPath = "docs/evidence-templates/staging-first-gates/first-gates-manifest.json";
  const result = spawnSync(process.execPath, ["scripts/check-staging-first-gates-evidence.mjs", "--manifest", manifestPath], {
    env: process.env,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    console.error("Production evidence template kontrolü başarısız: staging first-gates fixture geçmedi.");
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
}

function runStagingFirstGatesTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "staging-first-gates-target-negative-"));
  const symlinkParentRoot = mkdtempSync(join(rootParent, "staging-first-gates-target-parent-symlink-"));
  const symlinkParent = join(symlinkParentRoot, "link");
  symlinkSync(resolve("docs/evidence-templates/staging-first-gates"), symlinkParent, "dir");

  try {
    const tempPath = "/tmp/staging-first-gates-manifest-target-negative.json";
    writeFileSync(tempPath, readFileSync("docs/evidence-templates/staging-first-gates/first-gates-manifest.json", "utf8"));
    const tempResult = runStagingFirstGatesTargetNegative(pathToFileURL(tempPath).href);
    const tempOutput = `${tempResult.stdout ?? ""}${tempResult.stderr ?? ""}`;
    if (tempResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates target temp path negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!tempOutput.includes("STAGING_FIRST_GATES_TARGET lokal temp path olmamalı.")) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates target temp path negative beklenen hata yok.");
      console.error(tempOutput);
      process.exit(1);
    }
    unlinkSync(tempPath);

    const localTargetResult = runStagingFirstGatesTargetNegative(pathToFileURL(resolve("artifacts/local/first-gates/first-gates-manifest.json")).href);
    const localTargetOutput = `${localTargetResult.stdout ?? ""}${localTargetResult.stderr ?? ""}`;
    if (localTargetResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates target local artifact negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!localTargetOutput.includes("STAGING_FIRST_GATES_TARGET artifacts/local altında olmamalı.")) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates target local artifact negative beklenen hata yok.");
      console.error(localTargetOutput);
      process.exit(1);
    }

    const realManifest = join(root, "real-manifest.json");
    const symlinkManifest = join(root, "manifest-link.json");
    writeFileSync(realManifest, readFileSync("docs/evidence-templates/staging-first-gates/first-gates-manifest.json", "utf8"));
    symlinkSync(realManifest, symlinkManifest);
    const symlinkResult = runStagingFirstGatesTargetNegative(pathToFileURL(symlinkManifest).href);
    const symlinkOutput = `${symlinkResult.stdout ?? ""}${symlinkResult.stderr ?? ""}`;
    if (symlinkResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates target symlink negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!symlinkOutput.includes("STAGING_FIRST_GATES_TARGET symlink olmayan file artifact olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates target symlink negative beklenen hata yok.");
      console.error(symlinkOutput);
      process.exit(1);
    }

    const symlinkParentResult = runStagingFirstGatesTargetNegative(pathToFileURL(join(symlinkParent, "first-gates-manifest.json")).href);
    const symlinkParentOutput = `${symlinkParentResult.stdout ?? ""}${symlinkParentResult.stderr ?? ""}`;
    if (symlinkParentResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates target symlink parent negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!symlinkParentOutput.includes("STAGING_FIRST_GATES_TARGET parent dizini symlink olmayan dizin olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates target symlink parent negative beklenen hata yok.");
      console.error(symlinkParentOutput);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(symlinkParentRoot, { recursive: true, force: true });
    rmSync("/tmp/staging-first-gates-manifest-target-negative.json", { force: true });
  }
}

function runStagingFirstGatesTargetNegative(target) {
  return spawnSync(process.execPath, ["scripts/check-staging-first-gates-evidence.mjs"], {
    env: {
      ...process.env,
      STAGING_FIRST_GATES_TARGET: target,
    },
    encoding: "utf8",
  });
}

function runStagingFirstGatesOutputDirNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const unexpectedRoot = mkdtempSync(join(rootParent, "staging-first-gates-output-unexpected-"));
  const symlinkRoot = mkdtempSync(join(rootParent, "staging-first-gates-output-symlink-"));
  const realDirectory = mkdtempSync(join(rootParent, "staging-first-gates-output-real-parent-"));
  const symlinkParentRoot = mkdtempSync(join(rootParent, "staging-first-gates-output-symlink-parent-"));
  const symlinkParent = join(symlinkParentRoot, "link");
  symlinkSync(realDirectory, symlinkParent, "dir");

  try {
    const tempResult = spawnSync(
      process.execPath,
      ["scripts/run-staging-first-gate-smokes.mjs", "--output-dir", "/tmp/staging-first-gates-output-temp-negative"],
      {
        env: process.env,
        encoding: "utf8",
      },
    );
    const tempOutput = `${tempResult.stdout ?? ""}${tempResult.stderr ?? ""}`;
    if (tempResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates output-dir temp path negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!tempOutput.includes("staging:first-gates:smoke output-dir lokal temp path olmamalı.")) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates output-dir temp path negative beklenen hata yok.");
      console.error(tempOutput);
      process.exit(1);
    }

    const localOutputResult = spawnSync(
      process.execPath,
      ["scripts/run-staging-first-gate-smokes.mjs", "--output-dir", "artifacts/local/first-gates-output-negative"],
      {
        env: process.env,
        encoding: "utf8",
      },
    );
    const localOutput = `${localOutputResult.stdout ?? ""}${localOutputResult.stderr ?? ""}`;
    if (localOutputResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates output-dir local artifact negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!localOutput.includes("staging:first-gates:smoke output-dir artifacts/local altında olmamalı.")) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates output-dir local artifact negative beklenen hata yok.");
      console.error(localOutput);
      process.exit(1);
    }

    writeFileSync(join(unexpectedRoot, "unexpected.json"), "{}\n");
    const unexpectedResult = spawnSync(
      process.execPath,
      ["scripts/run-staging-first-gate-smokes.mjs", "--output-dir", unexpectedRoot],
      {
        env: process.env,
        encoding: "utf8",
      },
    );
    const unexpectedOutput = `${unexpectedResult.stdout ?? ""}${unexpectedResult.stderr ?? ""}`;
    if (unexpectedResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates output-dir unexpected file negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!unexpectedOutput.includes("staging:first-gates:smoke output-dir beklenmeyen dosya içeriyor: unexpected.json")) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates output-dir unexpected file negative beklenen hata yok.");
      console.error(unexpectedOutput);
      process.exit(1);
    }

    symlinkSync("/dev/null", join(symlinkRoot, "traefik-https.json"));
    const symlinkResult = spawnSync(
      process.execPath,
      ["scripts/run-staging-first-gate-smokes.mjs", "--output-dir", symlinkRoot],
      {
        env: process.env,
        encoding: "utf8",
      },
    );
    const symlinkOutput = `${symlinkResult.stdout ?? ""}${symlinkResult.stderr ?? ""}`;
    if (symlinkResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates output-dir symlink negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!symlinkOutput.includes("staging:first-gates:smoke output-dir symlink içermemeli: traefik-https.json")) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates output-dir symlink negative beklenen hata yok.");
      console.error(symlinkOutput);
      process.exit(1);
    }

    const symlinkParentResult = spawnSync(
      process.execPath,
      ["scripts/run-staging-first-gate-smokes.mjs", "--output-dir", join(symlinkParent, "nested")],
      {
        env: process.env,
        encoding: "utf8",
      },
    );
    const symlinkParentOutput = `${symlinkParentResult.stdout ?? ""}${symlinkParentResult.stderr ?? ""}`;
    if (symlinkParentResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates output-dir symlink parent negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!symlinkParentOutput.includes("staging:first-gates:smoke output-dir symlink olmayan dizin olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates output-dir symlink parent negative beklenen hata yok.");
      console.error(symlinkParentOutput);
      process.exit(1);
    }
  } finally {
    rmSync(unexpectedRoot, { recursive: true, force: true });
    rmSync(symlinkRoot, { recursive: true, force: true });
    rmSync(symlinkParentRoot, { recursive: true, force: true });
    rmSync(realDirectory, { recursive: true, force: true });
  }
}

function runGithubCiGeneratorOutputNegativeChecks() {
  const root = resolve("artifacts/prod-evidence-template-check/github-ci-generator-output-negative");
  const tempOutputPath = "/tmp/github-ci-evidence-output-temp-negative.json";
  rmSync(root, { recursive: true, force: true });
  rmSync(tempOutputPath, { force: true });
  mkdirSync(root, { recursive: true });

  try {
    const tempResult = runGithubCiGeneratorOutputNegative(tempOutputPath);
    const tempOutput = `${tempResult.stdout ?? ""}${tempResult.stderr ?? ""}`;
    if (tempResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: GitHub CI generator output temp path negative kırılmadı.");
      process.exit(1);
    }
    if (!tempOutput.includes("GITHUB_CI_EVIDENCE_OUTPUT lokal temp path olmamalı.")) {
      console.error("Production evidence template kontrolü başarısız: GitHub CI generator output temp path negative beklenen hata yok.");
      console.error(tempOutput);
      process.exit(1);
    }

    const realFile = join(root, "real.json");
    const symlinkFile = join(root, "symlink.json");
    writeFileSync(realFile, "{}\n");
    symlinkSync(realFile, symlinkFile);
    const symlinkFileResult = runGithubCiGeneratorOutputNegative(symlinkFile);
    const symlinkFileOutput = `${symlinkFileResult.stdout ?? ""}${symlinkFileResult.stderr ?? ""}`;
    if (symlinkFileResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: GitHub CI generator output symlink file negative kırılmadı.");
      process.exit(1);
    }
    if (!symlinkFileOutput.includes("GITHUB_CI_EVIDENCE_OUTPUT symlink olmayan file artifact olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: GitHub CI generator output symlink file negative beklenen hata yok.");
      console.error(symlinkFileOutput);
      process.exit(1);
    }

    const realDirectory = join(root, "real-dir");
    const symlinkDirectory = join(root, "symlink-dir");
    mkdirSync(realDirectory, { recursive: true });
    symlinkSync(realDirectory, symlinkDirectory, "dir");
    const symlinkParentResult = runGithubCiGeneratorOutputNegative(join(symlinkDirectory, "nested", "github-ci.json"));
    const symlinkParentOutput = `${symlinkParentResult.stdout ?? ""}${symlinkParentResult.stderr ?? ""}`;
    if (symlinkParentResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: GitHub CI generator output symlink parent negative kırılmadı.");
      process.exit(1);
    }
    if (!symlinkParentOutput.includes("GITHUB_CI_EVIDENCE_OUTPUT parent dizini symlink olmayan dizin olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: GitHub CI generator output symlink parent negative beklenen hata yok.");
      console.error(symlinkParentOutput);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(tempOutputPath, { force: true });
  }
}

function runGithubCiGeneratorOutputNegative(outputPath) {
  return spawnSync(process.execPath, ["scripts/generate-github-ci-evidence.mjs"], {
    env: {
      ...process.env,
      GITHUB_API_URL: "http://127.0.0.1:9",
      GITHUB_TOKEN: "mock-token",
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
      GITHUB_CI_EVIDENCE_OUTPUT: outputPath,
    },
    encoding: "utf8",
  });
}

function runInlineUploadMigrationReportOutputNegativeChecks() {
  const root = resolve("artifacts/prod-evidence-template-check/inline-upload-migration-report-output-negative");
  const tempOutputPath = "/tmp/inline-upload-migration-report-output-temp-negative.json";
  rmSync(root, { recursive: true, force: true });
  rmSync(tempOutputPath, { force: true });
  mkdirSync(root, { recursive: true });

  try {
    const tempResult = runInlineUploadMigrationReportOutputNegative(tempOutputPath);
    const tempOutput = `${tempResult.stdout ?? ""}${tempResult.stderr ?? ""}`;
    if (tempResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: inline upload migration report output temp path negative kırılmadı.");
      process.exit(1);
    }
    if (!tempOutput.includes("INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE lokal temp path olmamalı.")) {
      console.error("Production evidence template kontrolü başarısız: inline upload migration report output temp path negative beklenen hata yok.");
      console.error(tempOutput);
      process.exit(1);
    }

    const realFile = join(root, "real.json");
    const symlinkFile = join(root, "symlink.json");
    writeFileSync(realFile, "{}\n");
    symlinkSync(realFile, symlinkFile);
    const symlinkFileResult = runInlineUploadMigrationReportOutputNegative(symlinkFile);
    const symlinkFileOutput = `${symlinkFileResult.stdout ?? ""}${symlinkFileResult.stderr ?? ""}`;
    if (symlinkFileResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: inline upload migration report output symlink file negative kırılmadı.");
      process.exit(1);
    }
    if (!symlinkFileOutput.includes("INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE symlink olmayan file artifact olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: inline upload migration report output symlink file negative beklenen hata yok.");
      console.error(symlinkFileOutput);
      process.exit(1);
    }

    const realDirectory = join(root, "real-dir");
    const symlinkDirectory = join(root, "symlink-dir");
    const realNestedDirectory = join(realDirectory, "nested");
    mkdirSync(realNestedDirectory, { recursive: true });
    symlinkSync(realDirectory, symlinkDirectory, "dir");
    const symlinkParentResult = runInlineUploadMigrationReportOutputNegative(join(symlinkDirectory, "nested", "report.json"));
    const symlinkParentOutput = `${symlinkParentResult.stdout ?? ""}${symlinkParentResult.stderr ?? ""}`;
    if (symlinkParentResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: inline upload migration report output symlink parent negative kırılmadı.");
      process.exit(1);
    }
    if (!symlinkParentOutput.includes("INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE parent dizini symlink olmayan dizin olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: inline upload migration report output symlink parent negative beklenen hata yok.");
      console.error(symlinkParentOutput);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(tempOutputPath, { force: true });
  }
}

function runInlineUploadMigrationReportOutputNegative(outputPath) {
  return spawnSync(process.execPath, ["scripts/migrate-inline-upload-content-to-s3-live.mjs"], {
    env: {
      ...process.env,
      INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE: outputPath,
    },
    encoding: "utf8",
  });
}

function runStagingReleaseArtifactsBundleCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "staging-release-artifacts-"));
  const reportsDir = `${root}/reports`;
  const smokeDir = `${root}/smoke`;
  const firstGatesDir = `${root}/first-gates`;
  const evidenceTime = new Date(Date.now() - 120_000).toISOString();
  const summaryTime = new Date(Date.now() - 60_000).toISOString();

  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(smokeDir, { recursive: true });
  mkdirSync(firstGatesDir, { recursive: true });

  try {
    const summary = normalizeDateStrings(
      JSON.parse(readFileSync("docs/evidence-templates/production-evidence-summary.example.json", "utf8")),
      evidenceTime,
    );
    summary.generatedAt = summaryTime;
    summary.webUrl = "https://staging.o-okul.com";
    summary.appUrl = "https://staging.o-okul.com";
    summary.apiUrl = "https://staging-api.o-okul.com";
    summary.smokeEvidence.traefikHttps.url = "https://staging.o-okul.com/health";
    summary.smokeEvidence.alertWebhook.webhookUrl = "https://alerts.o-okul.com/hooks/staging";
    summary.reports.liveExamCycle.appUrl = summary.appUrl;
    summary.reports.liveExamCycle.apiUrl = summary.apiUrl;
    for (const monitor of summary.reports.externalMonitoring.monitorsVerified) {
      if (monitor.name === "API /health") monitor.url = `${summary.webUrl}/health`;
      if (monitor.name === "API /health/ready") monitor.url = `${summary.webUrl}/health/ready`;
      if (monitor.name === "Web login") monitor.url = `${summary.webUrl}/login`;
      if (monitor.name === "Traefik TLS certificate") monitor.url = `${summary.webUrl}/`;
    }

    const releaseSummaryPath = `${root}/release-summary-${"1".repeat(40)}.json`;
    writeFileSync(releaseSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    for (const [key, file] of Object.entries({
      restoreDrill: "restore-drill.example.json",
      deploymentRollback: "deployment-rollback.example.json",
      githubCi: "github-ci.example.json",
      kvkkInventory: "kvkk-inventory.example.json",
      identityMigration: "identity-migration.example.json",
      financialRetention: "financial-retention.example.json",
      uploadAv: "upload-av.example.json",
      observabilityUat: "observability-uat.example.json",
      externalMonitoring: "external-monitoring.example.json",
      adminMfa: "admin-mfa.example.json",
      securityAudit: "security-audit.example.json",
      liveExamCycle: "live-exam-cycle.example.json",
      isemOpticalPipeline: "isem-optical-pipeline.example.json",
      liveUiWorkerResult: "live-ui-worker-result.example.json",
      uiUxRedesign: "ui-ux-redesign.example.json",
      inlineUploadMigration: "inline-upload-content-migration.example.json",
      auditNullTenant: "audit-null-tenant.example.json",
      rateLimit: "rate-limit.example.json",
      rlsLive: "rls-live.example.json",
      uat: "uat.example.json",
    })) {
      const examplePayload = normalizeDateStrings(JSON.parse(readFileSync(`docs/evidence-templates/${file}`, "utf8")), evidenceTime);
      const summaryReport = summary.reports[key] ?? {};
      const summaryOverlay =
        key === "uat"
          ? Object.fromEntries(Object.entries(summaryReport).filter(([field]) => field !== "liveExamCyclePassed"))
          : summaryReport;
      const payload = { ...examplePayload, ...summaryOverlay };
      if (key === "deploymentRollback") {
        const checkedAtMs = Date.parse(payload.checkedAt);
        payload.drillStartedAt = new Date(checkedAtMs - 15 * 60 * 1000).toISOString();
        payload.drillCompletedAt = new Date(checkedAtMs - 5 * 60 * 1000).toISOString();
      }
      const targetFile = key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
      const artifactFile =
        key === "inlineUploadMigration" ? "inline-upload-content-migration" : key === "githubCi" ? "github-ci" : targetFile;
      writeFileSync(`${reportsDir}/${artifactFile}.json`, `${JSON.stringify(payload, null, 2)}\n`);
    }
    for (const [key, file] of Object.entries({
      traefikHttps: "traefik-https.json",
      smsProvider: "sms-provider.json",
      notificationProvider: "notification-provider.json",
      sentryEvent: "sentry-event.json",
      alertWebhook: "alert-webhook.json",
      walArchive: "wal-archive.json",
      reportGeneration: "report-generation.json",
      secretDeliveryOutbox: "secret-delivery-outbox.json",
    })) {
      writeFileSync(`${smokeDir}/${file}`, `${JSON.stringify(summary.smokeEvidence[key], null, 2)}\n`);
    }

    writeFileSync(
      `${reportsDir}/github-ci.json`,
      `${JSON.stringify({ result: "PASS", ...summary.reports.githubCi, gaps: [] }, null, 2)}\n`,
    );
    const cutover = normalizeDateStrings(
      JSON.parse(readFileSync("docs/evidence-templates/deployment-cutover.example.json", "utf8")),
      evidenceTime,
    );
    cutover.sourceSha = summary.reports.githubCi.commitSha;
    cutover.releaseImageTag = summary.smokeEvidence.secretDeliveryOutbox.releaseImageTag;
    cutover.repository = summary.reports.githubCi.repository;
    cutover.cutoverAt = summary.smokeEvidence.secretDeliveryOutbox.notBefore;
    cutover.serviceImages = Object.fromEntries(
      Object.keys(cutover.serviceImages).map((service) => [
        service,
        `ghcr.io/${cutover.repository}/${service}:${cutover.releaseImageTag}`,
      ]),
    );
    writeFileSync(`${reportsDir}/deployment-cutover.json`, `${JSON.stringify(cutover, null, 2)}\n`);

    const firstGatePayloads = {
      "traefik-https.json": {
        generatedAt: evidenceTime,
        result: "PASS",
        check: "traefik_https_smoke",
        environment: summary.smokeEvidence.traefikHttps.environment,
        checkedAt: evidenceTime,
        url: summary.smokeEvidence.traefikHttps.url,
        expectedStatus: summary.smokeEvidence.traefikHttps.expectedStatus,
        statusCode: summary.smokeEvidence.traefikHttps.statusCode,
        strictTransportSecurity: summary.smokeEvidence.traefikHttps.strictTransportSecurity,
        commandsPassed: ["pnpm traefik:https:smoke"],
        gaps: [],
      },
      "alert-webhook.json": {
        generatedAt: evidenceTime,
        result: "PASS",
        check: "alert_webhook_smoke",
        environment: summary.smokeEvidence.alertWebhook.environment,
        checkedAt: evidenceTime,
        webhookUrl: summary.smokeEvidence.alertWebhook.webhookUrl,
        statusCode: summary.smokeEvidence.alertWebhook.statusCode,
        authorizationScheme: summary.smokeEvidence.alertWebhook.authorizationScheme,
        commandsPassed: ["pnpm alert:webhook:smoke"],
        gaps: [],
      },
    };
    for (const [file, payload] of Object.entries(firstGatePayloads)) {
      writeFileSync(`${firstGatesDir}/${file}`, `${JSON.stringify(payload, null, 2)}\n`);
    }
    writeFileSync(
      `${firstGatesDir}/first-gates-manifest.json`,
      `${JSON.stringify(
        {
          result: "PASS",
          generatedAt: evidenceTime,
          environment: summary.smokeEvidence.traefikHttps.environment,
          checks: [
            {
              label: "Traefik HTTPS smoke",
              script: "scripts/smoke-traefik-https.mjs",
              evidenceFile: "traefik-https.json",
              status: "PASS",
            },
            {
              label: "Alert webhook smoke",
              script: "scripts/smoke-alert-webhook.mjs",
              evidenceFile: "alert-webhook.json",
              status: "PASS",
            },
          ],
          commandsPassed: ["pnpm staging:first-gates:smoke"],
          gaps: [],
        },
        null,
        2,
      )}\n`,
    );

    const positive = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
      env: {
        ...process.env,
        STAGING_RELEASE_ARTIFACTS_TARGET: root,
        STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
      },
      encoding: "utf8",
    });
    if (positive.status !== 0) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact bundle fixture geçmedi.");
      console.error(positive.stdout);
      console.error(positive.stderr);
      process.exit(positive.status ?? 1);
    }

    const deploymentCutoverPath = `${reportsDir}/deployment-cutover.json`;
    const originalDeploymentCutover = readFileSync(deploymentCutoverPath, "utf8");
    try {
      const mismatchedDeploymentCutover = JSON.parse(originalDeploymentCutover);
      mismatchedDeploymentCutover.sourceSha = "2".repeat(40);
      writeFileSync(deploymentCutoverPath, `${JSON.stringify(mismatchedDeploymentCutover, null, 2)}\n`);
      const cutoverBindingNegative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
        env: {
          ...process.env,
          STAGING_RELEASE_ARTIFACTS_TARGET: root,
          STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
        },
        encoding: "utf8",
      });
      const cutoverBindingOutput = `${cutoverBindingNegative.stdout ?? ""}${cutoverBindingNegative.stderr ?? ""}`;
      if (cutoverBindingNegative.status === 0) {
        console.error("Production evidence template kontrolü başarısız: staging release cutover SHA binding negative kırılmadı.");
        process.exit(1);
      }
      if (!cutoverBindingOutput.includes("reports/deployment-cutover.json.sourceSha, summary.reports.uiUxRedesign.sourceCommitSha ve summary.reports.githubCi.commitSha aynı SHA olmalı.")) {
        console.error("Production evidence template kontrolü başarısız: staging release cutover SHA binding beklenen hata yok.");
        console.error(cutoverBindingOutput);
        process.exit(1);
      }
    } finally {
      writeFileSync(deploymentCutoverPath, originalDeploymentCutover);
    }

    const originalSummary = readFileSync(releaseSummaryPath, "utf8");
    const githubCiReportPath = `${reportsDir}/github-ci.json`;
    const originalGithubCiReport = readFileSync(githubCiReportPath, "utf8");
    try {
      const mismatchedSummary = JSON.parse(originalSummary);
      const mismatchedGithubCiReport = JSON.parse(originalGithubCiReport);
      mismatchedSummary.reports.githubCi.commitSha = "2".repeat(40);
      mismatchedGithubCiReport.commitSha = "2".repeat(40);
      writeFileSync(releaseSummaryPath, `${JSON.stringify(mismatchedSummary, null, 2)}\n`);
      writeFileSync(githubCiReportPath, `${JSON.stringify(mismatchedGithubCiReport, null, 2)}\n`);
      const shaMismatchNegative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
        env: {
          ...process.env,
          STAGING_RELEASE_ARTIFACTS_TARGET: root,
          STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
        },
        encoding: "utf8",
      });
      const shaMismatchOutput = `${shaMismatchNegative.stdout ?? ""}${shaMismatchNegative.stderr ?? ""}`;
      if (shaMismatchNegative.status === 0) {
        console.error("Production evidence template kontrolü başarısız: staging release SHA mismatch negative kırılmadı.");
        process.exit(1);
      }
      if (
        !shaMismatchOutput.includes(
          "reports.uiUxRedesign releaseCandidate tag'i, sourceCommitSha ve reports.githubCi.commitSha aynı 40 karakter SHA olmalı.",
        )
      ) {
        console.error("Production evidence template kontrolü başarısız: staging release SHA mismatch beklenen hata yok.");
        console.error(shaMismatchOutput);
        process.exit(1);
      }
    } finally {
      writeFileSync(releaseSummaryPath, originalSummary);
      writeFileSync(githubCiReportPath, originalGithubCiReport);
    }

    const gapReportPath = join(rootParent, "staging-release-gap-report-negative.json");
      const rateLimitReportPath = `${reportsDir}/rate-limit.json`;
      const unexpectedRootFilePath = `${root}/unexpected-diagnostic.log`;
      const originalRateLimitReport = readFileSync(rateLimitReportPath, "utf8");
      unlinkSync(rateLimitReportPath);
      writeFileSync(unexpectedRootFilePath, "diagnostic logs do not belong in the release bundle\n");
      try {
      const gapReportNegative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
        env: {
          ...process.env,
          STAGING_RELEASE_ARTIFACTS_TARGET: root,
          STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
          STAGING_RELEASE_GAP_REPORT_FILE: gapReportPath,
        },
        encoding: "utf8",
      });
      const gapReportOutput = `${gapReportNegative.stdout ?? ""}${gapReportNegative.stderr ?? ""}`;
      if (gapReportNegative.status === 0) {
        console.error("Production evidence template kontrolü başarısız: staging release gap report negative beklenen şekilde kırılmadı.");
        process.exit(1);
      }
      const gapReport = JSON.parse(readFileSync(gapReportPath, "utf8"));
      if (
        gapReport.reportType !== "staging_release_artifacts_gap_report" ||
        gapReport.result !== "NOT_RELEASE_EVIDENCE" ||
        gapReport.overallStatus !== "BLOCKED" ||
        gapReport.releaseEvidence !== false ||
        gapReport.canPromote !== false
      ) {
        console.error("Production evidence template kontrolü başarısız: staging release gap report non-evidence shape bozuk.");
        console.error(JSON.stringify(gapReport, null, 2));
        process.exit(1);
	      }
	      if (
	        !Array.isArray(gapReport.missingRequiredFiles) ||
	        !gapReport.missingRequiredFiles.some(
	          (item) =>
	            item.path === "reports/rate-limit.json" &&
	            item.remediation?.ownerAgent === "auth_session_engineer" &&
	            item.remediation?.phase === "Faz 5 - Rate-limit Redis kanıtı" &&
	            item.remediation?.evidenceGate === "rate-limit:check" &&
	            item.remediation?.nextActionKind === "second_api_instance_or_lb_shard",
	        ) ||
	        gapReport.openClosureItemCount !== 1 ||
	        !Array.isArray(gapReport.openClosureItems) ||
	        !gapReport.openClosureItems.some((item) => item.path === "reports/rate-limit.json") ||
	        !Array.isArray(gapReport.unexpectedFiles) ||
	        !gapReport.unexpectedFiles.some((item) => item.path === "unexpected-diagnostic.log" && item.category === "unexpected_file") ||
	        Object.hasOwn(gapReport, "reports") ||
	        Object.hasOwn(gapReport, "smokeEvidence") ||
	        Object.hasOwn(gapReport, "commandsPassed") ||
	        Object.hasOwn(gapReport, "gaps")
      ) {
        console.error("Production evidence template kontrolü başarısız: staging release gap report yanlış release-evidence alanları taşıyor.");
        console.error(JSON.stringify(gapReport, null, 2));
        console.error(gapReportOutput);
        process.exit(1);
      }

      const gapSummaryNegative = spawnSync(
        process.execPath,
        [
          "scripts/print-staging-release-gap-summary.mjs",
          "--artifacts-dir",
          root,
          "--gap-report-file",
          gapReportPath,
        ],
        {
          env: process.env,
          encoding: "utf8",
        },
      );
      const gapSummaryOutput = `${gapSummaryNegative.stdout ?? ""}${gapSummaryNegative.stderr ?? ""}`;
      if (gapSummaryNegative.status === 0) {
        console.error("Production evidence template kontrolü başarısız: staging release gap summary CLI beklenen şekilde kırılmadı.");
        process.exit(1);
	      }
	      for (const expectedOutput of [
	        "- missingRequiredFiles: 1",
	        "- unexpectedFiles: 1",
	        "- blockedChecks: 0",
	        "- openClosureItems: 1",
	        "Açık kapanış kalemleri",
	        "Beklenmeyen bundle girdileri",
	        "* unexpected-diagnostic.log",
	      ]) {
	        if (!gapSummaryOutput.includes(expectedOutput)) {
	          console.error("Production evidence template kontrolü başarısız: staging release gap summary CLI eksik çıktı taşıyor.");
	          console.error(`Beklenen çıktı: ${expectedOutput}`);
	          console.error(gapSummaryOutput);
	          process.exit(1);
	        }
	      }

	      const firstGatesGapReportPath = join(rootParent, "staging-release-first-gates-gap-report-negative.json");
	      const manifestPath = `${firstGatesDir}/first-gates-manifest.json`;
	      const originalManifest = readFileSync(manifestPath, "utf8");
	      unlinkSync(manifestPath);
	      try {
	        const firstGatesGapNegative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
	          env: {
	            ...process.env,
	            STAGING_RELEASE_ARTIFACTS_TARGET: root,
	            STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
	            STAGING_RELEASE_GAP_REPORT_FILE: firstGatesGapReportPath,
	          },
	          encoding: "utf8",
	        });
	        if (firstGatesGapNegative.status === 0) {
	          console.error("Production evidence template kontrolü başarısız: first-gates gap negative beklenen şekilde kırılmadı.");
	          process.exit(1);
	        }
	        const firstGatesGapReport = JSON.parse(readFileSync(firstGatesGapReportPath, "utf8"));
	        const firstGateClosurePaths = new Set((firstGatesGapReport.openClosureItems ?? []).map((item) => item.path));
	        for (const expectedPath of [
	          "first-gates/first-gates-manifest.json",
	          "first-gates/traefik-https.json",
	          "first-gates/alert-webhook.json",
	        ]) {
	          if (!firstGateClosurePaths.has(expectedPath)) {
	            console.error("Production evidence template kontrolü başarısız: first-gates openClosureItems eksik.");
	            console.error(`Beklenen path: ${expectedPath}`);
	            console.error(JSON.stringify(firstGatesGapReport, null, 2));
	            process.exit(1);
	          }
	        }
	        if (firstGatesGapReport.openClosureItemCount !== 4) {
	          console.error("Production evidence template kontrolü başarısız: first-gates openClosureItemCount yanlış.");
	          console.error(JSON.stringify(firstGatesGapReport, null, 2));
	          process.exit(1);
	        }
	      } finally {
	        writeFileSync(manifestPath, originalManifest);
	      }

	      const archiveDir = join(rootParent, "staging-release-unexpected-archive");
      const archiveDryRun = spawnSync(
        process.execPath,
        [
          "scripts/archive-staging-release-unexpected-artifacts.mjs",
          "--artifacts-dir",
          root,
          "--gap-report-file",
          gapReportPath,
          "--archive-dir",
          archiveDir,
        ],
        { env: process.env, encoding: "utf8" },
      );
      const archiveDryRunOutput = `${archiveDryRun.stdout ?? ""}${archiveDryRun.stderr ?? ""}`;
      if (archiveDryRun.status !== 0 || !archiveDryRunOutput.includes("--apply verilmedi; dosyalar taşınmadı.")) {
        console.error("Production evidence template kontrolü başarısız: unexpected artifact archive dry-run çıktısı bozuk.");
        console.error(archiveDryRunOutput);
        process.exit(1);
      }
      if (!readFileSync(unexpectedRootFilePath, "utf8").includes("diagnostic logs")) {
        console.error("Production evidence template kontrolü başarısız: archive dry-run unexpected artifact'i taşımamalı.");
        process.exit(1);
      }

      const archiveApply = spawnSync(
        process.execPath,
        [
          "scripts/archive-staging-release-unexpected-artifacts.mjs",
          "--artifacts-dir",
          root,
          "--gap-report-file",
          gapReportPath,
          "--archive-dir",
          archiveDir,
          "--apply",
        ],
        { env: process.env, encoding: "utf8" },
      );
      const archiveApplyOutput = `${archiveApply.stdout ?? ""}${archiveApply.stderr ?? ""}`;
      if (archiveApply.status !== 0) {
        console.error("Production evidence template kontrolü başarısız: unexpected artifact archive apply kırıldı.");
        console.error(archiveApplyOutput);
        process.exit(1);
      }
      if (existsSync(unexpectedRootFilePath) || !existsSync(join(archiveDir, "unexpected-diagnostic.log"))) {
        console.error("Production evidence template kontrolü başarısız: unexpected artifact archive apply taşıma yapmadı.");
        console.error(archiveApplyOutput);
        process.exit(1);
      }
      const archiveManifest = JSON.parse(readFileSync(join(archiveDir, "manifest.json"), "utf8"));
      if (
        archiveManifest.result !== "ARCHIVED_UNEXPECTED_STAGING_RELEASE_ARTIFACTS" ||
        !archiveManifest.entries?.some((item) => item.path === "unexpected-diagnostic.log")
      ) {
        console.error("Production evidence template kontrolü başarısız: unexpected artifact archive manifest shape bozuk.");
        console.error(JSON.stringify(archiveManifest, null, 2));
        process.exit(1);
      }
    } finally {
      writeFileSync(rateLimitReportPath, originalRateLimitReport);
      rmSync(unexpectedRootFilePath, { force: true });
      rmSync(gapReportPath, { force: true });
      rmSync(join(rootParent, "staging-release-unexpected-archive"), { recursive: true, force: true });
    }

    const disallowExampleNegative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
      env: {
        ...process.env,
        STAGING_RELEASE_ARTIFACTS_TARGET: root,
      },
      encoding: "utf8",
    });
    const disallowExampleOutput = `${disallowExampleNegative.stdout ?? ""}${disallowExampleNegative.stderr ?? ""}`;
    if (disallowExampleNegative.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact example flag negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!disallowExampleOutput.includes("örnek/placeholder/redacted")) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact example flag negative beklenen hata yok.");
      console.error(disallowExampleOutput);
      process.exit(1);
    }

    const forbiddenExampleFlagRoot = resolve("artifacts/staging-release-artifacts-example-flag-negative");
    rmSync(forbiddenExampleFlagRoot, { recursive: true, force: true });
    mkdirSync(forbiddenExampleFlagRoot, { recursive: true });
    try {
      const forbiddenExampleFlagNegative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
        env: {
          ...process.env,
          STAGING_RELEASE_ARTIFACTS_TARGET: forbiddenExampleFlagRoot,
          STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
        },
        encoding: "utf8",
      });
      const forbiddenExampleFlagOutput = `${forbiddenExampleFlagNegative.stdout ?? ""}${forbiddenExampleFlagNegative.stderr ?? ""}`;
      if (forbiddenExampleFlagNegative.status === 0) {
        console.error("Production evidence template kontrolü başarısız: staging release artifact forbidden example flag negative beklenen şekilde kırılmadı.");
        process.exit(1);
      }
      if (
        !forbiddenExampleFlagOutput.includes(
          "STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE=1 yalnız prod evidence template fixture bundle'ında kullanılabilir.",
        )
      ) {
        console.error("Production evidence template kontrolü başarısız: staging release artifact forbidden example flag negative beklenen hata yok.");
        console.error(forbiddenExampleFlagOutput);
        process.exit(1);
      }
    } finally {
      rmSync(forbiddenExampleFlagRoot, { recursive: true, force: true });
    }

    const tempArtifactsRoot = "/tmp/staging-release-artifacts-temp-negative";
    rmSync(tempArtifactsRoot, { recursive: true, force: true });
    mkdirSync(tempArtifactsRoot, { recursive: true });
    try {
      const tempTargetNegative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
        env: {
          ...process.env,
          STAGING_RELEASE_ARTIFACTS_TARGET: tempArtifactsRoot,
          STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
        },
        encoding: "utf8",
      });
      const tempTargetOutput = `${tempTargetNegative.stdout ?? ""}${tempTargetNegative.stderr ?? ""}`;
      if (tempTargetNegative.status === 0) {
        console.error("Production evidence template kontrolü başarısız: staging release artifact temp path negative beklenen şekilde kırılmadı.");
        process.exit(1);
      }
      if (!tempTargetOutput.includes("STAGING_RELEASE_ARTIFACTS_TARGET lokal temp path altında olmamalı.")) {
        console.error("Production evidence template kontrolü başarısız: staging release artifact temp path negative beklenen hata yok.");
        console.error(tempTargetOutput);
        process.exit(1);
      }
    } finally {
      rmSync(tempArtifactsRoot, { recursive: true, force: true });
    }

    const symlinkParentRoot = mkdtempSync(join(rootParent, "staging-release-artifacts-parent-symlink-"));
    const symlinkParent = join(symlinkParentRoot, "parent-link");
    symlinkSync(rootParent, symlinkParent, "dir");
    try {
      const symlinkParentNegative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
        env: {
          ...process.env,
          STAGING_RELEASE_ARTIFACTS_TARGET: join(symlinkParent, basename(root)),
          STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
        },
        encoding: "utf8",
      });
      const symlinkParentOutput = `${symlinkParentNegative.stdout ?? ""}${symlinkParentNegative.stderr ?? ""}`;
      if (symlinkParentNegative.status === 0) {
        console.error("Production evidence template kontrolü başarısız: staging release artifact parent symlink negative beklenen şekilde kırılmadı.");
        process.exit(1);
      }
      if (!symlinkParentOutput.includes("artifactsDir parent dizini symlink olmayan dizin olmalı.")) {
        console.error("Production evidence template kontrolü başarısız: staging release artifact parent symlink negative beklenen hata yok.");
        console.error(symlinkParentOutput);
        process.exit(1);
      }
    } finally {
      rmSync(symlinkParentRoot, { recursive: true, force: true });
    }

    const wrongReleaseSummaryPath = `${root}/release-summary-wrong-tag.json`;
    writeFileSync(wrongReleaseSummaryPath, readFileSync(releaseSummaryPath, "utf8"));
    unlinkSync(releaseSummaryPath);
    const wrongReleaseSummaryNegative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
      env: {
        ...process.env,
        STAGING_RELEASE_ARTIFACTS_TARGET: root,
        STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
      },
      encoding: "utf8",
    });
    const wrongReleaseSummaryOutput = `${wrongReleaseSummaryNegative.stdout ?? ""}${wrongReleaseSummaryNegative.stderr ?? ""}`;
    if (wrongReleaseSummaryNegative.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact summary filename negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (
      !wrongReleaseSummaryOutput.includes(
        "release summary dosya tag'i summary.reports.deploymentRollback.releaseCandidate ile eşleşmeli.",
      )
    ) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact summary filename negative beklenen hata yok.");
      console.error(wrongReleaseSummaryOutput);
      process.exit(1);
    }
    writeFileSync(releaseSummaryPath, readFileSync(wrongReleaseSummaryPath, "utf8"));
    unlinkSync(wrongReleaseSummaryPath);

    const unexpectedReportPath = `${reportsDir}/unexpected.json`;
    writeFileSync(unexpectedReportPath, `${JSON.stringify({ result: "PASS" }, null, 2)}\n`);
    const unexpectedReportNegative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
      env: {
        ...process.env,
        STAGING_RELEASE_ARTIFACTS_TARGET: root,
        STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
      },
      encoding: "utf8",
    });
    const unexpectedReportOutput = `${unexpectedReportNegative.stdout ?? ""}${unexpectedReportNegative.stderr ?? ""}`;
    if (unexpectedReportNegative.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact unexpected file negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!unexpectedReportOutput.includes("reports/unexpected.json beklenmeyen artifact dosyası.")) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact unexpected file negative beklenen hata yok.");
      console.error(unexpectedReportOutput);
      process.exit(1);
    }
    unlinkSync(unexpectedReportPath);

    const leakedEnvPath = `${root}/.staging-evidence.env`;
    writeFileSync(leakedEnvPath, "NETGSM_PASSWORD=secret-value\n");
    const leakedEnvNegative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
      env: {
        ...process.env,
        STAGING_RELEASE_ARTIFACTS_TARGET: root,
        STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
      },
      encoding: "utf8",
    });
    const leakedEnvOutput = `${leakedEnvNegative.stdout ?? ""}${leakedEnvNegative.stderr ?? ""}`;
    if (leakedEnvNegative.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact secret/env leak negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!leakedEnvOutput.includes("artifact bundle secret/env dosyası içermemeli: .staging-evidence.env")) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact secret/env leak negative beklenen hata yok.");
      console.error(leakedEnvOutput);
      process.exit(1);
    }
    unlinkSync(leakedEnvPath);

    const manifestPath = `${firstGatesDir}/first-gates-manifest.json`;
    const originalFirstGatesManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const earlyFirstGatesManifest = { ...originalFirstGatesManifest, generatedAt: new Date(Date.parse(evidenceTime) - 60_000).toISOString() };
    writeFileSync(manifestPath, `${JSON.stringify(earlyFirstGatesManifest, null, 2)}\n`);
    const manifestNegative = spawnSync(process.execPath, ["scripts/check-staging-first-gates-evidence.mjs"], {
      env: {
        ...process.env,
        STAGING_FIRST_GATES_TARGET: pathToFileURL(manifestPath).href,
      },
      encoding: "utf8",
    });
    const manifestNegativeOutput = `${manifestNegative.stdout ?? ""}${manifestNegative.stderr ?? ""}`;
    if (manifestNegative.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates manifest chronology negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (
      !manifestNegativeOutput.includes(
        "checks.Traefik HTTPS smoke.smokeEvidence.generatedAt firstGates.generatedAt tarihinden sonra olamaz.",
      )
    ) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates manifest chronology negative beklenen hata yok.");
      console.error(manifestNegativeOutput);
      process.exit(1);
    }
    writeFileSync(manifestPath, `${JSON.stringify(originalFirstGatesManifest, null, 2)}\n`);

    const originalTraefikFirstGate = JSON.parse(readFileSync(`${firstGatesDir}/traefik-https.json`, "utf8"));
    const mismatchedFirstGateEnvironment = originalTraefikFirstGate.environment === "production" ? "staging" : "production";
    const wrongEnvironmentTraefikFirstGate = { ...originalTraefikFirstGate, environment: mismatchedFirstGateEnvironment };
    writeFileSync(`${firstGatesDir}/traefik-https.json`, `${JSON.stringify(wrongEnvironmentTraefikFirstGate, null, 2)}\n`);
    const manifestEnvironmentNegative = spawnSync(process.execPath, ["scripts/check-staging-first-gates-evidence.mjs"], {
      env: {
        ...process.env,
        STAGING_FIRST_GATES_TARGET: pathToFileURL(manifestPath).href,
      },
      encoding: "utf8",
    });
    const manifestEnvironmentOutput = `${manifestEnvironmentNegative.stdout ?? ""}${manifestEnvironmentNegative.stderr ?? ""}`;
    if (manifestEnvironmentNegative.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates manifest environment negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (
      !manifestEnvironmentOutput.includes(
        "checks.Traefik HTTPS smoke.smokeEvidence.environment firstGates.environment ile eşleşmeli.",
      )
    ) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates manifest environment negative beklenen hata yok.");
      console.error(manifestEnvironmentOutput);
      process.exit(1);
    }
    writeFileSync(`${firstGatesDir}/traefik-https.json`, `${JSON.stringify(originalTraefikFirstGate, null, 2)}\n`);

    const firstGateTraefikPath = `${firstGatesDir}/traefik-https.json`;
    unlinkSync(firstGateTraefikPath);
    symlinkSync(`${smokeDir}/traefik-https.json`, firstGateTraefikPath);
    const firstGatesSymlinkNegative = spawnSync(process.execPath, ["scripts/check-staging-first-gates-evidence.mjs"], {
      env: {
        ...process.env,
        STAGING_FIRST_GATES_TARGET: pathToFileURL(manifestPath).href,
      },
      encoding: "utf8",
    });
    const firstGatesSymlinkOutput = `${firstGatesSymlinkNegative.stdout ?? ""}${firstGatesSymlinkNegative.stderr ?? ""}`;
    if (firstGatesSymlinkNegative.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates symlink negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!firstGatesSymlinkOutput.includes("checks.Traefik HTTPS smoke.evidenceFile symlink olmayan dosya olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: staging first-gates symlink negative beklenen hata yok.");
      console.error(firstGatesSymlinkOutput);
      process.exit(1);
    }
    unlinkSync(firstGateTraefikPath);
    writeFileSync(firstGateTraefikPath, `${JSON.stringify(originalTraefikFirstGate, null, 2)}\n`);

    unlinkSync(firstGateTraefikPath);
    symlinkSync(`${smokeDir}/traefik-https.json`, firstGateTraefikPath);
    const releaseSymlinkNegative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
      env: {
        ...process.env,
        STAGING_RELEASE_ARTIFACTS_TARGET: root,
        STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
      },
      encoding: "utf8",
    });
    const releaseSymlinkOutput = `${releaseSymlinkNegative.stdout ?? ""}${releaseSymlinkNegative.stderr ?? ""}`;
    if (releaseSymlinkNegative.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact symlink negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!releaseSymlinkOutput.includes("artifact bundle symlink içermemeli: first-gates/traefik-https.json")) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact symlink negative beklenen hata yok.");
      console.error(releaseSymlinkOutput);
      process.exit(1);
    }
    unlinkSync(firstGateTraefikPath);
    writeFileSync(firstGateTraefikPath, `${JSON.stringify(originalTraefikFirstGate, null, 2)}\n`);

    const originalDeploymentRollback = JSON.parse(readFileSync(`${reportsDir}/deployment-rollback.json`, "utf8"));
    const badDeploymentRollback = { ...originalDeploymentRollback, failureMode: "different rollback drill failure mode" };
    writeFileSync(`${reportsDir}/deployment-rollback.json`, `${JSON.stringify(badDeploymentRollback, null, 2)}\n`);
    const reportNegative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
      env: {
        ...process.env,
        STAGING_RELEASE_ARTIFACTS_TARGET: root,
        STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
      },
      encoding: "utf8",
    });
    const reportNegativeOutput = `${reportNegative.stdout ?? ""}${reportNegative.stderr ?? ""}`;
    if (reportNegative.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact bundle raw report negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!reportNegativeOutput.includes("summary.reports.deploymentRollback.failureMode reports/deployment-rollback.json ile eşleşmeli")) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact bundle raw report negative beklenen hata yok.");
      console.error(reportNegativeOutput);
      process.exit(1);
    }
    writeFileSync(`${reportsDir}/deployment-rollback.json`, `${JSON.stringify(originalDeploymentRollback, null, 2)}\n`);

    const firstGateTargetMismatch = JSON.parse(readFileSync(`${firstGatesDir}/traefik-https.json`, "utf8"));
    firstGateTargetMismatch.url = "https://staging-different.o-okul.com/health";
    writeFileSync(`${firstGatesDir}/traefik-https.json`, `${JSON.stringify(firstGateTargetMismatch, null, 2)}\n`);
    const firstGateTargetMismatchNegative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
      env: {
        ...process.env,
        STAGING_RELEASE_ARTIFACTS_TARGET: root,
        STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
      },
      encoding: "utf8",
    });
    const firstGateTargetMismatchOutput = `${firstGateTargetMismatchNegative.stdout ?? ""}${firstGateTargetMismatchNegative.stderr ?? ""}`;
    if (firstGateTargetMismatchNegative.status === 0) {
      console.error(
        "Production evidence template kontrolü başarısız: staging release artifact first-gate target mismatch negative beklenen şekilde kırılmadı.",
      );
      process.exit(1);
    }
    if (!firstGateTargetMismatchOutput.includes("first-gates/traefik-https.json.url summary.smokeEvidence.traefikHttps.url ile eşleşmeli.")) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact first-gate target mismatch negative beklenen hata yok.");
      console.error(firstGateTargetMismatchOutput);
      process.exit(1);
    }
    writeFileSync(`${firstGatesDir}/traefik-https.json`, `${JSON.stringify(originalTraefikFirstGate, null, 2)}\n`);

    const staleTraefikFirstGate = JSON.parse(readFileSync(`${firstGatesDir}/traefik-https.json`, "utf8"));
    staleTraefikFirstGate.checkedAt = summaryTime;
    writeFileSync(`${firstGatesDir}/traefik-https.json`, `${JSON.stringify(staleTraefikFirstGate, null, 2)}\n`);
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ ...originalFirstGatesManifest, generatedAt: summaryTime }, null, 2)}\n`,
    );
    const staleFirstGateNegative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
      env: {
        ...process.env,
        STAGING_RELEASE_ARTIFACTS_TARGET: root,
        STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
      },
      encoding: "utf8",
    });
    const staleFirstGateOutput = `${staleFirstGateNegative.stdout ?? ""}${staleFirstGateNegative.stderr ?? ""}`;
    if (staleFirstGateNegative.status === 0) {
      console.error(
        "Production evidence template kontrolü başarısız: staging release artifact bundle first-gate chronology negative beklenen şekilde kırılmadı.",
      );
      process.exit(1);
    }
    if (
      !staleFirstGateOutput.includes(
        "first-gates/traefik-https.json.checkedAt summary.smokeEvidence.traefikHttps.checkedAt tarihinden sonra olamaz",
      )
    ) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact bundle first-gate chronology negative beklenen hata yok.");
      console.error(staleFirstGateOutput);
      process.exit(1);
    }
    staleTraefikFirstGate.checkedAt = evidenceTime;
    writeFileSync(`${firstGatesDir}/traefik-https.json`, `${JSON.stringify(staleTraefikFirstGate, null, 2)}\n`);
    writeFileSync(manifestPath, `${JSON.stringify(originalFirstGatesManifest, null, 2)}\n`);

    const badTraefik = JSON.parse(readFileSync(`${smokeDir}/traefik-https.json`, "utf8"));
    badTraefik.statusCode = 204;
    writeFileSync(`${smokeDir}/traefik-https.json`, `${JSON.stringify(badTraefik, null, 2)}\n`);
    const negative = spawnSync(process.execPath, ["scripts/check-staging-release-artifacts.mjs"], {
      env: {
        ...process.env,
        STAGING_RELEASE_ARTIFACTS_TARGET: root,
        STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE: "1",
      },
      encoding: "utf8",
    });
    const output = `${negative.stdout ?? ""}${negative.stderr ?? ""}`;
    if (negative.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact bundle raw smoke negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("summary.smokeEvidence.traefikHttps smoke/traefik-https.json ile birebir eşleşmeli")) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact bundle raw smoke negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function normalizeDateStrings(value, replacement) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDateStrings(item, replacement));
  }
  if (value && typeof value === "object") {
    if (isOutageDrillRecord(value)) {
      return normalizeOutageDrillRecord(value, replacement);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeDateStrings(item, replacement)]));
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return replacement;
  }
  return value;
}

function isOutageDrillRecord(value) {
  return (
    typeof value.inducedAt === "string" &&
    typeof value.detectedAt === "string" &&
    typeof value.webhookDeliveredAt === "string" &&
    typeof value.recoveredAt === "string" &&
    Number.isInteger(value.detectionLatencySeconds) &&
    Number.isInteger(value.webhookDeliveryLatencySeconds)
  );
}

function normalizeOutageDrillRecord(value, replacement) {
  const recoveredAtMs = Date.parse(replacement);
  const recoveryWindowMs = 150_000;
  const inducedAtMs = recoveredAtMs - recoveryWindowMs;
  return {
    ...value,
    inducedAt: new Date(inducedAtMs).toISOString(),
    detectedAt: new Date(inducedAtMs + value.detectionLatencySeconds * 1000).toISOString(),
    webhookDeliveredAt: new Date(inducedAtMs + value.webhookDeliveryLatencySeconds * 1000).toISOString(),
    recoveredAt: new Date(recoveredAtMs).toISOString(),
  };
}

function runProdEnvHttpEvidenceTargetNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.DEPLOYMENT_ROLLBACK_TARGET = "http://evidence.o-okul.com/deployment-rollback.json";

  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod env http evidence target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("DEPLOYMENT_ROLLBACK_TARGET file:// veya https:// URL olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: prod env http evidence target negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEnvSecretEvidenceTargetNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.DEPLOYMENT_ROLLBACK_TARGET = "https://ops:secret@evidence.o-okul.com/deployment-rollback.json?token=secret#proof";

  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod env secret evidence target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("DEPLOYMENT_ROLLBACK_TARGET production evidence target URL userinfo, query veya fragment içeremez.")) {
    console.error("Production evidence template kontrolü başarısız: prod env secret evidence target negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEnvLocalEvidenceTargetNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.RLS_LIVE_EVIDENCE_TARGET = "file:///var/lib/o-okul/artifacts/local/rls-live.json";

  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod env local evidence target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("RLS_LIVE_EVIDENCE_TARGET production için artifacts/local altında olmamalı.")) {
    console.error("Production evidence template kontrolü başarısız: prod env local evidence target negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEvidenceSummaryOutputNegativeChecks() {
  const root = resolve("artifacts/prod-evidence-template-check/prod-evidence-summary-output-negative");
  const tempSummaryPath = "/tmp/prod-evidence-summary-output-negative.json";
  rmSync(root, { recursive: true, force: true });
  rmSync(tempSummaryPath, { force: true });
  mkdirSync(root, { recursive: true });

  try {
    const tempResult = runProdEvidenceSummaryOutputNegative(tempSummaryPath);
    const tempOutput = `${tempResult.stdout ?? ""}${tempResult.stderr ?? ""}`;
    if (tempResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: prod evidence summary output temp path negative kırılmadı.");
      process.exit(1);
    }
    if (!tempOutput.includes("--summary-file lokal temp path olmamalı.")) {
      console.error("Production evidence template kontrolü başarısız: prod evidence summary output temp path negative beklenen hata yok.");
      console.error(tempOutput);
      process.exit(1);
    }

    const realFile = join(root, "real-summary.json");
    const symlinkFile = join(root, "symlink-summary.json");
    writeFileSync(realFile, "{}\n");
    symlinkSync(realFile, symlinkFile);
    const symlinkFileResult = runProdEvidenceSummaryOutputNegative(symlinkFile);
    const symlinkFileOutput = `${symlinkFileResult.stdout ?? ""}${symlinkFileResult.stderr ?? ""}`;
    if (symlinkFileResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: prod evidence summary output symlink file negative kırılmadı.");
      process.exit(1);
    }
    if (!symlinkFileOutput.includes("--summary-file symlink olmayan file artifact olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: prod evidence summary output symlink file negative beklenen hata yok.");
      console.error(symlinkFileOutput);
      process.exit(1);
    }

    const realDirectory = join(root, "real-dir");
    const symlinkDirectory = join(root, "symlink-dir");
    const realNestedDirectory = join(realDirectory, "nested");
    mkdirSync(realNestedDirectory, { recursive: true });
    symlinkSync(realDirectory, symlinkDirectory, "dir");
    const symlinkParentResult = runProdEvidenceSummaryOutputNegative(join(symlinkDirectory, "nested", "release-summary.json"));
    const symlinkParentOutput = `${symlinkParentResult.stdout ?? ""}${symlinkParentResult.stderr ?? ""}`;
    if (symlinkParentResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: prod evidence summary output symlink parent negative kırılmadı.");
      process.exit(1);
    }
    if (!symlinkParentOutput.includes("--summary-file parent dizini symlink olmayan dizin olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: prod evidence summary output symlink parent negative beklenen hata yok.");
      console.error(symlinkParentOutput);
      process.exit(1);
    }

    const reportsRoot = join(root, "reports-negative");
    const realReportsDirectory = join(root, "real-reports");
    mkdirSync(reportsRoot, { recursive: true });
    mkdirSync(realReportsDirectory, { recursive: true });
    symlinkSync(realReportsDirectory, join(reportsRoot, "reports"), "dir");
    const reportsResult = runProdEvidenceSummaryOutputNegative(join(reportsRoot, "release-summary.json"));
    const reportsOutput = `${reportsResult.stdout ?? ""}${reportsResult.stderr ?? ""}`;
    if (reportsResult.status === 0) {
      console.error("Production evidence template kontrolü başarısız: prod evidence summary output reports symlink negative kırılmadı.");
      process.exit(1);
    }
    if (!reportsOutput.includes("--summary-file reports dizini symlink olmayan dizin olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: prod evidence summary output reports symlink negative beklenen hata yok.");
      console.error(reportsOutput);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(tempSummaryPath, { force: true });
  }
}

function runProdEvidenceSummaryOutputNegative(summaryPath) {
  return spawnSync(process.execPath, ["scripts/check-prod-evidence.mjs", "--summary-file", summaryPath], {
    env: process.env,
    encoding: "utf8",
  });
}

function runProdEvidenceSmokeEvidenceFileNegativeChecks() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "prod-evidence-smoke-file-"));

  try {
    const tempEnv = createValidProdEnvForNegativeCheck();
    tempEnv.TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE = "/tmp/prod-evidence-traefik-smoke.json";
    runProdEvidenceSmokeEvidenceFileNegative(
      "prod evidence smoke file temp path negative",
      tempEnv,
      "TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE production için lokal temp path olmamalı.",
    );

    const localArtifactEnv = createValidProdEnvForNegativeCheck();
    localArtifactEnv.SMS_PROVIDER_SMOKE_EVIDENCE_FILE = "artifacts/local/sms-provider.json";
    runProdEvidenceSmokeEvidenceFileNegative(
      "prod evidence smoke file local artifact negative",
      localArtifactEnv,
      "SMS_PROVIDER_SMOKE_EVIDENCE_FILE production için artifacts/local altında olmamalı.",
    );

    const realFile = join(root, "traefik-https.json");
    const symlinkFile = join(root, "traefik-https-link.json");
    writeFileSync(realFile, "{}\n");
    symlinkSync(realFile, symlinkFile);
    const symlinkFileEnv = createValidProdEnvForNegativeCheck();
    symlinkFileEnv.TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE = symlinkFile;
    runProdEvidenceSmokeEvidenceFileNegative(
      "prod evidence smoke file symlink negative",
      symlinkFileEnv,
      "TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE production için symlink olmayan smoke artifact olmalı.",
    );

    const realDirectory = join(root, "real-dir");
    const symlinkDirectory = join(root, "symlink-dir");
    const realNestedDirectory = join(realDirectory, "nested");
    mkdirSync(realNestedDirectory, { recursive: true });
    symlinkSync(realDirectory, symlinkDirectory, "dir");
    const symlinkParentEnv = createValidProdEnvForNegativeCheck();
    symlinkParentEnv.TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE = join(symlinkDirectory, "nested", "traefik-https.json");
    runProdEvidenceSmokeEvidenceFileNegative(
      "prod evidence smoke file symlink parent negative",
      symlinkParentEnv,
      "TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE parent dizini symlink olmayan dizin olmalı.",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runFinalExternalEvidenceMissingTargetNegativeCheck() {
  const env = { ...process.env };
  delete env.PRODUCTION_EVIDENCE_SUMMARY_TARGET;
  delete env.LIVE_STATUS_EVIDENCE_TARGET;
  delete env.PILOT_EVIDENCE_TARGET;
  delete env.GO_LIVE_EVIDENCE_TARGET;

  const result = spawnSync(process.execPath, ["scripts/check-final-external-evidence.mjs"], {
    env,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: final external evidence missing target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("PRODUCTION_EVIDENCE_SUMMARY_TARGET zorunlu.") || !output.includes("GO_LIVE_EVIDENCE_TARGET zorunlu.")) {
    console.error("Production evidence template kontrolü başarısız: final external evidence missing target negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runFinalExternalEvidenceExampleFlagNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-final-external-evidence.mjs"], {
    env: {
      ...process.env,
      PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE: "1",
      PRODUCTION_EVIDENCE_SUMMARY_TARGET: "file:///final-summary.json",
      LIVE_STATUS_EVIDENCE_TARGET: "file:///final-live-status.json",
      PILOT_EVIDENCE_TARGET: "file:///final-pilot.json",
      GO_LIVE_EVIDENCE_TARGET: "file:///final-go-live.json",
    },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: final external evidence example flag negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE=1 final dış kanıt kapısında kullanılamaz.")) {
    console.error("Production evidence template kontrolü başarısız: final external evidence example flag negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runFinalExternalEvidenceReadinessOverrideNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-final-external-evidence.mjs"], {
    env: {
      ...process.env,
      LIVE_STATUS_READINESS_PATH: "docs/evidence-templates/live-status-pass-readiness.example.md",
      PRODUCTION_EVIDENCE_SUMMARY_TARGET: "file:///final-summary.json",
      LIVE_STATUS_EVIDENCE_TARGET: "file:///final-live-status.json",
      PILOT_EVIDENCE_TARGET: "file:///final-pilot.json",
      GO_LIVE_EVIDENCE_TARGET: "file:///final-go-live.json",
    },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: final external evidence readiness override negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("LIVE_STATUS_READINESS_PATH final dış kanıt kapısında docs/phase-6-production-readiness.md olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: final external evidence readiness override negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runProdEvidenceExampleFlagNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.RESTORE_DRILL_ALLOW_EXAMPLE_EVIDENCE = "1";

  const result = spawnSync(process.execPath, ["scripts/check-prod-evidence.mjs"], {
    env,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod evidence example flag negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }
  if (!output.includes("RESTORE_DRILL_ALLOW_EXAMPLE_EVIDENCE=1 prod:evidence:check kapısında kullanılamaz.")) {
    console.error("Production evidence template kontrolü başarısız: prod evidence example flag negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function runFinalExternalEvidenceTargetHygieneNegativeChecks() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "final-external-target-hygiene-"));
  const symlinkPath = join(root, "summary-link.json");
  symlinkSync(resolve(productionSummaryFixturePath), symlinkPath);

  try {
    runFinalExternalEvidenceTargetHygieneNegative(
      "final external evidence temp target negative",
      {
        PRODUCTION_EVIDENCE_SUMMARY_TARGET: "file:///tmp/final-production-summary.json",
      },
      "PRODUCTION_EVIDENCE_SUMMARY_TARGET final dış kanıt için lokal temp path olmamalı.",
    );
    runFinalExternalEvidenceTargetHygieneNegative(
      "final external evidence private temp target negative",
      {
        PRODUCTION_EVIDENCE_SUMMARY_TARGET: "file:///private/tmp/final-production-summary.json",
      },
      "PRODUCTION_EVIDENCE_SUMMARY_TARGET final dış kanıt için lokal temp path olmamalı.",
    );
    runFinalExternalEvidenceTargetHygieneNegative(
      "final external evidence local artifact target negative",
      {
        PRODUCTION_EVIDENCE_SUMMARY_TARGET: pathToFileURL(resolve("artifacts/local/final-production-summary.json")).href,
      },
      "PRODUCTION_EVIDENCE_SUMMARY_TARGET final dış kanıt için artifacts/local altında olmamalı.",
    );
    runFinalExternalEvidenceTargetHygieneNegative(
      "final external evidence template fixture target negative",
      {
        PRODUCTION_EVIDENCE_SUMMARY_TARGET: pathToFileURL(resolve(productionSummaryFixturePath)).href,
      },
      "PRODUCTION_EVIDENCE_SUMMARY_TARGET final dış kanıt için docs/evidence-templates fixture hedefi olmamalı.",
    );
    runFinalExternalEvidenceTargetHygieneNegative(
      "final external evidence placeholder target negative",
      {
        PRODUCTION_EVIDENCE_SUMMARY_TARGET: "https://example.com/final-production-summary.json",
      },
      "PRODUCTION_EVIDENCE_SUMMARY_TARGET final dış kanıt için gerçek https host olmalı.",
    );
    runFinalExternalEvidenceTargetHygieneNegative(
      "final external evidence secret URL target negative",
      {
        PRODUCTION_EVIDENCE_SUMMARY_TARGET: "https://ops:secret@evidence.o-okul.com/final-production-summary.json?token=secret#proof",
      },
      "PRODUCTION_EVIDENCE_SUMMARY_TARGET final dış kanıt target URL userinfo, query veya fragment içeremez.",
    );
    runFinalExternalEvidenceTargetHygieneNegative(
      "final external evidence symlink target negative",
      {
        PRODUCTION_EVIDENCE_SUMMARY_TARGET: pathToFileURL(symlinkPath).href,
      },
      "PRODUCTION_EVIDENCE_SUMMARY_TARGET symlink olmayan file artifact olmalı.",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runFinalExternalEvidenceTargetHygieneNegative(label, envOverrides, expectedFailure) {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "final-external-fixtures-"));
  const env = { ...process.env };
  delete env.PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE;
  delete env.LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE;
  delete env.PILOT_ALLOW_EXAMPLE_EVIDENCE;
  delete env.GO_LIVE_ALLOW_EXAMPLE_EVIDENCE;
  Object.assign(env, createFinalExternalFixtureTargets(root), envOverrides);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-final-external-evidence.mjs"], {
      env,
      encoding: "utf8",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes(expectedFailure)) {
      console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runFinalExternalEvidenceTargetMismatchNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "final-external-target-mismatch-"));
  const goLivePath = join(root, basename(goLiveFixturePath));
  const fixture = structuredClone(goLiveFixture);
  fixture.productionEvidenceSummary.summaryTarget = pathToFileURL(join(root, "other-production-summary.json")).href;

  try {
    const targets = createFinalExternalFixtureTargets(root);
    writeFileSync(goLivePath, `${JSON.stringify(fixture, null, 2)}\n`);
    const env = { ...process.env };
    delete env.PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE;
    delete env.LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE;
    delete env.PILOT_ALLOW_EXAMPLE_EVIDENCE;
    delete env.GO_LIVE_ALLOW_EXAMPLE_EVIDENCE;
    Object.assign(env, targets, { GO_LIVE_EVIDENCE_TARGET: pathToFileURL(goLivePath).href });

    const result = spawnSync(process.execPath, ["scripts/check-final-external-evidence.mjs"], {
      env,
      encoding: "utf8",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    if (result.status === 0) {
      console.error(
        "Production evidence template kontrolü başarısız: final external evidence target mismatch negative beklenen şekilde kırılmadı.",
      );
      process.exit(1);
    }
    if (!output.includes("goLive.productionEvidenceSummary.summaryTarget final target env ile aynı artifact hedefine bağlanmalı.")) {
      console.error("Production evidence template kontrolü başarısız: final external evidence target mismatch negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function createFinalExternalFixtureTargets(root) {
  const productionSummaryPath = join(root, basename(productionSummaryFixturePath));
  const liveStatusPath = join(root, basename(liveStatusFixturePath));
  const pilotPath = join(root, basename(pilotFixturePath));
  const goLivePath = join(root, basename(goLiveFixturePath));
  copyFileSync(productionSummaryFixturePath, productionSummaryPath);
  copyFileSync(liveStatusFixturePath, liveStatusPath);
  copyFileSync(pilotFixturePath, pilotPath);
  copyFileSync(goLiveFixturePath, goLivePath);

  return {
    PRODUCTION_EVIDENCE_SUMMARY_TARGET: pathToFileURL(productionSummaryPath).href,
    LIVE_STATUS_EVIDENCE_TARGET: pathToFileURL(liveStatusPath).href,
    PILOT_EVIDENCE_TARGET: pathToFileURL(pilotPath).href,
    GO_LIVE_EVIDENCE_TARGET: pathToFileURL(goLivePath).href,
  };
}

function runRemoteFinalEvidenceReadinessBehaviorChecks() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "remote-final-readiness-"));
  const binDir = join(root, "bin");
  const fakeSshLog = join(root, "ssh.log");
  const fakeSshPath = join(binDir, "ssh");
  mkdirSync(binDir, { recursive: true });

  const remoteTargets = {
    REMOTE_PRODUCTION_EVIDENCE_SUMMARY_TARGET: "/root/o-okul/artifacts/staging/release-summary.json",
    REMOTE_LIVE_STATUS_EVIDENCE_TARGET: "/root/o-okul/artifacts/staging/live-status.json",
    REMOTE_PILOT_EVIDENCE_TARGET: "/root/o-okul/artifacts/staging/pilot.json",
    REMOTE_GO_LIVE_EVIDENCE_TARGET: "/root/o-okul/artifacts/staging/go-live.json",
  };

  writeFileSync(
    fakeSshPath,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const command = process.argv.at(-1) ?? "";
appendFileSync(process.env.FAKE_SSH_LOG, command + "\\n");

function ok(output = "") {
  if (output) process.stdout.write(output);
  process.exit(0);
}

function fail(message) {
  process.stderr.write(message + "\\n");
  process.exit(10);
}

const expectedEnv = [
  "PRODUCTION_EVIDENCE_SUMMARY_TARGET='file:///root/o-okul/artifacts/staging/release-summary.json'",
  "LIVE_STATUS_EVIDENCE_TARGET='file:///root/o-okul/artifacts/staging/live-status.json'",
  "PILOT_EVIDENCE_TARGET='file:///root/o-okul/artifacts/staging/pilot.json'",
  "GO_LIVE_EVIDENCE_TARGET='file:///root/o-okul/artifacts/staging/go-live.json'",
];

if (command === "printf remote-ok") ok("remote-ok");
if (command.startsWith("test -d ")) ok();
if (command.startsWith("test -f ") && command.includes("/root/o-okul/artifacts/staging/")) ok();
if (command.includes("test -f package.json")) ok();
if (command.includes("curl -fsS") && command.includes("/health")) ok("{\\"status\\":\\"ok\\"}\\n");
if (command.includes("curl -fsSI")) ok("HTTP/1.1 200 OK\\n");
if (command.includes("test -f scripts/check-final-external-evidence.mjs")) ok();
if (command.includes("prod:external-evidence:check")) {
  ok("\\"prod:external-evidence:check\\": \\"node scripts/check-final-external-evidence.mjs\\"\\n");
}

if (command.includes("node scripts/check-live-status-evidence.mjs")) {
  for (const token of expectedEnv) {
    if (!command.includes(token)) fail("remote live status missing env " + token);
  }
  ok("Live status evidence kontrolü geçti: 17/17 dış kanıt PASS.\\n");
}

if (command.includes("node scripts/check-final-external-evidence.mjs")) {
  for (const token of expectedEnv) {
    if (!command.includes(token)) fail("remote final evidence missing env " + token);
  }
  ok("Final external evidence kontrolü geçti: production summary, tam Canlı Durum, pilot ve go-live hedefleri doğrulandı.\\n");
}

fail("unexpected remote command: " + command);
`,
  );
  chmodSync(fakeSshPath, 0o755);

  try {
    const positive = spawnSync(process.execPath, ["scripts/check-remote-final-evidence-readiness.mjs"], {
      env: createRemoteFinalEvidenceReadinessEnv(binDir, fakeSshLog, remoteTargets),
      encoding: "utf8",
    });
    const positiveOutput = `${positive.stdout ?? ""}${positive.stderr ?? ""}`;
    if (positive.status !== 0) {
      console.error("Production evidence template kontrolü başarısız: remote final readiness fake SSH positive kırıldı.");
      console.error(positiveOutput);
      process.exit(1);
    }
    if (!positiveOutput.includes("Remote final evidence readiness geçti: fake-remote:/root/o-okul")) {
      console.error("Production evidence template kontrolü başarısız: remote final readiness fake SSH positive beklenen çıktı yok.");
      console.error(positiveOutput);
      process.exit(1);
    }

    const sshLog = readFileSync(fakeSshLog, "utf8");
    if (
      !sshLog.includes("node scripts/check-live-status-evidence.mjs") ||
      !sshLog.includes("test -f '/root/o-okul/artifacts/staging/release-summary.json'") ||
      !sshLog.includes("LIVE_STATUS_EVIDENCE_TARGET='file:///root/o-okul/artifacts/staging/live-status.json'") ||
      !sshLog.includes("-u RESTORE_DRILL_ALLOW_EXAMPLE_EVIDENCE") ||
      !sshLog.includes("node scripts/check-final-external-evidence.mjs") ||
      !sshLog.includes("GO_LIVE_EVIDENCE_TARGET='file:///root/o-okul/artifacts/staging/go-live.json'")
    ) {
      console.error("Production evidence template kontrolü başarısız: remote final readiness fake SSH env aktarımı logda yok.");
      console.error(sshLog);
      process.exit(1);
    }

    rmSync(fakeSshLog, { force: true });
    const exampleFlagNegative = spawnSync(process.execPath, ["scripts/check-remote-final-evidence-readiness.mjs"], {
      env: {
        ...createRemoteFinalEvidenceReadinessEnv(binDir, fakeSshLog, remoteTargets),
        RESTORE_DRILL_ALLOW_EXAMPLE_EVIDENCE: "1",
      },
      encoding: "utf8",
    });
    const exampleFlagOutput = `${exampleFlagNegative.stdout ?? ""}${exampleFlagNegative.stderr ?? ""}`;
    if (exampleFlagNegative.status === 0) {
      console.error("Production evidence template kontrolü başarısız: remote final readiness example flag negative kırılmadı.");
      process.exit(1);
    }
    if (!exampleFlagOutput.includes("RESTORE_DRILL_ALLOW_EXAMPLE_EVIDENCE=1 prod:remote-evidence:check kapısında kullanılamaz.")) {
      console.error("Production evidence template kontrolü başarısız: remote final readiness example flag negative beklenen hata yok.");
      console.error(exampleFlagOutput);
      process.exit(1);
    }
    try {
      const unexpectedSshLog = readFileSync(fakeSshLog, "utf8");
      if (unexpectedSshLog.trim() !== "") {
        console.error("Production evidence template kontrolü başarısız: remote final readiness example flag SSH'e çıkmamalı.");
        console.error(unexpectedSshLog);
        process.exit(1);
      }
    } catch {
      // Missing log means the invalid example flag failed before SSH, as expected.
    }

    rmSync(fakeSshLog, { force: true });
    const invalidTargets = {
      ...remoteTargets,
      REMOTE_LIVE_STATUS_EVIDENCE_TARGET: "file:///root/o-okul/artifacts/local/live-status.json",
    };
    const negative = spawnSync(process.execPath, ["scripts/check-remote-final-evidence-readiness.mjs"], {
      env: createRemoteFinalEvidenceReadinessEnv(binDir, fakeSshLog, invalidTargets),
      encoding: "utf8",
    });
    const negativeOutput = `${negative.stdout ?? ""}${negative.stderr ?? ""}`;
    if (negative.status === 0) {
      console.error("Production evidence template kontrolü başarısız: remote final readiness local artifact target negative kırılmadı.");
      process.exit(1);
    }
    if (!negativeOutput.includes("LIVE_STATUS_EVIDENCE_TARGET remote final kanıt için artifacts/local altında olmamalı.")) {
      console.error("Production evidence template kontrolü başarısız: remote final readiness local artifact target negative beklenen hata yok.");
      console.error(negativeOutput);
      process.exit(1);
    }
    try {
      const unexpectedSshLog = readFileSync(fakeSshLog, "utf8");
      if (unexpectedSshLog.trim() !== "") {
        console.error("Production evidence template kontrolü başarısız: remote final readiness invalid target SSH'e çıkmamalı.");
        console.error(unexpectedSshLog);
        process.exit(1);
      }
    } catch {
      // Missing log means the invalid local target failed before SSH, as expected.
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function createRemoteFinalEvidenceReadinessEnv(binDir, fakeSshLog, targetEnv) {
  return {
    ...process.env,
    ...targetEnv,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    FAKE_SSH_LOG: fakeSshLog,
    REMOTE_EVIDENCE_HOST: "fake-remote",
    REMOTE_EVIDENCE_ROOT: "/root/o-okul",
  };
}

function runProdEvidenceSmokeEvidenceFileNegative(label, env, expectedFailure) {
  const result = spawnSync(process.execPath, ["scripts/check-prod-evidence.mjs"], {
    env,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    console.error(`Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`);
    process.exit(1);
  }

  if (!output.includes(expectedFailure)) {
    console.error(`Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`);
    console.error(output);
    process.exit(1);
  }
}

function runProdEvidenceHttpEvidenceTargetNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.DEPLOYMENT_ROLLBACK_TARGET = "http://evidence.o-okul.com/deployment-rollback.json";

  const result = spawnSync(process.execPath, ["scripts/check-prod-evidence.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod evidence http evidence target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("DEPLOYMENT_ROLLBACK_TARGET file:// veya https:// URL olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: prod evidence http evidence target negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEvidencePlaceholderEvidenceTargetNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.DEPLOYMENT_ROLLBACK_TARGET = "https://example.test/deployment-rollback.json";

  const result = spawnSync(process.execPath, ["scripts/check-prod-evidence.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod evidence placeholder evidence target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("DEPLOYMENT_ROLLBACK_TARGET production için gerçek https host olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: prod evidence placeholder evidence target negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEvidenceSecretEvidenceTargetNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.DEPLOYMENT_ROLLBACK_TARGET = "https://ops:secret@evidence.o-okul.com/deployment-rollback.json?token=secret#proof";

  const result = spawnSync(process.execPath, ["scripts/check-prod-evidence.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod evidence secret evidence target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("DEPLOYMENT_ROLLBACK_TARGET production evidence target URL userinfo, query veya fragment içeremez.")) {
    console.error("Production evidence template kontrolü başarısız: prod evidence secret evidence target negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEvidenceTempFileEvidenceTargetNegativeCheck() {
  for (const tempRoot of ["/tmp", "/private/tmp"]) {
    const label = `prod evidence temp file evidence target negative (${tempRoot})`;
    const env = createValidProdEnvForNegativeCheck();
    env.DEPLOYMENT_ROLLBACK_TARGET = `file://${tempRoot}/deployment-rollback.json`;

    const result = spawnSync(process.execPath, ["scripts/check-prod-evidence.mjs"], {
      env,
      encoding: "utf8",
    });

    if (result.status === 0) {
      console.error(
        `Production evidence template kontrolü başarısız: ${label} beklenen şekilde kırılmadı.`,
      );
      process.exit(1);
    }

    if (!String(result.stderr).includes("DEPLOYMENT_ROLLBACK_TARGET production için lokal temp path olmamalı.")) {
      console.error(
        `Production evidence template kontrolü başarısız: ${label} beklenen hata yok.`,
      );
      console.error(result.stderr);
      process.exit(1);
    }
  }
}

function runProdEvidenceSymlinkEvidenceTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "prod-evidence-symlink-"));
  const linkPath = join(root, "deployment-rollback.json");
  symlinkSync(resolve("docs/evidence-templates/deployment-rollback.example.json"), linkPath);

  try {
    const env = createValidProdEnvForNegativeCheck();
    env.DEPLOYMENT_ROLLBACK_TARGET = pathToFileURL(linkPath).href;

    const result = spawnSync(process.execPath, ["scripts/check-prod-evidence.mjs"], {
      env,
      encoding: "utf8",
    });

    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: prod evidence symlink evidence target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }

    if (!String(result.stderr).includes("DEPLOYMENT_ROLLBACK_TARGET production için symlink olmayan file artifact olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: prod evidence symlink evidence target negative beklenen hata yok.");
      console.error(result.stderr);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runProdEvidenceSymlinkParentEvidenceTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "prod-evidence-symlink-parent-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const realNestedDirectory = join(realDirectory, "nested");
  mkdirSync(realNestedDirectory, { recursive: true });
  writeFileSync(
    join(realNestedDirectory, "deployment-rollback.json"),
    readFileSync("docs/evidence-templates/deployment-rollback.example.json", "utf8"),
  );
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const env = createValidProdEnvForNegativeCheck();
    env.DEPLOYMENT_ROLLBACK_TARGET = pathToFileURL(join(symlinkDirectory, "nested", "deployment-rollback.json")).href;

    const result = spawnSync(process.execPath, ["scripts/check-prod-evidence.mjs"], {
      env,
      encoding: "utf8",
    });

    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: prod evidence symlink parent evidence target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }

    if (!String(result.stderr).includes("DEPLOYMENT_ROLLBACK_TARGET production için parent dizini symlink olmayan dizin olmalı.")) {
      console.error("Production evidence template kontrolü başarısız: prod evidence symlink parent evidence target negative beklenen hata yok.");
      console.error(result.stderr);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runProdEnvTraefikOriginNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.TRAEFIK_HTTPS_SMOKE_URL = "https://other.o-okul.com/health";

  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod env Traefik origin negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("TRAEFIK_HTTPS_SMOKE_URL WEB_URL origin'i ile eşleşmeli.")) {
    console.error("Production evidence template kontrolü başarısız: prod env Traefik origin negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEnvValidCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env: createValidProdEnvForNegativeCheck(),
    encoding: "utf8",
  });

  if (result.status !== 0) {
    console.error("Production evidence template kontrolü başarısız: geçerli prod env kontrolü kırıldı.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEnvTrustedForwarderNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.TRAEFIK_TRUSTED_FORWARDER_CIDRS = "0.0.0.0/0";

  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod env geniş trusted forwarder negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("TRAEFIK_TRUSTED_FORWARDER_CIDRS yalnız sabit proxy IP'lerini /32 veya /128 ile içermeli.")) {
    console.error("Production evidence template kontrolü başarısız: prod env geniş trusted forwarder negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEnvProxyTopologyNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.TRUSTED_PROXY_CIDRS = "172.31.255.3/32";

  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod env yanlış trusted proxy negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("TRUSTED_PROXY_CIDRS yalnız TRAEFIK_PROXY_IP/32 ile eşleşmeli.")) {
    console.error("Production evidence template kontrolü başarısız: prod env yanlış trusted proxy negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEnvMissingAlertWebhookTokenNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  delete env.ALERT_WEBHOOK_TOKEN;

  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod env missing alert webhook token negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("ALERT_WEBHOOK_TOKEN en az 32 karakterlik gerçek secret olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: prod env missing alert webhook token negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEnvMissingSmsSmokeConfirmNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  delete env.SMS_SMOKE_CONFIRM;

  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod env missing SMS smoke confirm negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("SMS_SMOKE_CONFIRM send olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: prod env missing SMS smoke confirm negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEnvMissingSentrySmokeConfirmNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  delete env.SENTRY_SMOKE_CONFIRM;

  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod env missing Sentry smoke confirm negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("SENTRY_SMOKE_CONFIRM send olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: prod env missing Sentry smoke confirm negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEnvWhatsappEnabledNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.WHATSAPP_ENABLED = "true";

  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod env enabled WhatsApp negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("WHATSAPP_ENABLED false olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: prod env enabled WhatsApp negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }

  const missingEnv = createValidProdEnvForNegativeCheck();
  delete missingEnv.WHATSAPP_ENABLED;
  const missingResult = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env: missingEnv,
    encoding: "utf8",
  });

  if (missingResult.status === 0 || !String(missingResult.stderr).includes("WHATSAPP_ENABLED false olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: prod env missing WhatsApp negative kırılmadı.");
    console.error(missingResult.stderr);
    process.exit(1);
  }
}

function runProdEnvPlaceholderNetgsmPasswordNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.NETGSM_PASSWORD = "__SET_NETGSM_PASSWORD__";

  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod env placeholder Netgsm password negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("NETGSM_PASSWORD production için placeholder/test/example değer içermemeli.")) {
    console.error("Production evidence template kontrolü başarısız: prod env placeholder Netgsm password negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEnvPlaceholderNotificationEmailNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.NOTIFICATION_SMOKE_EMAIL_TO = "ops@example.test";

  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod env placeholder notification email negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("NOTIFICATION_SMOKE_EMAIL_TO production için placeholder/test/example değer içermemeli.")) {
    console.error("Production evidence template kontrolü başarısız: prod env placeholder notification email negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEnvNotificationPushEnabledNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.NOTIFICATION_SMOKE_PUSH_TO = "test-token-device";

  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod env enabled notification push negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("NOTIFICATION_SMOKE_PUSH_TO e-posta-only release kapsamında boş olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: prod env enabled notification push negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEnvMissingS3SecretNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  delete env.S3_SECRET_ACCESS_KEY;

  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod env missing S3 secret negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("S3_SECRET_ACCESS_KEY boş bırakılamaz.")) {
    console.error("Production evidence template kontrolü başarısız: prod env missing S3 secret negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runAlertWebhookMissingTokenNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/smoke-alert-webhook.mjs"], {
    env: {
      ...process.env,
      ALERT_WEBHOOK_URL: "https://alerts.o-okul.com/webhook",
      ALERT_WEBHOOK_TOKEN: "",
    },
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: alert webhook missing token negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("ALERT_WEBHOOK_TOKEN en az 32 karakterlik gerçek bearer secret olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: alert webhook missing token negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runAlertWebhookHttpUrlNegativeCheck() {
  const result = runAlertWebhookUrlNegativeCheck("http://alerts.o-okul.com/webhook");

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: alert webhook HTTP URL negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("ALERT_WEBHOOK_URL https olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: alert webhook HTTP URL negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runAlertWebhookSecretUrlNegativeCheck() {
  const result = runAlertWebhookUrlNegativeCheck("https://user:secret@alerts.o-okul.com/webhook?token=secret#fragment");

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: alert webhook secret URL negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("ALERT_WEBHOOK_URL userinfo, query veya fragment içeremez.")) {
    console.error("Production evidence template kontrolü başarısız: alert webhook secret URL negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runAlertWebhookLocalHostNegativeCheck() {
  const result = runAlertWebhookUrlNegativeCheck("https://localhost/webhook");

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: alert webhook local host negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("ALERT_WEBHOOK_URL production için gerçek host olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: alert webhook local host negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runAlertWebhookUrlNegativeCheck(url) {
  return spawnSync(process.execPath, ["scripts/smoke-alert-webhook.mjs"], {
    env: {
      ...process.env,
      ALERT_WEBHOOK_URL: url,
      ALERT_WEBHOOK_TOKEN: "alert-webhook-token-123456789012345",
    },
    encoding: "utf8",
  });
}

function runTraefikInsecureEvidenceFileNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/smoke-traefik-https.mjs"], {
    env: {
      ...process.env,
      TRAEFIK_HTTPS_SMOKE_URL: "https://127.0.0.1/health",
      TRAEFIK_HTTPS_SMOKE_ALLOW_INSECURE_TLS: "true",
      TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE: "artifacts/staging/smoke/traefik-https.json",
    },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: Traefik insecure evidence negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!output.includes("yalnız teşhis") || !output.includes("PASS evidence artifact'i yazamaz")) {
    console.error("Production evidence template kontrolü başarısız: Traefik insecure evidence negative beklenen hata yok.");
    console.error(output);
    process.exit(1);
  }
}

function createValidProdEnvForNegativeCheck() {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    APP_URL: "https://o-okul.com",
    API_URL: "https://o-okul.com",
    WEB_URL: "https://o-okul.com",
    DATABASE_URL: "postgresql://app_user:strong-password@db.o-okul.internal:5432/o_okul",
    DIRECT_DATABASE_URL: "postgresql://migration_user:strong-password@db.o-okul.internal:5432/o_okul",
    SECRET_DELIVERY_OUTBOX_DATABASE_URL: "postgresql://secret_delivery_worker:secret-delivery-worker-db-password-123456789@db.o-okul.internal:5432/o_okul",
    DOCKER_SECRET_DELIVERY_OUTBOX_DATABASE_URL: "postgresql://secret_delivery_worker:secret-delivery-worker-db-password-123456789@postgres:5432/o_okul",
    SECRET_DELIVERY_WORKER_DB_PASSWORD: "secret-delivery-worker-db-password-123456789",
    JWT_ACCESS_SECRET: "access-secret-123456789012345678901234",
    STUDENT_PII_ENCRYPTION_KEY: "student-pii-encryption-123456789012",
    STUDENT_PII_HASH_KEY: "student-pii-hash-123456789012345678",
    ADMIN_MFA_MODE: "required",
    ADMIN_MFA_SECRET_ENCRYPTION_KEY: "admin-mfa-secret-encryption-1234567",
    SECRET_DELIVERY_ENCRYPTION_KEY: "secret-delivery-encryption-123456789",
    ADMIN_MFA_RECOVERY_HASH_KEY: "admin-mfa-recovery-hash-12345678901",
    ADMIN_MFA_CHALLENGE_SECRET: "admin-mfa-challenge-secret-123456789",
    ADMIN_MFA_ISSUER: "o-okul",
    DOMAIN: "o-okul.com",
    CF_DNS_API_TOKEN_FILE: "./secrets/cloudflare_dns_api_token",
    LEGACY_TENANT_LOGIN_CUTOFF_AT: "2099-01-01T00:00:00.000Z",
    COOKIE_SECURE: "true",
    LOG_LEVEL: "info",
    LOG_ENABLED: "true",
    OPENAPI_UI_ENABLED: "false",
    API_RATE_LIMIT_ENABLED: "true",
    API_RATE_LIMIT_STORE: "redis",
    API_RATE_LIMIT_WINDOW_MS: "60000",
    API_RATE_LIMIT_MAX: "300",
    DOCKER_PROXY_SUBNET: "172.31.255.0/29",
    DOCKER_PROXY_NETWORK: "o-okul_proxy_net",
    TRAEFIK_PROXY_IP: "172.31.255.2",
    API_PROXY_IP: "172.31.255.3",
    RATE_LIMIT_SMOKE_EGRESS_IP: "172.31.255.4",
    TRUSTED_PROXY_CIDRS: "172.31.255.2/32",
    TRAEFIK_TRUSTED_FORWARDER_CIDRS: "",
    IDEMPOTENCY_STORE: "postgres",
    REPORT_PDF_RENDERER: "worker",
    REPORT_PDF_RENDER_TIMEOUT_MS: "30000",
    PERSISTENCE_DRIVER: "postgres",
    QUEUE_METRICS_ENABLED: "true",
    QUEUE_BOARD_BASIC_AUTH_USER: "ops-admin",
    QUEUE_BOARD_BASIC_AUTH_PASSWORD: "queue-board-password-1234567890123",
    SMS_ENABLED: "true",
    NEXT_PUBLIC_SMS_ENABLED: "true",
    SMS_PROVIDER: "netgsm",
    SMS_ALLOW_NOOP_IN_PRODUCTION: "false",
    WHATSAPP_ENABLED: "false",
    SMS_SMOKE_TO: "+905551112233",
    SMS_SMOKE_BODY: "o-okul production SMS smoke",
    SMS_SMOKE_CONFIRM: "send",
    NETGSM_USERCODE: "netgsm-usercode",
    NETGSM_PASSWORD: "netgsm-password",
    NETGSM_MSG_HEADER: "OOKUL",
    NOTIFICATION_PROVIDER: "http",
    NOTIFICATION_ALLOW_NOOP_IN_PRODUCTION: "false",
    NOTIFICATION_HTTP_ENDPOINT: "https://notify.o-okul.com/send",
    NOTIFICATION_HTTP_BEARER_TOKEN: "notification-bearer-token-1234567890",
    NOTIFICATION_FROM_EMAIL: "bildirim@o-okul.com",
    NOTIFICATION_REPLY_TO_EMAIL: "destek@o-okul.com",
    NOTIFICATION_SMOKE_EMAIL_TO: "ops@o-okul.com",
    NOTIFICATION_SMOKE_PUSH_TO: "",
    NOTIFICATION_SMOKE_SUBJECT: "o-okul production notification smoke",
    NOTIFICATION_SMOKE_BODY: "o-okul production notification smoke",
    NOTIFICATION_SMOKE_CONFIRM: "send",
    SUPPORT_ATTACHMENT_STORAGE: "s3",
    HOMEWORK_MATERIAL_FILE_STORAGE: "s3",
    UPLOAD_AV_SCANNER: "clamav",
    CLAMAV_HOST: "clamav",
    CLAMAV_PORT: "3310",
    CLAMAV_TIMEOUT_MS: "5000",
    S3_BUCKET: "o-okul-prod-assets",
    S3_ENDPOINT: "https://s3.tr-storage.o-okul.com",
    S3_ACCESS_KEY_ID: "prod-access-key",
    S3_SECRET_ACCESS_KEY: "prod-secret-key",
    SENTRY_DSN: "https://1234567890abcdef@o123456.ingest.sentry.io/987654",
    NEXT_PUBLIC_SENTRY_DSN: "https://1234567890abcdef@o123456.ingest.sentry.io/987654",
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: "0.05",
    SENTRY_SEND_DEFAULT_PII: "false",
    SENTRY_SMOKE_CONFIRM: "send",
    SENTRY_SMOKE_MESSAGE: "o-okul production Sentry smoke",
    TRAEFIK_HTTPS_SMOKE_URL: "https://o-okul.com/",
    BACKUP_PATH: "/var/backups/o-okul",
    BACKUP_RETENTION_DAYS: "7",
    WAL_ARCHIVE_TARGET: "s3://prod-wal-archive/o-okul/wal",
    ALERT_WEBHOOK_URL: "https://alerts.o-okul.com/webhook",
    ALERT_WEBHOOK_TOKEN: "alert-webhook-token-123456789012345",
    ROLLBACK_IMAGE_TAG: "ghcr.io/4rmus/o-okul/api:2026-06-14.1",
  };

  for (const key of [
    "TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE",
    "SMS_PROVIDER_SMOKE_EVIDENCE_FILE",
    "NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE",
    "SENTRY_SMOKE_EVIDENCE_FILE",
    "ALERT_WEBHOOK_SMOKE_EVIDENCE_FILE",
    "WAL_ARCHIVE_SMOKE_EVIDENCE_FILE",
    "REPORT_GENERATION_SMOKE_EVIDENCE_FILE",
  ]) {
    delete env[key];
  }

  for (const key of [
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
    "PRODUCTION_EVIDENCE_SUMMARY_TARGET",
    "PILOT_EVIDENCE_TARGET",
    "GO_LIVE_EVIDENCE_TARGET",
    "LIVE_STATUS_EVIDENCE_TARGET",
  ]) {
    env[key] = `file:///var/lib/o-okul/evidence/${key.toLowerCase().replaceAll("_", "-")}.json`;
  }

  return env;
}

async function runGithubCiGeneratorContractCheck() {
  const outputPath = "docs/evidence-templates/github-ci.generated.tmp.json";
  const mockRun = {
    id: 1234567890,
    name: "CI",
    path: ".github/workflows/ci.yml",
    run_attempt: 1,
    html_url: "https://github.com/owner/repo/actions/runs/1234567890",
    conclusion: "success",
    event: "push",
    run_started_at: "2026-05-31T11:00:00.000Z",
    created_at: "2026-05-31T11:00:00.000Z",
    updated_at: "2026-05-31T11:45:00.000Z",
    head_branch: "main",
  };
  const mockJobs = [
    {
      name: "verify",
      conclusion: "success",
      started_at: "2026-05-31T11:01:00.000Z",
      completed_at: "2026-05-31T11:44:00.000Z",
      html_url: "https://github.com/owner/repo/actions/runs/1234567890/job/9876543210",
      steps: [
        { name: "Run pnpm install --frozen-lockfile", conclusion: "success" },
        { name: "Run pnpm run ci", conclusion: "success" },
      ],
    },
  ];

  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url?.startsWith("/repos/owner/repo/actions/workflows/ci.yml/runs")) {
      response.end(JSON.stringify({ workflow_runs: [mockRun] }));
      return;
    }
    if (request.url?.startsWith("/repos/owner/repo/actions/runs/1234567890/jobs")) {
      response.end(JSON.stringify({ jobs: mockJobs }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });

  await listen(server);

  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : undefined;
    if (!port) {
      console.error("Production evidence template kontrolü başarısız: GitHub CI generator mock server port alınamadı.");
      process.exit(1);
    }

    const generate = await runChild(process.execPath, ["scripts/generate-github-ci-evidence.mjs"], {
      ...process.env,
      GITHUB_API_URL: `http://127.0.0.1:${port}`,
      GITHUB_TOKEN: "mock-token",
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
      GITHUB_CI_EVIDENCE_OUTPUT: outputPath,
    });

    if (generate.status !== 0) {
      console.error("Production evidence template kontrolü başarısız: GitHub CI generator mock contract");
      console.error(generate.output);
      process.exit(generate.status ?? 1);
    }

    const check = spawnSync(process.execPath, ["scripts/check-github-ci-evidence.mjs"], {
      env: {
        ...process.env,
        GITHUB_CI_EVIDENCE_TARGET: pathToFileURL(outputPath).href,
      },
      encoding: "utf8",
    });

    if (check.status !== 0) {
      console.error("Production evidence template kontrolü başarısız: generated GitHub CI evidence contract");
      console.error(`${check.stdout ?? ""}${check.stderr ?? ""}`);
      process.exit(check.status ?? 1);
    }
  } finally {
    await closeServer(server);
    try {
      unlinkSync(outputPath);
    } catch {
      // Ignore cleanup errors; the generator/check failure above is the actionable signal.
    }
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function runChild(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("close", (status) => {
      resolve({ status, output });
    });
  });
}
