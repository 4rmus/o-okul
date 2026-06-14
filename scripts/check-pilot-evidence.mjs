import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.env.PILOT_EVIDENCE_TARGET;
const allowExampleEvidence = process.env.PILOT_ALLOW_EXAMPLE_EVIDENCE === "1";
const pilotTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "pilotTenantReference",
  "pilotStartDate",
  "pilotEndDate",
  "dataProcessingAgreementSigned",
  "kvkkNoticeApproved",
  "phase0And5GatesPassed",
  "realDataImport",
  "examCycle",
  "performance",
  "operations",
  "assessmentCriteria",
  "criticalDefectsOpen",
  "goLiveDecision",
  "evidenceReferences",
  "gaps",
];
const realDataImportKeys = [
  "source",
  "dryRunRows",
  "committedRows",
  "rollbackTested",
  "identityMigrationApproved",
  "identityMigrationReference",
];
const examCycleKeys = [
  "examReference",
  "participantCount",
  "answerKeyImported",
  "opticalImportCommitted",
  "quarantineResolved",
  "reportGenerated",
  "karnePdfDownloaded",
  "excelDownloaded",
  "guardianPortalViewed",
  "idempotencyVerified",
  "evidenceReferences",
];
const performanceKeys = [
  "reportListingExpectedResultCount",
  "reportListingP95Ms",
  "studentProgressP95Ms",
  "rlsLoadRps",
  "reportGenerationResultCount",
  "reportGenerationDurationMs",
  "thresholdsPassed",
];
const operationsKeys = [
  "incidentDrillPerformed",
  "alertDelivered",
  "sentryEventReviewed",
  "supportTicketExercised",
  "restoreDrillRepeated",
  "restoreDrillReference",
  "incidentResponseMinutes",
];
const assessmentCriteriaKeys = ["id", "status", "evidence"];
const expectedAssessmentCriteriaIds = [
  "AC-01",
  "AC-02",
  "AC-03",
  "AC-04",
  "AC-05",
  "AC-06",
  "AC-07",
  "AC-08",
  "AC-09",
  "AC-10",
];

if (!target) {
  fail(["PILOT_EVIDENCE_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["PILOT_EVIDENCE_TARGET file:// veya https:// URL olmalı."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Pilot kanıt kontrolü geçti: ${report.environment} ${report.pilotTenantReference}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Pilot raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["PILOT_EVIDENCE_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["PILOT_EVIDENCE_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["PILOT_EVIDENCE_TARGET symlink olmayan file:// artifact olmali."]);
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
      fail(["PILOT_EVIDENCE_TARGET parent dizini okunabilir olmali."]);
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["PILOT_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmali."]);
    }
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["PILOT_EVIDENCE_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["PILOT_EVIDENCE_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["PILOT_EVIDENCE_TARGET production kaniti icin lokal temp path olmamali."]);
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
    fail(["Pilot raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, pilotTopLevelKeys, failures, "pilot")) {
    return failures;
  }
  requireEqual(report, failures, "result", "PASS");
  requireEqual(report, failures, "environment", "production");
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireString(report, failures, "pilotTenantReference");
  requireNonPlaceholderString(report, failures, "pilotTenantReference");
  requireDate(report, failures, "pilotStartDate");
  requireDate(report, failures, "pilotEndDate");
  requireDateNotInFuture(report, failures, "pilotEndDate");
  requireDateNotAfter(report, failures, "pilotEndDate", "checkedAt");
  requireTrue(report, failures, "dataProcessingAgreementSigned");
  requireTrue(report, failures, "kvkkNoticeApproved");
  requireTrue(report, failures, "phase0And5GatesPassed");
  requirePilotDuration(report, failures);
  requireRealDataImport(report, failures);
  requireExamCycle(report, failures);
  requirePerformance(report, failures);
  requireOperations(report, failures);
  requireAssessmentCriteria(report, failures);
  requireNumberAtMost(report, failures, "criticalDefectsOpen", 0);
  requireEqual(report, failures, "goLiveDecision", "APPROVED");
  requireEvidenceReferences(report, failures, "evidenceReferences");
  requireEmptyArray(report, failures, "gaps");

  return failures;
}

function requirePilotDuration(report, failures) {
  const start = Date.parse(report.pilotStartDate);
  const end = Date.parse(report.pilotEndDate);
  if (Number.isNaN(start) || Number.isNaN(end)) return;
  if (end < start) {
    failures.push("pilot bitiş tarihi başlangıçtan önce olamaz.");
    return;
  }
  const durationDays = (end - start) / (24 * 60 * 60 * 1000);
  if (durationDays < 14) {
    failures.push("pilot süresi en az 14 gün olmalı.");
  }
}

function requireRealDataImport(report, failures) {
  const value = requireObject(report, failures, "realDataImport");
  if (!value) return;
  requireObjectKeySet(value, realDataImportKeys, failures, "realDataImport");
  requireObjectString(value, failures, "realDataImport.source", "source");
  requireObjectIntegerAtLeast(value, failures, "realDataImport.dryRunRows", "dryRunRows", 1);
  requireObjectIntegerAtLeast(value, failures, "realDataImport.committedRows", "committedRows", 1);
  requireObjectTrue(value, failures, "realDataImport.rollbackTested", "rollbackTested");
  requireObjectTrue(value, failures, "realDataImport.identityMigrationApproved", "identityMigrationApproved");
  requireObjectString(value, failures, "realDataImport.identityMigrationReference", "identityMigrationReference");
  requireObjectNonPlaceholderString(value, failures, "realDataImport.identityMigrationReference", "identityMigrationReference");
}

function requireExamCycle(report, failures) {
  const value = requireObject(report, failures, "examCycle");
  if (!value) return;
  requireObjectKeySet(value, examCycleKeys, failures, "examCycle");
  requireObjectString(value, failures, "examCycle.examReference", "examReference");
  requireObjectNonPlaceholderString(value, failures, "examCycle.examReference", "examReference");
  requireObjectIntegerAtLeast(value, failures, "examCycle.participantCount", "participantCount", 1);
  for (const key of [
    "answerKeyImported",
    "opticalImportCommitted",
    "quarantineResolved",
    "reportGenerated",
    "karnePdfDownloaded",
    "excelDownloaded",
    "guardianPortalViewed",
    "idempotencyVerified",
  ]) {
    requireObjectTrue(value, failures, `examCycle.${key}`, key);
  }
  requireEvidenceReferences(value, failures, "examCycle.evidenceReferences");
}

function requirePerformance(report, failures) {
  const value = requireObject(report, failures, "performance");
  if (!value) return;
  requireObjectKeySet(value, performanceKeys, failures, "performance");
  requireObjectIntegerAtLeast(value, failures, "performance.reportListingExpectedResultCount", "reportListingExpectedResultCount", 10000);
  requireObjectNumberAtMost(value, failures, "performance.reportListingP95Ms", "reportListingP95Ms", 1500);
  requireObjectNumberAtMost(value, failures, "performance.studentProgressP95Ms", "studentProgressP95Ms", 1200);
  requireObjectNumberAtLeast(value, failures, "performance.rlsLoadRps", "rlsLoadRps", 200);
  requireObjectIntegerAtLeast(value, failures, "performance.reportGenerationResultCount", "reportGenerationResultCount", 10000);
  requireObjectNumberAtMost(value, failures, "performance.reportGenerationDurationMs", "reportGenerationDurationMs", 60000);
  requireObjectTrue(value, failures, "performance.thresholdsPassed", "thresholdsPassed");
}

function requireOperations(report, failures) {
  const value = requireObject(report, failures, "operations");
  if (!value) return;
  requireObjectKeySet(value, operationsKeys, failures, "operations");
  for (const key of [
    "incidentDrillPerformed",
    "alertDelivered",
    "sentryEventReviewed",
    "supportTicketExercised",
    "restoreDrillRepeated",
  ]) {
    requireObjectTrue(value, failures, `operations.${key}`, key);
  }
  requireObjectString(value, failures, "operations.restoreDrillReference", "restoreDrillReference");
  requireObjectNonPlaceholderString(value, failures, "operations.restoreDrillReference", "restoreDrillReference");
  requireObjectNumberAtMost(value, failures, "operations.incidentResponseMinutes", "incidentResponseMinutes", 30);
}

function requireAssessmentCriteria(report, failures) {
  const value = report.assessmentCriteria;
  if (!Array.isArray(value)) {
    failures.push("assessmentCriteria alan listesi zorunlu.");
    return;
  }
  if (value.length !== 10) {
    failures.push("assessmentCriteria tam 10 madde içermeli.");
  }

  const expectedIds = new Set(expectedAssessmentCriteriaIds);
  const seenIds = new Set();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      failures.push("assessmentCriteria nesnelerden oluşmalı.");
      return;
    }
    const id = typeof item.id === "string" ? item.id : "unknown";
    requireObjectKeySet(item, assessmentCriteriaKeys, failures, `assessmentCriteria.${id}`);
    requireObjectString(item, failures, "assessmentCriteria.id", "id");
    if (seenIds.has(id)) {
      failures.push(`assessmentCriteria tekrarlı madde içeriyor: ${id}`);
    }
    seenIds.add(id);
    if (!expectedIds.has(id)) {
      failures.push(`assessmentCriteria beklenmeyen madde içeriyor: ${id}`);
    }
    if (item.status !== "PASS") {
      failures.push(`${item.id ?? "assessmentCriteria"}.status PASS olmalı.`);
    }
    requireObjectString(item, failures, `${item.id ?? "assessmentCriteria"}.evidence`, "evidence");
    requireObjectNonPlaceholderString(item, failures, `${item.id ?? "assessmentCriteria"}.evidence`, "evidence");
  }

  for (const expectedId of expectedAssessmentCriteriaIds) {
    if (!seenIds.has(expectedId)) {
      failures.push(`assessmentCriteria eksik: ${expectedId}`);
    }
  }
}

function requireEqual(report, failures, key, expected) {
  if (report[key] !== expected) {
    failures.push(`${key} ${expected} olmalı.`);
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
    failures.push(`${firstKey} ${secondKey} tarihinden sonra olamaz.`);
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

function requireTrue(report, failures, key) {
  if (report[key] !== true) {
    failures.push(`${key} true olmalı.`);
  }
}

function requireNumberAtMost(report, failures, key, maxValue) {
  const value = report[key];
  if (typeof value !== "number" || value > maxValue) {
    failures.push(`${key} ${maxValue} veya daha küçük sayı olmalı.`);
  }
}

function requireObject(report, failures, key) {
  const value = report[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${key} nesnesi zorunlu.`);
    return undefined;
  }
  return value;
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

function requireObjectString(report, failures, label, key) {
  if (typeof report[key] !== "string" || report[key].trim() === "") {
    failures.push(`${label} boş olmayan metin olmalı.`);
  }
}

function requireObjectNonPlaceholderString(report, failures, label, key) {
  if (allowExampleEvidence) return;

  const value = report[key];
  if (typeof value !== "string" || value.trim() === "") {
    return;
  }

  if (hasPlaceholderToken(value)) {
    failures.push(`${label} production kanıtı için örnek/placeholder/redacted değer olmamalı.`);
  }
}

function requireObjectTrue(report, failures, label, key) {
  if (report[key] !== true) {
    failures.push(`${label} true olmalı.`);
  }
}

function requireObjectIntegerAtLeast(report, failures, label, key, minValue) {
  const value = report[key];
  if (!Number.isInteger(value) || value < minValue) {
    failures.push(`${label} en az ${minValue} tam sayı olmalı.`);
  }
}

function requireObjectNumberAtLeast(report, failures, label, key, minValue) {
  const value = report[key];
  if (typeof value !== "number" || value < minValue) {
    failures.push(`${label} en az ${minValue} sayı olmalı.`);
  }
}

function requireObjectNumberAtMost(report, failures, label, key, maxValue) {
  const value = report[key];
  if (typeof value !== "number" || value > maxValue) {
    failures.push(`${label} en fazla ${maxValue} sayı olmalı.`);
  }
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
  console.error("Pilot kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
