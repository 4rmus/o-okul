import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.DEPLOYMENT_REGION_TARGET;

if (!target) {
  fail(["DEPLOYMENT_REGION_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["DEPLOYMENT_REGION_TARGET file://, http:// veya https:// URL olmalı."]);
}

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Deployment region kanıt kontrolü geçti: ${report.environment} ${report.provider} ${report.region}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readFile(fileURLToPath(url), "utf8"));
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Deployment region raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["DEPLOYMENT_REGION_TARGET yalnız file://, http:// veya https:// destekler."]);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["Deployment region raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireString(report, failures, "provider");
  requireString(report, failures, "region");
  requireEqual(report, failures, "datacenterCountryCode", "TR");
  requireTrue(report, failures, "dataResidencyVerified");
  requireString(report, failures, "evidenceReference");
  requireList(report, failures, "servicesVerified", ["api", "worker", "postgres", "redis", "object-storage"]);

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

function requireTrue(report, failures, key) {
  if (report[key] !== true) {
    failures.push(`${key} true olmalı.`);
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
  console.error("Deployment region kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
