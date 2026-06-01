import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.FINANCIAL_RETENTION_TARGET;

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

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requirePolicyDecision(report.policyDecision, failures);
  requireFinancialRecords(report.financialRecords, failures);
  requireVerified(report.purgeBehaviorVerified, failures, [
    "privacy.me.purge_preserves_payment_plans",
    "payment_plan_records_excluded_from_pii_purge",
  ]);

  if (Array.isArray(report.gaps) && report.gaps.length > 0) {
    failures.push("gaps boş olmalı.");
  }

  return failures;
}

function requirePolicyDecision(policy, failures) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    failures.push("policyDecision nesnesi zorunlu.");
    return;
  }

  requireString(policy, failures, "policyDecision.approvedBy", "approvedBy");
  requireString(policy, failures, "policyDecision.approvalReference", "approvalReference");
  requireString(policy, failures, "policyDecision.legalBasis", "legalBasis");
  if (!Number.isInteger(policy.retentionPeriodYears) || policy.retentionPeriodYears < 1) {
    failures.push("policyDecision.retentionPeriodYears pozitif tam sayı olmalı.");
  }
  if (policy.purgeException !== true) {
    failures.push("policyDecision.purgeException true olmalı.");
  }
}

function requireFinancialRecords(records, failures) {
  if (!records || typeof records !== "object" || Array.isArray(records)) {
    failures.push("financialRecords nesnesi zorunlu.");
    return;
  }

  for (const key of ["paymentPlans", "installments"]) {
    if (!Number.isInteger(records[key]) || records[key] <= 0) {
      failures.push(`financialRecords.${key} gerçek kanıt için sıfırdan büyük tam sayı olmalı.`);
    }
  }
}

function requireVerified(values, failures, expectedValues) {
  if (!Array.isArray(values)) {
    failures.push("purgeBehaviorVerified alan listesi zorunlu.");
    return;
  }

  for (const expected of expectedValues) {
    if (!values.includes(expected)) {
      failures.push(`purgeBehaviorVerified eksik: ${expected}`);
    }
  }
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

function requireString(scope, failures, label, key) {
  if (typeof scope[key] !== "string" || scope[key].trim() === "") {
    failures.push(`${label} boş olmayan metin olmalı.`);
  }
}

function fail(failures) {
  console.error("Finansal saklama kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
