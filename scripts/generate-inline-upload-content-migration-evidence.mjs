import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const requiredSubjects = ["homework_material_files", "support_ticket_attachments"];
const outputPath = readOption("--output") ?? process.env.INLINE_UPLOAD_CONTENT_MIGRATION_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";
const dryRunTarget = process.env.INLINE_UPLOAD_CONTENT_DRY_RUN_TARGET?.trim();
const migrationTarget = process.env.INLINE_UPLOAD_CONTENT_APPROVED_MIGRATION_TARGET?.trim();
const orphanAuditTarget = process.env.INLINE_UPLOAD_CONTENT_ORPHAN_AUDIT_TARGET?.trim();
const approvedBy = process.env.INLINE_UPLOAD_CONTENT_APPROVED_BY?.trim();
const approvalReference = process.env.INLINE_UPLOAD_CONTENT_APPROVAL_REFERENCE?.trim();
const downloadUrlExpiresInSeconds = Number(process.env.INLINE_UPLOAD_CONTENT_DOWNLOAD_URL_EXPIRES_IN_SECONDS);

const failures = [];
requireValue(outputPath, "INLINE_UPLOAD_CONTENT_MIGRATION_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireValue(dryRunTarget, "INLINE_UPLOAD_CONTENT_DRY_RUN_TARGET", failures);
requireValue(migrationTarget, "INLINE_UPLOAD_CONTENT_APPROVED_MIGRATION_TARGET", failures);
requireValue(orphanAuditTarget, "INLINE_UPLOAD_CONTENT_ORPHAN_AUDIT_TARGET", failures);
requireEvidenceValue(approvedBy, "INLINE_UPLOAD_CONTENT_APPROVED_BY", failures);
requireEvidenceValue(approvalReference, "INLINE_UPLOAD_CONTENT_APPROVAL_REFERENCE", failures);
requireEqual(process.env.SUPPORT_ATTACHMENT_STORAGE, "SUPPORT_ATTACHMENT_STORAGE", "s3", failures);
requireEqual(process.env.HOMEWORK_MATERIAL_FILE_STORAGE, "HOMEWORK_MATERIAL_FILE_STORAGE", "s3", failures);
requireEqual(process.env.INLINE_UPLOAD_CONTENT_DOWNLOAD_MODE, "INLINE_UPLOAD_CONTENT_DOWNLOAD_MODE", "signed-url", failures);
requireTrue(
  process.env.INLINE_UPLOAD_CONTENT_CONTENT_BASE64_WRITE_DISABLED,
  "INLINE_UPLOAD_CONTENT_CONTENT_BASE64_WRITE_DISABLED",
  failures,
);
requireTrue(
  process.env.INLINE_UPLOAD_CONTENT_INLINE_READ_COMPATIBILITY,
  "INLINE_UPLOAD_CONTENT_INLINE_READ_COMPATIBILITY",
  failures,
);
if (!Number.isInteger(downloadUrlExpiresInSeconds) || downloadUrlExpiresInSeconds < 1) {
  failures.push("INLINE_UPLOAD_CONTENT_DOWNLOAD_URL_EXPIRES_IN_SECONDS pozitif tam sayı olmalı.");
} else if (downloadUrlExpiresInSeconds > 300) {
  failures.push("INLINE_UPLOAD_CONTENT_DOWNLOAD_URL_EXPIRES_IN_SECONDS en fazla 300 olmalı.");
}
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

const dryRun = readJsonEvidenceTarget(dryRunTarget, "INLINE_UPLOAD_CONTENT_DRY_RUN_TARGET");
const migration = readJsonEvidenceTarget(migrationTarget, "INLINE_UPLOAD_CONTENT_APPROVED_MIGRATION_TARGET");
const orphanAudit = readJsonEvidenceTarget(orphanAuditTarget, "INLINE_UPLOAD_CONTENT_ORPHAN_AUDIT_TARGET");
validateDryRun(dryRun);
validateMigration(migration, dryRun);
validateOrphanAudit(orphanAudit);

const report = {
  result: "PASS",
  environment,
  checkedAt: new Date().toISOString(),
  storageMode: {
    supportAttachmentStorage: "s3",
    homeworkMaterialFileStorage: "s3",
    downloadMode: "signed-url",
    downloadUrlExpiresInSeconds,
    contentBase64WriteDisabled: true,
    inlineReadCompatibility: true,
  },
  dryRun,
  migration: {
    ...migration,
    approvedBy,
    approvalReference,
    approvalEnv: "INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true",
  },
  orphanAudit,
  commandsPassed: [
    "pnpm inline-upload-content:audit",
    "INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true pnpm inline-upload-content:migrate",
    "pnpm inline-upload-content:orphan-audit",
  ],
  evidenceReferences: [dryRunTarget, migrationTarget, orphanAuditTarget],
  gaps: [],
};

mkdirSync(dirname(outputFile), { recursive: true });
validateOutputTarget(outputFile);
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
validateOutputTarget(outputFile);
runCheck(outputFile);
console.log(`Inline upload migration kanıtı yazıldı: ${outputFile}`);

function readJsonEvidenceTarget(target, label) {
  let url;
  try {
    url = new URL(target);
  } catch {
    fail([`${label} file:// veya https:// URL olmalı.`]);
  }

  requireAllowedEvidenceTargetUrl(url, label);

  if (url.protocol === "file:") {
    const filePath = fileURLToPath(url);
    const stat = readFileStat(filePath, label);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail([`${label} symlink olmayan file artifact olmalı.`]);
    }
    assertParentPathAllowed(dirname(filePath), label);
    return parseJson(readFileSync(filePath, "utf8"), label);
  }

  fail([`${label} generator için file:// artifact olmalı; https:// target final checker tarafından desteklenir.`]);
}

function requireAllowedEvidenceTargetUrl(url, label) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail([`${label} file:// veya https:// URL olmalı.`]);
  }
  if (url.username || url.password || url.search || url.hash) {
    fail([`${label} userinfo, query veya fragment taşımamalı.`]);
  }
  if (url.protocol === "file:" && isLocalTempPath(fileURLToPath(url))) {
    fail([`${label} lokal temp path olmamalı.`]);
  }
}

function validateDryRun(value) {
  const output = [];
  requireObject(value, "dryRun", output);
  requireEqual(value.status, "dryRun.status", "DRY_RUN", output);
  requireEqual(value.approvalRequired, "dryRun.approvalRequired", "INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true", output);
  requireDate(value.generatedAt, "dryRun.generatedAt", output);
  requireSubjectSnapshots(value.subjects, "dryRun.subjects", { requirePendingZero: false }, output);
  if (output.length > 0) fail(output);
}

function validateMigration(value, dryRun) {
  const output = [];
  requireObject(value, "migration", output);
  requireEqual(value.status, "migration.status", "MIGRATED", output);
  requireDate(value.generatedAt, "migration.generatedAt", output);
  requireSubjectSnapshots(value.subjects, "migration.subjects", { requirePendingZero: true }, output);
  requireMigrated(value.migrated, output);
  requireDateOrder(dryRun.generatedAt, value.generatedAt, "dryRun.generatedAt", "migration.generatedAt", output);

  const pendingRows = subjectNumberMap(dryRun.subjects, "pendingRows");
  const migratedRows = subjectNumberMap(value.migrated, "migratedRows");
  for (const subject of requiredSubjects) {
    if ((migratedRows.get(subject) ?? 0) < (pendingRows.get(subject) ?? 0)) {
      output.push(`migration.migrated.${subject}.migratedRows dry-run pendingRows değerinden az olamaz.`);
    }
  }

  if (output.length > 0) fail(output);
}

function validateOrphanAudit(value) {
  const output = [];
  requireObject(value, "orphanAudit", output);
  requireEqual(value.result, "orphanAudit.result", "PASS", output);
  requireEqual(value.status, "orphanAudit.status", "NO_ORPHANS", output);
  requireOneOf(value.environment, "orphanAudit.environment", ["staging", "production"], output);
  requireDate(value.checkedAt, "orphanAudit.checkedAt", output);
  requireEqual(value.bucketVerified, "orphanAudit.bucketVerified", true, output);
  requireEqualArray(value.commandsPassed, "orphanAudit.commandsPassed", ["pnpm inline-upload-content:orphan-audit"], output);
  requireEqualArray(value.gaps, "orphanAudit.gaps", [], output);
  requireOrphanSubjects(value.subjects, output);
  if (output.length > 0) fail(output);
}

function requireOrphanSubjects(value, output) {
  if (!Array.isArray(value) || value.length !== requiredSubjects.length) {
    output.push(`orphanAudit.subjects tam ${requiredSubjects.length} subject içermeli.`);
    return;
  }

  for (const subject of requiredSubjects) {
    const item = value.find((candidate) => candidate?.subject === subject);
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      output.push(`orphanAudit.subjects.${subject} nesnesi zorunlu.`);
      continue;
    }
    for (const key of ["listedObjects", "dbReferencedObjects", "referencedObjectsPresent"]) {
      requireIntegerAtLeast(item[key], `orphanAudit.subjects.${subject}.${key}`, 0, output);
    }
    for (const key of ["dbReferencedMissingObjects", "orphanObjects", "invalidKeyObjects", "legacyDbStorageKeyRows"]) {
      requireEqual(item[key], `orphanAudit.subjects.${subject}.${key}`, 0, output);
    }
  }
}

function requireSubjectSnapshots(value, label, options, output) {
  if (!Array.isArray(value) || value.length !== requiredSubjects.length) {
    output.push(`${label} tam ${requiredSubjects.length} subject içermeli.`);
    return;
  }

  for (const subject of requiredSubjects) {
    const item = value.find((candidate) => candidate?.subject === subject);
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      output.push(`${label}.${subject} nesnesi zorunlu.`);
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
      requireIntegerAtLeast(item[key], `${label}.${subject}.${key}`, 0, output);
    }
    if (options.requirePendingZero) {
      for (const key of ["pendingRows", "pendingActiveRows", "pendingDeletedRows", "pendingBase64Characters"]) {
        requireEqual(item[key], `${label}.${subject}.${key}`, 0, output);
      }
    }
  }
}

function requireMigrated(value, output) {
  if (!Array.isArray(value) || value.length !== requiredSubjects.length) {
    output.push(`migration.migrated tam ${requiredSubjects.length} subject içermeli.`);
    return;
  }
  for (const subject of requiredSubjects) {
    const item = value.find((candidate) => candidate?.subject === subject);
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      output.push(`migration.migrated.${subject} nesnesi zorunlu.`);
      continue;
    }
    requireIntegerAtLeast(item.migratedRows, `migration.migrated.${subject}.migratedRows`, 0, output);
    requireIntegerAtLeast(item.migratedBytes, `migration.migrated.${subject}.migratedBytes`, 0, output);
  }
}

function subjectNumberMap(items, key) {
  const values = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (requiredSubjects.includes(item?.subject) && Number.isInteger(item[key])) {
      values.set(item.subject, item[key]);
    }
  }
  return values;
}

function runCheck(filePath) {
  const result = spawnSync("pnpm", ["inline-upload-content:check"], {
    env: {
      ...process.env,
      INLINE_UPLOAD_CONTENT_MIGRATION_TARGET: pathToFileURL(filePath).href,
    },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(["pnpm inline-upload-content:check başarısız oldu."]);
  }
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail([`${name} için değer gerekli.`]);
  }
  return value;
}

function requireValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
  }
}

function requireOneOf(value, label, expected, output) {
  if (!expected.includes(value)) {
    output.push(`${label} ${expected.join(" veya ")} olmalı.`);
  }
}

function requireEqual(value, label, expected, output) {
  if (value !== expected) {
    output.push(`${label} ${expected} olmalı.`);
  }
}

function requireEqualArray(value, label, expected, output) {
  if (!Array.isArray(value) || value.length !== expected.length) {
    output.push(`${label} tam ${expected.length} item içermeli.`);
    return;
  }
  for (const item of expected) {
    if (!value.includes(item)) {
      output.push(`${label} eksik item: ${item}`);
    }
  }
  for (const item of value) {
    if (!expected.includes(item)) {
      output.push(`${label} beklenmeyen item: ${item}`);
    }
  }
}

function requireTrue(value, label, output) {
  if (value !== "true") {
    output.push(`${label} true olmalı.`);
  }
}

function requireEvidenceValue(value, label, output) {
  requireValue(value, label, output);
  if (typeof value !== "string" || value.trim() === "") return;
  if (hasPlaceholderToken(value)) {
    output.push(`${label} gerçek karar/onay değeri olmalı; placeholder/example/redacted/test içeremez.`);
  }
}

function requireObject(value, label, output) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    output.push(`${label} nesnesi zorunlu.`);
  }
}

function requireDate(value, label, output) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    output.push(`${label} geçerli tarih olmalı.`);
  }
}

function requireDateOrder(firstValue, secondValue, firstLabel, secondLabel, output) {
  const first = Date.parse(firstValue);
  const second = Date.parse(secondValue);
  if (Number.isNaN(first) || Number.isNaN(second)) return;
  if (first > second) {
    output.push(`${firstLabel} ${secondLabel} tarihinden sonra olamaz.`);
  }
}

function requireIntegerAtLeast(value, label, min, output) {
  if (!Number.isInteger(value) || value < min) {
    output.push(`${label} en az ${min} tam sayı olmalı.`);
  }
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    fail([`${label} geçerli JSON olmalı.`]);
  }
}

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) {
    fail(["INLINE_UPLOAD_CONTENT_MIGRATION_OUTPUT lokal temp path olmamalı."]);
  }

  assertParentPathAllowed(dirname(filePath), "INLINE_UPLOAD_CONTENT_MIGRATION_OUTPUT");

  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail(["INLINE_UPLOAD_CONTENT_MIGRATION_OUTPUT symlink olmayan file artifact olmalı."]);
    }
  }
}

function assertParentPathAllowed(parentPath, label) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;

    const directoryStat = lstatSync(current);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      fail([`${label} parent dizini symlink olmayan dizin olmalı.`]);
    }
  }
}

function readFileStat(filePath, label) {
  try {
    return lstatSync(filePath);
  } catch {
    fail([`${label} okunabilir file artifact olmalı.`]);
  }
}

function isLocalTempPath(filePath) {
  const normalized = filePath.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
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
    "todo",
    "tbd",
    "???",
  ].some((token) => normalized.includes(token));
}

function fail(messages) {
  console.error("Inline upload migration kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
