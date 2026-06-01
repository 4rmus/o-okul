import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.RESTORE_DRILL_TARGET;

if (!target) {
  fail(["RESTORE_DRILL_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["RESTORE_DRILL_TARGET file://, http:// veya https:// URL olmalı."]);
}

const report = await readReport(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Restore drill kanıt kontrolü geçti: ${report.environment} ${report.drillDate}`);

async function readReport(url) {
  if (url.protocol === "file:") {
    return parseJson(await readFile(fileURLToPath(url), "utf8"));
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Restore drill raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["RESTORE_DRILL_TARGET yalnız file://, http:// veya https:// destekler."]);
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

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "drillDate");
  requireString(report, failures, "sourceBackup");
  requireString(report, failures, "targetDatabase");

  if (!report.tableCounts || typeof report.tableCounts !== "object" || Array.isArray(report.tableCounts)) {
    failures.push("tableCounts nesnesi zorunlu.");
  } else {
    requireCount(report.tableCounts, failures, "Tenant");
    requireCount(report.tableCounts, failures, "AuditLog");
    requireCount(report.tableCounts, failures, "ReportSnapshot");
    requireCount(report.tableCounts, failures, "_prisma_migrations");
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

function requireString(report, failures, key) {
  if (typeof report[key] !== "string" || report[key].trim() === "") {
    failures.push(`${key} boş olmayan metin olmalı.`);
  }
}

function requireCount(tableCounts, failures, key) {
  const value = tableCounts[key];
  if (!Number.isInteger(value) || value < 0) {
    failures.push(`tableCounts.${key} sıfır veya daha büyük tam sayı olmalı.`);
  }
}

function fail(failures) {
  console.error("Restore drill kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
