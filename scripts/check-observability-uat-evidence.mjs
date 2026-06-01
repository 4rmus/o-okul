import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.OBSERVABILITY_UAT_TARGET;

if (!target) {
  fail(["OBSERVABILITY_UAT_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["OBSERVABILITY_UAT_TARGET file://, http:// veya https:// URL olmalı."]);
}

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Observability UAT kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readFile(fileURLToPath(url), "utf8"));
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Observability UAT raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["OBSERVABILITY_UAT_TARGET yalnız file://, http:// veya https:// destekler."]);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["Observability UAT raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireTrue(report, failures, "prometheusScrapeOk");
  requireTrue(report, failures, "grafanaDashboardOk");
  requireTrue(report, failures, "lokiLogPanelOk");
  requireStatus(report, failures, "alertWebhookStatus");

  requireList(report, failures, "dashboardPanelsVerified", [
    "API up",
    "Request rate",
    "Average duration",
    "Readiness failures",
    "Docker logs",
  ]);
  requireList(report, failures, "alertsVerified", [
    "UzmanHocamApiDown",
    "UzmanHocamReadinessFailing",
    "UzmanHocamHigh5xxRate",
    "UzmanHocamSlowRequests",
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

function requireTrue(report, failures, key) {
  if (report[key] !== true) {
    failures.push(`${key} true olmalı.`);
  }
}

function requireStatus(report, failures, key) {
  const value = report[key];
  if (!Number.isInteger(value) || value < 200 || value > 299) {
    failures.push(`${key} 2xx HTTP durum kodu olmalı.`);
  }
}

function requireList(report, failures, key, expectedValues) {
  const value = report[key];
  if (!Array.isArray(value)) {
    failures.push(`${key} alan listesi zorunlu.`);
    return;
  }

  for (const expected of expectedValues) {
    if (!value.includes(expected)) {
      failures.push(`${key} eksik: ${expected}`);
    }
  }
}

function fail(failures) {
  console.error("Observability UAT kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
