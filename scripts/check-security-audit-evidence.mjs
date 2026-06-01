import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.SECURITY_AUDIT_TARGET;

if (!target) {
  fail(["SECURITY_AUDIT_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["SECURITY_AUDIT_TARGET file://, http:// veya https:// URL olmalı."]);
}

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Güvenlik denetimi kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readFile(fileURLToPath(url), "utf8"));
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Güvenlik denetimi raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["SECURITY_AUDIT_TARGET yalnız file://, http:// veya https:// destekler."]);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["Güvenlik denetimi raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireTrue(report, failures, "prodEnvCheckOk");
  requireTrue(report, failures, "httpsOk");
  requireTrue(report, failures, "rlsLiveCheckOk");
  requireTrue(report, failures, "noCriticalFindings");
  requireStatus(report, failures, "healthStatus");
  requireStatus(report, failures, "readinessStatus");

  requireList(report, failures, "securityHeadersVerified", [
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Content-Security-Policy",
  ]);
  requireList(report, failures, "authControlsVerified", [
    "COOKIE_SECURE=true",
    "login lockout",
    "strong JWT secrets",
    "refresh session revocation",
  ]);
  requireList(report, failures, "dataControlsVerified", [
    "RLS live check",
    "tenant isolation",
    "audit PII redaction",
    "SENTRY_SEND_DEFAULT_PII=false",
  ]);

  if (Array.isArray(report.findings) && report.findings.length > 0) {
    failures.push("findings boş olmalı.");
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
  console.error("Güvenlik denetimi kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
