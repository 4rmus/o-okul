import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
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
  "auditDiffRedactionVerified",
  "gaps",
];
const dataSubjectCountKeys = ["student", "teacher", "guardian", "user"];
const purgeCoverageKeys = ["student", "teacher", "guardian", "user"];
const auditDiffRedactionKeys = ["endpoint", "negativeControls", "actionsSampled", "command"];
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
const expectedAuditDiffNegativeControls = [
  "body",
  "contentBase64",
  "email",
  "fileBase64",
  "fileName",
  "firstName",
  "lastName",
  "message",
  "name",
  "nationalId",
  "objectKey",
  "phone",
  "rawLine",
  "rawRow",
  "rawText",
  "s3Key",
  "sourceFileName",
  "sourceFilePath",
  "subject",
  "title",
  "token",
];
const expectedAuditDiffActions = [
  "announcement.created",
  "message_template.created",
  "support_ticket.created",
  "support_ticket_comment.created",
  "kvkk.student_pii_purged",
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
  fail(["KVKK_INVENTORY_TARGET file:// veya https:// URL olmalı."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`KVKK envanter kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`KVKK envanter raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["KVKK_INVENTORY_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["KVKK_INVENTORY_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["KVKK_INVENTORY_TARGET symlink olmayan file:// artifact olmali."]);
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
      fail(["KVKK_INVENTORY_TARGET parent dizini okunabilir olmali."]);
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["KVKK_INVENTORY_TARGET parent dizini symlink olmayan dizin olmali."]);
    }
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["KVKK_INVENTORY_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["KVKK_INVENTORY_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["KVKK_INVENTORY_TARGET production kaniti icin lokal temp path olmamali."]);
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
  requireAuditDiffRedaction(report.auditDiffRedactionVerified, failures);
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

function requireAuditDiffRedaction(redaction, failures) {
  if (!requireObjectKeySet(redaction, auditDiffRedactionKeys, failures, "auditDiffRedactionVerified")) return;

  requireEqual(redaction, failures, "endpoint", "/audit-logs");
  requireExactStringSet(redaction.negativeControls, failures, "auditDiffRedactionVerified.negativeControls", expectedAuditDiffNegativeControls, "kontrol");
  requireExactStringSet(redaction.actionsSampled, failures, "auditDiffRedactionVerified.actionsSampled", expectedAuditDiffActions, "action");
  if (typeof redaction.command !== "string" || !redaction.command.includes("audit-log")) {
    failures.push("auditDiffRedactionVerified.command audit-log doğrulama komutu içermeli.");
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
