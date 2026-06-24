import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.env.AUDIT_NULL_TENANT_EVIDENCE_TARGET;
const allowExampleEvidence = process.env.AUDIT_NULL_TENANT_ALLOW_EXAMPLE_EVIDENCE === "1";

const requiredCommands = ["pnpm audit-null-tenant:check"];
const topLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "auditNullTenant",
  "commandsPassed",
  "evidenceReferences",
  "gaps",
];
const auditNullTenantKeys = ["totalRows", "tenantRows", "nullTenantRows", "nullTenantBreakdown"];
const breakdownKeys = ["system", "deletedTenant", "unknown"];
const breakdownItemKeys = ["count", "classificationRule"];

if (!target) {
  fail(["AUDIT_NULL_TENANT_EVIDENCE_TARGET bos birakilamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["AUDIT_NULL_TENANT_EVIDENCE_TARGET file:// veya https:// URL olmali."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Audit null tenant kanit kontrolu gecti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Audit null tenant raporu okunamadi: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["AUDIT_NULL_TENANT_EVIDENCE_TARGET yalniz file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["AUDIT_NULL_TENANT_EVIDENCE_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["AUDIT_NULL_TENANT_EVIDENCE_TARGET symlink olmayan file:// artifact olmali."]);
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
      fail(["AUDIT_NULL_TENANT_EVIDENCE_TARGET parent dizini okunabilir olmali."]);
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["AUDIT_NULL_TENANT_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmali."]);
    }
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["AUDIT_NULL_TENANT_EVIDENCE_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["AUDIT_NULL_TENANT_EVIDENCE_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["AUDIT_NULL_TENANT_EVIDENCE_TARGET production kaniti icin lokal temp path olmamali."]);
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
    fail(["Audit null tenant raporu gecerli JSON olmali."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, topLevelKeys, failures, "auditNullTenantEvidence")) {
    return failures;
  }

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireAuditNullTenantClassification(report.auditNullTenant, failures);
  requireCommands(report, failures);
  requireEvidenceReferences(report.evidenceReferences, failures);
  requireEmptyArray(report, failures, "gaps");

  return failures;
}

function requireAuditNullTenantClassification(value, failures) {
  if (!requireObjectKeySet(value, auditNullTenantKeys, failures, "auditNullTenant")) return;

  requireObjectIntegerAtLeast(value, failures, "auditNullTenant.totalRows", "totalRows", 0);
  requireObjectIntegerAtLeast(value, failures, "auditNullTenant.tenantRows", "tenantRows", 0);
  requireObjectIntegerAtLeast(value, failures, "auditNullTenant.nullTenantRows", "nullTenantRows", 0);
  if (Number.isInteger(value.totalRows) && Number.isInteger(value.tenantRows) && Number.isInteger(value.nullTenantRows)) {
    if (value.totalRows !== value.tenantRows + value.nullTenantRows) {
      failures.push("auditNullTenant.totalRows tenantRows + nullTenantRows toplamına esit olmali.");
    }
  }

  const breakdown = value.nullTenantBreakdown;
  if (!requireObjectKeySet(breakdown, breakdownKeys, failures, "auditNullTenant.nullTenantBreakdown")) return;

  let breakdownCount = 0;
  for (const key of breakdownKeys) {
    const item = breakdown[key];
    if (!requireObjectKeySet(item, breakdownItemKeys, failures, `auditNullTenant.nullTenantBreakdown.${key}`)) {
      continue;
    }
    requireObjectIntegerAtLeast(item, failures, `auditNullTenant.nullTenantBreakdown.${key}.count`, "count", 0);
    requireObjectString(item, failures, `auditNullTenant.nullTenantBreakdown.${key}.classificationRule`, "classificationRule");
    if (Number.isInteger(item.count)) breakdownCount += item.count;
  }

  if (breakdown.unknown?.count !== 0) {
    failures.push("auditNullTenant.nullTenantBreakdown.unknown.count 0 olmali.");
  }
  if (Number.isInteger(value.nullTenantRows) && breakdownCount !== value.nullTenantRows) {
    failures.push("auditNullTenant.nullTenantBreakdown count toplami nullTenantRows degerine esit olmali.");
  }
}

function requireCommands(report, failures) {
  requireExactStringSet(report.commandsPassed, failures, "commandsPassed", requiredCommands, "komut");
}

function requireEvidenceReferences(value, failures) {
  if (!Array.isArray(value) || value.length < 1) {
    failures.push("evidenceReferences en az 1 kanit referansi icermeli.");
    return;
  }

  if (allowExampleEvidence) return;
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`evidenceReferences.${index} bos olmayan metin olmali.`);
      continue;
    }
    if (hasPlaceholderToken(item)) {
      failures.push(`evidenceReferences.${index} production kaniti icin placeholder/redacted deger olmamali.`);
    }
  }
}

function requireEqual(report, failures, key, expected) {
  if (report[key] !== expected) {
    failures.push(`${key} ${expected} olmali.`);
  }
}

function requireOneOf(report, failures, key, expectedValues) {
  if (!expectedValues.includes(report[key])) {
    failures.push(`${key} ${expectedValues.join(" veya ")} olmali.`);
  }
}

function requireDate(report, failures, key) {
  const value = report[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${key} gecerli tarih olmali.`);
  }
}

function requireDateNotInFuture(report, failures, key) {
  if (allowExampleEvidence) return;

  const value = report[key];
  const timestamp = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(timestamp)) return;

  const clockSkewMs = 5 * 60 * 1000;
  if (timestamp > Date.now() + clockSkewMs) {
    failures.push(`${key} gelecekte olamaz.`);
  }
}

function requireObjectString(scope, failures, label, key) {
  if (typeof scope?.[key] !== "string" || scope[key].trim() === "") {
    failures.push(`${label} bos olmayan metin olmali.`);
  }
}

function requireObjectIntegerAtLeast(scope, failures, label, key, min) {
  if (!Number.isInteger(scope?.[key]) || scope[key] < min) {
    failures.push(`${label} en az ${min} tam sayi olmali.`);
  }
}

function requireObjectKeySet(value, expectedKeys, failures, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return false;
  }

  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length) {
    failures.push(`${label} tam ${expectedKeys.length} alan icermeli.`);
    return false;
  }

  for (const expectedKey of expectedKeys) {
    if (!Object.hasOwn(value, expectedKey)) {
      failures.push(`${label}.${expectedKey} alani zorunlu.`);
    }
  }

  return true;
}

function requireExactStringSet(value, failures, label, expectedValues, itemLabel) {
  if (!Array.isArray(value)) {
    failures.push(`${label} listesi zorunlu.`);
    return;
  }

  if (value.length !== expectedValues.length) {
    failures.push(`${label} tam ${expectedValues.length} ${itemLabel} icermeli.`);
    return;
  }

  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label}[${index}] bos olmayan metin olmali.`);
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
    failures.push(`${key} bos olmali.`);
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
  console.error("Audit null tenant kanit kontrolu basarisiz:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
