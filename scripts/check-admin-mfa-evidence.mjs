import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.env.ADMIN_MFA_EVIDENCE_TARGET;
const allowExampleEvidence = process.env.ADMIN_MFA_ALLOW_EXAMPLE_EVIDENCE === "1";
const adminMfaTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "policy",
  "enrollment",
  "loginVerification",
  "commandsPassed",
  "evidenceReferences",
  "gaps",
];
const adminMfaPolicyKeys = [
  "mode",
  "requiredRoles",
  "secretStorage",
  "secretEncryptionKeyEnv",
  "recoveryCodeHashKeyEnv",
  "challengeSecretEnv",
  "smsOtpRejected",
];
const adminMfaEnrollmentKeys = [
  "systemAdminsTotal",
  "systemAdminsEnrolled",
  "unenrolledRequiredAdmins",
  "recoveryCodesPerEnrollment",
];
const adminMfaLoginVerificationKeys = [
  "passwordOnlyLoginBlocked",
  "totpLoginSucceeded",
  "invalidTotpRejected",
  "totpReuseRejected",
  "recoveryCodeLoginSucceeded",
  "recoveryCodeReuseRejected",
  "sessionsRevokedOnEnable",
  "sessionsRevokedOnDisable",
];

if (!target) {
  fail(["ADMIN_MFA_EVIDENCE_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["ADMIN_MFA_EVIDENCE_TARGET file:// veya https:// URL olmalı."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Admin MFA kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Admin MFA raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["ADMIN_MFA_EVIDENCE_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["ADMIN_MFA_EVIDENCE_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["ADMIN_MFA_EVIDENCE_TARGET symlink olmayan file:// artifact olmali."]);
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
      fail(["ADMIN_MFA_EVIDENCE_TARGET parent dizini okunabilir olmali."]);
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["ADMIN_MFA_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmali."]);
    }
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["ADMIN_MFA_EVIDENCE_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["ADMIN_MFA_EVIDENCE_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["ADMIN_MFA_EVIDENCE_TARGET production kaniti icin lokal temp path olmamali."]);
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
    fail(["Admin MFA raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, adminMfaTopLevelKeys, failures, "adminMfa")) {
    return failures;
  }

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requirePolicy(report.policy, failures);
  requireEnrollment(report.enrollment, failures);
  requireLoginVerification(report.loginVerification, failures);
  requireStringArray(report.commandsPassed, failures, "commandsPassed");
  requireStringArray(report.evidenceReferences, failures, "evidenceReferences");
  requireEvidenceReferences(report.evidenceReferences, failures);
  requireEmptyArray(report, failures, "gaps");

  return failures;
}

function requirePolicy(policy, failures) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    failures.push("policy nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(policy, adminMfaPolicyKeys, failures, "policy");
  requireOneOf(policy, failures, "policy.mode", ["optional", "required"], "mode");
  requireStringArray(policy.requiredRoles, failures, "policy.requiredRoles");
  if (policy.requiredRoles?.length !== 1 || policy.requiredRoles[0] !== "SYSTEM_ADMIN") {
    failures.push("policy.requiredRoles yalnız SYSTEM_ADMIN içermeli.");
  }
  requireObjectEqual(policy, failures, "policy.secretStorage", "secretStorage", "aes-256-gcm");
  requireObjectEqual(policy, failures, "policy.secretEncryptionKeyEnv", "secretEncryptionKeyEnv", "ADMIN_MFA_SECRET_ENCRYPTION_KEY");
  requireObjectEqual(policy, failures, "policy.recoveryCodeHashKeyEnv", "recoveryCodeHashKeyEnv", "ADMIN_MFA_RECOVERY_HASH_KEY");
  requireObjectEqual(policy, failures, "policy.challengeSecretEnv", "challengeSecretEnv", "ADMIN_MFA_CHALLENGE_SECRET");
  if (policy.smsOtpRejected !== true) {
    failures.push("policy.smsOtpRejected true olmalı.");
  }
}

function requireEnrollment(enrollment, failures) {
  if (!enrollment || typeof enrollment !== "object" || Array.isArray(enrollment)) {
    failures.push("enrollment nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(enrollment, adminMfaEnrollmentKeys, failures, "enrollment");
  for (const key of adminMfaEnrollmentKeys) {
    requireObjectNonNegativeInteger(enrollment, failures, `enrollment.${key}`, key);
  }

  if (enrollment.systemAdminsEnrolled > enrollment.systemAdminsTotal) {
    failures.push("enrollment.systemAdminsEnrolled toplamdan büyük olamaz.");
  }
  if (enrollment.unenrolledRequiredAdmins !== 0) {
    failures.push("enrollment.unenrolledRequiredAdmins 0 olmalı.");
  }
  if (enrollment.recoveryCodesPerEnrollment < 8) {
    failures.push("enrollment.recoveryCodesPerEnrollment en az 8 olmalı.");
  }
}

function requireLoginVerification(verification, failures) {
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
    failures.push("loginVerification nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(verification, adminMfaLoginVerificationKeys, failures, "loginVerification");
  for (const key of adminMfaLoginVerificationKeys) {
    if (verification[key] !== true) {
      failures.push(`loginVerification.${key} true olmalı.`);
    }
  }
}

function requireEvidenceReferences(references, failures) {
  if (!Array.isArray(references)) return;
  for (const reference of references) {
    if (typeof reference !== "string" || reference.trim() === "") continue;
    if (!allowExampleEvidence && hasPlaceholderToken(reference)) {
      failures.push("evidenceReferences production kanıtı için örnek/placeholder/redacted değer içermemeli.");
    }
  }
}

function requireStringArray(value, failures, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    failures.push(`${label} boş olmayan metin listesi olmalı.`);
  }
}

function requireEqual(scope, failures, key, expected) {
  if (scope[key] !== expected) {
    failures.push(`${key} ${expected} olmalı.`);
  }
}

function requireObjectEqual(scope, failures, label, key, expected) {
  if (scope[key] !== expected) {
    failures.push(`${label} ${expected} olmalı.`);
  }
}

function requireOneOf(scope, failures, label, expectedValues, key = label) {
  if (!expectedValues.includes(scope[key])) {
    failures.push(`${label} ${expectedValues.join(" veya ")} olmalı.`);
  }
}

function requireObjectNonNegativeInteger(scope, failures, label, key) {
  if (!Number.isInteger(scope[key]) || scope[key] < 0) {
    failures.push(`${label} negatif olmayan tam sayı olmalı.`);
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
  console.error("Admin MFA kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
