import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.AI_REPORT_SUMMARY_EVIDENCE_TARGET;
const allowExampleEvidence = process.env.AI_REPORT_SUMMARY_ALLOW_EXAMPLE_EVIDENCE === "1";
const aiReportSummaryTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "provider",
  "kvkk",
  "externalAiStopRule",
  "generation",
  "validation",
  "commandsPassed",
  "evidenceReferences",
  "gaps",
];
const providerKeys = [
  "mode",
  "featureFlagEnv",
  "evidenceTargetEnv",
  "externalProvider",
  "productionExternalAiEnabled",
  "templateFallbackAvailable",
];
const kvkkKeys = ["piiSentToModel", "fieldsSent", "excludedFields", "overseasTransferAssessment"];
const requiredFieldsSent = [
  "total.net",
  "total.standardScore",
  "branches.branch",
  "branches.net",
  "classes.averages.net",
  "statistics.rank",
];
const requiredExcludedFields = ["studentId", "studentName", "guardianName", "tcKimlikNo", "phone", "email", "address"];
const externalAiStopRuleKeys = [
  "kvkkAssessmentRequired",
  "productOwnerApprovalRequired",
  "teacherReviewRequired",
  "anthropicEnabledInProduction",
  "decisionReference",
];
const templateGenerationKeys = [
  "templateSummaryGenerated",
  "studentCommentaryGenerated",
  "teacherActionDraftGenerated",
  "teacherReviewRequired",
  "disclaimerIncluded",
  "deterministicOutput",
  "outputStoredInSnapshot",
];
const disabledGenerationKeys = [
  "featureDisabled",
  "templateSummaryGenerated",
  "studentCommentaryGenerated",
  "teacherActionDraftGenerated",
  "deterministicOutput",
  "outputStoredInSnapshot",
];
const templateValidationKeys = [
  "piiLeakageCheckPassed",
  "logsExcludePromptResponse",
  "externalProviderNotCalled",
  "templateRegressionPassed",
];
const disabledValidationKeys = ["piiLeakageCheckPassed", "logsExcludePromptResponse", "externalProviderNotCalled"];
const requiredCoreCommands = [
  "pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/report-generation-job.test.ts",
  "pnpm --filter @uzman-hocam/api exec vitest run src/report/report-generation.service.test.ts",
];

if (!target) {
  fail(["AI_REPORT_SUMMARY_EVIDENCE_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["AI_REPORT_SUMMARY_EVIDENCE_TARGET file://, http:// veya https:// URL olmalı."]);
}

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`AI karne özeti kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readFile(fileURLToPath(url), "utf8"));
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`AI karne özeti raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["AI_REPORT_SUMMARY_EVIDENCE_TARGET yalnız file://, http:// veya https:// destekler."]);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["AI karne özeti raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, aiReportSummaryTopLevelKeys, failures, "aiReportSummary")) {
    return failures;
  }

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireProvider(report.provider, failures);
  requireKvkk(report.kvkk, failures);
  requireStopRule(report.externalAiStopRule, failures);
  requireGeneration(report.generation, report.provider?.mode, failures);
  requireValidation(report.validation, report.provider?.mode, failures);
  requireCommandsPassed(report.commandsPassed, failures);
  requireStringArray(report.evidenceReferences, failures, "evidenceReferences");
  requireEvidenceReferences(report.evidenceReferences, failures);
  requireEmptyArray(report, failures, "gaps");

  return failures;
}

function requireProvider(provider, failures) {
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    failures.push("provider nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(provider, providerKeys, failures, "provider");
  requireOneOf(provider, failures, "provider.mode", ["disabled", "template"], "mode");
  requireObjectEqual(provider, failures, "provider.featureFlagEnv", "featureFlagEnv", "AI_REPORT_SUMMARY_PROVIDER");
  requireObjectEqual(provider, failures, "provider.evidenceTargetEnv", "evidenceTargetEnv", "AI_REPORT_SUMMARY_EVIDENCE_TARGET");
  requireObjectEqual(provider, failures, "provider.externalProvider", "externalProvider", "disabled");
  requireObjectFalse(provider, failures, "provider.productionExternalAiEnabled", "productionExternalAiEnabled");
  requireObjectTrue(provider, failures, "provider.templateFallbackAvailable", "templateFallbackAvailable");
}

function requireKvkk(kvkk, failures) {
  if (!kvkk || typeof kvkk !== "object" || Array.isArray(kvkk)) {
    failures.push("kvkk nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(kvkk, kvkkKeys, failures, "kvkk");
  requireObjectFalse(kvkk, failures, "kvkk.piiSentToModel", "piiSentToModel");
  requireExactStringSet(kvkk.fieldsSent, failures, "kvkk.fieldsSent", requiredFieldsSent, "alan");
  requireExactStringSet(kvkk.excludedFields, failures, "kvkk.excludedFields", requiredExcludedFields, "alan");
  for (const field of kvkk.fieldsSent ?? []) {
    if (hasPiiFieldName(field)) {
      failures.push(`kvkk.fieldsSent PII alanı içeremez: ${field}`);
    }
  }
  requireObjectString(kvkk, failures, "kvkk.overseasTransferAssessment", "overseasTransferAssessment");
  requireNonPlaceholderString(kvkk, failures, "kvkk.overseasTransferAssessment", "overseasTransferAssessment");
}

function requireStopRule(stopRule, failures) {
  if (!stopRule || typeof stopRule !== "object" || Array.isArray(stopRule)) {
    failures.push("externalAiStopRule nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(stopRule, externalAiStopRuleKeys, failures, "externalAiStopRule");
  requireObjectTrue(stopRule, failures, "externalAiStopRule.kvkkAssessmentRequired", "kvkkAssessmentRequired");
  requireObjectTrue(stopRule, failures, "externalAiStopRule.productOwnerApprovalRequired", "productOwnerApprovalRequired");
  requireObjectTrue(stopRule, failures, "externalAiStopRule.teacherReviewRequired", "teacherReviewRequired");
  requireObjectFalse(stopRule, failures, "externalAiStopRule.anthropicEnabledInProduction", "anthropicEnabledInProduction");
  requireObjectString(stopRule, failures, "externalAiStopRule.decisionReference", "decisionReference");
  requireNonPlaceholderString(stopRule, failures, "externalAiStopRule.decisionReference", "decisionReference");
}

function requireGeneration(generation, mode, failures) {
  if (!generation || typeof generation !== "object" || Array.isArray(generation)) {
    failures.push("generation nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(
    generation,
    mode === "disabled" ? disabledGenerationKeys : templateGenerationKeys,
    failures,
    "generation",
  );
  requireObjectTrue(generation, failures, "generation.deterministicOutput", "deterministicOutput");
  if (mode === "disabled") {
    requireObjectTrue(generation, failures, "generation.featureDisabled", "featureDisabled");
    for (const key of [
      "templateSummaryGenerated",
      "studentCommentaryGenerated",
      "teacherActionDraftGenerated",
      "outputStoredInSnapshot",
    ]) {
      requireObjectFalse(generation, failures, `generation.${key}`, key);
    }
    return;
  }

  requireObjectTrue(generation, failures, "generation.teacherReviewRequired", "teacherReviewRequired");
  requireObjectTrue(generation, failures, "generation.disclaimerIncluded", "disclaimerIncluded");
  requireObjectTrue(generation, failures, "generation.outputStoredInSnapshot", "outputStoredInSnapshot");
  if (mode === "template") {
    requireObjectTrue(generation, failures, "generation.templateSummaryGenerated", "templateSummaryGenerated");
    requireObjectTrue(generation, failures, "generation.studentCommentaryGenerated", "studentCommentaryGenerated");
    requireObjectTrue(generation, failures, "generation.teacherActionDraftGenerated", "teacherActionDraftGenerated");
  }
}

function requireValidation(validation, mode, failures) {
  if (!validation || typeof validation !== "object" || Array.isArray(validation)) {
    failures.push("validation nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(
    validation,
    mode === "disabled" ? disabledValidationKeys : templateValidationKeys,
    failures,
    "validation",
  );
  requireObjectTrue(validation, failures, "validation.piiLeakageCheckPassed", "piiLeakageCheckPassed");
  requireObjectTrue(validation, failures, "validation.logsExcludePromptResponse", "logsExcludePromptResponse");
  requireObjectTrue(validation, failures, "validation.externalProviderNotCalled", "externalProviderNotCalled");
  if (mode === "template") {
    requireObjectTrue(validation, failures, "validation.templateRegressionPassed", "templateRegressionPassed");
  }
}

function requireStringArray(value, failures, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    failures.push(`${label} boş olmayan metin listesi olmalı.`);
  }
}

function requireCommandsPassed(value, failures) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    failures.push("commandsPassed boş olmayan metin listesi olmalı.");
    return;
  }

  if (value.length !== 3) {
    failures.push("commandsPassed tam 3 komut içermeli.");
    return;
  }

  for (const command of requiredCoreCommands) {
    if (!value.includes(command)) {
      failures.push(`commandsPassed eksik: ${command}`);
    }
  }

  if (!value.some((command) => command.includes("pnpm ai-report-summary:check"))) {
    failures.push("commandsPassed pnpm ai-report-summary:check komutunu içermeli.");
  }

  if (!allowExampleEvidence && value.some((command) => command.includes("AI_REPORT_SUMMARY_ALLOW_EXAMPLE_EVIDENCE=1"))) {
    failures.push("commandsPassed production kanıtı example-bypass bayrağı içermemeli.");
  }
}

function requireExactStringSet(value, failures, label, expectedValues, itemLabel) {
  if (!Array.isArray(value)) {
    failures.push(`${label} alan listesi zorunlu.`);
    return;
  }

  if (value.length !== expectedValues.length) {
    failures.push(`${label} tam ${expectedValues.length} ${itemLabel} içermeli.`);
    return;
  }

  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label}.${index} boş olmayan metin olmalı.`);
      return;
    }
  }

  for (const expected of expectedValues) {
    if (!value.includes(expected)) {
      failures.push(`${label} eksik: ${expected}`);
    }
  }
}

function requireEmptyArray(report, failures, key) {
  const value = report?.[key];
  if (!Array.isArray(value)) {
    failures.push(`${key} listesi zorunlu.`);
    return;
  }
  if (value.length > 0) {
    failures.push(`${key} boş olmalı.`);
  }
}

function requireObjectKeySet(value, expectedKeys, failures, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return false;
  }

  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length) {
    failures.push(`${label} tam ${expectedKeys.length} alan içermeli.`);
    return false;
  }

  for (const expectedKey of expectedKeys) {
    if (!Object.hasOwn(value, expectedKey)) {
      failures.push(`${label}.${expectedKey} alanı zorunlu.`);
    }
  }

  return true;
}

function requireEqual(scope, failures, key, expected) {
  if (scope[key] !== expected) {
    failures.push(`${key} ${expected} olmalı.`);
  }
}

function requireObjectEqual(scope, failures, label, key, expected) {
  if (scope[key] !== expected) {
    failures.push(`${label} ${expected} olmalı.`);
  }
}

function requireObjectTrue(scope, failures, label, key) {
  if (scope[key] !== true) {
    failures.push(`${label} true olmalı.`);
  }
}

function requireObjectFalse(scope, failures, label, key) {
  if (scope[key] !== false) {
    failures.push(`${label} false olmalı.`);
  }
}

function requireObjectString(scope, failures, label, key) {
  if (typeof scope[key] !== "string" || scope[key].trim() === "") {
    failures.push(`${label} boş olmayan metin olmalı.`);
  }
}

function requireOneOf(scope, failures, label, expectedValues, key = label) {
  if (!expectedValues.includes(scope[key])) {
    failures.push(`${label} ${expectedValues.join(" veya ")} olmalı.`);
  }
}

function requireDate(report, failures, key) {
  const value = report[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${key} geçerli tarih olmalı.`);
  }
}

function requireDateNotInFuture(report, failures, key) {
  if (allowExampleEvidence) return;

  const value = report[key];
  const timestamp = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(timestamp)) {
    return;
  }

  const clockSkewMs = 5 * 60 * 1000;
  if (timestamp > Date.now() + clockSkewMs) {
    failures.push(`${key} gelecekte olamaz.`);
  }
}

function requireEvidenceReferences(references, failures) {
  if (!Array.isArray(references)) return;
  for (const reference of references) {
    if (typeof reference !== "string" || reference.trim() === "") continue;
    if (!allowExampleEvidence && hasPlaceholderToken(reference)) {
      failures.push("evidenceReferences production kanıtı için örnek/placeholder/redacted değer içermemeli.");
    }
  }
}

function requireNonPlaceholderString(scope, failures, label, key) {
  const value = scope[key];
  if (typeof value !== "string" || value.trim() === "") return;
  if (!allowExampleEvidence && hasPlaceholderToken(value)) {
    failures.push(`${label} production kanıtı için örnek/placeholder/redacted değer içermemeli.`);
  }
}

function hasPiiFieldName(value) {
  return /(studentId|studentName|guardian|tcKimlik|phone|email|address|firstName|lastName)/i.test(value);
}

function hasPlaceholderToken(value) {
  const normalized = value.toLowerCase();
  return [
    "__set",
    "change-me",
    "replace-me",
    "placeholder",
    "redacted",
    "example",
    ".test",
    ".invalid",
    "localhost",
    "127.0.0.1",
  ].some((token) => normalized.includes(token));
}

function fail(failures) {
  console.error("AI karne özeti kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
