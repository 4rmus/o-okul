import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";

const enabled = process.env.NEXT_E2E_LIVE_ONBOARDING;
const evidencePath = process.env.LIVE_ONBOARDING_EVIDENCE_PATH;
const allowExampleEvidence = process.env.LIVE_ONBOARDING_ALLOW_EXAMPLE_EVIDENCE === "1";

const failures = [];

if (enabled !== "1") {
  failures.push("NEXT_E2E_LIVE_ONBOARDING=1 olmalı.");
}

if (!evidencePath) {
  failures.push("LIVE_ONBOARDING_EVIDENCE_PATH boş bırakılamaz.");
}

if (failures.length === 0) {
  const resolvedPath = resolve(evidencePath);
  await validateEvidencePath(resolvedPath, failures);

  if (failures.length === 0) {
    const evidence = parseJson(await readFile(resolvedPath, "utf8"), failures);
    if (evidence) validateEvidence(evidence, failures);
  }
}

if (failures.length > 0) {
  console.error("Live onboarding evidence preflight başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Live onboarding evidence preflight geçti.");

async function validateEvidencePath(filePath, collectedFailures) {
  if (isLocalTempPath(filePath)) {
    collectedFailures.push("LIVE_ONBOARDING_EVIDENCE_PATH lokal temp path olmamalı.");
    return;
  }

  await assertParentPathAllowed(dirname(filePath), collectedFailures);
  if (collectedFailures.length > 0) return;

  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    collectedFailures.push("LIVE_ONBOARDING_EVIDENCE_PATH okunabilir file artifact olmalı.");
    return;
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    collectedFailures.push("LIVE_ONBOARDING_EVIDENCE_PATH symlink olmayan file artifact olmalı.");
  }
}

async function assertParentPathAllowed(parentPath, collectedFailures) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    let stat;
    try {
      stat = await lstat(current);
    } catch {
      collectedFailures.push("LIVE_ONBOARDING_EVIDENCE_PATH parent dizini mevcut olmalı.");
      return;
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      collectedFailures.push("LIVE_ONBOARDING_EVIDENCE_PATH parent dizini symlink olmayan dizin olmalı.");
      return;
    }
  }
}

function isLocalTempPath(filePath) {
  return filePath === "/tmp" || filePath.startsWith("/tmp/") || filePath === "/var/tmp" || filePath.startsWith("/var/tmp/");
}

function parseJson(value, collectedFailures) {
  try {
    return JSON.parse(value);
  } catch {
    collectedFailures.push("LIVE_ONBOARDING_EVIDENCE_PATH geçerli JSON olmalı.");
    return null;
  }
}

function validateEvidence(evidence, collectedFailures) {
  if (!isObjectRecord(evidence)) {
    collectedFailures.push("liveOnboardingEvidence nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(evidence, collectedFailures, "liveOnboardingEvidence", [
    "firstAdmin",
    "systemAdmin",
    "tenant",
  ], ["appendRunId", "onboarding"]);

  if (Object.hasOwn(evidence, "appendRunId") && typeof evidence.appendRunId !== "boolean") {
    collectedFailures.push("appendRunId boolean olmalı.");
  }

  validatePrincipal(evidence.systemAdmin, collectedFailures, "systemAdmin", { requireName: false });
  validatePrincipal(evidence.firstAdmin, collectedFailures, "firstAdmin", { requireName: true });
  validateTenant(evidence.tenant, collectedFailures);
  validateOnboarding(evidence.onboarding, collectedFailures);

  const systemAdminEmail = normalizeString(evidence.systemAdmin?.email);
  const firstAdminEmail = normalizeString(evidence.firstAdmin?.email);
  if (systemAdminEmail && firstAdminEmail && systemAdminEmail === firstAdminEmail) {
    collectedFailures.push("systemAdmin.email ve firstAdmin.email farklı olmalı.");
  }
}

function validatePrincipal(value, collectedFailures, label, { requireName }) {
  if (!isObjectRecord(value)) {
    collectedFailures.push(`${label} nesnesi zorunlu.`);
    return;
  }

  requireObjectKeySet(value, collectedFailures, label, requireName ? ["email", "name", "password"] : ["email", "password"]);
  requireEmail(value, collectedFailures, `${label}.email`, "email");
  requireSecret(value, collectedFailures, `${label}.password`, "password");
  if (requireName) {
    requireString(value, collectedFailures, `${label}.name`, "name");
    requireNonPlaceholderString(value, collectedFailures, `${label}.name`, "name");
  }
}

function validateTenant(value, collectedFailures) {
  if (!isObjectRecord(value)) {
    collectedFailures.push("tenant nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(value, collectedFailures, "tenant", ["name", "slug"], ["plan", "seatLimit"]);
  requireString(value, collectedFailures, "tenant.name", "name");
  requireNonPlaceholderString(value, collectedFailures, "tenant.name", "name");
  requireString(value, collectedFailures, "tenant.slug", "slug");
  requireNonPlaceholderString(value, collectedFailures, "tenant.slug", "slug");
  if (typeof value.slug === "string" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)) {
    collectedFailures.push("tenant.slug küçük harf, rakam ve tire içermeli.");
  }

  if (Object.hasOwn(value, "plan") && !["TRIAL", "PRO", "ENTERPRISE"].includes(value.plan)) {
    collectedFailures.push("tenant.plan TRIAL, PRO veya ENTERPRISE olmalı.");
  }
  if (Object.hasOwn(value, "seatLimit") && (!Number.isInteger(value.seatLimit) || value.seatLimit < 1)) {
    collectedFailures.push("tenant.seatLimit pozitif tam sayı olmalı.");
  }
}

function validateOnboarding(value, collectedFailures) {
  if (value === undefined) return;
  if (!isObjectRecord(value)) {
    collectedFailures.push("onboarding nesnesi olmalı.");
    return;
  }

  requireObjectKeySet(value, collectedFailures, "onboarding", [], ["contactEmail", "importOwner", "institutionName"]);
  if (Object.hasOwn(value, "contactEmail")) {
    requireEmail(value, collectedFailures, "onboarding.contactEmail", "contactEmail");
  }
  for (const key of ["importOwner", "institutionName"]) {
    if (Object.hasOwn(value, key)) {
      requireString(value, collectedFailures, `onboarding.${key}`, key);
      requireNonPlaceholderString(value, collectedFailures, `onboarding.${key}`, key);
    }
  }
}

function requireObjectKeySet(value, collectedFailures, label, requiredKeys, optionalKeys = []) {
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  const keys = Object.keys(value);

  for (const requiredKey of requiredKeys) {
    if (!Object.hasOwn(value, requiredKey)) {
      collectedFailures.push(`${label}.${requiredKey} alanı zorunlu.`);
    }
  }
  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      collectedFailures.push(`${label}.${key} beklenmeyen alan.`);
    }
  }
}

function requireEmail(scope, collectedFailures, label, key) {
  requireString(scope, collectedFailures, label, key);
  if (typeof scope[key] !== "string") return;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(scope[key])) {
    collectedFailures.push(`${label} geçerli e-posta olmalı.`);
    return;
  }
  requireNonPlaceholderString(scope, collectedFailures, label, key);
}

function requireSecret(scope, collectedFailures, label, key) {
  requireString(scope, collectedFailures, label, key);
  if (typeof scope[key] !== "string") return;

  if (scope[key].length < 8) {
    collectedFailures.push(`${label} en az 8 karakter olmalı.`);
  }
  requireNonPlaceholderString(scope, collectedFailures, label, key);
}

function requireString(scope, collectedFailures, label, key) {
  if (typeof scope[key] !== "string" || scope[key].trim() === "") {
    collectedFailures.push(`${label} boş olmayan metin olmalı.`);
  }
}

function requireNonPlaceholderString(scope, collectedFailures, label, key) {
  if (allowExampleEvidence) return;

  const value = scope[key];
  if (typeof value !== "string" || value.trim() === "") return;
  if (hasPlaceholderToken(value)) {
    collectedFailures.push(`${label} production kanıtı için örnek/placeholder/redacted değer olmamalı.`);
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
    "dummy",
  ].some((token) => normalized.includes(token));
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isObjectRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
