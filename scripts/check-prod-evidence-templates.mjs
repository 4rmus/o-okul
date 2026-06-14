import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const templateChecks = [
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
  ],
  [
    "Identity migration template",
    "IDENTITY_MIGRATION_TARGET",
    "docs/evidence-templates/identity-migration.example.json",
    "scripts/check-identity-migration-evidence.mjs",
    { IDENTITY_MIGRATION_ALLOW_EXAMPLE_EVIDENCE: "1" },
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
    "AI report summary template",
    "AI_REPORT_SUMMARY_EVIDENCE_TARGET",
    "docs/evidence-templates/ai-report-summary.example.json",
    "scripts/check-ai-report-summary-evidence.mjs",
    { AI_REPORT_SUMMARY_ALLOW_EXAMPLE_EVIDENCE: "1" },
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
    "Inline upload content migration template",
    "INLINE_UPLOAD_CONTENT_MIGRATION_TARGET",
    "docs/evidence-templates/inline-upload-content-migration.example.json",
    "scripts/check-inline-upload-content-migration-evidence.mjs",
    { INLINE_UPLOAD_CONTENT_MIGRATION_ALLOW_EXAMPLE_EVIDENCE: "1" },
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
        [envKey]: `http://evidence.uzmanhocam.com/${envKey.toLowerCase().replaceAll("_", "-")}.json`,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(`Production evidence template kontrolü başarısız: ${label} HTTP target negative beklenen şekilde kırılmadı.`);
      process.exit(1);
    }
    if (!output.includes("file:// veya https://")) {
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
    if (!output.includes("gercek https host") && !output.includes("file:// veya https://")) {
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
    const result = spawnSync(process.execPath, [script], {
      env: {
        ...process.env,
        ...extraEnv,
        [envKey]: `file:///tmp/${envKey.toLowerCase().replaceAll("_", "-")}.json`,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error(
        `Production evidence template kontrolü başarısız: ${label} temp file target negative beklenen şekilde kırılmadı.`,
      );
      process.exit(1);
    }
    if (!output.includes("lokal temp path") && !output.includes("file:// veya https://")) {
      console.error(
        `Production evidence template kontrolü başarısız: ${label} temp file target negative beklenen hata yok.`,
      );
      console.error(output);
      process.exit(1);
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
runStagingFirstGatesOutputDirNegativeCheck();
runProdEnvHttpEvidenceTargetNegativeCheck();
runProdEvidenceSummaryOutputNegativeChecks();
runProdEvidenceSmokeEvidenceFileNegativeChecks();
runProdEvidenceHttpEvidenceTargetNegativeCheck();
runProdEvidencePlaceholderEvidenceTargetNegativeCheck();
runProdEvidenceTempFileEvidenceTargetNegativeCheck();
runProdEvidenceSymlinkEvidenceTargetNegativeCheck();
runProdEvidenceSymlinkParentEvidenceTargetNegativeCheck();
runProdEnvTraefikOriginNegativeCheck();
runProdEnvMissingAlertWebhookTokenNegativeCheck();
runProdEnvMissingSmsSmokeConfirmNegativeCheck();
runProdEnvMissingSentrySmokeConfirmNegativeCheck();
runProdEnvPlaceholderNetgsmPasswordNegativeCheck();
runProdEnvMissingS3SecretNegativeCheck();
runAlertWebhookMissingTokenNegativeCheck();
runStagingReleaseArtifactsBundleCheck();

const generatedLiveStatusPath = "docs/evidence-templates/live-status.generated.tmp.json";
const adminMfaFixturePath = "docs/evidence-templates/admin-mfa.example.json";
const aiReportSummaryFixturePath = "docs/evidence-templates/ai-report-summary.example.json";
const deploymentRegionFixturePath = "docs/evidence-templates/deployment-region.example.json";
const deploymentRollbackFixturePath = "docs/evidence-templates/deployment-rollback.example.json";
const externalMonitoringFixturePath = "docs/evidence-templates/external-monitoring.example.json";
const financialRetentionFixturePath = "docs/evidence-templates/financial-retention.example.json";
const githubCiFixturePath = "docs/evidence-templates/github-ci.example.json";
const identityMigrationFixturePath = "docs/evidence-templates/identity-migration.example.json";
const inlineUploadMigrationFixturePath = "docs/evidence-templates/inline-upload-content-migration.example.json";
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
const aiReportSummaryFixture = JSON.parse(readFileSync(aiReportSummaryFixturePath, "utf8"));
const externalMonitoringFixture = JSON.parse(readFileSync(externalMonitoringFixturePath, "utf8"));
const financialRetentionFixture = JSON.parse(readFileSync(financialRetentionFixturePath, "utf8"));
const githubCiFixture = JSON.parse(readFileSync(githubCiFixturePath, "utf8"));
const identityMigrationFixture = JSON.parse(readFileSync(identityMigrationFixturePath, "utf8"));
const inlineUploadMigrationFixture = JSON.parse(readFileSync(inlineUploadMigrationFixturePath, "utf8"));
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
    label: "AI report summary non-empty gaps negative",
    path: "docs/evidence-templates/ai-report-summary.non-empty-gaps.tmp.json",
    expectedFailure: "gaps boş olmalı.",
    runner: runAiReportSummaryNegativeCheck,
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
runKvkkInventoryNegativeCheck({
  label: "KVKK inventory extra top-level key negative",
  path: "docs/evidence-templates/kvkk-inventory.extra-top-level.tmp.json",
  expectedFailure: "kvkkInventory tam 8 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
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
  expectedFailure: "purgeCoverage.student tam 4 alan içermeli.",
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
  label: "KVKK inventory invalid gaps negative",
  path: "docs/evidence-templates/kvkk-inventory.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
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
runAiReportSummaryNegativeCheck({
  label: "AI report summary extra top-level key negative",
  path: "docs/evidence-templates/ai-report-summary.extra-top-level.tmp.json",
  expectedFailure: "aiReportSummary tam 11 alan içermeli.",
  mutate: (fixture) => {
    fixture.unexpectedTopLevel = true;
  },
});
runAiReportSummaryNegativeCheck({
  label: "AI report summary extra provider field negative",
  path: "docs/evidence-templates/ai-report-summary.extra-provider-field.tmp.json",
  expectedFailure: "provider tam 6 alan içermeli.",
  mutate: (fixture) => {
    fixture.provider.unexpectedField = true;
  },
});
runAiReportSummaryNegativeCheck({
  label: "AI report summary extra field-sent negative",
  path: "docs/evidence-templates/ai-report-summary.extra-field-sent.tmp.json",
  expectedFailure: "kvkk.fieldsSent tam 6 alan içermeli.",
  mutate: (fixture) => {
    fixture.kvkk.fieldsSent.push("unexpected.metric");
  },
});
runAiReportSummaryNegativeCheck({
  label: "AI report summary extra generation field negative",
  path: "docs/evidence-templates/ai-report-summary.extra-generation-field.tmp.json",
  expectedFailure: "generation tam 7 alan içermeli.",
  mutate: (fixture) => {
    fixture.generation.unexpectedField = true;
  },
});
runAiReportSummaryNegativeCheck({
  label: "AI report summary extra validation field negative",
  path: "docs/evidence-templates/ai-report-summary.extra-validation-field.tmp.json",
  expectedFailure: "validation tam 4 alan içermeli.",
  mutate: (fixture) => {
    fixture.validation.unexpectedField = true;
  },
});
runAiReportSummaryNegativeCheck({
  label: "AI report summary extra command negative",
  path: "docs/evidence-templates/ai-report-summary.extra-command.tmp.json",
  expectedFailure: "commandsPassed tam 3 komut içermeli.",
  mutate: (fixture) => {
    fixture.commandsPassed.push("pnpm unexpected:ai-report-summary");
  },
});
runAiReportSummaryNegativeCheck({
  label: "AI report summary invalid gaps negative",
  path: "docs/evidence-templates/ai-report-summary.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
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
    fixture.workflow.runUrl = "https://github.com/other/uzman-hocam/actions/runs/1234567890";
    fixture.evidenceReferences[0] = fixture.workflow.runUrl;
  },
});
runGithubCiNegativeCheck({
  label: "GitHub CI workflow run URL runId mismatch negative",
  path: "docs/evidence-templates/github-ci.run-url-runid-mismatch.tmp.json",
  expectedFailure: "workflow.runUrl runId ile eslesmeli.",
  mutate: (fixture) => {
    fixture.workflow.runUrl = "https://github.com/example/uzman-hocam/actions/runs/1234567891";
    fixture.evidenceReferences[0] = fixture.workflow.runUrl;
  },
});
runGithubCiNegativeCheck({
  label: "GitHub CI evidence reference run mismatch negative",
  path: "docs/evidence-templates/github-ci.evidence-reference-run-mismatch.tmp.json",
  expectedFailure: "evidenceReferences.0 runId ile eslesmeli.",
  mutate: (fixture) => {
    fixture.evidenceReferences[0] = "https://github.com/example/uzman-hocam/actions/runs/1234567891";
  },
});
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
  expectedFailure: "examCycle tam 26 alan icermeli.",
  mutate: (fixture) => {
    fixture.examCycle.unexpectedField = true;
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
  label: "Live exam cycle invalid gaps negative",
  path: "docs/evidence-templates/live-exam-cycle.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
runInlineUploadMigrationNegativeCheck({
  label: "Inline upload migration extra top-level key negative",
  path: "docs/evidence-templates/inline-upload-content-migration.extra-top-level.tmp.json",
  expectedFailure: "inlineUploadMigration tam 9 alan icermeli.",
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
  expectedFailure: "commandsPassed tam 2 komut icermeli.",
  mutate: (fixture) => {
    fixture.commandsPassed.push("pnpm unexpected:migrate");
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
runRateLimitNegativeCheck({
  label: "Rate limit extra top-level key negative",
  path: "docs/evidence-templates/rate-limit.extra-top-level.tmp.json",
  expectedFailure: "rateLimit tam 10 alan icermeli.",
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
runRlsLiveNegativeCheck({
  label: "RLS live extra top-level key negative",
  path: "docs/evidence-templates/rls-live.extra-top-level.tmp.json",
  expectedFailure: "rlsLive tam 9 alan icermeli.",
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
  expectedFailure: "schema.tablesVerified tam 54 tablo icermeli.",
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
  label: "RLS live invalid gaps negative",
  path: "docs/evidence-templates/rls-live.invalid-gaps.tmp.json",
  expectedFailure: "gaps listesi zorunlu.",
  mutate: (fixture) => {
    fixture.gaps = "none";
  },
});
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
  expectedFailure: "servicesVerified tam 3 servis içermeli.",
  mutate: (fixture) => {
    fixture.servicesVerified.push({
      service: "queue-board",
      status: "healthy",
      imageTag: "ghcr.io/example/uzman-hocam/queue-board:previous-pass",
      evidenceReference: "https://staging.example.test/queues",
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
runProductionSummaryHttpTargetNegativeCheck();
runProductionSummarySymlinkParentTargetNegativeCheck();
runProductionSummaryNegativeCheck({
  label: "Production summary extra check negative",
  path: "docs/evidence-templates/production-evidence-summary.extra-check.tmp.json",
  expectedFailure: "checks tam 26 madde içermeli.",
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
  expectedFailure: "smokeEvidence tam 7 alan içermeli.",
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
  expectedFailure: "reports tam 18 alan içermeli.",
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
  expectedFailure: "reports.deploymentRegion.checkedAt generatedAt tarihinden sonra olamaz.",
  mutate: (fixture) => {
    fixture.reports.deploymentRegion.checkedAt = "2026-06-15T10:30:00.000Z";
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
    fixture.reports.liveExamCycle.releaseCandidate = "ghcr.io/example/uzman-hocam/api:unexpected-live-exam-release";
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
  label: "Production summary UAT release candidate mismatch negative",
  path: "docs/evidence-templates/production-evidence-summary.uat-release-candidate-mismatch.tmp.json",
  expectedFailure: "reports.uat.releaseCandidate reports.deploymentRollback.releaseCandidate ile eşleşmeli.",
  mutate: (fixture) => {
    fixture.reports.uat.releaseCandidate = "ghcr.io/example/uzman-hocam/api:unexpected-release";
  },
});
runProductionSummaryNegativeCheck({
  label: "Production summary UAT rollback image mismatch negative",
  path: "docs/evidence-templates/production-evidence-summary.uat-rollback-image-mismatch.tmp.json",
  expectedFailure: "reports.uat.rollbackImageTag reports.deploymentRollback.rollbackImageTag ile eşleşmeli.",
  mutate: (fixture) => {
    fixture.reports.uat.rollbackImageTag = "ghcr.io/example/uzman-hocam/api:unexpected-rollback";
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
  label: "Live status HTTP summary target negative",
  path: "docs/evidence-templates/live-status.http-summary-target.tmp.json",
  expectedFailure: "productionEvidenceSummaryTarget file:// veya https:// URL olmalı.",
  mutate: (fixture) => {
    fixture.productionEvidenceSummaryTarget = "http://evidence.uzmanhocam.com/production-summary.json";
  },
});
runGoLiveNegativeCheck({
  label: "Go-live HTTP live-status target negative",
  path: "docs/evidence-templates/go-live.http-live-status-target.tmp.json",
  expectedFailure: "liveStatusEvidence.evidenceTarget file:// veya https:// URL olmali.",
  mutate: (fixture) => {
    fixture.liveStatusEvidence.evidenceTarget = "http://evidence.uzmanhocam.com/live-status.json";
  },
});
runGoLiveNegativeCheck({
  label: "Go-live extra gatesPassed negative",
  path: "docs/evidence-templates/go-live.extra-gates-passed.tmp.json",
  expectedFailure: "liveStatusEvidence.gatesPassed tam 8 gate içermeli.",
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
  expectedFailure: "deployment tam 14 alan icermeli.",
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
  expectedFailure: "productionEvidenceSummary.checksPassed tam 26 madde icermeli.",
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
  expectedFailure: "productionEvidenceSummary.summary.checks tam 26 madde icermeli.",
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
  expectedFailure: "productionEvidenceSummary.summary.smokeEvidence tam 7 alan icermeli.",
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
  expectedFailure: "productionEvidenceSummary.summary.reports tam 18 alan icermeli.",
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
  expectedFailure: "liveStatusEvidence.gates tam 8 gate içermeli.",
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
    "liveStatusEvidence.gates.TR datacenter/provider kanıtı.checkedAt productionEvidenceSummary.reports.deploymentRegion.checkedAt ile eslesmeli.",
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
    linkedLiveStatus.gates[4].checkedAt = "2026-06-14";
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
    linkedLiveStatus.gates[5].checkedAt = "2026-06-15T13:00:00.000Z";
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
    "liveStatusEvidence.gates.TR datacenter/provider kanıtı.evidenceReference productionEvidenceSummary.reports.deploymentRegion kaynak referansı ile eslesmeli.",
  mutate: (fixture, cleanupPaths) => {
    const linkedPath = "docs/evidence-templates/live-status.report-reference-mismatch-for-go-live.tmp.json";
    const linkedLiveStatus = structuredClone(liveStatusFixture);
    linkedLiveStatus.goLiveEvidenceTarget = "go-live.linked-live-status-report-reference-mismatch.tmp.json";
    linkedLiveStatus.gates[1].evidenceReference = "artifacts/example/production/wrong-region-reference.json";
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
    linkedLiveStatus.gates[4].evidenceReference = "artifacts/example/pilot/wrong-pilot-reference.json";
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
    linkedLiveStatus.gates[5].evidenceReference = "artifacts/example/production/wrong-go-live-reference.json";
    fixture.liveStatusEvidence.evidenceTarget = "live-status.go-live-reference-mismatch-for-go-live.tmp.json";
    writeFileSync(linkedPath, `${JSON.stringify(linkedLiveStatus, null, 2)}\n`);
    cleanupPaths.push(linkedPath);
  },
});
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
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  const cleanupPaths = [path];

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

function runProductionSummaryHttpTargetNegativeCheck() {
  const result = spawnSync(process.execPath, ["scripts/check-production-evidence-summary.mjs"], {
    env: {
      ...process.env,
      PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE: "1",
      PRODUCTION_EVIDENCE_SUMMARY_TARGET: "http://evidence.uzmanhocam.com/release-summary.json",
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

function runProductionSummarySymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "production-summary-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  mkdirSync(realDirectory, { recursive: true });
  writeFileSync(join(realDirectory, "release-summary.json"), readFileSync(productionSummaryFixturePath, "utf8"));
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(process.execPath, ["scripts/check-production-evidence-summary.mjs"], {
      env: {
        ...process.env,
        PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE: "1",
        PRODUCTION_EVIDENCE_SUMMARY_TARGET: pathToFileURL(join(symlinkDirectory, "release-summary.json")).href,
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

function runAiReportSummaryNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(aiReportSummaryFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-ai-report-summary-evidence.mjs"], {
      env: {
        ...process.env,
        AI_REPORT_SUMMARY_ALLOW_EXAMPLE_EVIDENCE: "1",
        AI_REPORT_SUMMARY_EVIDENCE_TARGET: pathToFileURL(path).href,
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

function runUatNegativeCheck({ label, path, expectedFailure, mutate }) {
  const fixture = structuredClone(uatFixture);
  mutate(fixture);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-uat-evidence.mjs"], {
      env: {
        ...process.env,
        UAT_ALLOW_EXAMPLE_EVIDENCE: "1",
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
        "http://evidence.uzmanhocam.com/production-summary.json",
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
  mkdirSync(realDirectory, { recursive: true });
  writeFileSync(join(realDirectory, "production-summary.json"), readFileSync(productionSummaryFixturePath, "utf8"));
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/generate-live-status-evidence.mjs",
        "--summary-target",
        pathToFileURL(join(symlinkDirectory, "production-summary.json")).href,
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
  writeFileSync(symlinkTargetPath, "{}\n");
  symlinkSync(symlinkTargetPath, symlinkOutputPath);

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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runLiveStatusEvidenceSymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "live-status-evidence-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  mkdirSync(realDirectory, { recursive: true });
  writeFileSync(join(realDirectory, "live-status.json"), readFileSync(liveStatusFixturePath, "utf8"));
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const result = spawnSync(process.execPath, ["scripts/check-live-status-evidence.mjs"], {
      env: {
        ...process.env,
        LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE: "1",
        LIVE_STATUS_READINESS_PATH: liveStatusReadinessPath,
        LIVE_STATUS_EVIDENCE_TARGET: pathToFileURL(join(symlinkDirectory, "live-status.json")).href,
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

function runGoLiveLinkedLiveStatusSymlinkParentTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "go-live-live-status-parent-symlink-"));
  const realDirectory = join(root, "real-dir");
  const symlinkDirectory = join(root, "symlink-dir");
  const goLivePath = "docs/evidence-templates/go-live.linked-live-status-parent-symlink-target.tmp.json";
  mkdirSync(realDirectory, { recursive: true });
  writeFileSync(join(realDirectory, "live-status.json"), readFileSync(liveStatusFixturePath, "utf8"));
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  const fixture = structuredClone(goLiveFixture);
  fixture.liveStatusEvidence.evidenceTarget = pathToFileURL(join(symlinkDirectory, "live-status.json")).href;
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
  const workflowPath = "docs/evidence-templates/staging-deploy.bad-order.tmp.yml";
  const contents = readFileSync("docs/evidence-templates/staging-evidence.env.example", "utf8").replace(
    /^NETGSM_USERCODE=.*$/m,
    "NETGSM_USERCODE=",
  );
  writeFileSync(path, contents);

  try {
    const result = spawnSync(process.execPath, ["scripts/check-staging-evidence-env.mjs", "--env-file", path], {
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: staging env empty required negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }
    if (!output.includes("boş env değeri içeriyor: NETGSM_USERCODE")) {
      console.error("Production evidence template kontrolü başarısız: staging env empty required negative beklenen hata yok.");
      console.error(output);
      process.exit(1);
    }

    const workflow = readFileSync(".github/workflows/staging-deploy.yml", "utf8");
    const cleanupBlock = `      - name: Cleanup staging evidence env
        if: always()
        shell: bash
        run: rm -f .staging-evidence.env`;
    const uploadBlock = `      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: staging-production-evidence-\${{ needs.build-images.outputs.image-tag }}
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
    for (const cleanupPath of [path, workflowPath]) {
      try {
        unlinkSync(cleanupPath);
      } catch {
        // Ignore cleanup errors; the negative-check failure above is the actionable signal.
      }
    }
  }
}

function runStagingFirstGatesOutputDirNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const unexpectedRoot = mkdtempSync(join(rootParent, "staging-first-gates-output-unexpected-"));
  const symlinkRoot = mkdtempSync(join(rootParent, "staging-first-gates-output-symlink-"));

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
  } finally {
    rmSync(unexpectedRoot, { recursive: true, force: true });
    rmSync(symlinkRoot, { recursive: true, force: true });
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
    const symlinkParentResult = runGithubCiGeneratorOutputNegative(join(symlinkDirectory, "github-ci.json"));
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
    mkdirSync(realDirectory, { recursive: true });
    symlinkSync(realDirectory, symlinkDirectory, "dir");
    const symlinkParentResult = runInlineUploadMigrationReportOutputNegative(join(symlinkDirectory, "report.json"));
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

    const releaseSummaryPath = `${root}/release-summary-2026-06-15.1.json`;
    writeFileSync(releaseSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    for (const [key, file] of Object.entries({
      restoreDrill: "restore-drill.example.json",
      deploymentRegion: "deployment-region.example.json",
      deploymentRollback: "deployment-rollback.example.json",
      githubCi: "github-ci.example.json",
      kvkkInventory: "kvkk-inventory.example.json",
      identityMigration: "identity-migration.example.json",
      financialRetention: "financial-retention.example.json",
      uploadAv: "upload-av.example.json",
      observabilityUat: "observability-uat.example.json",
      externalMonitoring: "external-monitoring.example.json",
      adminMfa: "admin-mfa.example.json",
      aiReportSummary: "ai-report-summary.example.json",
      securityAudit: "security-audit.example.json",
      liveExamCycle: "live-exam-cycle.example.json",
      inlineUploadMigration: "inline-upload-content-migration.example.json",
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
      backupOffsite: "backup-offsite.json",
      walArchive: "wal-archive.json",
    })) {
      writeFileSync(`${smokeDir}/${file}`, `${JSON.stringify(summary.smokeEvidence[key], null, 2)}\n`);
    }

    writeFileSync(
      `${reportsDir}/github-ci.json`,
      `${JSON.stringify({ result: "PASS", ...summary.reports.githubCi, gaps: [] }, null, 2)}\n`,
    );

    const firstGatePayloads = {
      "traefik-https.json": {
        generatedAt: evidenceTime,
        result: "PASS",
        check: "traefik_https_smoke",
        environment: summary.smokeEvidence.traefikHttps.environment,
        checkedAt: evidenceTime,
        url: "https://staging.uzmanhocam.com/health",
        expectedStatus: 200,
        statusCode: 200,
        strictTransportSecurity: "max-age=31536000; includeSubDomains",
        commandsPassed: ["pnpm traefik:https:smoke"],
        gaps: [],
      },
      "alert-webhook.json": {
        generatedAt: evidenceTime,
        result: "PASS",
        check: "alert_webhook_smoke",
        environment: summary.smokeEvidence.alertWebhook.environment,
        checkedAt: evidenceTime,
        webhookUrl: "https://alerts.uzmanhocam.com/hooks/staging",
        statusCode: 200,
        authorizationScheme: "bearer",
        commandsPassed: ["pnpm alert:webhook:smoke"],
        gaps: [],
      },
      "backup-offsite.json": {
        generatedAt: evidenceTime,
        result: "PASS",
        check: "backup_offsite_smoke",
        environment: summary.smokeEvidence.backupOffsite.environment,
        checkedAt: evidenceTime,
        target: { protocol: "file", pathRedacted: true },
        markerSha256: "a".repeat(64),
        commandsPassed: ["pnpm backup:offsite:smoke"],
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
            {
              label: "Off-site backup smoke",
              script: "scripts/smoke-backup-offsite.mjs",
              evidenceFile: "backup-offsite.json",
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

    const originalDeploymentRegion = JSON.parse(readFileSync(`${reportsDir}/deployment-region.json`, "utf8"));
    const badDeploymentRegion = { ...originalDeploymentRegion, region: "tr-ankara-2" };
    writeFileSync(`${reportsDir}/deployment-region.json`, `${JSON.stringify(badDeploymentRegion, null, 2)}\n`);
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
    if (!reportNegativeOutput.includes("summary.reports.deploymentRegion.region reports/deployment-region.json ile eşleşmeli")) {
      console.error("Production evidence template kontrolü başarısız: staging release artifact bundle raw report negative beklenen hata yok.");
      console.error(reportNegativeOutput);
      process.exit(1);
    }
    writeFileSync(`${reportsDir}/deployment-region.json`, `${JSON.stringify(originalDeploymentRegion, null, 2)}\n`);

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
  env.DEPLOYMENT_REGION_TARGET = "http://evidence.uzmanhocam.com/deployment-region.json";

  const result = spawnSync(process.execPath, ["scripts/check-prod-env.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod env http evidence target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("DEPLOYMENT_REGION_TARGET file:// veya https:// URL olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: prod env http evidence target negative beklenen hata yok.");
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
    mkdirSync(realDirectory, { recursive: true });
    symlinkSync(realDirectory, symlinkDirectory, "dir");
    const symlinkParentResult = runProdEvidenceSummaryOutputNegative(join(symlinkDirectory, "release-summary.json"));
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
    mkdirSync(realDirectory, { recursive: true });
    symlinkSync(realDirectory, symlinkDirectory, "dir");
    const symlinkParentEnv = createValidProdEnvForNegativeCheck();
    symlinkParentEnv.TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE = join(symlinkDirectory, "traefik-https.json");
    runProdEvidenceSmokeEvidenceFileNegative(
      "prod evidence smoke file symlink parent negative",
      symlinkParentEnv,
      "TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE parent dizini symlink olmayan dizin olmalı.",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
  env.DEPLOYMENT_REGION_TARGET = "http://evidence.uzmanhocam.com/deployment-region.json";

  const result = spawnSync(process.execPath, ["scripts/check-prod-evidence.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod evidence http evidence target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("DEPLOYMENT_REGION_TARGET file:// veya https:// URL olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: prod evidence http evidence target negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEvidencePlaceholderEvidenceTargetNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.DEPLOYMENT_REGION_TARGET = "https://example.test/deployment-region.json";

  const result = spawnSync(process.execPath, ["scripts/check-prod-evidence.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod evidence placeholder evidence target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("DEPLOYMENT_REGION_TARGET production için gerçek https host olmalı.")) {
    console.error("Production evidence template kontrolü başarısız: prod evidence placeholder evidence target negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEvidenceTempFileEvidenceTargetNegativeCheck() {
  const env = createValidProdEnvForNegativeCheck();
  env.DEPLOYMENT_REGION_TARGET = "file:///tmp/deployment-region.json";

  const result = spawnSync(process.execPath, ["scripts/check-prod-evidence.mjs"], {
    env,
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error("Production evidence template kontrolü başarısız: prod evidence temp file evidence target negative beklenen şekilde kırılmadı.");
    process.exit(1);
  }

  if (!String(result.stderr).includes("DEPLOYMENT_REGION_TARGET production için lokal temp path olmamalı.")) {
    console.error("Production evidence template kontrolü başarısız: prod evidence temp file evidence target negative beklenen hata yok.");
    console.error(result.stderr);
    process.exit(1);
  }
}

function runProdEvidenceSymlinkEvidenceTargetNegativeCheck() {
  const rootParent = resolve("artifacts/prod-evidence-template-check");
  mkdirSync(rootParent, { recursive: true });
  const root = mkdtempSync(join(rootParent, "prod-evidence-symlink-"));
  const linkPath = join(root, "deployment-region.json");
  symlinkSync(resolve("docs/evidence-templates/deployment-region.example.json"), linkPath);

  try {
    const env = createValidProdEnvForNegativeCheck();
    env.DEPLOYMENT_REGION_TARGET = pathToFileURL(linkPath).href;

    const result = spawnSync(process.execPath, ["scripts/check-prod-evidence.mjs"], {
      env,
      encoding: "utf8",
    });

    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: prod evidence symlink evidence target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }

    if (!String(result.stderr).includes("DEPLOYMENT_REGION_TARGET production için symlink olmayan file artifact olmalı.")) {
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
  mkdirSync(realDirectory, { recursive: true });
  writeFileSync(
    join(realDirectory, "deployment-region.json"),
    readFileSync("docs/evidence-templates/deployment-region.example.json", "utf8"),
  );
  symlinkSync(realDirectory, symlinkDirectory, "dir");

  try {
    const env = createValidProdEnvForNegativeCheck();
    env.DEPLOYMENT_REGION_TARGET = pathToFileURL(join(symlinkDirectory, "deployment-region.json")).href;

    const result = spawnSync(process.execPath, ["scripts/check-prod-evidence.mjs"], {
      env,
      encoding: "utf8",
    });

    if (result.status === 0) {
      console.error("Production evidence template kontrolü başarısız: prod evidence symlink parent evidence target negative beklenen şekilde kırılmadı.");
      process.exit(1);
    }

    if (!String(result.stderr).includes("DEPLOYMENT_REGION_TARGET production için parent dizini symlink olmayan dizin olmalı.")) {
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
  env.TRAEFIK_HTTPS_SMOKE_URL = "https://other.uzmanhocam.com/health";

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
      ALERT_WEBHOOK_URL: "https://alerts.uzmanhocam.com/webhook",
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

function createValidProdEnvForNegativeCheck() {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    APP_URL: "https://app.uzmanhocam.com",
    API_URL: "https://api.uzmanhocam.com",
    WEB_URL: "https://app.uzmanhocam.com",
    DATABASE_URL: "postgresql://app_user:strong-password@db.uzmanhocam.internal:5432/uzman_hocam",
    DIRECT_DATABASE_URL: "postgresql://migration_user:strong-password@db.uzmanhocam.internal:5432/uzman_hocam",
    JWT_ACCESS_SECRET: "access-secret-123456789012345678901234",
    JWT_REFRESH_SECRET: "refresh-secret-12345678901234567890123",
    STUDENT_PII_ENCRYPTION_KEY: "student-pii-encryption-123456789012",
    STUDENT_PII_HASH_KEY: "student-pii-hash-123456789012345678",
    ADMIN_MFA_MODE: "required",
    ADMIN_MFA_SECRET_ENCRYPTION_KEY: "admin-mfa-secret-encryption-1234567",
    ADMIN_MFA_RECOVERY_HASH_KEY: "admin-mfa-recovery-hash-12345678901",
    ADMIN_MFA_CHALLENGE_SECRET: "admin-mfa-challenge-secret-123456789",
    ADMIN_MFA_ISSUER: "Uzman Hocam",
    AI_REPORT_SUMMARY_PROVIDER: "template",
    COOKIE_DOMAIN: "uzmanhocam.com",
    COOKIE_SECURE: "true",
    LOG_LEVEL: "info",
    LOG_ENABLED: "true",
    OPENAPI_UI_ENABLED: "false",
    API_RATE_LIMIT_ENABLED: "true",
    API_RATE_LIMIT_STORE: "redis",
    API_RATE_LIMIT_WINDOW_MS: "60000",
    API_RATE_LIMIT_MAX: "300",
    IDEMPOTENCY_STORE: "postgres",
    REPORT_PDF_RENDERER: "worker",
    REPORT_PDF_RENDER_TIMEOUT_MS: "30000",
    PERSISTENCE_DRIVER: "postgres",
    QUEUE_METRICS_ENABLED: "true",
    QUEUE_BOARD_BASIC_AUTH_USER: "ops-admin",
    QUEUE_BOARD_BASIC_AUTH_PASSWORD: "queue-board-password-1234567890123",
    SMS_PROVIDER: "netgsm",
    SMS_ALLOW_NOOP_IN_PRODUCTION: "false",
    SMS_SMOKE_TO: "+905551112233",
    SMS_SMOKE_BODY: "Uzman Hocam production SMS smoke",
    SMS_SMOKE_CONFIRM: "send",
    NETGSM_USERCODE: "netgsm-usercode",
    NETGSM_PASSWORD: "netgsm-password",
    NETGSM_MSG_HEADER: "UZMNHOCAM",
    NOTIFICATION_PROVIDER: "http",
    NOTIFICATION_ALLOW_NOOP_IN_PRODUCTION: "false",
    NOTIFICATION_HTTP_ENDPOINT: "https://notify.uzmanhocam.com/send",
    NOTIFICATION_HTTP_BEARER_TOKEN: "notification-bearer-token-1234567890",
    NOTIFICATION_SMOKE_EMAIL_TO: "ops@uzmanhocam.com",
    NOTIFICATION_SMOKE_PUSH_TO: "ops-device-token",
    NOTIFICATION_SMOKE_SUBJECT: "Uzman Hocam production notification smoke",
    NOTIFICATION_SMOKE_BODY: "Uzman Hocam production notification smoke",
    NOTIFICATION_SMOKE_CONFIRM: "send",
    SUPPORT_ATTACHMENT_STORAGE: "s3",
    HOMEWORK_MATERIAL_FILE_STORAGE: "s3",
    UPLOAD_AV_SCANNER: "clamav",
    CLAMAV_HOST: "clamav",
    CLAMAV_PORT: "3310",
    CLAMAV_TIMEOUT_MS: "5000",
    S3_BUCKET: "uzman-hocam-prod-assets",
    S3_ENDPOINT: "https://s3.tr-storage.uzmanhocam.com",
    S3_ACCESS_KEY_ID: "prod-access-key",
    S3_SECRET_ACCESS_KEY: "prod-secret-key",
    SENTRY_DSN: "https://1234567890abcdef@o123456.ingest.sentry.io/987654",
    NEXT_PUBLIC_SENTRY_DSN: "https://1234567890abcdef@o123456.ingest.sentry.io/987654",
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: "0.05",
    SENTRY_SEND_DEFAULT_PII: "false",
    SENTRY_SMOKE_CONFIRM: "send",
    SENTRY_SMOKE_MESSAGE: "Uzman Hocam production Sentry smoke",
    TRAEFIK_HTTPS_SMOKE_URL: "https://app.uzmanhocam.com/",
    BACKUP_PATH: "/var/backups/uzman-hocam",
    BACKUP_RETENTION_DAYS: "7",
    BACKUP_OFFSITE_TARGET: "s3://prod-offsite-archive/uzman-hocam/base",
    WAL_ARCHIVE_TARGET: "s3://prod-wal-archive/uzman-hocam/wal",
    ALERT_WEBHOOK_URL: "https://alerts.uzmanhocam.com/webhook",
    ALERT_WEBHOOK_TOKEN: "alert-webhook-token-123456789012345",
    ROLLBACK_IMAGE_TAG: "ghcr.io/uzman-hocam/uzman-hocam/api:2026-06-14.1",
  };

  for (const key of [
    "TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE",
    "SMS_PROVIDER_SMOKE_EVIDENCE_FILE",
    "NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE",
    "SENTRY_SMOKE_EVIDENCE_FILE",
    "ALERT_WEBHOOK_SMOKE_EVIDENCE_FILE",
    "BACKUP_OFFSITE_SMOKE_EVIDENCE_FILE",
    "WAL_ARCHIVE_SMOKE_EVIDENCE_FILE",
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
  ]) {
    env[key] = `file:///var/lib/uzman-hocam/evidence/${key.toLowerCase().replaceAll("_", "-")}.json`;
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
