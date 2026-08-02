import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { validateSmokeEvidenceOutputTarget } from "./smoke-evidence.mjs";

const databaseUrl = process.env.SECRET_DELIVERY_OUTBOX_DATABASE_URL;
const sourceId = process.env.SECRET_DELIVERY_OUTBOX_SMOKE_SOURCE_ID;
const evidenceFile = process.env.SECRET_DELIVERY_OUTBOX_SMOKE_EVIDENCE_FILE;
const notBefore = process.env.SECRET_DELIVERY_OUTBOX_NOT_BEFORE;
const releaseImageTag = process.env.SECRET_DELIVERY_OUTBOX_RELEASE_IMAGE_TAG;
const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV;

if (!databaseUrl) fail(["SECRET_DELIVERY_OUTBOX_DATABASE_URL boş bırakılamaz."]);
if (!sourceId) fail(["SECRET_DELIVERY_OUTBOX_SMOKE_SOURCE_ID boş bırakılamaz."]);
if (!evidenceFile) fail(["SECRET_DELIVERY_OUTBOX_SMOKE_EVIDENCE_FILE boş bırakılamaz."]);
if (!notBefore || !isRecentCutoverTimestamp(notBefore)) fail(["SECRET_DELIVERY_OUTBOX_NOT_BEFORE cutover sonrası son 15 dakika içinde bir ISO zaman olmalı."]);
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
    otherTables: { userSelect: privilege?.userSelect === true },
    publicSchema: { create: privilege?.publicSchemaCreate === true, owner: privilege?.publicSchemaOwner === true },
    elevatedCapabilities: {
      superuser: privilege?.superuser === true,
      createRole: privilege?.createRole === true,
      createDb: privilege?.createDb === true,
      bypassRls: privilege?.bypassRls === true,
    },
  };
  if (separateRolePrivilege.result !== "PASS") fail(["secret_delivery_worker yalnız SecretDeliveryOutbox SELECT/UPDATE yetkisine sahip olmalı."]);

  const outboxResult = await pool.query(
    `SELECT "id", "purpose", "attempts", "status", "deliveredAt", "updatedAt", ("payloadEncrypted" IS NULL) AS "payloadCleared"
     FROM "SecretDeliveryOutbox"
     WHERE "sourceId" = $1
     ORDER BY "createdAt" DESC
     LIMIT 1`,
    [sourceId],
  );
  const outbox = outboxResult.rows[0];
  if (!outbox) fail(["Secret delivery outbox staging smoke kaydı bulunamadı."]);
  if (outbox.status !== "DELIVERED") fail(["Secret delivery outbox Phase B success smoke kaydı DELIVERED durumda olmalı."]);
  if (outbox.attempts < 2) fail(["Secret delivery outbox kaydı retry kanıtı için en az iki deneme içermeli."]);
  if (outbox.payloadCleared !== true) fail(["Secret delivery outbox terminal kaydının payload'u temizlenmiş olmalı."]);
  if (!isFreshTimestamp(outbox.deliveredAt) || !isFreshTimestamp(outbox.updatedAt)) {
    fail(["Secret delivery outbox deliveredAt ve updatedAt 24 saat içindeki terminal kanıtı olmalı."]);
  }
  if (Date.parse(outbox.deliveredAt) < Date.parse(notBefore) || Date.parse(outbox.updatedAt) < Date.parse(notBefore)) {
    fail(["Secret delivery outbox terminal zamanları cutover sonrası NOT_BEFORE zamanından önce olamaz."]);
  }

  const evidence = {
    schemaVersion: 1,
    result: "PASS",
    check: "secret_delivery_outbox_staging_smoke",
    environment,
    generatedAt: new Date().toISOString(),
    releaseImageTag,
    notBefore,
    outboxRecordHash: sha256(outbox.id),
    purpose: outbox.purpose,
    retry: { attempts: outbox.attempts, retried: true },
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
  return value?.role === "secret_delivery_worker" && value.select === true && value.update === true && value.insert === false && value.delete === false && value.truncate === false && value.userSelect === false && value.publicSchemaCreate === false && value.publicSchemaOwner === false && value.superuser === false && value.createRole === false && value.createDb === false && value.bypassRls === false;
}

function isFreshTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 5 * 60 * 1000 && Date.now() - timestamp <= 24 * 60 * 60 * 1000;
}

function isRecentCutoverTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 5 * 60 * 1000 && Date.now() - timestamp <= 15 * 60 * 1000;
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
