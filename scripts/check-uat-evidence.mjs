import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.UAT_EVIDENCE_TARGET;
const allowExampleEvidence = process.env.UAT_ALLOW_EXAMPLE_EVIDENCE === "1";
const uatTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "tester",
  "releaseCandidate",
  "rollbackImageTag",
  "restoreBackupReference",
  "flowsVerified",
  "commandsPassed",
  "journeyScenariosVerified",
  "defects",
];
const uatJourneyScenarioKeys = ["id", "persona", "status", "evidence"];

const expectedJourneyScenarios = [
  ["UAT-SYS-01", "SYSTEM_ADMIN"],
  ["UAT-SYS-02", "SYSTEM_ADMIN"],
  ["UAT-SYS-03", "SYSTEM_ADMIN"],
  ["UAT-SYS-04", "SYSTEM_ADMIN"],
  ["UAT-KURUM-01", "TENANT_ADMIN"],
  ["UAT-KURUM-02", "TENANT_ADMIN"],
  ["UAT-KURUM-03", "TENANT_ADMIN"],
  ["UAT-KURUM-04", "TENANT_ADMIN"],
  ["UAT-KURUM-05", "TENANT_ADMIN"],
  ["UAT-KURUM-06", "TENANT_ADMIN"],
  ["UAT-KURUM-07", "TENANT_ADMIN"],
  ["UAT-KURUM-08", "TENANT_ADMIN"],
  ["UAT-TEACHER-01", "TEACHER"],
  ["UAT-TEACHER-02", "TEACHER"],
  ["UAT-TEACHER-03", "TEACHER"],
  ["UAT-STUDENT-01", "STUDENT"],
  ["UAT-STUDENT-02", "STUDENT"],
  ["UAT-STUDENT-03", "STUDENT"],
  ["UAT-GUARDIAN-01", "GUARDIAN"],
  ["UAT-GUARDIAN-02", "GUARDIAN"],
  ["UAT-GUARDIAN-03", "GUARDIAN"],
];
const expectedFlowsVerified = [
  "tenant admin login",
  "teacher workflow",
  "guardian workflow",
  "raw import smoke",
  "report generation smoke",
  "live exam cycle evidence",
  "sms batch smoke",
  "notification provider smoke",
  "privacy purge",
];
const expectedCommandsPassed = [
  "pnpm run ci",
  "pnpm prod:env:check",
  "pnpm db:rls:check:live",
  "pnpm raw-import:smoke",
  "pnpm report-generation:smoke",
  "pnpm live:exam-cycle:check",
  "pnpm queue:smoke",
  "pnpm live:onboarding:smoke",
  "pnpm live:ui-worker:smoke",
  "pnpm sms:smoke",
  "pnpm notification:smoke",
  "pnpm traefik:https:smoke",
];

const templateEvidencePhrases = [
  "system dashboard opened",
  "audit and observability screens checked",
  "tenant created",
  "first admin logged in",
  "expired tenant read request passed",
  "expired tenant write request returned 403",
  "prod evidence check passed",
  "rollback reference reviewed",
  "setup wizard completed",
  "academic structure visible",
  "student created",
  "guardian and teacher relation verified",
  "tenant user role updated",
  "identity invitation accepted",
  "schedule created",
  "attendance and study session flows verified",
  "exam created",
  "answer key and raw import smoke passed",
  "report generation smoke passed",
  "pdf and excel download verified",
  "payment plan created",
  "idempotency retry verified",
  "announcement and sms smoke passed",
  "support and material upload verified",
  "teacher scoped student list opened",
  "teacher scoped report opened",
  "teacher support flow verified",
  "teacher homework and announcement flow verified",
  "out-of-scope student read rejected",
  "out-of-scope write rejected",
  "student portal profile opened",
  "student homework attendance and report opened",
  "student announcement marked read",
  "student support ticket created",
  "other student access returned 403",
  "guardian linked student profile opened",
  "guardian finance and report permission verified",
  "guardian announcement read",
  "guardian support and notification preference verified",
  "unlinked student access returned 403",
  "finance permission denial verified",
];

if (!target) {
  fail(["UAT_EVIDENCE_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["UAT_EVIDENCE_TARGET file:// veya https:// URL olmalı."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`UAT kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`UAT raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["UAT_EVIDENCE_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["UAT_EVIDENCE_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["UAT_EVIDENCE_TARGET symlink olmayan file:// artifact olmali."]);
  }

  return readFile(filePath, "utf8");
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["UAT_EVIDENCE_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["UAT_EVIDENCE_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["UAT_EVIDENCE_TARGET production kaniti icin lokal temp path olmamali."]);
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
    fail(["UAT raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, uatTopLevelKeys, failures, "uat")) {
    return failures;
  }
  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireString(report, failures, "tester");
  requireNonPlaceholderString(report, failures, "tester");
  requireString(report, failures, "releaseCandidate");
  requireNonPlaceholderString(report, failures, "releaseCandidate");
  requireString(report, failures, "rollbackImageTag");
  requireNonPlaceholderString(report, failures, "rollbackImageTag");
  requireString(report, failures, "restoreBackupReference");
  requireNonPlaceholderString(report, failures, "restoreBackupReference");

  requireExactStringSet(report, failures, "flowsVerified", expectedFlowsVerified, "akış");
  requireExactStringSet(report, failures, "commandsPassed", expectedCommandsPassed, "komut");
  requireJourneyScenarios(report, failures);

  if (report.releaseCandidate && report.rollbackImageTag && report.releaseCandidate === report.rollbackImageTag) {
    failures.push("releaseCandidate ve rollbackImageTag farklı olmalı.");
  }

  if (Array.isArray(report.defects) && report.defects.length > 0) {
    failures.push("defects boş olmalı.");
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
    failures.push(`${key} production kanıtı için örnek/placeholder/redacted değer olmamalı.`);
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

function requireExactStringSet(report, failures, key, expectedValues, itemLabel) {
  const value = report[key];
  if (!Array.isArray(value)) {
    failures.push(`${key} alan listesi zorunlu.`);
    return;
  }

  if (value.length !== expectedValues.length) {
    failures.push(`${key} tam ${expectedValues.length} ${itemLabel} içermeli.`);
  }

  const seen = new Set();
  const expected = new Set(expectedValues);
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${key} boş olmayan metinlerden oluşmalı.`);
      continue;
    }
    if (seen.has(item)) {
      failures.push(`${key} tekrarlı ${itemLabel} içeriyor: ${item}`);
    }
    seen.add(item);
    if (!expected.has(item)) {
      failures.push(`${key} beklenmeyen ${itemLabel} içeriyor: ${item}`);
    }
  }

  for (const expectedValue of expectedValues) {
    if (!seen.has(expectedValue)) {
      failures.push(`${key} eksik: ${expectedValue}`);
    }
  }
}

function requireJourneyScenarios(report, failures) {
  const value = report.journeyScenariosVerified;
  if (!Array.isArray(value)) {
    failures.push("journeyScenariosVerified alan listesi zorunlu.");
    return;
  }

  if (value.length !== expectedJourneyScenarios.length) {
    failures.push(`journeyScenariosVerified tam ${expectedJourneyScenarios.length} senaryo içermeli.`);
  }

  const expectedIds = new Set(expectedJourneyScenarios.map(([id]) => id));
  const seenIds = new Set();
  for (const scenario of value) {
    if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
      failures.push("journeyScenariosVerified senaryo nesnelerinden oluşmalı.");
      continue;
    }
    const id = typeof scenario.id === "string" ? scenario.id : "unknown";
    requireObjectKeySet(scenario, uatJourneyScenarioKeys, failures, `journeyScenariosVerified.${id}`);
    if (seenIds.has(id)) {
      failures.push(`journeyScenariosVerified tekrarlı senaryo içeriyor: ${id}`);
    }
    seenIds.add(id);
    if (!expectedIds.has(id)) {
      failures.push(`journeyScenariosVerified beklenmeyen senaryo içeriyor: ${id}`);
    }
  }

  for (const [id, persona] of expectedJourneyScenarios) {
    const scenario = value.find((candidate) => candidate && typeof candidate === "object" && candidate.id === id);
    if (!scenario) {
      failures.push(`journeyScenariosVerified eksik: ${id}`);
      continue;
    }

    if (scenario.persona !== persona) {
      failures.push(`${id} persona ${persona} olmalı.`);
    }
    if (scenario.status !== "PASS") {
      failures.push(`${id} status PASS olmalı.`);
    }
    requireEvidenceList(scenario, failures, `${id}.evidence`);
  }
}

function requireEvidenceList(scenario, failures, label) {
  if (!Array.isArray(scenario.evidence) || scenario.evidence.length === 0) {
    failures.push(`${label} boş olmayan liste olmalı.`);
    return;
  }

  for (const item of scenario.evidence) {
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
    "previous-pass",
    "backup-bucket",
    "qa-owner",
    ...templateEvidencePhrases,
  ].some((token) => normalized.includes(token));
}

function fail(failures) {
  console.error("UAT kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
