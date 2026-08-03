import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.env.LICENSE_TERM_BACKFILL_TARGET;
const allowReady = process.env.LICENSE_TERM_BACKFILL_ALLOW_READY === "1";
const allowExample = process.env.LICENSE_TERM_BACKFILL_ALLOW_EXAMPLE === "1";
const maxAgeHours = Number.parseInt(process.env.LICENSE_TERM_BACKFILL_MAX_AGE_HOURS ?? "24", 10);
const topLevelKeys = ["schemaVersion", "result", "mode", "environment", "checkedAt", "databaseMutationApplied", "checks", "blockers", "gaps"];
const checkKeys = ["eligibleTenants", "existingTermsBefore", "readyTenants", "plannedWrites", "missingSnapshots", "invalidSnapshots", "mirrorParityMismatches", "overlappingTerms"];

if (!target) fail(["LICENSE_TERM_BACKFILL_TARGET boş bırakılamaz."]);
if (!Number.isInteger(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > 168) fail(["LICENSE_TERM_BACKFILL_MAX_AGE_HOURS 1..168 olmalı."]);

let targetUrl;
try { targetUrl = new URL(target); } catch { fail(["LICENSE_TERM_BACKFILL_TARGET file:// veya https:// URL olmalı."]); }
requireAllowedTarget(targetUrl);
let report;
try { report = JSON.parse(await readTarget(targetUrl)); } catch (error) {
  if (error?.code) throw error;
  fail(["LICENSE_TERM_BACKFILL_TARGET geçerli JSON olmalı."]);
}
const failures = validate(report);
if (failures.length > 0) fail(failures);
console.log(`LicenseTerm backfill kontrolü geçti: ${report.result} ${report.environment} ${report.checkedAt}`);

function validate(value) {
  const output = [];
  if (!exactObject(value, topLevelKeys, "backfill", output)) return output;
  if (value.schemaVersion !== 1) output.push("schemaVersion 1 olmalı.");
  if (!['PASS', 'READY'].includes(value.result)) output.push("result PASS veya izinli READY olmalı.");
  if (!['DRY_RUN', 'APPLY'].includes(value.mode)) output.push("mode DRY_RUN veya APPLY olmalı.");
  if (!['staging', 'production'].includes(value.environment)) output.push("environment staging veya production olmalı.");
  validateResultMode(value, output);
  validateCheckedAt(value.checkedAt, output);
  if (!exactObject(value.checks, checkKeys, "checks", output)) return output;
  for (const key of checkKeys) requireCount(value.checks[key], `checks.${key}`, output);
  requireZero(value.checks.missingSnapshots, "checks.missingSnapshots", output);
  requireZero(value.checks.invalidSnapshots, "checks.invalidSnapshots", output);
  requireZero(value.checks.mirrorParityMismatches, "checks.mirrorParityMismatches", output);
  requireZero(value.checks.overlappingTerms, "checks.overlappingTerms", output);
  if (value.mode === "DRY_RUN" && value.checks.readyTenants + value.checks.plannedWrites !== value.checks.eligibleTenants) {
    output.push("DRY_RUN readyTenants + plannedWrites eligibleTenants ile eşleşmeli.");
  }
  if (value.result === "PASS" && value.checks.readyTenants !== value.checks.eligibleTenants) {
    output.push("PASS tüm eligible tenantları hazır doğrulamalı.");
  }
  requireEmptyStringArray(value.blockers, "blockers", output);
  requireEmptyStringArray(value.gaps, "gaps", output);
  return output;
}

function validateResultMode(value, output) {
  if (value.result === "READY") {
    if (!allowReady) output.push("READY yalnız LICENSE_TERM_BACKFILL_ALLOW_READY=1 ile kabul edilir.");
    if (value.mode !== "DRY_RUN" || value.databaseMutationApplied !== false) output.push("READY salt-okunur DRY_RUN olmalı.");
  }
  if (value.result === "PASS" && (value.mode !== "APPLY" || value.databaseMutationApplied !== true)) {
    output.push("PASS mutasyon uygulanmış APPLY olmalı.");
  }
}

function validateCheckedAt(value, output) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return output.push("checkedAt geçerli ISO tarih olmalı.");
  if (timestamp > Date.now() + 60_000) output.push("checkedAt gelecekte olamaz.");
  if (!allowExample && Date.now() - timestamp > maxAgeHours * 60 * 60 * 1_000) output.push(`checkedAt ${maxAgeHours} saatten eski olamaz.`);
}

function exactObject(value, keys, label, output) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    output.push(`${label} nesnesi zorunlu.`);
    return false;
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) output.push(`${label} alanları exact olmalı: ${keys.join(", ")}.`);
  return true;
}

function requireCount(value, label, output) {
  if (!Number.isSafeInteger(value) || value < 0) output.push(`${label} sıfır veya büyük güvenli tam sayı olmalı.`);
}
function requireZero(value, label, output) { if (value !== 0) output.push(`${label} 0 olmalı.`); }
function requireEmptyStringArray(value, label, output) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) output.push(`${label} string listesi olmalı.`);
  else if (value.length > 0) output.push(`${label} boş olmalı.`);
}

async function readTarget(url) {
  if (url.protocol === "file:") {
    const path = fileURLToPath(url);
    const stat = await lstat(path).catch(() => fail(["LICENSE_TERM_BACKFILL_TARGET okunabilir file olmalı."]));
    if (stat.isSymbolicLink() || !stat.isFile()) fail(["LICENSE_TERM_BACKFILL_TARGET symlink olmayan file:// artifact olmalı."]);
    await assertParentPathAllowed(dirname(path));
    return readFile(path, "utf8");
  }
  const response = await fetch(url);
  if (!response.ok) fail([`LicenseTerm backfill okunamadı: HTTP ${response.status}`]);
  return response.text();
}

function requireAllowedTarget(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") fail(["LICENSE_TERM_BACKFILL_TARGET yalnız file:// veya https:// destekler."]);
  if (url.protocol === "https:" && hasPlaceholder(url.hostname)) fail(["LICENSE_TERM_BACKFILL_TARGET gerçek https host olmalı."]);
  if (url.protocol === "file:" && isLocalTempPath(fileURLToPath(url))) fail(["LICENSE_TERM_BACKFILL_TARGET lokal temp path olmamalı."]);
}
async function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    const stat = await lstat(current).catch(() => fail(["LICENSE_TERM_BACKFILL_TARGET parent dizini okunabilir olmalı."]));
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail(["LICENSE_TERM_BACKFILL_TARGET parent dizini güvenli olmalı."]);
  }
}
function hasPlaceholder(value) { return ["example", "placeholder", "redacted", "__set", "todo", "tbd", ".test", "localhost"].some((token) => String(value).toLowerCase().includes(token)); }
function isLocalTempPath(path) { return ["/tmp", "/var/tmp", "/private/tmp"].some((root) => path === root || path.startsWith(`${root}/`)); }
function fail(messages) {
  console.error("LicenseTerm backfill kontrolü başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
