import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.KVKK_INVENTORY_TARGET;

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

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireString(report, failures, "inventorySource");
  requirePositiveTotal(report.dataSubjectCounts, failures);

  requireFields(report, failures, "student", ["firstName", "lastName"]);
  requireFields(report, failures, "teacher", ["firstName", "lastName"]);
  requireFields(report, failures, "guardian", ["firstName", "lastName", "phone"]);
  requireFields(report, failures, "user", ["email", "name"]);

  requireActions(report, failures, [
    "kvkk.student_pii_purged",
    "kvkk.teacher_pii_purged",
    "kvkk.guardian_pii_purged",
    "kvkk.user_pii_purged",
  ]);

  if (Array.isArray(report.gaps) && report.gaps.length > 0) {
    failures.push("gaps boş olmalı.");
  }

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

function requireString(report, failures, key) {
  if (typeof report[key] !== "string" || report[key].trim() === "") {
    failures.push(`${key} boş olmayan metin olmalı.`);
  }
}

function requirePositiveTotal(counts, failures) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    failures.push("dataSubjectCounts nesnesi zorunlu.");
    return;
  }

  let total = 0;
  for (const key of ["student", "teacher", "guardian", "user"]) {
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

function requireFields(report, failures, subject, expectedFields) {
  const fields = report.purgeCoverage?.[subject];
  if (!Array.isArray(fields)) {
    failures.push(`purgeCoverage.${subject} alan listesi zorunlu.`);
    return;
  }

  for (const field of expectedFields) {
    if (!fields.includes(field)) {
      failures.push(`purgeCoverage.${subject} eksik: ${field}`);
    }
  }
}

function requireActions(report, failures, expectedActions) {
  if (!Array.isArray(report.auditActionsVerified)) {
    failures.push("auditActionsVerified alan listesi zorunlu.");
    return;
  }

  for (const action of expectedActions) {
    if (!report.auditActionsVerified.includes(action)) {
      failures.push(`auditActionsVerified eksik: ${action}`);
    }
  }
}

function fail(failures) {
  console.error("KVKK envanter kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
