import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.DEPLOYMENT_REGION_TARGET;
const allowExampleEvidence = process.env.DEPLOYMENT_REGION_ALLOW_EXAMPLE_EVIDENCE === "1";
const deploymentRegionTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "provider",
  "region",
  "datacenterCountryCode",
  "dataResidencyVerified",
  "evidenceReference",
  "servicesVerified",
  "gaps",
];
const requiredServicesVerified = ["api", "worker", "postgres", "redis", "object-storage"];

if (!target) {
  fail(["DEPLOYMENT_REGION_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["DEPLOYMENT_REGION_TARGET file:// veya https:// URL olmalı."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Deployment region kanıt kontrolü geçti: ${report.environment} ${report.provider} ${report.region}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Deployment region raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["DEPLOYMENT_REGION_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["DEPLOYMENT_REGION_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["DEPLOYMENT_REGION_TARGET symlink olmayan file:// artifact olmali."]);
  }

  return readFile(filePath, "utf8");
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["DEPLOYMENT_REGION_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["DEPLOYMENT_REGION_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["DEPLOYMENT_REGION_TARGET production kaniti icin lokal temp path olmamali."]);
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
    fail(["Deployment region raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, deploymentRegionTopLevelKeys, failures, "deploymentRegion")) {
    return failures;
  }
  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireString(report, failures, "provider");
  requireString(report, failures, "region");
  requireNonPlaceholderString(report, failures, "provider");
  requireNonPlaceholderString(report, failures, "region");
  requireEqual(report, failures, "datacenterCountryCode", "TR");
  requireTrue(report, failures, "dataResidencyVerified");
  requireString(report, failures, "evidenceReference");
  requireNonPlaceholderString(report, failures, "evidenceReference");
  requireExactStringSet(report, failures, "servicesVerified", requiredServicesVerified);
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
    failures.push(`${key} production kanıtı için örnek/placeholder değer olmamalı.`);
  }
}

function hasPlaceholderToken(value) {
  const normalized = value.toLowerCase();
  return [
    "__set",
    "change-me",
    "replace-me",
    "placeholder",
    "example",
    ".test",
    ".invalid",
    "localhost",
    "127.0.0.1",
  ].some((token) => normalized.includes(token));
}

function requireTrue(report, failures, key) {
  if (report[key] !== true) {
    failures.push(`${key} true olmalı.`);
  }
}

function requireObjectKeySet(value, expectedKeys, failures, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return false;
  }

  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length) {
    failures.push(`${label} tam ${expectedKeys.length} alan içermeli.`);
  }

  const expected = new Set(expectedKeys);
  for (const key of actualKeys) {
    if (!expected.has(key)) {
      failures.push(`${label}.${key} beklenmeyen alan.`);
    }
  }
  for (const key of expectedKeys) {
    if (!actualKeys.includes(key)) {
      failures.push(`${label}.${key} eksik.`);
    }
  }

  return true;
}

function requireExactStringSet(report, failures, key, expectedValues) {
  const value = report[key];
  if (!Array.isArray(value)) {
    failures.push(`${key} alan listesi zorunlu.`);
    return;
  }

  if (value.length !== expectedValues.length) {
    failures.push(`${key} tam ${expectedValues.length} servis içermeli.`);
  }

  const seen = new Set();
  const expected = new Set(expectedValues);
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${key} boş olmayan metinlerden oluşmalı.`);
      continue;
    }
    if (seen.has(item)) {
      failures.push(`${key} tekrarlı servis içeriyor: ${item}`);
    }
    seen.add(item);
    if (!expected.has(item)) {
      failures.push(`${key} beklenmeyen servis içeriyor: ${item}`);
    }
  }

  for (const expectedValue of expectedValues) {
    if (!seen.has(expectedValue)) {
      failures.push(`${key} eksik: ${expectedValue}`);
    }
  }
}

function requireEmptyArray(report, failures, key) {
  const value = report[key];
  if (!Array.isArray(value)) {
    failures.push(`${key} listesi zorunlu.`);
    return;
  }
  if (value.length > 0) {
    failures.push(`${key} boş olmalı.`);
  }
}

function fail(failures) {
  console.error("Deployment region kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
