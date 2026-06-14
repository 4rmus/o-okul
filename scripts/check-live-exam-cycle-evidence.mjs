import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.LIVE_EXAM_CYCLE_TARGET;
const allowExampleEvidence = process.env.LIVE_EXAM_CYCLE_ALLOW_EXAMPLE_EVIDENCE === "1";
const requiredCommands = [
  "pnpm isem-answer-key:smoke",
  "pnpm isem-optical-pipeline:smoke",
  "pnpm raw-import:smoke",
  "pnpm report-generation:smoke",
  "pnpm live:ui-worker:smoke",
];
const liveExamCycleTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "tester",
  "releaseCandidate",
  "appUrl",
  "apiUrl",
  "commandsPassed",
  "examCycle",
  "evidenceReferences",
  "gaps",
];
const examCycleKeys = [
  "examId",
  "answerKeyId",
  "answerKeyVersion",
  "parserConfigVersion",
  "rawImportId",
  "reportSnapshotId",
  "firstStudentId",
  "answerKeyQuestionCount",
  "bookletVariantCount",
  "participantCount",
  "matchedCount",
  "examResultCount",
  "reportResultCount",
  "downloadedArtifacts",
  "answerKeyImported",
  "opticalImportCommitted",
  "rawImportArchived",
  "evaluationQueued",
  "quarantinePathVerified",
  "reportGenerated",
  "reportReady",
  "karnePdfDownloaded",
  "excelDownloaded",
  "studentPortalViewed",
  "guardianPortalViewed",
  "noMockRoutes",
];

if (!target) {
  fail(["LIVE_EXAM_CYCLE_TARGET bos birakilamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["LIVE_EXAM_CYCLE_TARGET file:// veya https:// URL olmali."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Live exam cycle kanit kontrolu gecti: ${report.environment} ${report.examCycle?.examId}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Live exam cycle raporu okunamadi: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["LIVE_EXAM_CYCLE_TARGET yalniz file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["LIVE_EXAM_CYCLE_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["LIVE_EXAM_CYCLE_TARGET symlink olmayan file:// artifact olmali."]);
  }

  return readFile(filePath, "utf8");
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["LIVE_EXAM_CYCLE_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["LIVE_EXAM_CYCLE_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["LIVE_EXAM_CYCLE_TARGET production kaniti icin lokal temp path olmamali."]);
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
    fail(["Live exam cycle raporu gecerli JSON olmali."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, liveExamCycleTopLevelKeys, failures, "liveExamCycle")) {
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
  requireHttpsUrl(report, failures, "appUrl");
  requireHttpsUrl(report, failures, "apiUrl");
  requireExactStringSet(report.commandsPassed, failures, "commandsPassed", requiredCommands, "komut");

  requireExamCycle(report, failures);
  requireEvidenceReferences(report, failures, "evidenceReferences");
  requireEmptyArray(report, failures, "gaps");

  return failures;
}

function requireExamCycle(report, failures) {
  const value = requireObject(report, failures, "examCycle");
  if (!value) return;

  requireObjectKeySet(value, examCycleKeys, failures, "examCycle");

  for (const key of [
    "examId",
    "answerKeyId",
    "answerKeyVersion",
    "parserConfigVersion",
    "rawImportId",
    "reportSnapshotId",
    "firstStudentId",
  ]) {
    requireObjectString(value, failures, `examCycle.${key}`, key);
    requireObjectNonPlaceholderString(value, failures, `examCycle.${key}`, key);
  }

  requireObjectIntegerAtLeast(value, failures, "examCycle.answerKeyQuestionCount", "answerKeyQuestionCount", 90);
  requireObjectIntegerAtLeast(value, failures, "examCycle.bookletVariantCount", "bookletVariantCount", 1);
  requireObjectIntegerAtLeast(value, failures, "examCycle.participantCount", "participantCount", 1);
  requireObjectIntegerAtLeast(value, failures, "examCycle.matchedCount", "matchedCount", 1);
  requireObjectIntegerAtLeast(value, failures, "examCycle.examResultCount", "examResultCount", 1);
  requireObjectIntegerAtLeast(value, failures, "examCycle.reportResultCount", "reportResultCount", 1);
  requireObjectIntegerAtLeast(value, failures, "examCycle.downloadedArtifacts", "downloadedArtifacts", 2);

  if (Number.isInteger(value.matchedCount) && Number.isInteger(value.participantCount) && value.matchedCount > value.participantCount) {
    failures.push("examCycle.matchedCount participantCount degerinden buyuk olamaz.");
  }
  if (Number.isInteger(value.examResultCount) && Number.isInteger(value.matchedCount) && value.examResultCount < value.matchedCount) {
    failures.push("examCycle.examResultCount matchedCount degerinden kucuk olamaz.");
  }
  if (Number.isInteger(value.reportResultCount) && Number.isInteger(value.examResultCount) && value.reportResultCount > value.examResultCount) {
    failures.push("examCycle.reportResultCount examResultCount degerinden buyuk olamaz.");
  }

  for (const key of [
    "answerKeyImported",
    "opticalImportCommitted",
    "rawImportArchived",
    "evaluationQueued",
    "quarantinePathVerified",
    "reportGenerated",
    "reportReady",
    "karnePdfDownloaded",
    "excelDownloaded",
    "studentPortalViewed",
    "guardianPortalViewed",
    "noMockRoutes",
  ]) {
    requireObjectTrue(value, failures, `examCycle.${key}`, key);
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
    failures.push(`${key} bos olmayan metin olmali.`);
  }
}

function requireObjectString(report, failures, label, key) {
  if (typeof report[key] !== "string" || report[key].trim() === "") {
    failures.push(`${label} bos olmayan metin olmali.`);
  }
}

function requireHttpsUrl(report, failures, key) {
  requireString(report, failures, key);
  const value = report[key];
  if (typeof value !== "string" || value.trim() === "") return;
  if (allowExampleEvidence && value.includes("__SET_")) return;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      failures.push(`${key} https URL olmali.`);
    }
  } catch {
    failures.push(`${key} gecerli URL olmali.`);
  }
}

function requireNonPlaceholderString(report, failures, key) {
  if (allowExampleEvidence) return;

  const value = report[key];
  if (typeof value !== "string" || value.trim() === "") {
    return;
  }

  if (hasPlaceholderToken(value)) {
    failures.push(`${key} gercek kanit icin ornek/placeholder/redacted deger olmamali.`);
  }
}

function requireObjectNonPlaceholderString(report, failures, label, key) {
  if (allowExampleEvidence) return;

  const value = report[key];
  if (typeof value !== "string" || value.trim() === "") {
    return;
  }

  if (hasPlaceholderToken(value)) {
    failures.push(`${label} gercek kanit icin ornek/placeholder/redacted deger olmamali.`);
  }
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
    "redacted",
  ].some((token) => normalized.includes(token));
}

function requireExactStringSet(value, failures, label, expectedValues, itemLabel) {
  if (!Array.isArray(value)) {
    failures.push(`${label} alan listesi zorunlu.`);
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

function requireObject(report, failures, key) {
  const value = report[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${key} nesnesi zorunlu.`);
    return undefined;
  }
  return value;
}

function requireObjectIntegerAtLeast(report, failures, label, key, minimum) {
  const value = report[key];
  if (!Number.isInteger(value) || value < minimum) {
    failures.push(`${label} en az ${minimum} olmali.`);
  }
}

function requireObjectTrue(report, failures, label, key) {
  if (report[key] !== true) {
    failures.push(`${label} true olmali.`);
  }
}

function requireEvidenceReferences(report, failures, key) {
  const value = report[key];
  if (!Array.isArray(value) || value.length < 2) {
    failures.push(`${key} en az 2 kanit referansi icermeli.`);
    return;
  }

  for (const [index, reference] of value.entries()) {
    if (typeof reference !== "string" || reference.trim() === "") {
      failures.push(`${key}[${index}] bos olmayan metin olmali.`);
      continue;
    }
    if (!allowExampleEvidence && hasPlaceholderToken(reference)) {
      failures.push(`${key}[${index}] gercek kanit icin ornek/placeholder/redacted deger olmamali.`);
    }
  }
}

function fail(failures) {
  console.error("Live exam cycle kanit kontrolu basarisiz:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
