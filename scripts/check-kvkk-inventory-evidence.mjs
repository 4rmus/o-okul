import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.KVKK_INVENTORY_TARGET;
const kvkkInventoryTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "inventorySource",
  "dataSubjectCounts",
  "purgeCoverage",
  "auditActionsVerified",
  "gaps",
];
const dataSubjectCountKeys = ["student", "teacher", "guardian", "user"];
const purgeCoverageKeys = ["student", "teacher", "guardian", "user"];
const expectedPurgeCoverage = {
  student: ["firstName", "lastName", "phone", "email"],
  teacher: ["firstName", "lastName"],
  guardian: ["firstName", "lastName", "phone"],
  user: ["email", "name"],
};
const expectedAuditActions = [
  "kvkk.student_pii_purged",
  "kvkk.teacher_pii_purged",
  "kvkk.guardian_pii_purged",
  "kvkk.user_pii_purged",
];

if (!target) {
  fail(["KVKK_INVENTORY_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["KVKK_INVENTORY_TARGET file://, http:// veya https:// URL olmalı."]);
}

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`KVKK envanter kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readFile(fileURLToPath(url), "utf8"));
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`KVKK envanter raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["KVKK_INVENTORY_TARGET yalnız file://, http:// veya https:// destekler."]);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["KVKK envanter raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, kvkkInventoryTopLevelKeys, failures, "kvkkInventory")) return failures;

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireString(report, failures, "inventorySource");
  requirePositiveTotal(report.dataSubjectCounts, failures);
  requirePurgeCoverage(report.purgeCoverage, failures);
  requireExactStringSet(report.auditActionsVerified, failures, "auditActionsVerified", expectedAuditActions, "action");
  requireEmptyArray(report, failures, "gaps");

  return failures;
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

function requireString(report, failures, key) {
  if (typeof report[key] !== "string" || report[key].trim() === "") {
    failures.push(`${key} boş olmayan metin olmalı.`);
  }
}

function requirePositiveTotal(counts, failures) {
  if (!requireObjectKeySet(counts, dataSubjectCountKeys, failures, "dataSubjectCounts")) return;

  let total = 0;
  for (const key of dataSubjectCountKeys) {
    const value = counts[key];
    if (!Number.isInteger(value) || value < 0) {
      failures.push(`dataSubjectCounts.${key} sıfır veya daha büyük tam sayı olmalı.`);
    } else {
      total += value;
    }
  }

  if (total <= 0) {
    failures.push("dataSubjectCounts toplamı gerçek veri doğrulaması için sıfırdan büyük olmalı.");
  }
}

function requirePurgeCoverage(coverage, failures) {
  if (!requireObjectKeySet(coverage, purgeCoverageKeys, failures, "purgeCoverage", "subject")) return;

  for (const [subject, expectedFields] of Object.entries(expectedPurgeCoverage)) {
    requireExactStringSet(coverage[subject], failures, `purgeCoverage.${subject}`, expectedFields, "alan");
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

function requireObjectKeySet(value, expectedKeys, failures, label, itemLabel = "alan") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return false;
  }

  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length) {
    failures.push(`${label} tam ${expectedKeys.length} ${itemLabel} içermeli.`);
    return false;
  }

  const keySet = new Set(keys);
  for (const key of expectedKeys) {
    if (!keySet.has(key)) {
      failures.push(`${label} eksik ${itemLabel}: ${key}`);
    }
  }
  for (const key of keys) {
    if (!expectedKeys.includes(key)) {
      failures.push(`${label} beklenmeyen ${itemLabel} içeriyor: ${key}`);
    }
  }

  return true;
}

function fail(failures) {
  console.error("KVKK envanter kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
