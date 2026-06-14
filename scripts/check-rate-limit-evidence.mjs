import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.env.RATE_LIMIT_EVIDENCE_TARGET;
const allowExampleEvidence = process.env.RATE_LIMIT_ALLOW_EXAMPLE_EVIDENCE === "1";

const requiredCommands = ["pnpm rate-limit:smoke", "pnpm rate-limit:check"];
const expectedExcludedPaths = ["/health", "/metrics"];
const rateLimitTopLevelKeys = [
  "generatedAt",
  "result",
  "check",
  "environment",
  "checkedAt",
  "config",
  "instances",
  "apiRateLimit",
  "loginAttemptLimiter",
  "commandsPassed",
  "evidenceReferences",
  "gaps",
];
const configKeys = [
  "apiRateLimitEnabled",
  "apiRateLimitStore",
  "loginAttemptLimiterStore",
  "windowMs",
  "maxRequests",
  "loginMaxAttempts",
  "keyIncludesClientIpHash",
  "excludedPaths",
];
const instanceKeys = ["label", "baseUrl"];
const apiRateLimitKeys = [
  "clientIpHash",
  "requestsSent",
  "allowedBeforeLimit",
  "limitedAtRequest",
  "limitStatusCode",
  "errorCode",
  "retryAfterHeaderPresent",
  "secondInstanceLimitObserved",
  "healthEndpointExcluded",
  "metricsEndpointExcluded",
];
const loginAttemptLimiterKeys = [
  "clientIpHash",
  "emailHash",
  "attemptsSent",
  "lockStatusCode",
  "errorCode",
  "sharedAcrossInstances",
  "emailAndIpScoped",
  "differentIpNotLocked",
];

if (!target) {
  fail(["RATE_LIMIT_EVIDENCE_TARGET bos birakilamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["RATE_LIMIT_EVIDENCE_TARGET file:// veya https:// URL olmali."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Rate limit Redis kanit kontrolu gecti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Rate limit raporu okunamadi: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["RATE_LIMIT_EVIDENCE_TARGET yalniz file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["RATE_LIMIT_EVIDENCE_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["RATE_LIMIT_EVIDENCE_TARGET symlink olmayan file:// artifact olmali."]);
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
      fail(["RATE_LIMIT_EVIDENCE_TARGET parent dizini okunabilir olmali."]);
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["RATE_LIMIT_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmali."]);
    }
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["RATE_LIMIT_EVIDENCE_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["RATE_LIMIT_EVIDENCE_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["RATE_LIMIT_EVIDENCE_TARGET production kaniti icin lokal temp path olmamali."]);
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
    fail(["Rate limit raporu gecerli JSON olmali."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, rateLimitTopLevelKeys, failures, "rateLimit")) {
    return failures;
  }
  requireDate(report, failures, "generatedAt");
  requireDateNotInFuture(report, failures, "generatedAt");
  requireEqual(report, failures, "result", "PASS");
  requireEqual(report, failures, "check", "rate_limit_redis_smoke");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireConfig(report.config, failures);
  requireInstances(report.instances, failures);
  requireApiRateLimit(report.apiRateLimit, report.config, failures);
  requireLoginAttemptLimiter(report.loginAttemptLimiter, report.config, failures);
  requireCommands(report, failures);
  requireEvidenceReferences(report.evidenceReferences, failures);
  requireEmptyArray(report, failures, "gaps");

  return failures;
}

function requireConfig(config, failures) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    failures.push("config nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(config, configKeys, failures, "config");
  requireObjectTrue(config, failures, "config.apiRateLimitEnabled", "apiRateLimitEnabled");
  requireObjectEqual(config, failures, "config.apiRateLimitStore", "apiRateLimitStore", "redis");
  requireObjectEqual(config, failures, "config.loginAttemptLimiterStore", "loginAttemptLimiterStore", "redis");
  requireObjectIntegerAtLeast(config, failures, "config.windowMs", "windowMs", 1);
  requireObjectIntegerAtLeast(config, failures, "config.maxRequests", "maxRequests", 1);
  requireObjectIntegerAtLeast(config, failures, "config.loginMaxAttempts", "loginMaxAttempts", 1);
  requireObjectTrue(config, failures, "config.keyIncludesClientIpHash", "keyIncludesClientIpHash");
  requireExactStringSet(config.excludedPaths, failures, "config.excludedPaths", expectedExcludedPaths, "path");
}

function requireInstances(instances, failures) {
  if (!Array.isArray(instances)) {
    failures.push("instances listesi zorunlu.");
    return;
  }
  if (instances.length !== 2) {
    failures.push("instances tam 2 API instance kaniti icermeli.");
  }

  for (const [index, instance] of instances.entries()) {
    if (!instance || typeof instance !== "object" || Array.isArray(instance)) {
      failures.push(`instances.${index} nesnesi zorunlu.`);
      continue;
    }
    requireObjectKeySet(instance, instanceKeys, failures, `instances.${index}`);
    requireObjectString(instance, failures, `instances.${index}.label`, "label");
    requireObjectUrl(instance, failures, `instances.${index}.baseUrl`, "baseUrl");
  }
}

function requireApiRateLimit(apiRateLimit, config, failures) {
  if (!apiRateLimit || typeof apiRateLimit !== "object" || Array.isArray(apiRateLimit)) {
    failures.push("apiRateLimit nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(apiRateLimit, apiRateLimitKeys, failures, "apiRateLimit");
  requireObjectString(apiRateLimit, failures, "apiRateLimit.clientIpHash", "clientIpHash");
  requireObjectIntegerAtLeast(apiRateLimit, failures, "apiRateLimit.requestsSent", "requestsSent", 1);
  requireObjectIntegerAtLeast(apiRateLimit, failures, "apiRateLimit.allowedBeforeLimit", "allowedBeforeLimit", 0);
  requireObjectIntegerAtLeast(apiRateLimit, failures, "apiRateLimit.limitedAtRequest", "limitedAtRequest", 1);
  requireObjectEqual(apiRateLimit, failures, "apiRateLimit.limitStatusCode", "limitStatusCode", 429);
  requireObjectEqual(apiRateLimit, failures, "apiRateLimit.errorCode", "errorCode", "RATE_LIMITED");
  requireObjectTrue(apiRateLimit, failures, "apiRateLimit.retryAfterHeaderPresent", "retryAfterHeaderPresent");
  requireObjectTrue(apiRateLimit, failures, "apiRateLimit.secondInstanceLimitObserved", "secondInstanceLimitObserved");
  requireObjectTrue(apiRateLimit, failures, "apiRateLimit.healthEndpointExcluded", "healthEndpointExcluded");
  requireObjectTrue(apiRateLimit, failures, "apiRateLimit.metricsEndpointExcluded", "metricsEndpointExcluded");

  if (Number.isInteger(config?.maxRequests) && Number.isInteger(apiRateLimit.limitedAtRequest)) {
    if (apiRateLimit.limitedAtRequest !== config.maxRequests + 1) {
      failures.push("apiRateLimit.limitedAtRequest config.maxRequests + 1 olmali.");
    }
  }
  if (Number.isInteger(apiRateLimit.allowedBeforeLimit) && Number.isInteger(apiRateLimit.limitedAtRequest)) {
    if (apiRateLimit.allowedBeforeLimit !== apiRateLimit.limitedAtRequest - 1) {
      failures.push("apiRateLimit.allowedBeforeLimit limitedAtRequest - 1 olmali.");
    }
  }
}

function requireLoginAttemptLimiter(loginAttemptLimiter, config, failures) {
  if (!loginAttemptLimiter || typeof loginAttemptLimiter !== "object" || Array.isArray(loginAttemptLimiter)) {
    failures.push("loginAttemptLimiter nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(loginAttemptLimiter, loginAttemptLimiterKeys, failures, "loginAttemptLimiter");
  requireObjectString(loginAttemptLimiter, failures, "loginAttemptLimiter.clientIpHash", "clientIpHash");
  requireObjectString(loginAttemptLimiter, failures, "loginAttemptLimiter.emailHash", "emailHash");
  requireObjectIntegerAtLeast(loginAttemptLimiter, failures, "loginAttemptLimiter.attemptsSent", "attemptsSent", 1);
  requireObjectEqual(loginAttemptLimiter, failures, "loginAttemptLimiter.lockStatusCode", "lockStatusCode", 429);
  requireObjectEqual(loginAttemptLimiter, failures, "loginAttemptLimiter.errorCode", "errorCode", "LOGIN_LOCKED");
  requireObjectTrue(loginAttemptLimiter, failures, "loginAttemptLimiter.sharedAcrossInstances", "sharedAcrossInstances");
  requireObjectTrue(loginAttemptLimiter, failures, "loginAttemptLimiter.emailAndIpScoped", "emailAndIpScoped");
  requireObjectTrue(loginAttemptLimiter, failures, "loginAttemptLimiter.differentIpNotLocked", "differentIpNotLocked");

  if (Number.isInteger(config?.loginMaxAttempts) && Number.isInteger(loginAttemptLimiter.attemptsSent)) {
    if (loginAttemptLimiter.attemptsSent < config.loginMaxAttempts + 1) {
      failures.push("loginAttemptLimiter.attemptsSent config.loginMaxAttempts + 1 veya daha fazla olmali.");
    }
  }
}

function requireCommands(report, failures) {
  if (!Array.isArray(report.commandsPassed)) {
    failures.push("commandsPassed listesi zorunlu.");
    return;
  }

  requireExactStringSet(report.commandsPassed, failures, "commandsPassed", requiredCommands, "komut");
}

function requireEmptyArray(report, failures, key) {
  const value = report?.[key];
  if (!Array.isArray(value)) {
    failures.push(`${key} listesi zorunlu.`);
    return;
  }
  if (value.length > 0) {
    failures.push(`${key} bos olmali.`);
  }
}

function requireEvidenceReferences(references, failures) {
  requireStringList(references, failures, "evidenceReferences", 2);
  if (!Array.isArray(references) || allowExampleEvidence) return;

  for (const [index, value] of references.entries()) {
    if (hasPlaceholderToken(value)) {
      failures.push(`evidenceReferences.${index} production kaniti icin placeholder/redacted deger olmamali.`);
    }
  }
}

function requireEqual(report, failures, key, expected) {
  if (report?.[key] !== expected) {
    failures.push(`${key} ${expected} olmali.`);
  }
}

function requireObjectEqual(scope, failures, label, key, expected) {
  if (scope?.[key] !== expected) {
    failures.push(`${label} ${expected} olmali.`);
  }
}

function requireOneOf(report, failures, key, expectedValues) {
  if (!expectedValues.includes(report?.[key])) {
    failures.push(`${key} ${expectedValues.join(" veya ")} olmali.`);
  }
}

function requireObjectTrue(scope, failures, label, key) {
  if (scope?.[key] !== true) {
    failures.push(`${label} true olmali.`);
  }
}

function requireObjectKeySet(value, expectedKeys, failures, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return false;
  }

  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length) {
    failures.push(`${label} tam ${expectedKeys.length} alan icermeli.`);
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

function requireObjectString(scope, failures, label, key) {
  const value = scope?.[key];
  if (typeof value !== "string" || value.trim() === "") {
    failures.push(`${label} bos olmayan metin olmali.`);
    return;
  }
  if (!allowExampleEvidence && hasPlaceholderToken(value)) {
    failures.push(`${label} production kaniti icin placeholder/redacted deger olmamali.`);
  }
}

function requireObjectUrl(scope, failures, label, key) {
  const value = scope?.[key];
  if (typeof value !== "string" || value.trim() === "") {
    failures.push(`${label} bos olmayan URL olmali.`);
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      failures.push(`${label} http:// veya https:// olmali.`);
    }
  } catch {
    failures.push(`${label} gecerli URL olmali.`);
  }
  if (!allowExampleEvidence && hasPlaceholderToken(value)) {
    failures.push(`${label} production kaniti icin placeholder/redacted deger olmamali.`);
  }
}

function requireObjectIntegerAtLeast(scope, failures, label, key, min) {
  if (!Number.isInteger(scope?.[key]) || scope[key] < min) {
    failures.push(`${label} en az ${min} tam sayi olmali.`);
  }
}

function requireStringList(value, failures, label, minLength) {
  if (!Array.isArray(value) || value.length < minLength) {
    failures.push(`${label} en az ${minLength} metin icermeli.`);
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label}.${index} bos olmayan metin olmali.`);
    }
  }
}

function requireExactStringSet(value, failures, label, expectedValues, itemLabel) {
  if (!Array.isArray(value)) {
    failures.push(`${label} listesi zorunlu.`);
    return;
  }

  if (value.length !== expectedValues.length) {
    failures.push(`${label} tam ${expectedValues.length} ${itemLabel} icermeli.`);
  }

  const expected = new Set(expectedValues);
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label} bos olmayan metinlerden olusmali.`);
      continue;
    }
    if (seen.has(item)) {
      failures.push(`${label} tekrarli ${itemLabel} iceriyor: ${item}`);
    }
    seen.add(item);
    if (!expected.has(item)) {
      failures.push(`${label} beklenmeyen ${itemLabel} iceriyor: ${item}`);
    }
  }

  for (const expectedValue of expectedValues) {
    if (!seen.has(expectedValue)) {
      failures.push(`${label} eksik: ${expectedValue}`);
    }
  }
}

function requireDate(report, failures, key) {
  const value = report?.[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${key} gecerli tarih olmali.`);
  }
}

function requireDateNotInFuture(report, failures, key) {
  if (allowExampleEvidence) return;

  const value = report?.[key];
  const timestamp = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(timestamp)) return;

  const clockSkewMs = 5 * 60 * 1000;
  if (timestamp > Date.now() + clockSkewMs) {
    failures.push(`${key} gelecekte olamaz.`);
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
  console.error("Rate limit Redis kanit kontrolu basarisiz:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
