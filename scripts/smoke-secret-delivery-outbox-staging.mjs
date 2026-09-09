import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { validateSmokeEvidenceOutputTarget } from "./smoke-evidence.mjs";

const databaseUrl = process.env.SECRET_DELIVERY_OUTBOX_DATABASE_URL;
const uncertainSourceFile = process.env.SECRET_DELIVERY_OUTBOX_UNCERTAIN_SOURCE_FILE;
const sourceFile = process.env.SECRET_DELIVERY_OUTBOX_SMOKE_SOURCE_FILE;
const evidenceFile = process.env.SECRET_DELIVERY_OUTBOX_SMOKE_EVIDENCE_FILE;
const notBefore = process.env.SECRET_DELIVERY_OUTBOX_NOT_BEFORE;
const releaseImageTag = process.env.SECRET_DELIVERY_OUTBOX_RELEASE_IMAGE_TAG;
const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV;

if (!databaseUrl) fail(["SECRET_DELIVERY_OUTBOX_DATABASE_URL boş bırakılamaz."]);
if (!uncertainSourceFile) fail(["SECRET_DELIVERY_OUTBOX_UNCERTAIN_SOURCE_FILE boş bırakılamaz."]);
if (!sourceFile) fail(["SECRET_DELIVERY_OUTBOX_SMOKE_SOURCE_FILE boş bırakılamaz."]);
if (!evidenceFile) fail(["SECRET_DELIVERY_OUTBOX_SMOKE_EVIDENCE_FILE boş bırakılamaz."]);
if (!notBefore || !isRecentCutoverTimestamp(notBefore)) fail(["SECRET_DELIVERY_OUTBOX_NOT_BEFORE cutover sonrası son 24 saat içinde bir ISO zaman olmalı."]);
if (!isReleaseImageTag(releaseImageTag)) fail(["SECRET_DELIVERY_OUTBOX_RELEASE_IMAGE_TAG güvenli IMAGE_TAG değeri olmalı."]);
if (!['staging', 'production'].includes(environment)) fail(["STAGING_ENVIRONMENT veya NODE_ENV staging/production olmalı."]);

let database;
try {
  database = new URL(databaseUrl);
} catch {
  fail(["SECRET_DELIVERY_OUTBOX_DATABASE_URL geçerli PostgreSQL URL olmalı."]);
}
if (!['postgres:', 'postgresql:'].includes(database.protocol) || decodeURIComponent(database.username) !== "secret_delivery_worker") {
  fail(["SECRET_DELIVERY_OUTBOX_DATABASE_URL secret_delivery_worker rolünü kullanmalı."]);
}

await validateSmokeEvidenceOutputTarget(evidenceFile);
const sourceId = await readPrivateSourceId(sourceFile);
const uncertainSourceId = await readPrivateSourceId(uncertainSourceFile);
if (sourceId === uncertainSourceId) fail(["Başarı ve belirsizlik kanıtları ayrı source ID taşımalı."]);
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  const privilegeResult = await pool.query(`
    SELECT current_user AS "role",
           has_table_privilege(current_user, '"SecretDeliveryOutbox"', 'SELECT') AS "select",
           has_table_privilege(current_user, '"SecretDeliveryOutbox"', 'UPDATE') AS "update",
           has_table_privilege(current_user, '"SecretDeliveryOutbox"', 'INSERT') AS "insert",
           has_table_privilege(current_user, '"SecretDeliveryOutbox"', 'DELETE') AS "delete",
           has_table_privilege(current_user, '"SecretDeliveryOutbox"', 'TRUNCATE') AS "truncate",
           has_table_privilege(current_user, '"User"', 'SELECT') AS "userSelect",
           has_column_privilege(current_user, '"Tenant"', 'id', 'SELECT') AS "tenantIdSelect",
           has_column_privilege(current_user, '"Tenant"', 'status', 'SELECT') AS "tenantStatusSelect",
           has_column_privilege(current_user, '"Tenant"', 'lifecycleVersion', 'SELECT') AS "tenantEpochSelect",
           EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid = '"Tenant"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attname NOT IN ('id','status','lifecycleVersion') AND has_column_privilege(current_user, a.attrelid, a.attname, 'SELECT')) AS "tenantOtherSelect",
           (has_table_privilege(current_user, '"Tenant"', 'DELETE,TRUNCATE,TRIGGER') OR EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid = '"Tenant"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege(current_user, a.attrelid, a.attname, 'INSERT,UPDATE,REFERENCES'))) AS "tenantWrite",
           has_schema_privilege(current_user, 'public', 'CREATE') AS "publicSchemaCreate",
           (SELECT nspowner = rol.oid FROM pg_namespace WHERE nspname = 'public') AS "publicSchemaOwner",
           rol.rolsuper AS "superuser",
           rol.rolcreaterole AS "createRole",
           rol.rolcreatedb AS "createDb",
           rol.rolbypassrls AS "bypassRls"
    FROM pg_roles rol
    WHERE rol.rolname = current_user`);
  const privilege = privilegeResult.rows[0];
  const separateRolePrivilege = {
    role: privilege?.role,
    result: hasExpectedPrivileges(privilege) ? "PASS" : "FAIL",
    outboxTable: {
      select: privilege?.select === true,
      update: privilege?.update === true,
      insert: privilege?.insert === true,
      delete: privilege?.delete === true,
      truncate: privilege?.truncate === true,
    },
    tenantAdmission: { idSelect: privilege?.tenantIdSelect === true, statusSelect: privilege?.tenantStatusSelect === true, lifecycleVersionSelect: privilege?.tenantEpochSelect === true, otherColumnSelect: privilege?.tenantOtherSelect === true, write: privilege?.tenantWrite === true },
    otherTables: { userSelect: privilege?.userSelect === true },
    publicSchema: { create: privilege?.publicSchemaCreate === true, owner: privilege?.publicSchemaOwner === true },
    elevatedCapabilities: {
      superuser: privilege?.superuser === true,
      createRole: privilege?.createRole === true,
      createDb: privilege?.createDb === true,
      bypassRls: privilege?.bypassRls === true,
    },
  };
  if (separateRolePrivilege.result !== "PASS") fail(["secret_delivery_worker Outbox SELECT/UPDATE ve yalnız Tenant id/status/lifecycleVersion SELECT yetkisine sahip olmalı."]);

  const outboxResult = await pool.query(
    `SELECT "id", "purpose", "attempts", "status", "deliveredAt", "updatedAt", ("payloadEncrypted" IS NULL) AS "payloadCleared", ("providerMessageId" IS NOT NULL AND length("providerMessageId") BETWEEN 1 AND 512) AS "hasProviderReceipt"
     FROM "SecretDeliveryOutbox"
     WHERE "sourceId" = $1
     ORDER BY "createdAt" DESC
     LIMIT 1`,
    [sourceId],
  );
  const outbox = outboxResult.rows[0];
  if (!outbox) fail(["Secret delivery outbox staging smoke kaydı bulunamadı."]);
  if (outbox.status !== "DELIVERED") fail(["Secret delivery outbox Phase B success smoke kaydı DELIVERED durumda olmalı."]);
  if (outbox.attempts !== 1 || outbox.hasProviderReceipt !== true) fail(["Başarı kaydı tek deneme ve saklanmış sağlayıcı makbuzu taşımalı."]);
  if (outbox.payloadCleared !== true) fail(["Secret delivery outbox terminal kaydının payload'u temizlenmiş olmalı."]);
  if (!isFreshTimestamp(outbox.deliveredAt) || !isFreshTimestamp(outbox.updatedAt)) {
    fail(["Secret delivery outbox deliveredAt ve updatedAt 24 saat içindeki terminal kanıtı olmalı."]);
  }
  if (Date.parse(outbox.deliveredAt) < Date.parse(notBefore) || Date.parse(outbox.updatedAt) < Date.parse(notBefore)) {
    fail(["Secret delivery outbox terminal zamanları cutover sonrası NOT_BEFORE zamanından önce olamaz."]);
  }

  const uncertain = (await pool.query(`SELECT "id", "status", "attempts", "updatedAt" FROM "SecretDeliveryOutbox" WHERE "sourceId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [uncertainSourceId])).rows[0];
  const observedAgeSeconds = uncertain ? Math.floor((Date.now() - Date.parse(uncertain.updatedAt)) / 1000) : -1;
  if (!uncertain || uncertain.id === outbox.id || uncertain.status !== "UNCERTAIN" || uncertain.attempts !== 1 || observedAgeSeconds < 300 || Date.parse(uncertain.updatedAt) < Date.parse(notBefore)) fail(["Ayrı belirsiz kayıt cutover sonrası en az 300 saniyelik UNCERTAIN/tek-deneme durumu taşımalı."]);
  // This is observed DB row-state stability, not proof that a provider stopped or a worker was running.
  const evidence = {
    schemaVersion: 2,
    result: "PASS",
    check: "secret_delivery_outbox_staging_smoke",
    environment,
    generatedAt: new Date().toISOString(),
    releaseImageTag,
    notBefore,
    outboxRecordHash: sha256(outbox.id),
    purpose: outbox.purpose,
    retry: { attempts: outbox.attempts, retried: false },
    retainedUncertain: { recordHash: sha256(uncertain.id), attempts: 1, status: "UNCERTAIN", observedAgeSeconds },
    hasProviderReceipt: true,
    terminalStatus: "DELIVERED",
    payloadCleared: true,
    deliveredAt: new Date(outbox.deliveredAt).toISOString(),
    updatedAt: new Date(outbox.updatedAt).toISOString(),
    separateRolePrivilege,
    commandsPassed: ["pnpm secret-delivery-outbox:staging:smoke"],
    gaps: [],
  };
  await mkdir(dirname(resolve(evidenceFile)), { recursive: true });
  await writeFile(resolve(evidenceFile), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log("Secret delivery outbox staging smoke geçti; hassas teslim verisi artifact'a yazılmadı.");
} finally {
  await pool.end();
}

function hasExpectedPrivileges(value) {
  return value?.role === "secret_delivery_worker" && value.select === true && value.update === true && value.insert === false && value.delete === false && value.truncate === false && value.userSelect === false && value.tenantIdSelect === true && value.tenantStatusSelect === true && value.tenantEpochSelect === true && value.tenantOtherSelect === false && value.tenantWrite === false && value.publicSchemaCreate === false && value.publicSchemaOwner === false && value.superuser === false && value.createRole === false && value.createDb === false && value.bypassRls === false;
}

function isFreshTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 5 * 60 * 1000 && Date.now() - timestamp <= 24 * 60 * 60 * 1000;
}

function isRecentCutoverTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 5 * 60 * 1000 && Date.now() - timestamp <= 24 * 60 * 60 * 1000;
}

async function readPrivateSourceId(file) {
  const stat = await lstat(file).catch(() => fail(["SECRET_DELIVERY_OUTBOX_SMOKE_SOURCE_FILE symlink olmayan private regular dosya olmalı."]));
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    fail(["SECRET_DELIVERY_OUTBOX_SMOKE_SOURCE_FILE symlink olmayan 0600 regular dosya olmalı."]);
  }
  const value = (await readFile(file, "utf8")).trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(value)) fail(["Private outbox source dosyası geçerli opaque source ID içermeli."]);
  return value;
}

function isReleaseImageTag(value) {
  return typeof value === "string" && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(messages) {
  console.error("Secret delivery outbox staging smoke başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
