import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateSmokeEvidencePayload } from "./smoke-evidence.mjs";

const artifactsTarget =
  process.env.STAGING_RELEASE_ARTIFACTS_TARGET ?? readArgValue("--artifacts-dir") ?? process.argv[2];
const allowExampleEvidence = process.env.STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE === "1";

const smokeArtifacts = new Map([
  ["traefikHttps", { file: "traefik-https.json", check: "traefik_https_smoke" }],
  ["smsProvider", { file: "sms-provider.json", check: "sms_provider_smoke" }],
  ["notificationProvider", { file: "notification-provider.json", check: "notification_provider_smoke" }],
  ["sentryEvent", { file: "sentry-event.json", check: "sentry_smoke" }],
  ["alertWebhook", { file: "alert-webhook.json", check: "alert_webhook_smoke" }],
  ["backupOffsite", { file: "backup-offsite.json", check: "backup_offsite_smoke" }],
  ["walArchive", { file: "wal-archive.json", check: "wal_archive_smoke" }],
]);
const firstGateSummaryKeys = new Map([
  ["Traefik HTTPS smoke", "traefikHttps"],
  ["Alert webhook smoke", "alertWebhook"],
  ["Off-site backup smoke", "backupOffsite"],
]);
const reportArtifacts = new Map([
  [
    "restoreDrill",
    {
      file: "restore-drill.json",
      script: "scripts/check-restore-drill-evidence.mjs",
      targetEnv: "RESTORE_DRILL_TARGET",
      allowEnv: "RESTORE_DRILL_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "deploymentRegion",
    {
      file: "deployment-region.json",
      script: "scripts/check-deployment-region-evidence.mjs",
      targetEnv: "DEPLOYMENT_REGION_TARGET",
      allowEnv: "DEPLOYMENT_REGION_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "deploymentRollback",
    {
      file: "deployment-rollback.json",
      script: "scripts/check-deployment-rollback-evidence.mjs",
      targetEnv: "DEPLOYMENT_ROLLBACK_TARGET",
      allowEnv: "DEPLOYMENT_ROLLBACK_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "githubCi",
    {
      file: "github-ci.json",
      script: "scripts/check-github-ci-evidence.mjs",
      targetEnv: "GITHUB_CI_EVIDENCE_TARGET",
      allowEnv: "GITHUB_CI_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "kvkkInventory",
    {
      file: "kvkk-inventory.json",
      script: "scripts/check-kvkk-inventory-evidence.mjs",
      targetEnv: "KVKK_INVENTORY_TARGET",
      allowEnv: "KVKK_INVENTORY_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "identityMigration",
    {
      file: "identity-migration.json",
      script: "scripts/check-identity-migration-evidence.mjs",
      targetEnv: "IDENTITY_MIGRATION_TARGET",
      allowEnv: "IDENTITY_MIGRATION_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "financialRetention",
    {
      file: "financial-retention.json",
      script: "scripts/check-financial-retention-evidence.mjs",
      targetEnv: "FINANCIAL_RETENTION_TARGET",
      allowEnv: "FINANCIAL_RETENTION_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "uploadAv",
    {
      file: "upload-av.json",
      script: "scripts/check-upload-av-evidence.mjs",
      targetEnv: "UPLOAD_AV_TARGET",
      allowEnv: "UPLOAD_AV_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "observabilityUat",
    {
      file: "observability-uat.json",
      script: "scripts/check-observability-uat-evidence.mjs",
      targetEnv: "OBSERVABILITY_UAT_TARGET",
      allowEnv: "OBSERVABILITY_UAT_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "externalMonitoring",
    {
      file: "external-monitoring.json",
      script: "scripts/check-external-monitoring-evidence.mjs",
      targetEnv: "EXTERNAL_MONITORING_TARGET",
      allowEnv: "EXTERNAL_MONITORING_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "adminMfa",
    {
      file: "admin-mfa.json",
      script: "scripts/check-admin-mfa-evidence.mjs",
      targetEnv: "ADMIN_MFA_EVIDENCE_TARGET",
      allowEnv: "ADMIN_MFA_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "aiReportSummary",
    {
      file: "ai-report-summary.json",
      script: "scripts/check-ai-report-summary-evidence.mjs",
      targetEnv: "AI_REPORT_SUMMARY_EVIDENCE_TARGET",
      allowEnv: "AI_REPORT_SUMMARY_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "securityAudit",
    {
      file: "security-audit.json",
      script: "scripts/check-security-audit-evidence.mjs",
      targetEnv: "SECURITY_AUDIT_TARGET",
      allowEnv: "SECURITY_AUDIT_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "liveExamCycle",
    {
      file: "live-exam-cycle.json",
      script: "scripts/check-live-exam-cycle-evidence.mjs",
      targetEnv: "LIVE_EXAM_CYCLE_TARGET",
      allowEnv: "LIVE_EXAM_CYCLE_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "inlineUploadMigration",
    {
      file: "inline-upload-content-migration.json",
      script: "scripts/check-inline-upload-content-migration-evidence.mjs",
      targetEnv: "INLINE_UPLOAD_CONTENT_MIGRATION_TARGET",
      allowEnv: "INLINE_UPLOAD_CONTENT_MIGRATION_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "rateLimit",
    {
      file: "rate-limit.json",
      script: "scripts/check-rate-limit-evidence.mjs",
      targetEnv: "RATE_LIMIT_EVIDENCE_TARGET",
      allowEnv: "RATE_LIMIT_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "rlsLive",
    {
      file: "rls-live.json",
      script: "scripts/check-rls-live-evidence.mjs",
      targetEnv: "RLS_LIVE_EVIDENCE_TARGET",
      allowEnv: "RLS_LIVE_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "uat",
    {
      file: "uat.json",
      script: "scripts/check-uat-evidence.mjs",
      targetEnv: "UAT_EVIDENCE_TARGET",
      allowEnv: "UAT_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
]);
const githubCiSummaryKeys = [
  "environment",
  "checkedAt",
  "repository",
  "commitSha",
  "branch",
  "workflow",
  "command",
  "jobs",
  "commandsPassed",
  "evidenceReferences",
];

if (!artifactsTarget) {
  fail(["STAGING_RELEASE_ARTIFACTS_TARGET veya --artifacts-dir zorunlu."]);
}

const artifactsDir = resolveArtifactsDir(artifactsTarget);
const failures = [];
requireDirectory(artifactsDir, failures, "artifactsDir");

const githubCiFile = resolve(artifactsDir, "reports", "github-ci.json");
const firstGatesManifestFile = resolve(artifactsDir, "first-gates", "first-gates-manifest.json");
const releaseSummaryFiles = existsSync(artifactsDir)
  ? readdirSync(artifactsDir)
      .filter((file) => /^release-summary-.+\.json$/.test(file))
      .sort()
      .map((file) => resolve(artifactsDir, file))
  : [];

requireFile(firstGatesManifestFile, failures, "first-gates/first-gates-manifest.json");
for (const { file } of reportArtifacts.values()) {
  requireFile(resolve(artifactsDir, "reports", file), failures, `reports/${file}`);
}
if (releaseSummaryFiles.length !== 1) {
  failures.push(`artifactsDir tam 1 release-summary-*.json içermeli; bulundu: ${releaseSummaryFiles.length}.`);
}

if (failures.length === 0) {
  for (const { file, script, targetEnv, allowEnv } of reportArtifacts.values()) {
    runChecker(script, {
      [targetEnv]: pathToFileURL(resolve(artifactsDir, "reports", file)).href,
      ...(allowExampleEvidence ? { [allowEnv]: "1" } : {}),
    });
  }
  runChecker("scripts/check-staging-first-gates-evidence.mjs", {
    STAGING_FIRST_GATES_TARGET: pathToFileURL(firstGatesManifestFile).href,
  });
  runChecker("scripts/check-production-evidence-summary.mjs", {
    PRODUCTION_EVIDENCE_SUMMARY_TARGET: pathToFileURL(releaseSummaryFiles[0]).href,
    ...(allowExampleEvidence ? { PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE: "1" } : {}),
  });
}

const reportFailures = failures.length === 0 ? validateArtifactBundle(releaseSummaryFiles[0], githubCiFile, firstGatesManifestFile) : failures;
if (reportFailures.length > 0) {
  fail(reportFailures);
}

console.log(
  `Staging release artifact bundle kontrolü geçti: ${releaseSummaryFiles[0].replace(`${process.cwd()}/`, "")}`,
);

function validateArtifactBundle(summaryFile, githubCiFilePath, manifestFilePath) {
  const output = [];
  const summary = readJsonFile(summaryFile, "release summary", output);
  const githubCi = readJsonFile(githubCiFilePath, "github-ci", output);
  const firstGatesManifest = readJsonFile(manifestFilePath, "first-gates manifest", output);
  if (!summary || !githubCi || !firstGatesManifest) return output;

  requireDateNotAfter(firstGatesManifest, output, "first-gates.generatedAt", "generatedAt", summary, "summary.generatedAt", "generatedAt");
  requireGithubCiMatchesSummary(summary, githubCi, output);
  requireReportFilesMatchSummary(summary, artifactsDir, output);
  requireSmokeFilesMatchSummary(summary, dirname(summaryFile), output);
  requireFirstGatesMatchSummary(summary, firstGatesManifest, manifestFilePath, output);

  return output;
}

function requireGithubCiMatchesSummary(summary, githubCi, output) {
  const embedded = summary?.reports?.githubCi;
  if (!embedded || typeof embedded !== "object" || Array.isArray(embedded)) {
    output.push("summary.reports.githubCi nesnesi zorunlu.");
    return;
  }

  for (const key of githubCiSummaryKeys) {
    if (stableStringify(embedded[key]) !== stableStringify(githubCi[key])) {
      output.push(`summary.reports.githubCi.${key} reports/github-ci.json ile eşleşmeli.`);
    }
  }
}

function requireReportFilesMatchSummary(summary, artifactsDirPath, output) {
  const embeddedReports = summary?.reports;
  if (!embeddedReports || typeof embeddedReports !== "object" || Array.isArray(embeddedReports)) {
    output.push("summary.reports nesnesi zorunlu.");
    return;
  }

  for (const [key, { file }] of reportArtifacts) {
    const reportFile = resolve(artifactsDirPath, "reports", file);
    const payload = readJsonFile(reportFile, `reports/${file}`, output);
    if (!payload) continue;

    const embedded = embeddedReports[key];
    if (!embedded || typeof embedded !== "object" || Array.isArray(embedded)) {
      output.push(`summary.reports.${key} nesnesi zorunlu.`);
      continue;
    }

    for (const embeddedKey of Object.keys(embedded)) {
      const expectedValue =
        key === "uat" && embeddedKey === "liveExamCyclePassed"
          ? Array.isArray(payload.commandsPassed) && payload.commandsPassed.includes("pnpm live:exam-cycle:check")
          : payload[embeddedKey];
      if (stableStringify(embedded[embeddedKey]) !== stableStringify(expectedValue)) {
        output.push(`summary.reports.${key}.${embeddedKey} reports/${file} ile eşleşmeli.`);
      }
    }
  }
}

function requireSmokeFilesMatchSummary(summary, summaryDir, output) {
  const smokeEvidence = summary?.smokeEvidence;
  if (!smokeEvidence || typeof smokeEvidence !== "object" || Array.isArray(smokeEvidence)) {
    output.push("summary.smokeEvidence nesnesi zorunlu.");
    return;
  }

  for (const [key, { file, check }] of smokeArtifacts) {
    const smokeFile = resolve(summaryDir, "smoke", file);
    requireFile(smokeFile, output, `smoke/${file}`);
    if (!existsSync(smokeFile)) continue;

    const payload = readJsonFile(smokeFile, `smoke/${file}`, output);
    if (!payload) continue;

    const smokeFailures = validateSmokeEvidencePayload(payload, {
      expectedCheck: check,
      allowedEnvironments: ["staging", "production"],
      label: `smoke/${file}`,
      allowExampleEvidence,
    });
    output.push(...smokeFailures);

    if (stableStringify(payload) !== stableStringify(smokeEvidence[key])) {
      output.push(`summary.smokeEvidence.${key} smoke/${file} ile birebir eşleşmeli.`);
    }
  }
}

function requireFirstGatesMatchSummary(summary, manifest, manifestPath, output) {
  if (!Array.isArray(manifest.checks)) {
    output.push("first-gates checks listesi zorunlu.");
    return;
  }

  const summaryGeneratedAt = summary?.generatedAt;
  for (const item of manifest.checks) {
    const summaryKey = firstGateSummaryKeys.get(item?.label);
    if (!summaryKey) continue;

    const evidencePath = resolve(dirname(manifestPath), item.evidenceFile);
    const payload = readJsonFile(evidencePath, `first-gates/${item.evidenceFile}`, output);
    if (!payload) continue;

    const summaryPayload = summary?.smokeEvidence?.[summaryKey];
    if (!summaryPayload || typeof summaryPayload !== "object" || Array.isArray(summaryPayload)) {
      output.push(`summary.smokeEvidence.${summaryKey} zorunlu.`);
      continue;
    }

    if (payload.check !== summaryPayload.check) {
      output.push(`first-gates/${item.evidenceFile}.check summary.smokeEvidence.${summaryKey}.check ile eşleşmeli.`);
    }
    if (payload.environment !== summaryPayload.environment) {
      output.push(`first-gates/${item.evidenceFile}.environment summary.smokeEvidence.${summaryKey}.environment ile eşleşmeli.`);
    }
    if (stableStringify(payload.commandsPassed) !== stableStringify(summaryPayload.commandsPassed)) {
      output.push(`first-gates/${item.evidenceFile}.commandsPassed summary.smokeEvidence.${summaryKey}.commandsPassed ile eşleşmeli.`);
    }
    requireDateNotAfter(payload, output, `first-gates/${item.evidenceFile}.generatedAt`, "generatedAt", summary, "summary.generatedAt", "generatedAt");
    requireDateNotAfter(payload, output, `first-gates/${item.evidenceFile}.checkedAt`, "checkedAt", summary, "summary.generatedAt", "generatedAt");
    requireDateNotAfter(
      payload,
      output,
      `first-gates/${item.evidenceFile}.generatedAt`,
      "generatedAt",
      summaryPayload,
      `summary.smokeEvidence.${summaryKey}.generatedAt`,
      "generatedAt",
    );
    requireDateNotAfter(
      payload,
      output,
      `first-gates/${item.evidenceFile}.checkedAt`,
      "checkedAt",
      summaryPayload,
      `summary.smokeEvidence.${summaryKey}.checkedAt`,
      "checkedAt",
    );

    if (typeof summaryGeneratedAt === "string" && Number.isNaN(Date.parse(summaryGeneratedAt))) {
      output.push("summary.generatedAt geçerli tarih olmalı.");
    }
  }
}

function runChecker(script, envPatch) {
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, ...envPatch },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveArtifactsDir(target) {
  if (target.startsWith("file://")) {
    return fileURLToPath(new URL(target));
  }
  return resolve(target);
}

function requireDirectory(path, output, label) {
  if (!existsSync(path)) {
    output.push(`${label} bulunamadı: ${path}`);
    return;
  }
  if (!statSync(path).isDirectory()) {
    output.push(`${label} dizin olmalı: ${path}`);
  }
}

function requireFile(path, output, label) {
  if (!existsSync(path)) {
    output.push(`${label} bulunamadı: ${path}`);
    return;
  }
  if (!statSync(path).isFile()) {
    output.push(`${label} dosya olmalı: ${path}`);
  }
}

function readJsonFile(path, label, output) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    output.push(`${label} geçerli JSON olmalı: ${path}`);
    return undefined;
  }
}

function requireDateNotAfter(source, output, sourceLabel, sourceKey, target, targetLabel, targetKey) {
  const sourceTimestamp = Date.parse(source?.[sourceKey]);
  const targetTimestamp = Date.parse(target?.[targetKey]);
  if (Number.isNaN(sourceTimestamp) || Number.isNaN(targetTimestamp)) return;
  if (sourceTimestamp > targetTimestamp) {
    output.push(`${sourceLabel} ${targetLabel} tarihinden sonra olamaz.`);
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function readArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail([`${name} için değer gerekli.`]);
  }
  return value;
}

function fail(messages) {
  console.error("Staging release artifact bundle kontrolü başarısız:");
  for (const message of messages) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}
