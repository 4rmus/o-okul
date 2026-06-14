import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
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
  fail(["FINANCIAL_RETENTION_TARGET file:// veya https:// URL olmalı."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Finansal saklama kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Finansal saklama raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["FINANCIAL_RETENTION_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["FINANCIAL_RETENTION_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["FINANCIAL_RETENTION_TARGET symlink olmayan file:// artifact olmali."]);
  }

  await assertParentPathAllowed(dirname(filePath));

  return readFile(filePath, "utf8");
}

async function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);

    let stat;
    try {
      stat = await lstat(current);
    } catch {
      fail(["FINANCIAL_RETENTION_TARGET parent dizini okunabilir olmali."]);
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["FINANCIAL_RETENTION_TARGET parent dizini symlink olmayan dizin olmali."]);
    }
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["FINANCIAL_RETENTION_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["FINANCIAL_RETENTION_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["FINANCIAL_RETENTION_TARGET production kaniti icin lokal temp path olmamali."]);
  }
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
