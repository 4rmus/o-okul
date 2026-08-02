import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.env.ACCOUNT_MANAGEMENT_BACKFILL_TARGET;
const allowReady = process.env.ACCOUNT_MANAGEMENT_BACKFILL_ALLOW_READY === "1";
const allowExample = process.env.ACCOUNT_MANAGEMENT_BACKFILL_ALLOW_EXAMPLE === "1";
const maxAgeHours = Number.parseInt(process.env.ACCOUNT_MANAGEMENT_BACKFILL_MAX_AGE_HOURS ?? "24", 10);
const topLevelKeys = [
  "schemaVersion",
  "result",
  "mode",
  "environment",
  "checkedAt",
  "databaseMutationApplied",
  "checks",
  "blockers",
  "gaps",
];
const checkKeys = [
  "foundation",
  "preconditions",
  "owners",
  "tenantAccounts",
  "platformAccounts",
  "memberships",
  "employees",
  "sessions",
];
const shapes = {
  foundation: ["expectedTables", "presentTables"],
  preconditions: [
    "emailCollisionGroups",
    "plannedLoginCollisionGroups",
    "invalidRoleAccounts",
    "orphanProfileLinks",
    "orphanSubjectMemberships",
    "employeeAmbiguousMatches",
    "platformLoginCollisionGroups",
    "platformEmailCollisionGroups",
  ],
  owners: ["activeTenants", "existingOwners", "automaticallyVerified", "decisionBacked", "missing"],
  tenantAccounts: ["total", "ready", "plannedWrites"],
  platformAccounts: ["sourceAccounts", "readyAccounts", "sourceSessions", "readySessions"],
  memberships: ["canonicalAccounts", "readyAccounts"],
  employees: ["teachers", "linkedTeachers"],
  sessions: ["activeSessions", "membershipVersionMatches", "legacyRoleMatches"],
};

if (!target) fail(["ACCOUNT_MANAGEMENT_BACKFILL_TARGET boş bırakılamaz."]);
if (!Number.isInteger(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > 168) {
  fail(["ACCOUNT_MANAGEMENT_BACKFILL_MAX_AGE_HOURS 1..168 olmalı."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["ACCOUNT_MANAGEMENT_BACKFILL_TARGET file:// veya https:// URL olmalı."]);
}
requireAllowedTarget(targetUrl);

let report;
try {
  report = JSON.parse(await readTarget(targetUrl));
} catch (error) {
  if (error?.code) throw error;
  fail(["ACCOUNT_MANAGEMENT_BACKFILL_TARGET geçerli JSON olmalı."]);
}
const failures = validate(report);
if (failures.length > 0) fail(failures);

console.log(`Account management backfill kontrolü geçti: ${report.result} ${report.environment} ${report.checkedAt}`);

function validate(report) {
  const output = [];
  if (!exactObject(report, topLevelKeys, "backfill", output)) return output;
  if (report.schemaVersion !== 1) output.push("schemaVersion 1 olmalı.");
  if (!['PASS', 'READY'].includes(report.result)) output.push("result PASS veya izinli READY olmalı.");
  if (!['DRY_RUN', 'APPLY'].includes(report.mode)) output.push("mode DRY_RUN veya APPLY olmalı.");
  if (!['staging', 'production'].includes(report.environment)) output.push("environment staging veya production olmalı.");
  validateResultMode(report, output);
  validateCheckedAt(report.checkedAt, output);
  if (!exactObject(report.checks, checkKeys, "checks", output)) return output;

  for (const [name, keys] of Object.entries(shapes)) {
    if (!exactObject(report.checks[name], keys, `checks.${name}`, output)) continue;
    for (const key of keys) requireCount(report.checks[name][key], `checks.${name}.${key}`, output);
  }

  const checks = report.checks;
  if (checks.foundation?.expectedTables !== 7 || checks.foundation?.presentTables !== 7) {
    output.push("checks.foundation 7/7 tablo doğrulamalı.");
  }
  for (const key of shapes.preconditions) requireZero(checks.preconditions?.[key], `checks.preconditions.${key}`, output);

  const owners = checks.owners;
  if (owners) {
    requireZero(owners.missing, "checks.owners.missing", output);
    if (owners.activeTenants !== owners.existingOwners + owners.automaticallyVerified + owners.decisionBacked) {
      output.push("checks.owners activeTenants dağılımı ile eşleşmeli.");
    }
  }

  const tenantAccounts = checks.tenantAccounts;
  if (tenantAccounts) {
    if (tenantAccounts.ready > tenantAccounts.total) output.push("checks.tenantAccounts.ready total değerini aşamaz.");
    if (tenantAccounts.plannedWrites > tenantAccounts.total) output.push("checks.tenantAccounts.plannedWrites total değerini aşamaz.");
    if (tenantAccounts.plannedWrites !== tenantAccounts.total - tenantAccounts.ready && report.mode === "DRY_RUN") {
      output.push("DRY_RUN checks.tenantAccounts.plannedWrites total-ready olmalı.");
    }
  }
  requireAtMost(checks.platformAccounts?.readyAccounts, checks.platformAccounts?.sourceAccounts, "checks.platformAccounts.readyAccounts", output);
  requireAtMost(checks.platformAccounts?.readySessions, checks.platformAccounts?.sourceSessions, "checks.platformAccounts.readySessions", output);
  requireAtMost(checks.memberships?.readyAccounts, checks.memberships?.canonicalAccounts, "checks.memberships.readyAccounts", output);
  requireAtMost(checks.employees?.linkedTeachers, checks.employees?.teachers, "checks.employees.linkedTeachers", output);

  const sessions = checks.sessions;
  if (sessions?.membershipVersionMatches !== sessions?.activeSessions) {
    output.push("checks.sessions.membershipVersionMatches activeSessions ile eşleşmeli.");
  }
  if (sessions?.legacyRoleMatches !== sessions?.activeSessions) {
    output.push("checks.sessions.legacyRoleMatches activeSessions ile eşleşmeli.");
  }

  if (report.result === "PASS") {
    requireEqual(tenantAccounts?.ready, tenantAccounts?.total, "checks.tenantAccounts backfill tamamlanmalı.", output);
    requireEqual(checks.platformAccounts?.readyAccounts, checks.platformAccounts?.sourceAccounts, "checks.platformAccounts account backfill tamamlanmalı.", output);
    requireEqual(checks.platformAccounts?.readySessions, checks.platformAccounts?.sourceSessions, "checks.platformAccounts session backfill tamamlanmalı.", output);
    requireEqual(checks.memberships?.readyAccounts, checks.memberships?.canonicalAccounts, "checks.memberships backfill tamamlanmalı.", output);
    requireEqual(checks.employees?.linkedTeachers, checks.employees?.teachers, "checks.employees backfill tamamlanmalı.", output);
  }

  requireEmptyStringArray(report.blockers, "blockers", output);
  requireEmptyStringArray(report.gaps, "gaps", output);
  return output;
}

function validateResultMode(report, output) {
  if (report.result === "READY") {
    if (!allowReady) output.push("READY yalnız ACCOUNT_MANAGEMENT_BACKFILL_ALLOW_READY=1 ile kabul edilir.");
    if (report.mode !== "DRY_RUN") output.push("READY sonucu yalnız DRY_RUN modunda olabilir.");
    if (report.databaseMutationApplied !== false) output.push("READY sonucu databaseMutationApplied false olmalı.");
  }
  if (report.result === "PASS") {
    if (report.mode !== "APPLY") output.push("PASS sonucu yalnız APPLY modunda olabilir.");
    if (report.databaseMutationApplied !== true) output.push("PASS sonucu databaseMutationApplied true olmalı.");
  }
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
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
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

function requireAtMost(value, maximum, label, output) {
  if (Number.isSafeInteger(value) && Number.isSafeInteger(maximum) && value > maximum) {
    output.push(`${label} kaynak toplamını aşamaz.`);
  }
}

function requireEqual(value, expected, message, output) {
  if (value !== expected) output.push(message);
}

function requireEmptyStringArray(value, label, output) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) output.push(`${label} string listesi olmalı.`);
  else if (value.length > 0) output.push(`${label} boş olmalı.`);
}

async function readTarget(url) {
  if (url.protocol === "file:") {
    const path = fileURLToPath(url);
    const stat = await lstat(path).catch(() => fail(["ACCOUNT_MANAGEMENT_BACKFILL_TARGET okunabilir file olmalı."]));
    if (stat.isSymbolicLink() || !stat.isFile()) fail(["ACCOUNT_MANAGEMENT_BACKFILL_TARGET symlink olmayan file:// artifact olmalı."]);
    await assertParentPathAllowed(dirname(path));
    return readFile(path, "utf8");
  }
  const response = await fetch(url);
  if (!response.ok) fail([`Account management backfill okunamadı: HTTP ${response.status}`]);
  return response.text();
}

function requireAllowedTarget(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") fail(["ACCOUNT_MANAGEMENT_BACKFILL_TARGET yalnız file:// veya https:// destekler."]);
  if (url.protocol === "https:" && hasPlaceholder(url.hostname)) fail(["ACCOUNT_MANAGEMENT_BACKFILL_TARGET gerçek https host olmalı."]);
  if (url.protocol === "file:" && isLocalTempPath(fileURLToPath(url))) fail(["ACCOUNT_MANAGEMENT_BACKFILL_TARGET lokal temp path olmamalı."]);
}

async function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    const stat = await lstat(current).catch(() => fail(["ACCOUNT_MANAGEMENT_BACKFILL_TARGET parent dizini okunabilir olmalı."]));
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail(["ACCOUNT_MANAGEMENT_BACKFILL_TARGET parent dizini symlink olmayan dizin olmalı."]);
  }
}

function hasPlaceholder(value) {
  const normalized = String(value).toLowerCase();
  return ["example", "placeholder", "redacted", "__set", "todo", "tbd", ".test", "localhost"].some((token) => normalized.includes(token));
}

function isLocalTempPath(path) {
  const normalized = path.replace(/\/+$/g, "") || "/";
  return ["/tmp", "/var/tmp", "/private/tmp"].some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function fail(messages) {
  console.error("Account management backfill kontrolü başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
