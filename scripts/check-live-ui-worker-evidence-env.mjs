import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";

const enabled = process.env.NEXT_E2E_LIVE_UI_WORKER;
const evidencePath = process.env.LIVE_UI_WORKER_EVIDENCE_PATH;
const resultEvidencePath = process.env.LIVE_UI_WORKER_RESULT_EVIDENCE_FILE ?? process.env.LIVE_UI_WORKER_RESULT_EVIDENCE_PATH;
const resultEvidenceEnvironment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV;
const allowExampleEvidence = process.env.LIVE_UI_WORKER_ALLOW_EXAMPLE_EVIDENCE === "1";
const failures = [];

if (enabled !== "1") {
  failures.push("NEXT_E2E_LIVE_UI_WORKER=1 olmalı.");
}

if (!evidencePath) {
  failures.push("LIVE_UI_WORKER_EVIDENCE_PATH boş bırakılamaz.");
}

if (failures.length === 0) {
  const resolvedPath = resolve(evidencePath);
  await validateEvidencePath(resolvedPath, failures);

  if (failures.length === 0) {
    const evidence = parseJson(await readFile(resolvedPath, "utf8"), failures);
    if (evidence) validateEvidence(evidence, failures);
  }
}

if (resultEvidencePath) {
  if (!["staging", "production"].includes(String(resultEvidenceEnvironment).toLowerCase())) {
    failures.push("LIVE_UI_WORKER_RESULT_EVIDENCE_FILE için STAGING_ENVIRONMENT veya NODE_ENV staging/production olmalı.");
  }
  await validateResultEvidencePath(resolve(resultEvidencePath), failures);
}

if (failures.length > 0) {
  console.error("Live UI-worker evidence preflight başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Live UI-worker evidence preflight geçti.");

async function validateEvidencePath(filePath, collectedFailures) {
  if (isLocalTempPath(filePath)) {
    collectedFailures.push("LIVE_UI_WORKER_EVIDENCE_PATH lokal temp path olmamalı.");
    return;
  }

  await assertParentPathAllowed(dirname(filePath), collectedFailures, "LIVE_UI_WORKER_EVIDENCE_PATH");
  if (collectedFailures.length > 0) return;

  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    collectedFailures.push("LIVE_UI_WORKER_EVIDENCE_PATH okunabilir file artifact olmalı.");
    return;
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    collectedFailures.push("LIVE_UI_WORKER_EVIDENCE_PATH symlink olmayan file artifact olmalı.");
  }
}

async function validateResultEvidencePath(filePath, collectedFailures) {
  if (isLocalTempPath(filePath)) {
    collectedFailures.push("LIVE_UI_WORKER_RESULT_EVIDENCE_FILE lokal temp path olmamalı.");
    return;
  }

  await assertParentPathAllowed(dirname(filePath), collectedFailures, "LIVE_UI_WORKER_RESULT_EVIDENCE_FILE", {
    allowMissing: true,
  });
  if (collectedFailures.length > 0) return;

  let stat;
  try {
    stat = await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    collectedFailures.push("LIVE_UI_WORKER_RESULT_EVIDENCE_FILE symlink olmayan file artifact olmalı.");
  }
}

async function assertParentPathAllowed(parentPath, collectedFailures, label, { allowMissing = false } = {}) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (allowMissing && error?.code === "ENOENT") return;
      collectedFailures.push(parentPathMissingMessage(label));
      return;
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      collectedFailures.push(parentPathInvalidMessage(label));
      return;
    }
  }
}

function parentPathMissingMessage(label) {
  if (label === "LIVE_UI_WORKER_RESULT_EVIDENCE_FILE") {
    return "LIVE_UI_WORKER_RESULT_EVIDENCE_FILE parent dizini mevcut olmalı.";
  }
  return "LIVE_UI_WORKER_EVIDENCE_PATH parent dizini mevcut olmalı.";
}

function parentPathInvalidMessage(label) {
  if (label === "LIVE_UI_WORKER_RESULT_EVIDENCE_FILE") {
    return "LIVE_UI_WORKER_RESULT_EVIDENCE_FILE parent dizini symlink olmayan dizin olmalı.";
  }
  return "LIVE_UI_WORKER_EVIDENCE_PATH parent dizini symlink olmayan dizin olmalı.";
}

function isLocalTempPath(filePath) {
  return filePath === "/tmp" || filePath.startsWith("/tmp/") || filePath === "/var/tmp" || filePath.startsWith("/var/tmp/");
}

function parseJson(value, collectedFailures) {
  try {
    return JSON.parse(value);
  } catch {
    collectedFailures.push("LIVE_UI_WORKER_EVIDENCE_PATH geçerli JSON olmalı.");
    return null;
  }
}

function validateEvidence(evidence, collectedFailures) {
  if (!isObjectRecord(evidence)) {
    collectedFailures.push("liveUiWorkerEvidence nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(evidence, collectedFailures, "liveUiWorkerEvidence", [
    "email",
    "examId",
    "firstStudentId",
    "password",
  ], ["guardianPortal", "studentPortal"]);
  requireEmail(evidence, collectedFailures, "email", "email");
  requireSecret(evidence, collectedFailures, "password", "password");
  requireString(evidence, collectedFailures, "examId", "examId");
  requireNonPlaceholderString(evidence, collectedFailures, "examId", "examId");
  requireString(evidence, collectedFailures, "firstStudentId", "firstStudentId");
  requireNonPlaceholderString(evidence, collectedFailures, "firstStudentId", "firstStudentId");
  validatePortalCredentials(evidence.studentPortal, collectedFailures, "studentPortal");
  validatePortalCredentials(evidence.guardianPortal, collectedFailures, "guardianPortal");
}

function validatePortalCredentials(value, collectedFailures, label) {
  if (value === undefined) return;
  if (!isObjectRecord(value)) {
    collectedFailures.push(`${label} nesnesi olmalı.`);
    return;
  }

  requireObjectKeySet(value, collectedFailures, label, ["email", "password"]);
  requireEmail(value, collectedFailures, `${label}.email`, "email");
  requireSecret(value, collectedFailures, `${label}.password`, "password");
}

function requireObjectKeySet(value, collectedFailures, label, requiredKeys, optionalKeys = []) {
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  for (const requiredKey of requiredKeys) {
    if (!Object.hasOwn(value, requiredKey)) {
      collectedFailures.push(`${label}.${requiredKey} alanı zorunlu.`);
    }
  }
  for (const key of Object.keys(value)) {
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

function isObjectRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
