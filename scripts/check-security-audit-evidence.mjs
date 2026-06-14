import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.SECURITY_AUDIT_TARGET;
const allowExampleEvidence = process.env.SECURITY_AUDIT_ALLOW_EXAMPLE_EVIDENCE === "1";
const securityAuditTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "prodEnvCheckOk",
  "httpsOk",
  "rlsLiveCheckOk",
  "noCriticalFindings",
  "healthStatus",
  "readinessStatus",
  "securityHeadersVerified",
  "authControlsVerified",
  "dataControlsVerified",
  "evidenceReferences",
  "findings",
];
const requiredSecurityHeaders = [
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Content-Security-Policy",
];
const requiredAuthControls = [
  "COOKIE_SECURE=true",
  "login lockout",
  "strong JWT secrets",
  "refresh session revocation",
];
const requiredDataControls = [
  "RLS live check",
  "tenant isolation",
  "audit PII redaction",
  "SENTRY_SEND_DEFAULT_PII=false",
];

if (!target) {
  fail(["SECURITY_AUDIT_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["SECURITY_AUDIT_TARGET file:// veya https:// URL olmalı."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Güvenlik denetimi kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Güvenlik denetimi raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["SECURITY_AUDIT_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["SECURITY_AUDIT_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["SECURITY_AUDIT_TARGET symlink olmayan file:// artifact olmali."]);
  }

  return readFile(filePath, "utf8");
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["SECURITY_AUDIT_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["SECURITY_AUDIT_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["SECURITY_AUDIT_TARGET production kaniti icin lokal temp path olmamali."]);
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
    fail(["Güvenlik denetimi raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, securityAuditTopLevelKeys, failures, "securityAudit")) {
    return failures;
  }

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireTrue(report, failures, "prodEnvCheckOk");
  requireTrue(report, failures, "httpsOk");
  requireTrue(report, failures, "rlsLiveCheckOk");
  requireTrue(report, failures, "noCriticalFindings");
  requireStatus(report, failures, "healthStatus");
  requireStatus(report, failures, "readinessStatus");

  requireExactStringSet(report, failures, "securityHeadersVerified", requiredSecurityHeaders, "header");
  requireExactStringSet(report, failures, "authControlsVerified", requiredAuthControls, "auth kontrolü");
  requireExactStringSet(report, failures, "dataControlsVerified", requiredDataControls, "data kontrolü");
  requireEvidenceReferences(report, failures, "evidenceReferences");

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

function requireExactStringSet(report, failures, key, expectedValues, itemLabel) {
  const value = report[key];
  if (!Array.isArray(value)) {
    failures.push(`${key} alan listesi zorunlu.`);
    return;
  }

  if (value.length !== expectedValues.length) {
    failures.push(`${key} tam ${expectedValues.length} ${itemLabel} içermeli.`);
    return;
  }

  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${key}.${index} boş olmayan metin olmalı.`);
      return;
    }
  }

  for (const expected of expectedValues) {
    if (!value.includes(expected)) {
      failures.push(`${key} eksik: ${expected}`);
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

  for (const expectedKey of expectedKeys) {
    if (!Object.hasOwn(value, expectedKey)) {
      failures.push(`${label}.${expectedKey} alanı zorunlu.`);
    }
  }

  return true;
}

function requireEvidenceReferences(report, failures, label) {
  const value = report.evidenceReferences;
  if (!Array.isArray(value) || value.length === 0) {
    failures.push(`${label} boş olmayan liste olmalı.`);
    return;
  }

  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label} boş olmayan metinlerden oluşmalı.`);
      return;
    }
    if (!allowExampleEvidence && hasPlaceholderToken(item)) {
      failures.push(`${label} production kanıtı için örnek/placeholder/redacted değer içermemeli.`);
      return;
    }
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
  console.error("Güvenlik denetimi kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
