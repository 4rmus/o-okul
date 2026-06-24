import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.env.UPLOAD_AV_TARGET;
const allowExampleEvidence = process.env.UPLOAD_AV_ALLOW_EXAMPLE_EVIDENCE === "1";
const requiredUploadSurfaces = ["homework_material_file", "support_ticket_attachment"];
const uploadAvTopLevelKeys = ["result", "environment", "checkedAt", "scannerDecision", "uploadSurfaces", "scanResults", "gaps"];
const scannerDecisionKeys = ["mode", "approvedBy", "approvalReference", "scannerName", "signatureVersion", "failClosed"];
const scanResultsKeys = ["cleanFileAccepted", "eicarRejected", "scannerUnavailableRejected"];

if (!target) {
  fail(["UPLOAD_AV_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["UPLOAD_AV_TARGET file:// veya https:// URL olmalı."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Upload AV kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Upload AV raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["UPLOAD_AV_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["UPLOAD_AV_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["UPLOAD_AV_TARGET symlink olmayan file:// artifact olmali."]);
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
      fail(["UPLOAD_AV_TARGET parent dizini okunabilir olmali."]);
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["UPLOAD_AV_TARGET parent dizini symlink olmayan dizin olmali."]);
    }
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["UPLOAD_AV_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["UPLOAD_AV_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["UPLOAD_AV_TARGET production kaniti icin lokal temp path olmamali."]);
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
  return (
    path === "/tmp" ||
    path.startsWith("/tmp/") ||
    path === "/var/tmp" ||
    path.startsWith("/var/tmp/") ||
    path === "/private/tmp" ||
    path.startsWith("/private/tmp/")
  );
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["Upload AV raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, uploadAvTopLevelKeys, failures, "uploadAv")) {
    return failures;
  }

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireScannerDecision(report.scannerDecision, failures);
  requireSurfaces(report.uploadSurfaces, failures);
  requireScanResults(report.scanResults, failures);
  requireEmptyArray(report, failures, "gaps");

  return failures;
}

function requireScannerDecision(decision, failures) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    failures.push("scannerDecision nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(decision, scannerDecisionKeys, failures, "scannerDecision");
  requireOneOf(decision, failures, "mode", ["provider", "local"]);
  requireString(decision, failures, "scannerDecision.approvedBy", "approvedBy");
  requireObjectNonPlaceholderString(decision, failures, "scannerDecision.approvedBy", "approvedBy");
  requireString(decision, failures, "scannerDecision.approvalReference", "approvalReference");
  requireObjectNonPlaceholderString(decision, failures, "scannerDecision.approvalReference", "approvalReference");
  requireString(decision, failures, "scannerDecision.scannerName", "scannerName");
  requireObjectNonPlaceholderString(decision, failures, "scannerDecision.scannerName", "scannerName");
  requireString(decision, failures, "scannerDecision.signatureVersion", "signatureVersion");
  if (decision.failClosed !== true) {
    failures.push("scannerDecision.failClosed true olmalı.");
  }
}

function requireSurfaces(surfaces, failures) {
  requireExactStringSet(surfaces, failures, "uploadSurfaces", requiredUploadSurfaces, "surface");
}

function requireScanResults(results, failures) {
  if (!results || typeof results !== "object" || Array.isArray(results)) {
    failures.push("scanResults nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(results, scanResultsKeys, failures, "scanResults");
  for (const key of ["cleanFileAccepted", "eicarRejected", "scannerUnavailableRejected"]) {
    if (results[key] !== true) {
      failures.push(`scanResults.${key} true olmalı.`);
    }
  }
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

function requireString(scope, failures, label, key) {
  if (typeof scope[key] !== "string" || scope[key].trim() === "") {
    failures.push(`${label} boş olmayan metin olmalı.`);
  }
}

function requireObjectNonPlaceholderString(scope, failures, label, key) {
  if (allowExampleEvidence) return;

  const value = scope[key];
  if (typeof value !== "string" || value.trim() === "") {
    return;
  }

  if (hasPlaceholderToken(value)) {
    failures.push(`${label} production kanıtı için örnek/placeholder/redacted değer olmamalı.`);
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

function requireExactStringSet(value, failures, label, expectedValues, itemLabel) {
  if (!Array.isArray(value)) {
    failures.push(`${label} alan listesi zorunlu.`);
    return;
  }

  if (value.length !== expectedValues.length) {
    failures.push(`${label} tam ${expectedValues.length} ${itemLabel} içermeli.`);
    return;
  }

  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label}.${index} boş olmayan metin olmalı.`);
      return;
    }
  }

  for (const expected of expectedValues) {
    if (!value.includes(expected)) {
      failures.push(`${label} eksik: ${expected}`);
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
  console.error("Upload AV kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
