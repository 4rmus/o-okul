import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.FINANCIAL_RETENTION_TARGET;
const allowExampleEvidence = process.env.FINANCIAL_RETENTION_ALLOW_EXAMPLE_EVIDENCE === "1";
const financialRetentionTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "policyDecision",
  "financialRecords",
  "purgeBehaviorVerified",
  "gaps",
];
const policyDecisionKeys = ["approvedBy", "approvalReference", "retentionPeriodYears", "legalBasis", "purgeException"];
const financialRecordKeys = ["paymentPlans", "installments"];
const expectedPurgeBehaviorVerifications = [
  "privacy.me.purge_preserves_payment_plans",
  "payment_plan_records_excluded_from_pii_purge",
];

if (!target) {
  fail(["FINANCIAL_RETENTION_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["FINANCIAL_RETENTION_TARGET file://, http:// veya https:// URL olmalı."]);
}

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Finansal saklama kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readFile(fileURLToPath(url), "utf8"));
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Finansal saklama raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["FINANCIAL_RETENTION_TARGET yalnız file://, http:// veya https:// destekler."]);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["Finansal saklama raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, financialRetentionTopLevelKeys, failures, "financialRetention")) return failures;

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requirePolicyDecision(report.policyDecision, failures);
  requireFinancialRecords(report.financialRecords, failures);
  requireExactStringSet(
    report.purgeBehaviorVerified,
    failures,
    "purgeBehaviorVerified",
    expectedPurgeBehaviorVerifications,
    "doğrulama",
  );

  if (!Array.isArray(report.gaps)) {
    failures.push("gaps listesi zorunlu.");
  } else if (report.gaps.length > 0) {
    failures.push("gaps boş olmalı.");
  }

  return failures;
}

function requirePolicyDecision(policy, failures) {
  if (!requireObjectKeySet(policy, policyDecisionKeys, failures, "policyDecision")) return;

  requireString(policy, failures, "policyDecision.approvedBy", "approvedBy");
  requireObjectNonPlaceholderString(policy, failures, "policyDecision.approvedBy", "approvedBy");
  requireString(policy, failures, "policyDecision.approvalReference", "approvalReference");
  requireObjectNonPlaceholderString(policy, failures, "policyDecision.approvalReference", "approvalReference");
  requireString(policy, failures, "policyDecision.legalBasis", "legalBasis");
  if (!Number.isInteger(policy.retentionPeriodYears) || policy.retentionPeriodYears < 1) {
    failures.push("policyDecision.retentionPeriodYears pozitif tam sayı olmalı.");
  }
  if (policy.purgeException !== true) {
    failures.push("policyDecision.purgeException true olmalı.");
  }
}

function requireFinancialRecords(records, failures) {
  if (!requireObjectKeySet(records, financialRecordKeys, failures, "financialRecords")) return;

  for (const key of financialRecordKeys) {
    if (!Number.isInteger(records[key]) || records[key] <= 0) {
      failures.push(`financialRecords.${key} gerçek kanıt için sıfırdan büyük tam sayı olmalı.`);
    }
  }
}

function requireExactStringSet(value, failures, label, expectedValues, itemLabel) {
  if (!Array.isArray(value)) {
    failures.push(`${label} listesi zorunlu.`);
    return;
  }

  if (value.length !== expectedValues.length) {
    failures.push(`${label} tam ${expectedValues.length} ${itemLabel} içermeli.`);
    return;
  }

  const uniqueValues = new Set(value);
  if (uniqueValues.size !== value.length) {
    failures.push(`${label} tekrarlı ${itemLabel} içeremez.`);
  }

  for (const expectedValue of expectedValues) {
    if (!uniqueValues.has(expectedValue)) {
      failures.push(`${label} eksik: ${expectedValue}`);
    }
  }

  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label} boş olmayan string ${itemLabel} içermeli.`);
    } else if (!expectedValues.includes(item)) {
      failures.push(`${label} beklenmeyen ${itemLabel} içeriyor: ${item}`);
    }
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

  const keySet = new Set(keys);
  for (const key of expectedKeys) {
    if (!keySet.has(key)) {
      failures.push(`${label} eksik alan içeriyor: ${key}`);
    }
  }
  for (const key of keys) {
    if (!expectedKeys.includes(key)) {
      failures.push(`${label} beklenmeyen alan içeriyor: ${key}`);
    }
  }

  return true;
}

function requireEqual(report, failures, key, expected) {
  if (report[key] !== expected) {
    failures.push(`${key} ${expected} olmalı.`);
  }
}

function requireOneOf(report, failures, key, expectedValues) {
  if (!expectedValues.includes(report[key])) {
    failures.push(`${key} ${expectedValues.join(" veya ")} olmalı.`);
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

function requireString(scope, failures, label, key) {
  if (typeof scope[key] !== "string" || scope[key].trim() === "") {
    failures.push(`${label} boş olmayan metin olmalı.`);
  }
}

function requireObjectNonPlaceholderString(scope, failures, label, key) {
  if (allowExampleEvidence) return;

  const value = scope[key];
  if (typeof value !== "string" || value.trim() === "") {
    return;
  }

  if (hasPlaceholderToken(value)) {
    failures.push(`${label} production kanıtı için örnek/placeholder/redacted değer olmamalı.`);
  }
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
  console.error("Finansal saklama kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
