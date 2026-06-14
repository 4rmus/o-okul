import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.RESTORE_DRILL_TARGET;
const allowExampleEvidence = process.env.RESTORE_DRILL_ALLOW_EXAMPLE_EVIDENCE === "1";
const restoreDrillTopLevelKeys = [
  "result",
  "environment",
  "drillDate",
  "sourceBackup",
  "targetDatabase",
  "tableCounts",
  "errors",
];
const tableCountsKeys = ["Tenant", "AuditLog", "ReportSnapshot", "_prisma_migrations"];

if (!target) {
  fail(["RESTORE_DRILL_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["RESTORE_DRILL_TARGET file:// veya https:// URL olmalı."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readReport(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Restore drill kanıt kontrolü geçti: ${report.environment} ${report.drillDate}`);

async function readReport(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Restore drill raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["RESTORE_DRILL_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["RESTORE_DRILL_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["RESTORE_DRILL_TARGET symlink olmayan file:// artifact olmali."]);
  }

  return readFile(filePath, "utf8");
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["RESTORE_DRILL_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["RESTORE_DRILL_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["RESTORE_DRILL_TARGET production kaniti icin lokal temp path olmamali."]);
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
    fail(["Restore drill raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, restoreDrillTopLevelKeys, failures, "restoreDrill")) {
    return failures;
  }

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "drillDate");
  requireDateNotInFuture(report, failures, "drillDate");
  requireString(report, failures, "sourceBackup");
  requireNonPlaceholderString(report, failures, "sourceBackup");
  requireString(report, failures, "targetDatabase");
  requireNonPlaceholderString(report, failures, "targetDatabase");

  if (!report.tableCounts || typeof report.tableCounts !== "object" || Array.isArray(report.tableCounts)) {
    failures.push("tableCounts nesnesi zorunlu.");
  } else {
    requireObjectKeySet(report.tableCounts, tableCountsKeys, failures, "tableCounts");
    for (const key of tableCountsKeys) {
      requireCount(report.tableCounts, failures, key);
    }
  }

  if (Array.isArray(report.errors) && report.errors.length > 0) {
    failures.push("errors boş olmalı.");
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

function requireString(report, failures, key) {
  if (typeof report[key] !== "string" || report[key].trim() === "") {
    failures.push(`${key} boş olmayan metin olmalı.`);
  }
}

function requireNonPlaceholderString(report, failures, key) {
  if (allowExampleEvidence) return;

  const value = report[key];
  if (typeof value !== "string" || value.trim() === "") {
    return;
  }

  if (hasPlaceholderToken(value)) {
    failures.push(`${key} production kanıtı için örnek/placeholder/redacted değer olmamalı.`);
  }
}

function requireCount(tableCounts, failures, key) {
  const value = tableCounts[key];
  if (!Number.isInteger(value) || value < 1) {
    failures.push(`tableCounts.${key} en az 1 tam sayı olmalı.`);
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
    "backup-bucket",
  ].some((token) => normalized.includes(token));
}

function fail(failures) {
  console.error("Restore drill kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
