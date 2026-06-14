import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.env.INLINE_UPLOAD_CONTENT_MIGRATION_TARGET;
const allowExampleEvidence = process.env.INLINE_UPLOAD_CONTENT_MIGRATION_ALLOW_EXAMPLE_EVIDENCE === "1";

const requiredSubjects = ["homework_material_files", "support_ticket_attachments"];
const requiredCommands = [
  "pnpm inline-upload-content:audit",
  "INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true pnpm inline-upload-content:migrate",
];
const inlineUploadMigrationTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "storageMode",
  "dryRun",
  "migration",
  "commandsPassed",
  "evidenceReferences",
  "gaps",
];
const storageModeKeys = [
  "supportAttachmentStorage",
  "homeworkMaterialFileStorage",
  "downloadMode",
  "downloadUrlExpiresInSeconds",
  "contentBase64WriteDisabled",
  "inlineReadCompatibility",
];
const dryRunKeys = ["status", "generatedAt", "approvalRequired", "subjects"];
const migrationKeys = ["status", "generatedAt", "approvedBy", "approvalReference", "approvalEnv", "subjects", "migrated"];
const subjectSnapshotKeys = [
  "subject",
  "totalRows",
  "pendingRows",
  "pendingActiveRows",
  "pendingDeletedRows",
  "pendingBase64Characters",
  "tableSizeBytes",
];
const migratedItemKeys = ["subject", "migratedRows", "migratedBytes"];

if (!target) {
  fail(["INLINE_UPLOAD_CONTENT_MIGRATION_TARGET bos birakilamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["INLINE_UPLOAD_CONTENT_MIGRATION_TARGET file:// veya https:// URL olmali."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Inline upload migration kanit kontrolu gecti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Inline upload migration raporu okunamadi: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["INLINE_UPLOAD_CONTENT_MIGRATION_TARGET yalniz file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["INLINE_UPLOAD_CONTENT_MIGRATION_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["INLINE_UPLOAD_CONTENT_MIGRATION_TARGET symlink olmayan file:// artifact olmali."]);
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
      fail(["INLINE_UPLOAD_CONTENT_MIGRATION_TARGET parent dizini okunabilir olmali."]);
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["INLINE_UPLOAD_CONTENT_MIGRATION_TARGET parent dizini symlink olmayan dizin olmali."]);
    }
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["INLINE_UPLOAD_CONTENT_MIGRATION_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["INLINE_UPLOAD_CONTENT_MIGRATION_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["INLINE_UPLOAD_CONTENT_MIGRATION_TARGET production kaniti icin lokal temp path olmamali."]);
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
    fail(["Inline upload migration raporu gecerli JSON olmali."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, inlineUploadMigrationTopLevelKeys, failures, "inlineUploadMigration")) {
    return failures;
  }

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireStorageMode(report.storageMode, failures);
  requireDryRun(report.dryRun, report, failures);
  requireMigration(report.migration, report, failures);
  requireCommands(report, failures);
  requireEvidenceReferences(report, failures);
  requireEmptyArray(report, failures, "gaps");

  return failures;
}

function requireStorageMode(storageMode, failures) {
  if (!storageMode || typeof storageMode !== "object" || Array.isArray(storageMode)) {
    failures.push("storageMode nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(storageMode, storageModeKeys, failures, "storageMode");
  requireObjectEqual(storageMode, failures, "storageMode.supportAttachmentStorage", "supportAttachmentStorage", "s3");
  requireObjectEqual(storageMode, failures, "storageMode.homeworkMaterialFileStorage", "homeworkMaterialFileStorage", "s3");
  requireObjectEqual(storageMode, failures, "storageMode.downloadMode", "downloadMode", "signed-url");
  requireObjectTrue(storageMode, failures, "storageMode.contentBase64WriteDisabled", "contentBase64WriteDisabled");
  requireObjectTrue(storageMode, failures, "storageMode.inlineReadCompatibility", "inlineReadCompatibility");
  if (!Number.isInteger(storageMode.downloadUrlExpiresInSeconds) || storageMode.downloadUrlExpiresInSeconds < 1) {
    failures.push("storageMode.downloadUrlExpiresInSeconds pozitif tam sayi olmali.");
  } else if (storageMode.downloadUrlExpiresInSeconds > 300) {
    failures.push("storageMode.downloadUrlExpiresInSeconds en fazla 300 olmali.");
  }
}

function requireDryRun(dryRun, report, failures) {
  if (!dryRun || typeof dryRun !== "object" || Array.isArray(dryRun)) {
    failures.push("dryRun nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(dryRun, dryRunKeys, failures, "dryRun");
  requireObjectEqual(dryRun, failures, "dryRun.status", "status", "DRY_RUN");
  requireObjectDate(dryRun, failures, "dryRun.generatedAt", "generatedAt");
  requireDateNotAfter(dryRun, failures, "dryRun.generatedAt", "generatedAt", report, "checkedAt", "checkedAt");
  requireObjectEqual(
    dryRun,
    failures,
    "dryRun.approvalRequired",
    "approvalRequired",
    "INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true",
  );
  requireSubjectSnapshotList(dryRun.subjects, failures, "dryRun.subjects", { requirePendingZero: false });
}

function requireMigration(migration, report, failures) {
  if (!migration || typeof migration !== "object" || Array.isArray(migration)) {
    failures.push("migration nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(migration, migrationKeys, failures, "migration");
  requireObjectEqual(migration, failures, "migration.status", "status", "MIGRATED");
  requireObjectDate(migration, failures, "migration.generatedAt", "generatedAt");
  requireDateNotAfter(migration, failures, "migration.generatedAt", "generatedAt", report, "checkedAt", "checkedAt");
  requireObjectString(migration, failures, "migration.approvedBy", "approvedBy");
  requireNonPlaceholderString(migration, failures, "migration.approvedBy", "approvedBy");
  requireObjectString(migration, failures, "migration.approvalReference", "approvalReference");
  requireNonPlaceholderString(migration, failures, "migration.approvalReference", "approvalReference");
  requireObjectEqual(
    migration,
    failures,
    "migration.approvalEnv",
    "approvalEnv",
    "INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true",
  );
  requireSubjectSnapshotList(migration.subjects, failures, "migration.subjects", { requirePendingZero: true });
  requireMigratedList(migration.migrated, failures);

  const dryRunPending = subjectPendingRows(report.dryRun?.subjects);
  const migratedRows = subjectMigratedRows(migration.migrated);
  for (const subject of requiredSubjects) {
    if ((migratedRows.get(subject) ?? 0) < (dryRunPending.get(subject) ?? 0)) {
      failures.push(`migration.migrated ${subject} dry-run pendingRows degerinden az olamaz.`);
    }
  }
}

function requireSubjectSnapshotList(value, failures, label, options) {
  if (!Array.isArray(value)) {
    failures.push(`${label} listesi zorunlu.`);
    return;
  }

  if (value.length !== requiredSubjects.length) {
    failures.push(`${label} tam ${requiredSubjects.length} subject icermeli.`);
    return;
  }

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      failures.push(`${label} item nesnesi zorunlu.`);
      continue;
    }
    const subjectLabel = requiredSubjects.includes(item.subject) ? item.subject : "unknown";
    requireObjectKeySet(item, subjectSnapshotKeys, failures, `${label}.${subjectLabel}`);
  }

  for (const subject of requiredSubjects) {
    const item = value.find((candidate) => candidate?.subject === subject);
    if (!item) {
      failures.push(`${label} eksik: ${subject}`);
      continue;
    }
    for (const key of [
      "totalRows",
      "pendingRows",
      "pendingActiveRows",
      "pendingDeletedRows",
      "pendingBase64Characters",
      "tableSizeBytes",
    ]) {
      requireObjectIntegerAtLeast(item, failures, `${label}.${subject}.${key}`, key, 0);
    }
    if (options.requirePendingZero) {
      for (const key of ["pendingRows", "pendingActiveRows", "pendingDeletedRows", "pendingBase64Characters"]) {
        requireObjectEqual(item, failures, `${label}.${subject}.${key}`, key, 0);
      }
    }
  }
}

function requireMigratedList(value, failures) {
  if (!Array.isArray(value)) {
    failures.push("migration.migrated listesi zorunlu.");
    return;
  }

  if (value.length !== requiredSubjects.length) {
    failures.push(`migration.migrated tam ${requiredSubjects.length} subject icermeli.`);
    return;
  }

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      failures.push("migration.migrated item nesnesi zorunlu.");
      continue;
    }
    const subjectLabel = requiredSubjects.includes(item.subject) ? item.subject : "unknown";
    requireObjectKeySet(item, migratedItemKeys, failures, `migration.migrated.${subjectLabel}`);
  }

  for (const subject of requiredSubjects) {
    const item = value.find((candidate) => candidate?.subject === subject);
    if (!item) {
      failures.push(`migration.migrated eksik: ${subject}`);
      continue;
    }
    requireObjectIntegerAtLeast(item, failures, `migration.migrated.${subject}.migratedRows`, "migratedRows", 0);
    requireObjectIntegerAtLeast(item, failures, `migration.migrated.${subject}.migratedBytes`, "migratedBytes", 0);
  }
}

function requireCommands(report, failures) {
  requireExactStringSet(report.commandsPassed, failures, "commandsPassed", requiredCommands, "komut");
}

function requireEvidenceReferences(report, failures) {
  if (!Array.isArray(report.evidenceReferences) || report.evidenceReferences.length < 2) {
    failures.push("evidenceReferences en az 2 kanit referansi icermeli.");
    return;
  }

  if (allowExampleEvidence) return;
  for (const [index, value] of report.evidenceReferences.entries()) {
    if (typeof value !== "string" || value.trim() === "") {
      failures.push(`evidenceReferences.${index} bos olmayan metin olmali.`);
      continue;
    }
    if (hasPlaceholderToken(value)) {
      failures.push(`evidenceReferences.${index} production kaniti icin placeholder/redacted deger olmamali.`);
    }
  }
}

function subjectPendingRows(subjects) {
  const values = new Map();
  if (!Array.isArray(subjects)) return values;
  for (const subject of subjects) {
    if (requiredSubjects.includes(subject?.subject) && Number.isInteger(subject.pendingRows)) {
      values.set(subject.subject, subject.pendingRows);
    }
  }
  return values;
}

function subjectMigratedRows(subjects) {
  const values = new Map();
  if (!Array.isArray(subjects)) return values;
  for (const subject of subjects) {
    if (requiredSubjects.includes(subject?.subject) && Number.isInteger(subject.migratedRows)) {
      values.set(subject.subject, subject.migratedRows);
    }
  }
  return values;
}

function requireEqual(report, failures, key, expected) {
  if (report[key] !== expected) {
    failures.push(`${key} ${expected} olmali.`);
  }
}

function requireObjectEqual(scope, failures, label, key, expected) {
  if (scope?.[key] !== expected) {
    failures.push(`${label} ${expected} olmali.`);
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

function requireObjectDate(scope, failures, label, key) {
  const value = scope[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${label} gecerli tarih olmali.`);
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

function requireDateNotAfter(scope, failures, label, key, otherScope, otherLabel, otherKey) {
  const value = Date.parse(scope?.[key]);
  const otherValue = Date.parse(otherScope?.[otherKey]);
  if (Number.isNaN(value) || Number.isNaN(otherValue)) return;

  if (value > otherValue) {
    failures.push(`${label} ${otherLabel} tarihinden sonra olamaz.`);
  }
}

function requireObjectString(scope, failures, label, key) {
  if (typeof scope[key] !== "string" || scope[key].trim() === "") {
    failures.push(`${label} bos olmayan metin olmali.`);
  }
}

function requireObjectTrue(scope, failures, label, key) {
  if (scope?.[key] !== true) {
    failures.push(`${label} true olmali.`);
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

function requireNonPlaceholderString(scope, failures, label, key) {
  if (allowExampleEvidence) return;

  const value = scope[key];
  if (typeof value !== "string" || value.trim() === "") return;

  if (hasPlaceholderToken(value)) {
    failures.push(`${label} production kaniti icin placeholder/redacted deger olmamali.`);
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
  console.error("Inline upload migration kanit kontrolu basarisiz:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
