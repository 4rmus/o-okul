import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const target = process.env.SECRET_DELIVERY_OUTBOX_EVIDENCE_TARGET ?? (
  process.env.SECRET_DELIVERY_OUTBOX_SMOKE_EVIDENCE_FILE
    ? pathToFileURL(resolve(process.env.SECRET_DELIVERY_OUTBOX_SMOKE_EVIDENCE_FILE)).href
    : undefined
);
const allowExample = process.env.SECRET_DELIVERY_OUTBOX_ALLOW_EXAMPLE_EVIDENCE === "1";
const expectedReleaseImageTag = process.env.SECRET_DELIVERY_OUTBOX_RELEASE_IMAGE_TAG ?? process.env.SENTRY_RELEASE;
const expectedNotBefore = process.env.SECRET_DELIVERY_OUTBOX_NOT_BEFORE;
const expectedKeys = [
  "schemaVersion",
  "result",
  "check",
  "environment",
  "generatedAt",
  "releaseImageTag",
  "notBefore",
  "outboxRecordHash",
  "purpose",
  "retry",
  "terminalStatus",
  "payloadCleared",
  "deliveredAt",
  "updatedAt",
  "separateRolePrivilege",
  "commandsPassed",
  "gaps",
];

if (!target) fail(["SECRET_DELIVERY_OUTBOX_EVIDENCE_TARGET boş bırakılamaz."]);

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["SECRET_DELIVERY_OUTBOX_EVIDENCE_TARGET file:// veya https:// URL olmalı."]);
}
await requireAllowedTarget(targetUrl);

let evidence;
try {
  evidence = JSON.parse(await readTarget(targetUrl));
} catch {
  fail(["SECRET_DELIVERY_OUTBOX_EVIDENCE_TARGET geçerli JSON olmalı."]);
}

const failures = validateEvidence(evidence);
if (failures.length > 0) fail(failures);

console.log(`Secret delivery outbox evidence kontrolü geçti: ${evidence.environment} ${evidence.generatedAt}`);

function validateEvidence(value) {
  const failures = [];
  if (!exactObject(value, expectedKeys, "outboxEvidence", failures)) return failures;
  if (value.schemaVersion !== 1) failures.push("schemaVersion 1 olmalı.");
  if (value.result !== "PASS") failures.push("result PASS olmalı.");
  if (value.check !== "secret_delivery_outbox_staging_smoke") failures.push("check secret_delivery_outbox_staging_smoke olmalı.");
  if (!['staging', 'production'].includes(value.environment)) failures.push("environment staging veya production olmalı.");
  requireRecentDate(value.generatedAt, failures);
  if (!isReleaseImageTag(value.releaseImageTag)) failures.push("releaseImageTag güvenli IMAGE_TAG olmalı.");
  if (expectedReleaseImageTag && value.releaseImageTag !== expectedReleaseImageTag) {
    failures.push("releaseImageTag geçerli release IMAGE_TAG ile eşleşmeli.");
  }
  if (expectedNotBefore && value.notBefore !== expectedNotBefore) {
    failures.push("notBefore full-evidence cutover zamanı ile eşleşmeli.");
  }
  requireCutoverNotBefore(value.notBefore, value.generatedAt, failures);
  if (typeof value.outboxRecordHash !== "string" || !/^[a-f0-9]{64}$/.test(value.outboxRecordHash)) {
    failures.push("outboxRecordHash SHA-256 hex olmalı.");
  }
  if (!['IDENTITY_INVITATION', 'PASSWORD_RESET'].includes(value.purpose)) {
    failures.push("purpose IDENTITY_INVITATION veya PASSWORD_RESET olmalı.");
  }
  if (!exactObject(value.retry, ["attempts", "retried"], "retry", failures)) return failures;
  if (!Number.isSafeInteger(value.retry.attempts) || value.retry.attempts < 2) {
    failures.push("retry.attempts en az 2 olmalı.");
  }
  if (value.retry.retried !== true) failures.push("retry.retried true olmalı.");
  if (value.terminalStatus !== "DELIVERED") failures.push("terminalStatus Phase B success smoke için DELIVERED olmalı.");
  if (value.payloadCleared !== true) failures.push("payloadCleared true olmalı.");
  requireRecentDate(value.deliveredAt, failures, "deliveredAt");
  requireRecentDate(value.updatedAt, failures, "updatedAt");
  if (Date.parse(value.deliveredAt) > Date.parse(value.generatedAt) || Date.parse(value.updatedAt) > Date.parse(value.generatedAt)) {
    failures.push("deliveredAt ve updatedAt generatedAt değerinden sonra olamaz.");
  }
  if (Date.parse(value.deliveredAt) < Date.parse(value.notBefore) || Date.parse(value.updatedAt) < Date.parse(value.notBefore)) {
    failures.push("deliveredAt ve updatedAt cutover notBefore zamanından önce olamaz.");
  }
  validateSeparateRolePrivilege(value.separateRolePrivilege, failures);
  if (!Array.isArray(value.commandsPassed) || value.commandsPassed.length !== 1 || value.commandsPassed[0] !== "pnpm secret-delivery-outbox:staging:smoke") {
    failures.push("commandsPassed yalnız pnpm secret-delivery-outbox:staging:smoke içermeli.");
  }
  if (!Array.isArray(value.gaps) || value.gaps.length !== 0 || value.gaps.some((item) => typeof item !== "string")) {
    failures.push("gaps boş string listesi olmalı.");
  }
  if (containsSensitiveMaterial(value)) {
    failures.push("Outbox kanıtı recipient, token, URL veya şifreli payload taşımamalı.");
  }
  return failures;
}

function validateSeparateRolePrivilege(value, failures) {
  if (!exactObject(value, ["role", "result", "outboxTable", "otherTables", "publicSchema", "elevatedCapabilities"], "separateRolePrivilege", failures)) return;
  if (value.role !== "secret_delivery_worker") failures.push("separateRolePrivilege.role secret_delivery_worker olmalı.");
  if (value.result !== "PASS") failures.push("separateRolePrivilege.result PASS olmalı.");
  if (exactObject(value.outboxTable, ["select", "update", "insert", "delete", "truncate"], "separateRolePrivilege.outboxTable", failures)) {
    if (value.outboxTable.select !== true || value.outboxTable.update !== true || value.outboxTable.insert !== false || value.outboxTable.delete !== false || value.outboxTable.truncate !== false) {
      failures.push("separateRolePrivilege.outboxTable yalnız SELECT ve UPDATE yetkisini göstermeli.");
    }
  }
  if (exactObject(value.otherTables, ["userSelect"], "separateRolePrivilege.otherTables", failures) && value.otherTables.userSelect !== false) {
    failures.push("separateRolePrivilege.otherTables.userSelect false olmalı.");
  }
  if (exactObject(value.publicSchema, ["create", "owner"], "separateRolePrivilege.publicSchema", failures)) {
    if (value.publicSchema.create !== false || value.publicSchema.owner !== false) {
      failures.push("separateRolePrivilege.publicSchema CREATE ve owner yetkisi taşımamalı.");
    }
  }
  if (exactObject(value.elevatedCapabilities, ["superuser", "createRole", "createDb", "bypassRls"], "separateRolePrivilege.elevatedCapabilities", failures)) {
    if (Object.values(value.elevatedCapabilities).some((item) => item !== false)) {
      failures.push("separateRolePrivilege.elevatedCapabilities tümü false olmalı.");
    }
  }
}

function containsSensitiveMaterial(value) {
  const serialized = JSON.stringify(value).toLowerCase();
  return /https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|recipient|token|payloadencrypted|sourceid/.test(serialized);
}

function requireRecentDate(value, failures, label = "generatedAt") {
  const timestamp = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(timestamp)) {
    failures.push(`${label} geçerli ISO tarih olmalı.`);
    return;
  }
  if (allowExample) return;
  if (timestamp > Date.now() + 5 * 60 * 1000) failures.push(`${label} gelecekte olamaz.`);
  if (Date.now() - timestamp > 24 * 60 * 60 * 1000) failures.push(`${label} 24 saatten eski olamaz.`);
}

function requireCutoverNotBefore(value, generatedAt, failures) {
  const timestamp = Date.parse(value);
  const generatedTimestamp = Date.parse(generatedAt);
  if (typeof value !== "string" || Number.isNaN(timestamp)) {
    failures.push("notBefore geçerli ISO tarih olmalı.");
    return;
  }
  if (Number.isFinite(generatedTimestamp) && (timestamp > generatedTimestamp || generatedTimestamp - timestamp > 15 * 60 * 1000)) {
    failures.push("notBefore generatedAt öncesindeki son 15 dakika içinde olmalı.");
  }
}

function isReleaseImageTag(value) {
  return typeof value === "string" && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(value);
}

async function requireAllowedTarget(url) {
  if (url.protocol === "https:") {
    if (!url.hostname || /(^|\.)(example|test|invalid)$/i.test(url.hostname) || url.hostname === "localhost" || url.username || url.password || url.search || url.hash) {
      fail(["SECRET_DELIVERY_OUTBOX_EVIDENCE_TARGET gerçek https host ve secretsiz URL olmalı."]);
    }
    return;
  }
  if (url.protocol !== "file:") fail(["SECRET_DELIVERY_OUTBOX_EVIDENCE_TARGET file:// veya https:// URL olmalı."]);
  const filePath = fileURLToPath(url);
  if (isLocalTempPath(filePath)) fail(["SECRET_DELIVERY_OUTBOX_EVIDENCE_TARGET lokal temp path olmamalı."]);
  await assertParentPathAllowed(dirname(filePath));
  const stat = await lstat(filePath).catch(() => fail(["SECRET_DELIVERY_OUTBOX_EVIDENCE_TARGET okunabilir file artifact olmalı."]));
  if (stat.isSymbolicLink() || !stat.isFile()) fail(["SECRET_DELIVERY_OUTBOX_EVIDENCE_TARGET symlink olmayan file:// artifact olmalı."]);
}

async function readTarget(url) {
  if (url.protocol === "file:") return readFile(fileURLToPath(url), "utf8");
  const response = await fetch(url);
  if (!response.ok) fail([`SECRET_DELIVERY_OUTBOX_EVIDENCE_TARGET okunamadı: HTTP ${response.status}`]);
  return response.text();
}

async function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    const stat = await lstat(current).catch(() => fail(["SECRET_DELIVERY_OUTBOX_EVIDENCE_TARGET parent dizini mevcut olmalı."]));
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail(["SECRET_DELIVERY_OUTBOX_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmalı."]);
  }
}

function isLocalTempPath(filePath) {
  return ["/tmp", "/var/tmp", "/private/tmp"].some((path) => filePath === path || filePath.startsWith(`${path}/`));
}

function exactObject(value, keys, label, failures) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return false;
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    failures.push(`${label} alanları exact olmalı: ${keys.join(", ")}.`);
    return false;
  }
  return true;
}

function fail(messages) {
  console.error("Secret delivery outbox evidence kontrolü başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
