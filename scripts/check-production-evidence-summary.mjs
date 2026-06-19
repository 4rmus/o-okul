import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateSmokeEvidencePayload } from "./smoke-evidence.mjs";

const target = process.env.PRODUCTION_EVIDENCE_SUMMARY_TARGET ?? process.argv[2];
const allowExampleEvidence = process.env.PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE === "1";

const requiredSummaryKeys = ["result", "generatedAt", "nodeEnv", "appUrl", "apiUrl", "webUrl", "checks", "smokeEvidence", "reports"];
const requiredCheckItemKeys = ["label", "script", "status"];

const requiredChecks = new Map([
  ["Production env", "scripts/check-prod-env.mjs"],
  ["Traefik HTTPS", "scripts/smoke-traefik-https.mjs"],
  ["SMS provider", "scripts/smoke-sms-provider.mjs"],
  ["Notification provider", "scripts/smoke-notification-provider.mjs"],
  ["Sentry test event", "scripts/smoke-sentry-event.mjs"],
  ["Alert webhook", "scripts/smoke-alert-webhook.mjs"],
  ["WAL archive target", "scripts/smoke-wal-archive-target.mjs"],
  ["Report generation smoke", "scripts/smoke-report-generation-live.mjs"],
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
  ["iSEM optical pipeline evidence", "scripts/check-isem-optical-pipeline-evidence.mjs"],
  ["Inline upload migration evidence", "scripts/check-inline-upload-content-migration-evidence.mjs"],
  ["Rate limit Redis evidence", "scripts/check-rate-limit-evidence.mjs"],
  ["RLS live evidence", "scripts/check-rls-live-evidence.mjs"],
  ["UAT evidence", "scripts/check-uat-evidence.mjs"],
]);

const requiredSmokeEvidence = new Map([
  ["traefikHttps", "traefik_https_smoke"],
  ["smsProvider", "sms_provider_smoke"],
  ["notificationProvider", "notification_provider_smoke"],
  ["sentryEvent", "sentry_smoke"],
  ["alertWebhook", "alert_webhook_smoke"],
  ["walArchive", "wal_archive_smoke"],
  ["reportGeneration", "report_generation_smoke"],
]);

const requiredReports = {
  restoreDrill: ["environment", "drillDate", "sourceBackup", "targetDatabase", "tableCounts"],
  deploymentRegion: [
    "environment",
    "checkedAt",
    "provider",
    "region",
    "datacenterCountryCode",
    "evidenceReference",
    "servicesVerified",
  ],
  deploymentRollback: [
    "environment",
    "checkedAt",
    "releaseCandidate",
    "failedImageTag",
    "rollbackImageTag",
    "failureInjected",
    "failureMode",
    "migrationRollbackSafe",
    "commandsPassed",
    "servicesVerified",
    "evidenceReferences",
  ],
  githubCi: [
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
  ],
  kvkkInventory: ["environment", "checkedAt", "inventorySource", "dataSubjectCounts", "purgeCoverage", "auditActionsVerified"],
  identityMigration: ["environment", "checkedAt", "migrationDecision", "subjects", "invitationFlow", "verifications"],
  financialRetention: ["environment", "checkedAt", "policyDecision", "financialRecords", "purgeBehaviorVerified"],
  uploadAv: ["environment", "checkedAt", "scannerDecision", "uploadSurfaces", "scanResults"],
  observabilityUat: [
    "environment",
    "checkedAt",
    "prometheusScrapeOk",
    "grafanaDashboardOk",
    "lokiLogPanelOk",
    "alertWebhookStatus",
    "alertsVerified",
    "evidenceReferences",
  ],
  externalMonitoring: ["environment", "checkedAt", "provider", "monitoringNode", "monitorsVerified", "outageDrill", "evidenceReferences"],
  adminMfa: ["environment", "checkedAt", "policy", "enrollment", "loginVerification", "commandsPassed", "evidenceReferences"],
  aiReportSummary: [
    "environment",
    "checkedAt",
    "provider",
    "kvkk",
    "externalAiStopRule",
    "generation",
    "validation",
    "commandsPassed",
    "evidenceReferences",
  ],
  securityAudit: ["environment", "checkedAt", "prodEnvCheckOk", "httpsOk", "rlsLiveCheckOk", "noCriticalFindings", "evidenceReferences"],
  liveExamCycle: [
    "environment",
    "checkedAt",
    "tester",
    "releaseCandidate",
    "appUrl",
    "apiUrl",
    "commandsPassed",
    "examCycle",
    "evidenceReferences",
  ],
  isemOpticalPipeline: [
    "generatedAt",
    "environment",
    "checkedAt",
    "parserConfigVersion",
    "answerKeyVersion",
    "answerKeyQuestionCount",
    "bookletVariantCount",
    "counts",
    "pipeline",
    "sampleScores",
    "hashes",
    "thresholds",
    "pipelineDurationMs",
    "commandsPassed",
  ],
  inlineUploadMigration: ["environment", "checkedAt", "storageMode", "dryRun", "migration", "commandsPassed", "evidenceReferences"],
  rateLimit: ["environment", "checkedAt", "config", "instances", "apiRateLimit", "loginAttemptLimiter", "commandsPassed", "evidenceReferences"],
  rlsLive: ["environment", "checkedAt", "schema", "isolation", "loadSmoke", "commandsPassed", "evidenceReferences"],
  uat: [
    "environment",
    "checkedAt",
    "tester",
    "releaseCandidate",
    "rollbackImageTag",
    "restoreBackupReference",
    "liveExamCyclePassed",
    "flowsVerified",
    "journeyScenariosVerified",
    "commandsPassed",
  ],
};
const expectedUatJourneyScenarios = [
  ["UAT-SYS-01", "SYSTEM_ADMIN"],
  ["UAT-SYS-02", "SYSTEM_ADMIN"],
  ["UAT-SYS-03", "SYSTEM_ADMIN"],
  ["UAT-SYS-04", "SYSTEM_ADMIN"],
  ["UAT-KURUM-01", "TENANT_ADMIN"],
  ["UAT-KURUM-02", "TENANT_ADMIN"],
  ["UAT-KURUM-03", "TENANT_ADMIN"],
  ["UAT-KURUM-04", "TENANT_ADMIN"],
  ["UAT-KURUM-05", "TENANT_ADMIN"],
  ["UAT-KURUM-06", "TENANT_ADMIN"],
  ["UAT-KURUM-07", "TENANT_ADMIN"],
  ["UAT-KURUM-08", "TENANT_ADMIN"],
  ["UAT-TEACHER-01", "TEACHER"],
  ["UAT-TEACHER-02", "TEACHER"],
  ["UAT-TEACHER-03", "TEACHER"],
  ["UAT-STUDENT-01", "STUDENT"],
  ["UAT-STUDENT-02", "STUDENT"],
  ["UAT-STUDENT-03", "STUDENT"],
  ["UAT-GUARDIAN-01", "GUARDIAN"],
  ["UAT-GUARDIAN-02", "GUARDIAN"],
  ["UAT-GUARDIAN-03", "GUARDIAN"],
];
const expectedUatCommandsPassed = [
  "pnpm run ci",
  "pnpm prod:env:check",
  "pnpm db:rls:check:live",
  "pnpm raw-import:smoke",
  "pnpm report-generation:smoke",
  "pnpm live:exam-cycle:check",
  "pnpm queue:smoke",
  "pnpm live:onboarding:smoke",
  "pnpm live:ui-worker:smoke",
  "pnpm sms:smoke",
  "pnpm notification:smoke",
  "pnpm traefik:https:smoke",
];
const externalMonitoringPublicEdgeMonitors = ["API /health", "API /health/ready", "Web login", "Traefik TLS certificate"];

if (!target) {
  fail(["PRODUCTION_EVIDENCE_SUMMARY_TARGET veya dosya argümanı boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? new URL(target) : pathToFileURL(target);
} catch {
  fail(["PRODUCTION_EVIDENCE_SUMMARY_TARGET file:// veya https:// URL olmalı."]);
}

if (!isAllowedEvidenceTargetUrl(targetUrl)) {
  fail(["PRODUCTION_EVIDENCE_SUMMARY_TARGET file:// veya https:// URL olmalı."]);
}

const summary = await readJsonTarget(targetUrl);
const failures = validateSummary(summary);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Production evidence summary kontrolü geçti: ${summary.generatedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url, "PRODUCTION_EVIDENCE_SUMMARY_TARGET"));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Production evidence summary okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["PRODUCTION_EVIDENCE_SUMMARY_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url, label) {
  const filePath = fileURLToPath(url);
  await assertParentPathAllowed(dirname(filePath), label);

  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail([`${label} okunabilir file:// artifact olmalı.`]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail([`${label} symlink olmayan file:// artifact olmalı.`]);
  }

  return readFile(filePath, "utf8");
}

async function assertParentPathAllowed(parentPath, label) {
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
      const failure =
        label === "PRODUCTION_EVIDENCE_SUMMARY_TARGET"
          ? "PRODUCTION_EVIDENCE_SUMMARY_TARGET parent dizini symlink olmayan dizin olmalı."
          : `${label} parent dizini symlink olmayan dizin olmalı.`;
      fail([failure]);
    }
  }
}

function isAllowedEvidenceTargetUrl(url) {
  return (
    (url.protocol === "file:" && !isLocalTempEvidenceTargetUrl(url)) ||
    (url.protocol === "https:" && !isPlaceholderEvidenceTargetHost(url.hostname))
  );
}

function isPlaceholderEvidenceTargetHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".test") ||
    normalized === "example.com" ||
    normalized.endsWith(".example.com") ||
    normalized.includes("example") ||
    normalized.includes("__set") ||
    normalized.includes("placeholder")
  );
}

function isLocalTempEvidenceTargetUrl(url) {
  const path = fileURLToPath(url).replace(/\/+$/g, "") || "/";
  return path === "/tmp" || path.startsWith("/tmp/") || path === "/var/tmp" || path.startsWith("/var/tmp/");
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["Production evidence summary geçerli JSON olmalı."]);
  }
}

function validateSummary(summary) {
  const failures = [];

  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    failures.push("summary nesnesi zorunlu.");
    return failures;
  }

  requireExpectedObjectKeys(summary, requiredSummaryKeys, failures, "summary");
  requireEqual(summary, failures, "result", "PASS");
  requireEqual(summary, failures, "nodeEnv", "production");
  requireDate(summary, failures, "generatedAt");
  requireDateNotInFuture(summary, failures, "generatedAt");
  requireHttpsUrl(summary, failures, "appUrl");
  requireHttpsUrl(summary, failures, "apiUrl");
  requireHttpsUrl(summary, failures, "webUrl");
  requireChecks(summary, failures);
  requireSmokeEvidence(summary, failures);
  requireReports(summary, failures);
  requireNoPlaceholderValues(summary, failures, "summary");

  return failures;
}

function requireChecks(summary, failures) {
  if (!Array.isArray(summary.checks)) {
    failures.push("checks listesi zorunlu.");
    return;
  }

  requireExpectedCheckSet(summary.checks, failures, "checks");

  for (const [label, expectedScript] of requiredChecks) {
    const item = summary.checks.find((candidate) => candidate?.label === label);
    if (!item) {
      failures.push(`checks eksik: ${label}`);
      continue;
    }
    if (item.status !== "PASS") {
      failures.push(`checks.${label} PASS olmalı.`);
    }
    if (item.script !== expectedScript) {
      failures.push(`checks.${label}.script ${expectedScript} olmalı.`);
    }
  }
}

function requireExpectedCheckSet(checks, failures, label) {
  const expectedLabels = new Set(requiredChecks.keys());
  const seenLabels = new Set();

  if (checks.length !== requiredChecks.size) {
    failures.push(`${label} tam ${requiredChecks.size} madde içermeli.`);
  }

  for (const item of checks) {
    const itemLabel = item?.label;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      failures.push(`${label} madde nesnesi olmalı.`);
      continue;
    }
    requireExpectedObjectKeys(item, requiredCheckItemKeys, failures, `${label}.${typeof itemLabel === "string" ? itemLabel : "unknown"}`);
    if (typeof itemLabel !== "string" || itemLabel.trim() === "") {
      failures.push(`${label}.label boş olmayan string olmalı.`);
      continue;
    }
    if (!expectedLabels.has(itemLabel)) {
      failures.push(`${label} beklenmeyen madde içeriyor: ${itemLabel}`);
    }
    if (seenLabels.has(itemLabel)) {
      failures.push(`${label} tekrarlı madde içeriyor: ${itemLabel}`);
    }
    seenLabels.add(itemLabel);
  }
}

function requireExpectedObjectKeys(value, expectedKeys, failures, label) {
  const expected = [...expectedKeys];
  const expectedSet = new Set(expected);
  const actual = Object.keys(value);

  if (actual.length !== expected.length) {
    failures.push(`${label} tam ${expected.length} alan içermeli.`);
  }

  for (const key of expected) {
    if (!(key in value)) {
      failures.push(`${label} eksik alan içeriyor: ${key}`);
    }
  }

  for (const key of actual) {
    if (!expectedSet.has(key)) {
      failures.push(`${label} beklenmeyen alan içeriyor: ${key}`);
    }
  }
}

function requireSmokeEvidence(summary, failures) {
  const value = requireObject(summary, failures, "smokeEvidence");
  if (!value) return;

  requireExpectedObjectKeys(value, requiredSmokeEvidence.keys(), failures, "smokeEvidence");

  for (const [key, expectedCheck] of requiredSmokeEvidence) {
    failures.push(
      ...validateSmokeEvidencePayload(value[key], {
        expectedCheck,
        allowedEnvironments: ["staging", "production"],
        label: `smokeEvidence.${key}`,
        allowExampleEvidence,
      }),
    );
    if (value[key]) {
      requireObjectEqual(value[key], failures, `smokeEvidence.${key}.environment`, "environment", "production");
      if (key === "traefikHttps") {
        requireMatchingUrlOrigin(value[key], failures, "smokeEvidence.traefikHttps.url", "url", summary, "webUrl", "webUrl");
      }
      requireDateNotAfter(value[key], failures, `smokeEvidence.${key}.generatedAt`, "generatedAt", summary, "generatedAt");
    }
  }
}

function requireReports(summary, failures) {
  const reports = requireObject(summary, failures, "reports");
  if (!reports) return;

  requireExpectedObjectKeys(reports, Object.keys(requiredReports), failures, "reports");

  for (const [key, requiredKeys] of Object.entries(requiredReports)) {
    const report = requireObject(reports, failures, `reports.${key}`, key);
    if (!report) continue;

    requireExpectedObjectKeys(report, requiredKeys, failures, `reports.${key}`);

    const expectedEnvironment = key === "githubCi" ? "github-actions" : "production";
    requireObjectEqual(report, failures, `reports.${key}.environment`, "environment", expectedEnvironment);

    const dateKey = key === "restoreDrill" ? "drillDate" : "checkedAt";
    if (dateKey in report) {
      requireObjectDate(report, failures, `reports.${key}.${dateKey}`, dateKey);
      requireDateNotInFuture(report, failures, `reports.${key}.${dateKey}`, dateKey);
      requireDateNotAfter(report, failures, `reports.${key}.${dateKey}`, dateKey, summary, "generatedAt");
    }
  }

  requireObjectEqual(reports.deploymentRegion, failures, "reports.deploymentRegion.datacenterCountryCode", "datacenterCountryCode", "TR");
  requireObjectEqual(reports.externalMonitoring, failures, "reports.externalMonitoring.provider", "provider", "self-hosted-uptime-kuma");
  requireExternalMonitoringPublicEdge(reports.externalMonitoring, summary, failures);
  requireExternalMonitoringOutageDrill(reports.externalMonitoring, failures);
  requireObjectTrue(reports.securityAudit, failures, "reports.securityAudit.prodEnvCheckOk", "prodEnvCheckOk");
  requireObjectTrue(reports.securityAudit, failures, "reports.securityAudit.httpsOk", "httpsOk");
  requireObjectTrue(reports.securityAudit, failures, "reports.securityAudit.rlsLiveCheckOk", "rlsLiveCheckOk");
  requireObjectTrue(reports.securityAudit, failures, "reports.securityAudit.noCriticalFindings", "noCriticalFindings");
  requireUatJourneyScenarios(reports.uat, failures);
  requireObjectTrue(reports.uat, failures, "reports.uat.liveExamCyclePassed", "liveExamCyclePassed");
  requireMatchingString(
    reports.liveExamCycle,
    failures,
    "reports.liveExamCycle.releaseCandidate",
    "releaseCandidate",
    reports.uat,
    "reports.uat.releaseCandidate",
    "releaseCandidate",
  );
  requireMatchingString(
    reports.liveExamCycle,
    failures,
    "reports.liveExamCycle.appUrl",
    "appUrl",
    summary,
    "appUrl",
    "appUrl",
  );
  requireMatchingString(
    reports.liveExamCycle,
    failures,
    "reports.liveExamCycle.apiUrl",
    "apiUrl",
    summary,
    "apiUrl",
    "apiUrl",
  );
  requireMatchingString(
    reports.uat,
    failures,
    "reports.uat.releaseCandidate",
    "releaseCandidate",
    reports.deploymentRollback,
    "reports.deploymentRollback.releaseCandidate",
    "releaseCandidate",
  );
  requireMatchingString(
    reports.uat,
    failures,
    "reports.uat.rollbackImageTag",
    "rollbackImageTag",
    reports.deploymentRollback,
    "reports.deploymentRollback.rollbackImageTag",
    "rollbackImageTag",
  );
  requireMatchingString(
    reports.uat,
    failures,
    "reports.uat.restoreBackupReference",
    "restoreBackupReference",
    reports.restoreDrill,
    "reports.restoreDrill.sourceBackup",
    "sourceBackup",
  );
  requireExactStringSet(reports.uat?.commandsPassed, failures, "reports.uat.commandsPassed", expectedUatCommandsPassed);
}

function requireNoPlaceholderValues(value, failures, label) {
  if (allowExampleEvidence) return;
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => requireNoPlaceholderValues(item, failures, `${label}.${index}`));
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    const itemLabel = `${label}.${key}`;
    if (typeof item === "string" && hasPlaceholderToken(item)) {
      failures.push(`${itemLabel} production için örnek/placeholder/redacted değer olmamalı.`);
      continue;
    }
    if (item && typeof item === "object") {
      requireNoPlaceholderValues(item, failures, itemLabel);
    }
  }
}

function requireObject(scope, failures, label, key = label) {
  const value = scope?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return undefined;
  }
  return value;
}

function requireEqual(scope, failures, key, expected) {
  if (scope?.[key] !== expected) {
    failures.push(`${key} ${expected} olmalı.`);
  }
}

function requireObjectEqual(scope, failures, label, key, expected) {
  if (scope?.[key] !== expected) {
    failures.push(`${label} ${expected} olmalı.`);
  }
}

function requireObjectTrue(scope, failures, label, key) {
  if (scope?.[key] !== true) {
    failures.push(`${label} true olmalı.`);
  }
}

function requireMatchingString(firstScope, failures, firstLabel, firstKey, secondScope, secondLabel, secondKey) {
  if (firstScope?.[firstKey] !== secondScope?.[secondKey]) {
    failures.push(`${firstLabel} ${secondLabel} ile eşleşmeli.`);
  }
}

function requireObjectStringList(scope, failures, label, key, minLength) {
  const value = scope?.[key];
  if (!Array.isArray(value) || value.length < minLength) {
    failures.push(`${label} en az ${minLength} madde içermeli.`);
  }
}

function requireUatJourneyScenarios(scope, failures) {
  const value = scope?.journeyScenariosVerified;
  if (!Array.isArray(value) || value.length !== expectedUatJourneyScenarios.length) {
    failures.push(`reports.uat.journeyScenariosVerified tam ${expectedUatJourneyScenarios.length} senaryo içermeli.`);
    return;
  }

  const expected = new Map(expectedUatJourneyScenarios);
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      failures.push(`reports.uat.journeyScenariosVerified.${index} senaryo nesnesi olmalı.`);
      continue;
    }
    const keys = Object.keys(item).sort();
    const expectedKeys = ["evidence", "id", "persona", "status"];
    if (stableStringify(keys) !== stableStringify(expectedKeys)) {
      failures.push(`reports.uat.journeyScenariosVerified.${index} tam id/persona/status/evidence alanlarını içermeli.`);
    }
    if (typeof item.id !== "string" || !item.id.startsWith("UAT-")) {
      failures.push(`reports.uat.journeyScenariosVerified.${index}.id UAT-* olmalı.`);
    } else if (!expected.has(item.id)) {
      failures.push(`reports.uat.journeyScenariosVerified beklenmeyen senaryo içeriyor: ${item.id}`);
    } else if (seen.has(item.id)) {
      failures.push(`reports.uat.journeyScenariosVerified tekrarlı senaryo içeriyor: ${item.id}`);
    } else {
      seen.add(item.id);
      if (item.persona !== expected.get(item.id)) {
        failures.push(`reports.uat.journeyScenariosVerified.${item.id}.persona ${expected.get(item.id)} olmalı.`);
      }
    }
    if (item.status !== "PASS") {
      failures.push(`reports.uat.journeyScenariosVerified.${index}.status PASS olmalı.`);
    }
    if (!Array.isArray(item.evidence) || item.evidence.length === 0 || item.evidence.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
      failures.push(`reports.uat.journeyScenariosVerified.${index}.evidence boş olmayan metin listesi olmalı.`);
    }
  }

  for (const [id] of expectedUatJourneyScenarios) {
    if (!seen.has(id)) {
      failures.push(`reports.uat.journeyScenariosVerified eksik: ${id}`);
    }
  }
}

function requireExternalMonitoringPublicEdge(scope, summary, failures) {
  const monitors = scope?.monitorsVerified;
  if (!Array.isArray(monitors)) {
    failures.push("reports.externalMonitoring.monitorsVerified alan listesi zorunlu.");
    return;
  }

  for (const name of externalMonitoringPublicEdgeMonitors) {
    const monitor = monitors.find((candidate) => candidate && typeof candidate === "object" && candidate.name === name);
    if (!monitor) {
      failures.push(`reports.externalMonitoring.monitorsVerified eksik: ${name}`);
      continue;
    }
    requireObjectHttpsUrl(monitor, failures, `reports.externalMonitoring.monitorsVerified.${name}.url`, "url");
    requireMatchingUrlOrigin(
      monitor,
      failures,
      `reports.externalMonitoring.monitorsVerified.${name}.url`,
      "url",
      summary,
      "webUrl",
      "webUrl",
    );
  }
}

function requireExternalMonitoringOutageDrill(scope, failures) {
  const drill = requireObject(scope, failures, "reports.externalMonitoring.outageDrill", "outageDrill");
  if (!drill) return;

  for (const key of ["inducedAt", "detectedAt", "webhookDeliveredAt", "recoveredAt"]) {
    requireObjectDate(drill, failures, `reports.externalMonitoring.outageDrill.${key}`, key);
  }

  requireDateOrder(
    drill,
    failures,
    "reports.externalMonitoring.outageDrill.inducedAt",
    "inducedAt",
    "reports.externalMonitoring.outageDrill.detectedAt",
    "detectedAt",
  );
  requireDateOrder(
    drill,
    failures,
    "reports.externalMonitoring.outageDrill.detectedAt",
    "detectedAt",
    "reports.externalMonitoring.outageDrill.webhookDeliveredAt",
    "webhookDeliveredAt",
  );
  requireDateOrder(
    drill,
    failures,
    "reports.externalMonitoring.outageDrill.webhookDeliveredAt",
    "webhookDeliveredAt",
    "reports.externalMonitoring.outageDrill.recoveredAt",
    "recoveredAt",
  );
  requireLatencyMatches(
    drill,
    failures,
    "reports.externalMonitoring.outageDrill.detectionLatencySeconds",
    "detectionLatencySeconds",
    "inducedAt",
    "detectedAt",
  );
  requireLatencyMatches(
    drill,
    failures,
    "reports.externalMonitoring.outageDrill.webhookDeliveryLatencySeconds",
    "webhookDeliveryLatencySeconds",
    "inducedAt",
    "webhookDeliveredAt",
  );
}

function requireExactStringSet(value, failures, label, expected) {
  if (!Array.isArray(value)) {
    failures.push(`${label} listesi zorunlu.`);
    return;
  }

  if (value.length !== expected.length) {
    failures.push(`${label} tam ${expected.length} madde içermeli.`);
  }

  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label} boş olmayan metinlerden oluşmalı.`);
      continue;
    }
    if (!expected.includes(item)) {
      failures.push(`${label} beklenmeyen madde içeriyor: ${item}`);
    }
  }

  for (const expectedItem of expected) {
    if (!value.includes(expectedItem)) {
      failures.push(`${label} eksik: ${expectedItem}`);
    }
  }
}

function requireDate(scope, failures, key) {
  const value = scope?.[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${key} geçerli tarih olmalı.`);
  }
}

function requireObjectDate(scope, failures, label, key) {
  const value = scope?.[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${label} geçerli tarih olmalı.`);
  }
}

function requireDateNotInFuture(scope, failures, label, key = label) {
  if (allowExampleEvidence) return;

  const value = scope?.[key];
  const timestamp = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(timestamp)) return;

  const clockSkewMs = 5 * 60 * 1000;
  if (timestamp > Date.now() + clockSkewMs) {
    failures.push(`${label} gelecekte olamaz.`);
  }
}

function requireDateNotAfter(scope, failures, firstLabel, firstKey, secondScope, secondKey) {
  const first = Date.parse(scope?.[firstKey]);
  const second = Date.parse(secondScope?.[secondKey]);
  if (Number.isNaN(first) || Number.isNaN(second)) return;
  if (first > second) {
    failures.push(`${firstLabel} ${secondKey} tarihinden sonra olamaz.`);
  }
}

function requireDateOrder(scope, failures, firstLabel, firstKey, secondLabel, secondKey) {
  const first = Date.parse(scope?.[firstKey]);
  const second = Date.parse(scope?.[secondKey]);
  if (Number.isNaN(first) || Number.isNaN(second)) return;
  if (first > second) {
    failures.push(`${firstLabel} ${secondLabel} sonrasında olamaz.`);
  }
}

function requireLatencyMatches(scope, failures, label, key, startKey, endKey) {
  const start = Date.parse(scope?.[startKey]);
  const end = Date.parse(scope?.[endKey]);
  const value = scope?.[key];
  if (Number.isNaN(start) || Number.isNaN(end) || !Number.isInteger(value)) return;

  const seconds = Math.round((end - start) / 1000);
  if (value !== seconds) {
    failures.push(`${label} ${startKey}/${endKey} farkıyla eşleşmeli.`);
  }
}

function requireHttpsUrl(scope, failures, key) {
  const value = scope?.[key];
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      failures.push(`${key} https URL olmalı.`);
      return;
    }
    if (!allowExampleEvidence && isPlaceholderHost(url.hostname)) {
      failures.push(`${key} production için gerçek host olmalı.`);
    }
  } catch {
    failures.push(`${key} geçerli URL olmalı.`);
  }
}

function requireObjectHttpsUrl(scope, failures, label, key) {
  const value = scope?.[key];
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

function requireMatchingUrlOrigin(firstScope, failures, firstLabel, firstKey, secondScope, secondLabel, secondKey) {
  const first = firstScope?.[firstKey];
  const second = secondScope?.[secondKey];
  if (typeof first !== "string" || typeof second !== "string") return;

  try {
    if (new URL(first).origin !== new URL(second).origin) {
      failures.push(`${firstLabel} ${secondLabel} origin'i ile eşleşmeli.`);
    }
  } catch {
    // URL format errors are reported by the field-specific URL validators.
  }
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
  const normalized = value.toLowerCase();
  return (
    normalized.includes("example") ||
    normalized.includes("redacted") ||
    normalized.includes("__set") ||
    normalized.includes("localhost") ||
    normalized.includes(".test") ||
    normalized.includes("backup-bucket") ||
    normalized.includes("provider-console-or-contract-reference")
  );
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

function fail(failures) {
  console.error("Production evidence summary kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
