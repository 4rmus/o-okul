import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTenantScopedTables } from "../packages/db/scripts/tenant-models.mjs";

const target = process.env.RLS_LIVE_EVIDENCE_TARGET;
const allowExampleEvidence = process.env.RLS_LIVE_ALLOW_EXAMPLE_EVIDENCE === "1";

const expectedTenantTables = getTenantScopedTables();
const rlsLiveTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "schema",
  "isolation",
  "loadSmoke",
  "commandsPassed",
  "evidenceReferences",
  "gaps",
];
const schemaKeys = ["tenantScopedTables", "derivedFromSchema", "staticCheckPassed", "liveCheckPassed", "tablesVerified"];
const isolationKeys = [
  "tenantAHash",
  "tenantBHash",
  "crossTenantReadRows",
  "crossTenantReadChecks",
  "withCheckRejects",
  "systemAdminBypassDefaultOff",
  "bypassRequiresReason",
  "auditBypassAction",
];
const loadSmokeKeys = ["targetRps", "actualRps", "durationSeconds", "concurrency", "queriesCompleted", "failures"];
const requiredCommands = [
  "pnpm db:rls:check",
  "pnpm db:rls:check:live",
  "pnpm rls:load:smoke",
  "pnpm rls:live:check",
];
const requiredWriteRejects = [
  "Student wrong tenant insert",
  "Homework wrong tenant insert",
  "Announcement wrong tenant insert",
  "MessageTemplate wrong tenant insert",
  "ExamResult foreign tenant RawImport",
  "ParsedAnswer foreign tenant RawImport",
  "ParsedAnswer cross exam mismatch",
  "ParsedAnswer duplicate raw import participant parser",
];

if (!target) {
  fail(["RLS_LIVE_EVIDENCE_TARGET bos birakilamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["RLS_LIVE_EVIDENCE_TARGET file:// veya https:// URL olmali."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`RLS live kanit kontrolu gecti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`RLS live raporu okunamadi: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["RLS_LIVE_EVIDENCE_TARGET yalniz file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["RLS_LIVE_EVIDENCE_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["RLS_LIVE_EVIDENCE_TARGET symlink olmayan file:// artifact olmali."]);
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
      fail(["RLS_LIVE_EVIDENCE_TARGET parent dizini okunabilir olmali."]);
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["RLS_LIVE_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmali."]);
    }
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["RLS_LIVE_EVIDENCE_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["RLS_LIVE_EVIDENCE_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["RLS_LIVE_EVIDENCE_TARGET production kaniti icin lokal temp path olmamali."]);
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
    fail(["RLS live raporu gecerli JSON olmali."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, rlsLiveTopLevelKeys, failures, "rlsLive")) {
    return failures;
  }
  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireSchema(report.schema, failures);
  requireIsolation(report.isolation, failures);
  requireLoadSmoke(report.loadSmoke, failures);
  requireCommands(report, failures);
  requireEvidenceReferences(report.evidenceReferences, failures);
  requireRlsLoadSmokeArtifactReference(report.evidenceReferences, failures);
  requireEmptyArray(report, failures, "gaps");

  return failures;
}

function requireRlsLoadSmokeArtifactReference(references, failures) {
  if (!Array.isArray(references)) return;
  if (!references.some((value) => typeof value === "string" && value.includes("rls-load-smoke"))) {
    failures.push("evidenceReferences rls-load-smoke kanıt artifact'ini içermeli.");
  }
}

function requireSchema(schema, failures) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    failures.push("schema nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(schema, schemaKeys, failures, "schema");
  requireObjectIntegerAtLeast(
    schema,
    failures,
    "schema.tenantScopedTables",
    "tenantScopedTables",
    expectedTenantTables.length,
  );
  requireObjectTrue(schema, failures, "schema.derivedFromSchema", "derivedFromSchema");
  requireObjectTrue(schema, failures, "schema.staticCheckPassed", "staticCheckPassed");
  requireObjectTrue(schema, failures, "schema.liveCheckPassed", "liveCheckPassed");
  requireExactStringSet(schema.tablesVerified, failures, "schema.tablesVerified", expectedTenantTables, "tablo");

  if (schema.tenantScopedTables !== expectedTenantTables.length) {
    failures.push(`schema.tenantScopedTables ${expectedTenantTables.length} olmali.`);
  }
}

function requireIsolation(isolation, failures) {
  if (!isolation || typeof isolation !== "object" || Array.isArray(isolation)) {
    failures.push("isolation nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(isolation, isolationKeys, failures, "isolation");
  requireObjectString(isolation, failures, "isolation.tenantAHash", "tenantAHash");
  requireObjectString(isolation, failures, "isolation.tenantBHash", "tenantBHash");
  requireObjectEqual(isolation, failures, "isolation.crossTenantReadRows", "crossTenantReadRows", 0);
  requireObjectIntegerAtLeast(
    isolation,
    failures,
    "isolation.crossTenantReadChecks",
    "crossTenantReadChecks",
    expectedTenantTables.length,
  );
  requireExactStringSet(isolation.withCheckRejects, failures, "isolation.withCheckRejects", requiredWriteRejects, "negatif");
  requireObjectTrue(isolation, failures, "isolation.systemAdminBypassDefaultOff", "systemAdminBypassDefaultOff");
  requireObjectTrue(isolation, failures, "isolation.bypassRequiresReason", "bypassRequiresReason");
  requireObjectEqual(
    isolation,
    failures,
    "isolation.auditBypassAction",
    "auditBypassAction",
    "system.rls_bypass_requested",
  );
}

function requireLoadSmoke(loadSmoke, failures) {
  if (!loadSmoke || typeof loadSmoke !== "object" || Array.isArray(loadSmoke)) {
    failures.push("loadSmoke nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(loadSmoke, loadSmokeKeys, failures, "loadSmoke");
  requireObjectIntegerAtLeast(loadSmoke, failures, "loadSmoke.targetRps", "targetRps", 200);
  requireObjectNumberAtLeast(loadSmoke, failures, "loadSmoke.actualRps", "actualRps", loadSmoke.targetRps ?? 200);
  requireObjectIntegerAtLeast(loadSmoke, failures, "loadSmoke.durationSeconds", "durationSeconds", 1);
  requireObjectIntegerAtLeast(loadSmoke, failures, "loadSmoke.concurrency", "concurrency", 1);
  requireObjectIntegerAtLeast(loadSmoke, failures, "loadSmoke.queriesCompleted", "queriesCompleted", 1);
  requireObjectEqual(loadSmoke, failures, "loadSmoke.failures", "failures", 0);
}

function requireCommands(report, failures) {
  if (!Array.isArray(report.commandsPassed)) {
    failures.push("commandsPassed listesi zorunlu.");
    return;
  }

  requireExactStringSet(report.commandsPassed, failures, "commandsPassed", requiredCommands, "komut");
}

function requireEvidenceReferences(references, failures) {
  requireStringList(references, failures, "evidenceReferences", 3);
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

function requireObjectIntegerAtLeast(scope, failures, label, key, min) {
  if (!Number.isInteger(scope?.[key]) || scope[key] < min) {
    failures.push(`${label} en az ${min} tam sayi olmali.`);
  }
}

function requireObjectNumberAtLeast(scope, failures, label, key, min) {
  if (typeof scope?.[key] !== "number" || Number.isNaN(scope[key]) || scope[key] < min) {
    failures.push(`${label} en az ${min} sayi olmali.`);
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
  console.error("RLS live kanit kontrolu basarisiz:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
