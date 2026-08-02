import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.env.ACCOUNT_MANAGEMENT_PREFLIGHT_TARGET;
const allowExample = process.env.ACCOUNT_MANAGEMENT_PREFLIGHT_ALLOW_EXAMPLE === "1";
const maxAgeHours = Number.parseInt(process.env.ACCOUNT_MANAGEMENT_PREFLIGHT_MAX_AGE_HOURS ?? "24", 10);
const topLevelKeys = ["schemaVersion", "result", "environment", "checkedAt", "databaseReadOnly", "checks", "blockers", "gaps"];
const checkKeys = [
  "foundation",
  "tenantEmailCollisions",
  "multipleOpenEnrollments",
  "invalidRoleCombinations",
  "orphanProfileLinks",
  "orphanSubjectMemberships",
  "teacherEmployeeBackfill",
  "guardianInventory",
];
const countShapes = {
  foundation: ["expectedTables", "presentTables"],
  tenantEmailCollisions: ["groups", "accounts", "tenantsAffected"],
  multipleOpenEnrollments: ["students", "enrollments", "tenantsAffected"],
  invalidRoleCombinations: ["accounts", "tenantsAffected"],
  orphanProfileLinks: ["profiles", "tenantsAffected"],
  orphanSubjectMemberships: ["accounts", "tenantsAffected"],
  teacherEmployeeBackfill: ["teachers", "missingEmployeeLinks", "tenantsAffected"],
};
const guardianKeys = [
  "guardians",
  "studentLinks",
  "linkedAccounts",
  "activeSessions",
  "pendingInvitations",
  "tenantsAffected",
  "classification",
  "classificationEvidenceReference",
];

if (!target) fail(["ACCOUNT_MANAGEMENT_PREFLIGHT_TARGET boş bırakılamaz."]);
if (!Number.isInteger(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > 168) {
  fail(["ACCOUNT_MANAGEMENT_PREFLIGHT_MAX_AGE_HOURS 1..168 olmalı."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["ACCOUNT_MANAGEMENT_PREFLIGHT_TARGET file:// veya https:// URL olmalı."]);
}
requireAllowedTarget(targetUrl);

let report;
const rawReport = await readTarget(targetUrl);
try {
  report = JSON.parse(rawReport);
} catch {
  fail(["ACCOUNT_MANAGEMENT_PREFLIGHT_TARGET geçerli JSON olmalı."]);
}
const failures = validate(report);
if (failures.length > 0) fail(failures);

console.log(`Account management preflight kontrolü geçti: ${report.environment} ${report.checkedAt}`);

function validate(report) {
  const output = [];
  if (!exactObject(report, topLevelKeys, "preflight", output)) return output;
  if (report.schemaVersion !== 1) output.push("schemaVersion 1 olmalı.");
  if (report.result !== "PASS") output.push("result PASS olmalı.");
  if (!["staging", "production"].includes(report.environment)) output.push("environment staging veya production olmalı.");
  if (report.databaseReadOnly !== true) output.push("databaseReadOnly true olmalı.");
  validateCheckedAt(report.checkedAt, output);
  if (!exactObject(report.checks, checkKeys, "checks", output)) return output;

  for (const [name, keys] of Object.entries(countShapes)) {
    if (!exactObject(report.checks[name], keys, `checks.${name}`, output)) continue;
    for (const key of keys) requireCount(report.checks[name][key], `checks.${name}.${key}`, output);
  }

  const foundation = report.checks.foundation;
  if (foundation?.expectedTables !== 7 || foundation?.presentTables !== 7) {
    output.push("checks.foundation 7/7 tablo doğrulamalı.");
  }
  requireZero(report.checks.tenantEmailCollisions?.groups, "checks.tenantEmailCollisions.groups", output);
  requireZero(report.checks.multipleOpenEnrollments?.students, "checks.multipleOpenEnrollments.students", output);
  requireZero(report.checks.invalidRoleCombinations?.accounts, "checks.invalidRoleCombinations.accounts", output);
  requireZero(report.checks.orphanProfileLinks?.profiles, "checks.orphanProfileLinks.profiles", output);
  requireZero(report.checks.orphanSubjectMemberships?.accounts, "checks.orphanSubjectMemberships.accounts", output);

  const teacherBackfill = report.checks.teacherEmployeeBackfill;
  if (teacherBackfill && teacherBackfill.missingEmployeeLinks > teacherBackfill.teachers) {
    output.push("checks.teacherEmployeeBackfill.missingEmployeeLinks teachers değerini aşamaz.");
  }

  const guardian = report.checks.guardianInventory;
  if (exactObject(guardian, guardianKeys, "checks.guardianInventory", output)) {
    for (const key of guardianKeys.slice(0, 6)) requireCount(guardian[key], `checks.guardianInventory.${key}`, output);
    if (!guardianClassificationAllowed(guardian.classification)) {
      output.push("checks.guardianInventory.classification geçersiz.");
    }
    if (guardian.guardians > 0) {
      if (guardian.classification !== "FIXTURE_ONLY") {
        output.push("Guardian kaydı varsa classification FIXTURE_ONLY olmalı; müşteri/unverified veri hard-stop'tur.");
      }
      requireEvidenceReference(guardian.classificationEvidenceReference, output);
    } else if (guardian.classificationEvidenceReference !== null && typeof guardian.classificationEvidenceReference !== "string") {
      output.push("checks.guardianInventory.classificationEvidenceReference string veya null olmalı.");
    }
    if (guardian.linkedAccounts > guardian.guardians) output.push("guardian linkedAccounts guardians değerini aşamaz.");
  }

  requireEmptyStringArray(report.blockers, "blockers", output);
  requireEmptyStringArray(report.gaps, "gaps", output);
  return output;
}

function validateCheckedAt(value, output) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    output.push("checkedAt geçerli ISO tarih olmalı.");
    return;
  }
  const now = Date.now();
  if (timestamp > now + 60_000) output.push("checkedAt gelecekte olamaz.");
  if (!allowExample && now - timestamp > maxAgeHours * 60 * 60 * 1000) {
    output.push(`checkedAt ${maxAgeHours} saatten eski olamaz.`);
  }
}

function exactObject(value, keys, label, output) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    output.push(`${label} nesnesi zorunlu.`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    output.push(`${label} alanları exact olmalı: ${keys.join(", ")}.`);
    return false;
  }
  return true;
}

function requireCount(value, label, output) {
  if (!Number.isSafeInteger(value) || value < 0) output.push(`${label} sıfır veya büyük güvenli tam sayı olmalı.`);
}

function requireZero(value, label, output) {
  if (value !== 0) output.push(`${label} 0 olmalı.`);
}

function requireEmptyStringArray(value, label, output) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    output.push(`${label} string listesi olmalı.`);
  } else if (value.length > 0) {
    output.push(`${label} boş olmalı.`);
  }
}

function guardianClassificationAllowed(value) {
  return ["UNVERIFIED", "FIXTURE_ONLY", "CUSTOMER_DATA_PRESENT"].includes(value);
}

function requireEvidenceReference(value, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push("Guardian fixture kanıt referansı zorunlu.");
    return;
  }
  if (!allowExample && hasPlaceholder(value)) output.push("Guardian fixture kanıt referansı gerçek değer olmalı.");
}

function hasPlaceholder(value) {
  const normalized = value.toLowerCase();
  return ["example", "placeholder", "redacted", "__set", "todo", "tbd", ".test", "localhost"].some((token) => normalized.includes(token));
}

async function readTarget(url) {
  if (url.protocol === "file:") {
    const path = fileURLToPath(url);
    const stat = await lstat(path).catch(() => fail(["ACCOUNT_MANAGEMENT_PREFLIGHT_TARGET okunabilir file olmalı."]));
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail(["ACCOUNT_MANAGEMENT_PREFLIGHT_TARGET symlink olmayan file:// artifact olmalı."]);
    }
    await assertParentPathAllowed(dirname(path));
    return readFile(path, "utf8");
  }
  const response = await fetch(url);
  if (!response.ok) fail([`Account management preflight okunamadı: HTTP ${response.status}`]);
  return response.text();
}

function requireAllowedTarget(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["ACCOUNT_MANAGEMENT_PREFLIGHT_TARGET yalnız file:// veya https:// destekler."]);
  }
  if (url.protocol === "https:" && hasPlaceholder(url.hostname)) {
    fail(["ACCOUNT_MANAGEMENT_PREFLIGHT_TARGET gerçek https host olmalı."]);
  }
  if (url.protocol === "file:" && isLocalTempPath(fileURLToPath(url))) {
    fail(["ACCOUNT_MANAGEMENT_PREFLIGHT_TARGET lokal temp path olmamalı."]);
  }
}

async function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    const stat = await lstat(current).catch(() => fail(["ACCOUNT_MANAGEMENT_PREFLIGHT_TARGET parent dizini okunabilir olmalı."]));
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["ACCOUNT_MANAGEMENT_PREFLIGHT_TARGET parent dizini symlink olmayan dizin olmalı."]);
    }
  }
}

function isLocalTempPath(path) {
  const normalized = path.replace(/\/+$/g, "") || "/";
  return ["/tmp", "/var/tmp", "/private/tmp"].some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function fail(messages) {
  console.error("Account management preflight kontrolü başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
