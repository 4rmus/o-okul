import { requireNoTenantMutationActivity } from "./tenant-mutation-activity.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { DeleteObjectCommand, GetObjectCommand, GetBucketVersioningCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { licenseExpiryPurgeRowCount } from "./tenant-expiry-purge.js";
import { assertResetWorkerRole, freshResetFinished, freshResetStatus, isLicenseExpiryPurge, purgeResetDatabase, requireResetLegalClearance, requireResetWriteQuiescence, resetAudit, verifyResetPostconditions, type FreshResetOperation } from "./tenant-fresh-reset.js";
import { withTenantDb, tenantDatabaseLockKey, type Queryable, type TenantQueryable } from "./tenant-db.js";
import { createAndVerifyTenantResetBackup, recoverTenantResetBackup, decryptResetPackage, resetBytesHash, verifyResetPackage, type TenantResetBackupConfig, type TenantResetPackage } from "./tenant-reset-backup.js";
import { resetDigest } from "./tenant-reset-catalog.js";
import { resetObjectInventory, resetPreflightDigest, resetS3Client, resetS3Config } from "./tenant-reset-objects.js";
import { withResetSnapshot } from "./tenant-reset-snapshot.js";

export interface FreshResetServices {
  clearance: typeof requireResetLegalClearance;
  quiescence(tenantId: string): Promise<void>;
  preflight(op: FreshResetOperation): Promise<void>;
  backup(op: FreshResetOperation): Promise<Record<string, unknown>>;
  package(op: FreshResetOperation): Promise<TenantResetPackage>;
  deleteObjects(pkg: TenantResetPackage, fence: () => Promise<void>): Promise<void>;
  verifyObjects(pkg: TenantResetPackage, fence: () => Promise<void>): Promise<void>;
}
// Advisory session lock covers backup and all phases. A crashed connection releases
// it; DB phase checkpoint and purge commit together, so retries never repeat purge.
export async function runFreshReset(pool: TenantQueryable, tenantId: string, operationId: string, services: FreshResetServices) {
  if (!/^[a-f0-9]{32}$/.test(operationId) || !tenantId || tenantId === "system" || !pool.connect) throw new Error("RESET_TARGET_INVALID");
  const tenantLockKey = tenantDatabaseLockKey(tenantId);
  const db = await pool.connect();
  let locked = false;
  let tenantLocked = false;
  const tx = <T>(run: (db: Queryable) => Promise<T>) => withTenantDb({ query: db.query.bind(db), connect: async () => ({ query: db.query.bind(db), release() {} }) }, { tenantId }, run);
  const read = () => tx(async (db) => (await db.query<FreshResetOperation>('SELECT * FROM "TenantFreshResetOperation" WHERE "id" = $1 AND "tenantId" = $2', [operationId, tenantId])).rows[0]);
  try {
    await assertResetWorkerRole(db);
    const lock = await db.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 1)) AS locked', [operationId]);
    if (lock.rows[0]?.locked !== true) throw new Error("RESET_OPERATION_BUSY");
    locked = true;
    const tenantLock = await db.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [tenantLockKey]);
    if (tenantLock.rows[0]?.locked !== true) throw new Error("RESET_TENANT_DATABASE_BUSY");
    tenantLocked = true;
    let op = await read();
    if (!op) throw new Error("RESET_OPERATION_NOT_FOUND");
    if (freshResetFinished(op)) return freshResetStatus(op);
    await tx(async (db) => { await requireNoTenantMutationActivity(db, tenantId); await services.clearance(tenantId, db, op); });
    await services.quiescence(tenantId);
    if (!["OBJECTS", "VERIFY"].includes(op.phase)) {
      await services.preflight(op);
      if (!op.backupReceipt) {
        await tx((db) => updatePhase(db, op!, "RUNNING", "BACKUP"));
        const receipt = await services.backup(op);
        await tx(async (db) => {
          await db.query('UPDATE "TenantFreshResetOperation" SET "backupReceipt" = $3::jsonb, "updatedAt" = now() WHERE "id" = $1 AND "tenantId" = $2', [operationId, tenantId, JSON.stringify(receipt)]);
          await updatePhase(db, op!, "RUNNING", "DATABASE");
        });
        op = (await read())!;
      }
      const pkg = await services.package(op);
      await services.preflight(op);
      await tx(async (db) => {
        const count = await purgeResetDatabase(db, op!, pkg.manifest.dataDigest, services.clearance, services.quiescence);
        const result = { preservedOwnerCount: count, deletedObjectCount: pkg.manifest.objects.length, ...(isLicenseExpiryPurge(op!) ? { deletedRowCount: licenseExpiryPurgeRowCount(pkg.manifest.tables) } : {}) };
        await db.query('UPDATE "TenantFreshResetOperation" SET "result" = $3::jsonb WHERE "id" = $1 AND "tenantId" = $2', [operationId, tenantId, JSON.stringify(result)]);
        await updatePhase(db, op!, "RUNNING", "OBJECTS");
      });
      op = (await read())!;
    }
    const pkg = await services.package(op);
    await tx(async (db) => { await requireNoTenantMutationActivity(db, tenantId); await services.clearance(tenantId, db, op); });
    await services.quiescence(tenantId);
    await services.deleteObjects(pkg, async () => { await db.query("SELECT 1"); });
    await services.verifyObjects(pkg, async () => { await db.query("SELECT 1"); });
    await tx(async (db) => {
      const tenant = await db.query<{ status: string; lifecycleVersion: number }>('SELECT "status", "lifecycleVersion" FROM "Tenant" WHERE "id" = $1 FOR UPDATE', [tenantId]);
      if (tenant.rows[0]?.status !== "SUSPENDED" || tenant.rows[0].lifecycleVersion !== op!.expectedLifecycleVersion) throw new Error("RESET_SOURCE_CHANGED");
      await verifyResetPostconditions(db, op!, op!.result?.preservedOwnerCount ?? 0);
      await requireNoTenantMutationActivity(db, tenantId);
      await services.clearance(tenantId, db, op);
    await services.quiescence(tenantId);
      // Completed first inside the SAME transaction satisfies the activation trigger.
      await updatePhase(db, op!, "COMPLETED", "DONE");
      if (isLicenseExpiryPurge(op!)) {
        // The purged tenant stays a SUSPENDED tombstone. Phase records go; one system-scope receipt remains.
        await db.query("SELECT o_okul_license_expiry_purge($1, $2, true)", [tenantId, operationId]);
        return;
      }
      await db.query('UPDATE "Tenant" SET "resetRequest" = jsonb_set("resetRequest", \'{status}\', \'"COMPLETED"\'::jsonb) WHERE "id" = $1', [tenantId]);
      const activated = await db.query('UPDATE "Tenant" SET "status" = \'ACTIVE\', "lifecycleVersion" = "lifecycleVersion" + 1, "suspendedAt" = NULL, "suspendedReason" = NULL, "updatedAt" = now() WHERE "id" = $1 AND "status" = \'SUSPENDED\' AND "lifecycleVersion" = $2 RETURNING "id"', [tenantId, op!.expectedLifecycleVersion]);
      if (!activated.rows.length) throw new Error("RESET_SOURCE_CHANGED");
      await resetAudit(db, op!, "tenant.reset.completed", { ...op!.result, lifecycleVersion: op!.expectedLifecycleVersion + 1 });
    });
    return freshResetStatus((await read())!);
  } catch (error) {
    // Reread after ambiguous COMMIT; never overwrite a committed completion or phase.
    const code = error instanceof Error && /^RESET_[A-Z_]+$/.test(error.message) ? error.message : "RESET_EXECUTION_FAILED";
    if (locked && tenantLocked) {
      try { await tx(async (db) => {
        const current = (await db.query<FreshResetOperation>('SELECT * FROM "TenantFreshResetOperation" WHERE "id" = $1 AND "tenantId" = $2 FOR UPDATE', [operationId, tenantId])).rows[0];
        // A renewed license stops a purge whose database phase has not committed; the tenant can be reactivated.
        const cancel = current && code === "RESET_LICENSE_NOT_EXPIRED" && isLicenseExpiryPurge(current) && ["PREFLIGHT", "BACKUP", "DATABASE"].includes(current.phase);
        if (current && !freshResetFinished(current)) await updatePhase(db, current, cancel ? "CANCELLED" : /UNVERIFIED|REQUIRED|INVALID|BLOCKED/.test(code) ? "BLOCKED" : "FAILED", current.phase, code);
      }); } catch { /* A lost DB connection is reconciled by the same durable operation. */ }
    }
    throw new Error(code);
  } finally {
    if (tenantLocked) { try { await db.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [tenantLockKey]); } catch {} }
    if (locked) { try { await db.query('SELECT pg_advisory_unlock(hashtextextended($1, 1))', [operationId]); } catch {} }
    // Reset sessions are rare; discard even after ambiguous lock/unlock responses.
    db.release(true);
  }
}
async function updatePhase(db: Queryable, op: FreshResetOperation, status: FreshResetOperation["status"], phase: FreshResetOperation["phase"], errorCode: string | null = null) {
  const updated = await db.query('UPDATE "TenantFreshResetOperation" SET "status" = $3, "phase" = $4, "errorCode" = $5, "updatedAt" = now() WHERE "id" = $1 AND "tenantId" = $2 AND "status" NOT IN (\'COMPLETED\', \'CANCELLED\') RETURNING "id"', [op.id, op.tenantId, status, phase, errorCode]);
  if (!updated.rows.length) throw new Error("RESET_OPERATION_CHANGED");
  await resetAudit(db, op, "tenant.reset.phase", { status, phase, errorCode });
}
export function resetWorkerDatabaseUrl(): string {
  const url = process.env.TENANT_RESET_DATABASE_URL;
  if (!url || decodeURIComponent(new URL(url).username) !== "o_okul_reset_worker") throw new Error("RESET_DATABASE_ROLE_INVALID");
  return url;
}
export function createFreshResetServices(queueCheck: (tenantId: string, operationId: string) => Promise<void>): FreshResetServices {
  const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error("RESET_OPERATIONS_PREREQUISITE_REQUIRED"); return value; };
  const config = (op: FreshResetOperation): TenantResetBackupConfig => {
    const purge = isLicenseExpiryPurge(op);
    if (!purge && (!op.institutionRequestId || !/^[a-f0-9]{32}$/.test(op.institutionRequestId))) throw new Error("RESET_INSTITUTION_REQUEST_REQUIRED");
    return ({ tenantId: op.tenantId, operationId: op.id, excludeCurrentOperation: true, approvalReference: purge ? `license-expiry-purge:${op.id}` : `institution-request:${op.institutionRequestId}`, encryptionKey: Buffer.from(required("TENANT_RESET_BACKUP_KEY_BASE64"), "base64"), sourceDatabaseUrl: required("TENANT_RESET_BACKUP_SOURCE_DATABASE_URL"), restoreDatabaseUrl: required("TENANT_RESET_RESTORE_DATABASE_URL"), sourceObjects: resetS3Config("TENANT_RESET_SOURCE_S3"), backupObjects: resetS3Config("TENANT_RESET_BACKUP_S3"), restoreObjects: resetS3Config("TENANT_RESET_RESTORE_S3") });
  };
  const sign = signResetRestoreReceipt;
  async function sourceCheck(op: FreshResetOperation) {
    const cfg = config(op);
    const source = new pg.Pool({ connectionString: cfg.sourceDatabaseUrl });
    const s3 = resetS3Client(cfg.sourceObjects);
    try {
      const role = await source.query<{ valid: boolean }>(`SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT has_schema_privilege(current_user, 'public', 'CREATE') AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND (c.relowner = r.oid OR has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'))) AS valid FROM pg_roles r WHERE rolname = current_user`);
      if (role.rows[0]?.valid !== true) throw new Error("RESET_BACKUP_SOURCE_ROLE_INVALID");
      if ((await s3.send(new GetBucketVersioningCommand({ Bucket: cfg.sourceObjects.bucket }))).Status) throw new Error("RESET_VERSIONED_SOURCE_UNVERIFIED");
      await queueCheck(op.tenantId, op.id);
      await withResetSnapshot(source, op.tenantId, async (snapshot) => {
        const objects = await resetObjectInventory(snapshot, s3, cfg.sourceObjects.bucket);
        // The write-drain gate remains independently fail-closed.
        // An authoritative future provider must produce the same validated preview contract.
        if (resetPreflightDigest(snapshot, objects, [], cfg.sourceObjects) !== op.preflightDigest) throw new Error("RESET_PREFLIGHT_CHANGED");
      }, op.id);
    } finally { await source.end(); s3.destroy(); }
  }
  async function objects(pkg: TenantResetPackage, remove: boolean, fence: () => Promise<void>) {
    const cfg = resetS3Config("TENANT_RESET_SOURCE_S3"); const s3 = resetS3Client(cfg);
    try {
      for (const object of pkg.manifest.objects) {
        await fence();
        let head;
        try { head = await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: object.key })); }
        catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) continue; throw new Error("RESET_OBJECT_STATE_UNVERIFIED"); }
        if (!remove) throw new Error("RESET_OBJECT_STILL_PRESENT");
        if (!head.ETag || head.VersionId || head.ContentLength !== object.size) throw new Error("RESET_OBJECT_CHANGED");
        const found = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: object.key, IfMatch: head.ETag }));
        if (!found.Body || resetBytesHash(await found.Body.transformToByteArray()) !== object.sha256) throw new Error("RESET_OBJECT_CHANGED");
        await fence();
        await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: object.key, IfMatch: head.ETag }));
      }
    } finally { s3.destroy(); }
  }
  return {
    clearance: requireResetLegalClearance, quiescence: requireResetWriteQuiescence,
    preflight: sourceCheck,
    async backup(op) {
      const cfg = config(op);
      const verified = await recoverTenantResetBackup(cfg) ?? await createAndVerifyTenantResetBackup(cfg);
      if (verified.lifecycleVersion !== op.expectedLifecycleVersion) throw new Error("RESET_SOURCE_CHANGED");
      const body = { tenantId: op.tenantId, operationId: op.id, preflightDigest: op.preflightDigest, expectedLifecycleVersion: op.expectedLifecycleVersion, verified };
      return { body, signature: sign(body, cfg.encryptionKey) };
    },
    async package(op) {
      const cfg = config(op); const receipt = op.backupReceipt;
      if (!receipt || typeof receipt.body !== "object" || !receipt.body || typeof receipt.signature !== "string" || !/^[a-f0-9]{64}$/.test(receipt.signature)) throw new Error("RESET_RECEIPT_UNVERIFIED");
      const body = receipt.body as { tenantId: string; operationId: string; preflightDigest: string; expectedLifecycleVersion: number; verified: Awaited<ReturnType<typeof createAndVerifyTenantResetBackup>> };
      if (!timingSafeEqual(Buffer.from(receipt.signature, "hex"), Buffer.from(sign(body, cfg.encryptionKey), "hex")) || body.tenantId !== op.tenantId || body.operationId !== op.id || body.preflightDigest !== op.preflightDigest || body.expectedLifecycleVersion !== op.expectedLifecycleVersion || body.verified.result !== "VERIFIED" || body.verified.operationId !== op.id) throw new Error("RESET_RECEIPT_UNVERIFIED");
      const s3 = resetS3Client(cfg.backupObjects);
      try {
        const saved = await s3.send(new GetObjectCommand({ Bucket: cfg.backupObjects.bucket, Key: `tenant-reset-backups/${op.id}.bin` }));
        if (!saved.Body) throw new Error("RESET_PACKAGE_INTEGRITY_FAILED");
        const bytes = Buffer.from(await saved.Body.transformToByteArray());
        if (resetBytesHash(bytes) !== body.verified.packageSha256) throw new Error("RESET_PACKAGE_INTEGRITY_FAILED");
        const pkg: TenantResetPackage = JSON.parse(decryptResetPackage(bytes, cfg.encryptionKey).toString("utf8"));
        verifyResetPackage(pkg, { ...pkg.manifest, tenantId: op.tenantId, lifecycleVersion: op.expectedLifecycleVersion, schemaDigest: body.verified.schemaDigest, dataDigest: body.verified.dataDigest });
        const sourceDb = new URL(cfg.sourceDatabaseUrl);
        const sourceIdentity = resetDigest({ database: { host: sourceDb.hostname, port: sourceDb.port || "5432", database: sourceDb.pathname }, objects: { endpoint: cfg.sourceObjects.endpoint, bucket: cfg.sourceObjects.bucket } });
        if (pkg.manifest.sourceIdentity !== sourceIdentity) throw new Error("RESET_SOURCE_CHANGED");
        if (pkg.manifest.digestOperationId !== op.id || resetDigest(pkg.manifest) !== body.verified.manifestSha256) throw new Error("RESET_RECEIPT_UNVERIFIED");
        return pkg;
      } finally { s3.destroy(); }
    },
    deleteObjects: (pkg, fence) => objects(pkg, true, fence), verifyObjects: (pkg, fence) => objects(pkg, false, fence),
  };
}

export function signResetRestoreReceipt(body: object, key: Buffer): string { return createHmac("sha256", key).update(`TENANT_RESET_RESTORE_RECEIPT_V1:${resetDigest(body)}`).digest("hex"); }
