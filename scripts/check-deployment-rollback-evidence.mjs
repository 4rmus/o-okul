import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.env.DEPLOYMENT_ROLLBACK_TARGET;
const allowExampleEvidence = process.env.DEPLOYMENT_ROLLBACK_ALLOW_EXAMPLE_EVIDENCE === "1";
const deploymentRollbackTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "releaseCandidate",
  "failedImageTag",
  "rollbackImageTag",
  "drillStartedAt",
  "drillCompletedAt",
  "failureInjected",
  "failureMode",
  "migrationRollbackSafe",
  "commandsPassed",
  "servicesVerified",
  "evidenceReferences",
  "gaps",
];
const serviceVerifiedItemKeys = ["service", "status", "imageTag", "evidenceReference"];
const requiredCommandsPassed = [
  "docker compose pull web api worker",
  "docker compose up -d --remove-orphans",
  "pnpm compose:health:smoke",
  "pnpm prod:evidence:check",
];
const dateOrderFailureMessages = {
  "drillStartedAt:drillCompletedAt": "drillStartedAt drillCompletedAt sonrasında olamaz.",
  "drillCompletedAt:checkedAt": "drillCompletedAt checkedAt sonrasında olamaz.",
};

if (!target) {
  fail(["DEPLOYMENT_ROLLBACK_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["DEPLOYMENT_ROLLBACK_TARGET file:// veya https:// URL olmalı."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Deployment rollback kanıt kontrolü geçti: ${report.environment} ${report.rollbackImageTag}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Deployment rollback raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["DEPLOYMENT_ROLLBACK_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["DEPLOYMENT_ROLLBACK_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["DEPLOYMENT_ROLLBACK_TARGET symlink olmayan file:// artifact olmali."]);
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
      fail(["DEPLOYMENT_ROLLBACK_TARGET parent dizini okunabilir olmali."]);
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["DEPLOYMENT_ROLLBACK_TARGET parent dizini symlink olmayan dizin olmali."]);
    }
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["DEPLOYMENT_ROLLBACK_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["DEPLOYMENT_ROLLBACK_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["DEPLOYMENT_ROLLBACK_TARGET production kaniti icin lokal temp path olmamali."]);
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
    fail(["Deployment rollback raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, deploymentRollbackTopLevelKeys, failures, "deploymentRollback")) {
    return failures;
  }
  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireString(report, failures, "releaseCandidate");
  requireString(report, failures, "failedImageTag");
  requireString(report, failures, "rollbackImageTag");
  requireNonPlaceholderString(report, failures, "releaseCandidate");
  requireNonPlaceholderString(report, failures, "failedImageTag");
  requireNonPlaceholderString(report, failures, "rollbackImageTag");
  requireDate(report, failures, "drillStartedAt");
  requireDateNotInFuture(report, failures, "drillStartedAt");
  requireDate(report, failures, "drillCompletedAt");
  requireDateNotInFuture(report, failures, "drillCompletedAt");
  requireDateNotAfter(report, failures, "drillStartedAt", "drillCompletedAt");
  requireDateNotAfter(report, failures, "drillCompletedAt", "checkedAt");
  requireTrue(report, failures, "failureInjected");
  requireString(report, failures, "failureMode");
  requireTrue(report, failures, "migrationRollbackSafe");
  requireExactStringSet(report, failures, "commandsPassed", requiredCommandsPassed);
  requireServices(report, failures);
  requireEvidenceReferences(report, failures);
  requireEmptyArray(report, failures, "gaps");

  if (report.failedImageTag && report.rollbackImageTag && report.failedImageTag === report.rollbackImageTag) {
    failures.push("failedImageTag ve rollbackImageTag farklı olmalı.");
  }
  if (report.releaseCandidate && report.rollbackImageTag && report.releaseCandidate === report.rollbackImageTag) {
    failures.push("releaseCandidate ve rollbackImageTag farklı olmalı.");
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

function requireDateNotAfter(report, failures, firstKey, secondKey) {
  const first = Date.parse(report[firstKey]);
  const second = Date.parse(report[secondKey]);
  if (Number.isNaN(first) || Number.isNaN(second)) return;
  if (first > second) {
    failures.push(
      dateOrderFailureMessages[`${firstKey}:${secondKey}`] ?? `${firstKey} ${secondKey} sonrasında olamaz.`,
    );
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

function requireObjectNonPlaceholderString(report, failures, label, key) {
  if (allowExampleEvidence) return;

  const value = report[key];
  if (typeof value !== "string" || value.trim() === "") {
    return;
  }

  if (hasPlaceholderToken(value)) {
    failures.push(`${label} production kanıtı için örnek/placeholder değer olmamalı.`);
  }
}

function requireObjectString(report, failures, label, key) {
  if (typeof report[key] !== "string" || report[key].trim() === "") {
    failures.push(`${label} boş olmayan metin olmalı.`);
  }
}

function requireTrue(report, failures, key) {
  if (report[key] !== true) {
    failures.push(`${key} true olmalı.`);
  }
}

function requireExactStringSet(report, failures, key, expectedValues) {
  const value = report[key];
  if (!Array.isArray(value)) {
    failures.push(`${key} alan listesi zorunlu.`);
    return;
  }

  if (value.length !== expectedValues.length) {
    failures.push(`${key} tam ${expectedValues.length} madde içermeli.`);
  }

  for (const expected of expectedValues) {
    if (!value.includes(expected)) {
      failures.push(`${key} eksik: ${expected}`);
    }
  }

  const expected = new Set(expectedValues);
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${key} boş olmayan metinlerden oluşmalı.`);
      continue;
    }
    if (!expected.has(item)) {
      failures.push(`${key} beklenmeyen madde içeriyor: ${item}`);
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

function requireServices(report, failures) {
  const value = report.servicesVerified;
  if (!Array.isArray(value)) {
    failures.push("servicesVerified alan listesi zorunlu.");
    return;
  }

  const requiredServices = ["web", "api", "worker"];
  if (value.length !== requiredServices.length) {
    failures.push("servicesVerified tam 3 servis içermeli.");
  }

  for (const service of requiredServices) {
    const item = value.find((candidate) => candidate && typeof candidate === "object" && candidate.service === service);
    if (!item) {
      failures.push(`servicesVerified eksik: ${service}`);
      continue;
    }
    requireObjectKeySet(item, serviceVerifiedItemKeys, failures, `servicesVerified.${service}`);
    if (!["healthy", "running"].includes(item.status)) {
      failures.push(`${service}.status healthy veya running olmalı.`);
    }
    requireObjectString(item, failures, `${service}.imageTag`, "imageTag");
    requireObjectString(item, failures, `${service}.evidenceReference`, "evidenceReference");
    requireObjectNonPlaceholderString(item, failures, `${service}.imageTag`, "imageTag");
    requireObjectNonPlaceholderString(item, failures, `${service}.evidenceReference`, "evidenceReference");
  }
}

function requireEvidenceReferences(report, failures) {
  const value = report.evidenceReferences;
  if (!Array.isArray(value) || value.length === 0) {
    failures.push("evidenceReferences boş olmayan liste olmalı.");
    return;
  }

  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push("evidenceReferences boş olmayan metinlerden oluşmalı.");
      return;
    }
    if (!allowExampleEvidence && hasPlaceholderToken(item)) {
      failures.push("evidenceReferences production kanıtı için örnek/placeholder değer içermemeli.");
      return;
    }
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

function fail(failures) {
  console.error("Deployment rollback kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
