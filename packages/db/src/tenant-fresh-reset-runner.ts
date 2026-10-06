import { requireNoTenantMutationActivity } from "./tenant-mutation-activity.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { DeleteObjectCommand, GetObjectCommand, GetBucketVersioningCommand, HeadObjectCommand, ListObjectVersionsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
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
  /** License-expiry purge only: removes the encrypted reset backup package (with its attestation) and the
   * restore-verify drill copies (database + restore bucket objects); each flag is true only when absence is proven. */
  deleteBackup(op: FreshResetOperation): Promise<PurgeBackupDeletion>;
}
export interface PurgeBackupDeletion { backupPackageDeleted: boolean; drillTargetsDeleted: boolean }
const prePurgePhases: ReadonlyArray<FreshResetOperation["phase"]> = ["PREFLIGHT", "BACKUP", "DATABASE"];
/** Security review 2026-10-06: a purge that ended before its database phase committed keeps no backup copy.
 * CANCELLED (license renewed) or FAILED/BLOCKED and not auto-retried (RESET_EXECUTION_FAILED is retried).
 * After the database phase the package stays: it is the only way back. */
export function purgeBackupCleanupDue(op: FreshResetOperation): boolean {
  if (!isLicenseExpiryPurge(op) || !prePurgePhases.includes(op.phase)) return false;
  if (!(op.status === "CANCELLED" || op.status === "BLOCKED" || (op.status === "FAILED" && op.errorCode !== "RESET_EXECUTION_FAILED"))) return false;
  return !(op.result?.backupPackageDeleted === true && op.result.drillTargetsDeleted === true);
}
async function recordPurgeBackupDeletion(db: Queryable, op: FreshResetOperation, deleted: PurgeBackupDeletion) {
  await db.query('UPDATE "TenantFreshResetOperation" SET "result" = coalesce("result", \'{}\'::jsonb) || $3::jsonb, "updatedAt" = now() WHERE "id" = $1 AND "tenantId" = $2', [op.id, op.tenantId, JSON.stringify(deleted)]);
  await resetAudit(db, op, "tenant.reset.backup-deletion", deleted);
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
  // Never throws: an unproven deletion is recorded as false and listed in the reset diagnostics.
  const removeBackup = async (op: FreshResetOperation): Promise<PurgeBackupDeletion> => {
    let deleted: PurgeBackupDeletion = { backupPackageDeleted: false, drillTargetsDeleted: false };
    try { deleted = await services.deleteBackup(op); } catch { /* recorded as not deleted */ }
    await tx((db) => recordPurgeBackupDeletion(db, op, deleted));
    return deleted;
  };
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
    // A purge whose backup or drill copies were removed after it ended before the database phase never resumes.
    if (isLicenseExpiryPurge(op) && prePurgePhases.includes(op.phase) && (op.result?.backupPackageDeleted === true || op.result?.drillTargetsDeleted === true)) throw new Error("RESET_BACKUP_DELETED");
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
        // The handover export ledger lives in the tenant AuditLog, which the purge deletes: read it first.
        const handover = (isLicenseExpiryPurge(op!) ? await services.clearance(tenantId, db, op) : undefined) as { exportId: string; deliveredOn: string } | undefined;
        const count = await purgeResetDatabase(db, op!, pkg.manifest.dataDigest, services.clearance, services.quiescence);
        const result = { preservedOwnerCount: count, deletedObjectCount: pkg.manifest.objects.length, ...(isLicenseExpiryPurge(op!) ? { deletedRowCount: licenseExpiryPurgeRowCount(pkg.manifest.tables), exportId: handover?.exportId ?? null, exportDeliveredOn: handover?.deliveredOn ?? null } : {}) };
        await db.query('UPDATE "TenantFreshResetOperation" SET "result" = $3::jsonb WHERE "id" = $1 AND "tenantId" = $2', [operationId, tenantId, JSON.stringify(result)]);
        await updatePhase(db, op!, "RUNNING", "OBJECTS");
      });
      op = (await read())!;
    }
    const purge = isLicenseExpiryPurge(op);
    const verify = async (db: Queryable) => {
      const tenant = await db.query<{ status: string; lifecycleVersion: number }>('SELECT "status", "lifecycleVersion" FROM "Tenant" WHERE "id" = $1 FOR UPDATE', [tenantId]);
      if (tenant.rows[0]?.status !== "SUSPENDED" || tenant.rows[0].lifecycleVersion !== op!.expectedLifecycleVersion) throw new Error("RESET_SOURCE_CHANGED");
      await verifyResetPostconditions(db, op!, op!.result?.preservedOwnerCount ?? 0);
      await requireNoTenantMutationActivity(db, tenantId);
      await services.clearance(tenantId, db, op);
      await services.quiescence(tenantId);
    };
    // A purge at VERIFY already proved its objects gone and may have deleted the backup package it would read.
    if (!(purge && op.phase === "VERIFY")) {
      const pkg = await services.package(op);
      await tx(async (db) => { await requireNoTenantMutationActivity(db, tenantId); await services.clearance(tenantId, db, op); });
      await services.quiescence(tenantId);
      await services.deleteObjects(pkg, async () => { await db.query("SELECT 1"); });
      await services.verifyObjects(pkg, async () => { await db.query("SELECT 1"); });
      // Purge VERIFY passed: committed before the backup package goes. A failure above keeps the package.
      if (purge) await tx(async (db) => { await verify(db); await updatePhase(db, op!, "RUNNING", "VERIFY"); });
    }
    // Product owner decision (2026-10-05, completed by the 2026-10-06 security review): right after a successful
    // purge VERIFY the encrypted backup package AND the restore-verify drill copies go; each absence is proven
    // and recorded separately. Idempotent, so a retry at VERIFY simply repeats it.
    if (purge) {
      const deleted = await removeBackup(op);
      if (!deleted.backupPackageDeleted || !deleted.drillTargetsDeleted) throw new Error("RESET_BACKUP_DELETE_UNVERIFIED");
    }
    await tx(async (db) => {
      await verify(db);
      // Completed first inside the SAME transaction satisfies the activation trigger.
      await updatePhase(db, op!, "COMPLETED", "DONE");
      if (purge) {
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
      let cancelled: FreshResetOperation | undefined;
      try { cancelled = await tx(async (db) => {
        const current = (await db.query<FreshResetOperation>('SELECT * FROM "TenantFreshResetOperation" WHERE "id" = $1 AND "tenantId" = $2 FOR UPDATE', [operationId, tenantId])).rows[0];
        // A renewed license stops a purge whose database phase has not committed; the tenant can be reactivated.
        const cancel = current && code === "RESET_LICENSE_NOT_EXPIRED" && isLicenseExpiryPurge(current) && prePurgePhases.includes(current.phase);
        if (current && !freshResetFinished(current)) await updatePhase(db, current, cancel ? "CANCELLED" : /UNVERIFIED|REQUIRED|INVALID|BLOCKED/.test(code) ? "BLOCKED" : "FAILED", current.phase, code);
        return cancel ? current : undefined;
      }); } catch { /* A lost DB connection is reconciled by the same durable operation. */ }
      // Security review 2026-10-06: the cancelled purge's backup and drill copies go too; failures stay listed.
      if (cancelled) { try { await removeBackup(cancelled); } catch { /* the backup cleanup job retries */ } }
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
/** Backup cleanup job for a purge that ended before its database phase (see purgeBackupCleanupDue). */
export async function cleanupPurgeBackup(pool: TenantQueryable, tenantId: string, operationId: string, services: Pick<FreshResetServices, "deleteBackup">): Promise<PurgeBackupDeletion | undefined> {
  if (!/^[a-f0-9]{32}$/.test(operationId) || !tenantId || tenantId === "system" || !pool.connect) throw new Error("RESET_TARGET_INVALID");
  const db = await pool.connect();
  let locked = false;
  const tx = <T>(run: (db: Queryable) => Promise<T>) => withTenantDb({ query: db.query.bind(db), connect: async () => ({ query: db.query.bind(db), release() {} }) }, { tenantId }, run);
  try {
    await assertResetWorkerRole(db);
    // Same operation lock as runFreshReset: a cleanup never overlaps a run of the same operation.
    if ((await db.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 1)) AS locked', [operationId])).rows[0]?.locked !== true) throw new Error("RESET_OPERATION_BUSY");
    locked = true;
    const op = await tx(async (db) => (await db.query<FreshResetOperation>('SELECT * FROM "TenantFreshResetOperation" WHERE "id" = $1 AND "tenantId" = $2', [operationId, tenantId])).rows[0]);
    if (!op || !purgeBackupCleanupDue(op)) return undefined;
    let deleted: PurgeBackupDeletion = { backupPackageDeleted: false, drillTargetsDeleted: false };
    try { deleted = await services.deleteBackup(op); } catch { /* recorded as not deleted */ }
    await tx((db) => recordPurgeBackupDeletion(db, op, deleted));
    return deleted;
  } finally {
    if (locked) { try { await db.query('SELECT pg_advisory_unlock(hashtextextended($1, 1))', [operationId]); } catch {} }
    db.release(true);
  }
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
      // A purge deletes its backup after VERIFY; a versioned bucket would keep the data as an old version.
      if (isLicenseExpiryPurge(op)) await assertUnversionedBackupBucket(cfg.backupObjects);
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
    async deleteBackup(op) {
      const cfg = config(op);
      const deleted: PurgeBackupDeletion = { backupPackageDeleted: false, drillTargetsDeleted: false };
      const backup = resetS3Client(cfg.backupObjects);
      try { await deleteResetBackupPackage(backup, cfg.backupObjects.bucket, op.id); deleted.backupPackageDeleted = true; } catch { /* stays false */ } finally { backup.destroy(); }
      // ponytail: the drill database is dropped from the restore server's "postgres" maintenance database by the
      // restore role, which must own o_okul_reset_drill_{operationId}. Add a dedicated admin URL if that ever differs.
      const adminUrl = new URL(cfg.restoreDatabaseUrl); adminUrl.pathname = "/postgres";
      const admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 1 });
      const restore = resetS3Client(cfg.restoreObjects);
      try { await deleteResetDrillTargets(admin, restore, op.id); deleted.drillTargetsDeleted = true; } catch { /* stays false */ } finally { await admin.end().catch(() => {}); restore.destroy(); }
      return deleted;
    },
  };
}
async function assertUnversionedBackupBucket(cfg: ReturnType<typeof resetS3Config>) {
  const s3 = resetS3Client(cfg);
  try { if ((await s3.send(new GetBucketVersioningCommand({ Bucket: cfg.bucket }))).Status) throw new Error("RESET_VERSIONED_BACKUP_UNVERIFIED"); } finally { s3.destroy(); }
}
/** Deletes the encrypted package and its restore attestation, then proves both keys answer 404. */
export async function deleteResetBackupPackage(s3: { send(command: unknown): Promise<unknown> }, bucket: string, operationId: string): Promise<void> {
  if (!/^[a-f0-9]{32}$/.test(operationId)) throw new Error("RESET_TARGET_INVALID");
  if ((await s3.send(new GetBucketVersioningCommand({ Bucket: bucket })) as { Status?: string }).Status) throw new Error("RESET_VERSIONED_BACKUP_UNVERIFIED");
  for (const key of [`tenant-reset-backups/${operationId}.bin`, `tenant-reset-backups/${operationId}.restore-verified.json`]) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); }
    catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) continue; throw new Error("RESET_BACKUP_DELETE_UNVERIFIED"); }
    throw new Error("RESET_BACKUP_DELETE_UNVERIFIED");
  }
}

/** Drops o_okul_reset_drill_{operationId} and empties o-okul-reset-drill-{operationId} (all versions), then
 * proves both absent. Names come from the validated operation id, never from configuration. */
export async function deleteResetDrillTargets(admin: Queryable, s3: { send(command: unknown): Promise<unknown> }, operationId: string): Promise<void> {
  if (!/^[a-f0-9]{32}$/.test(operationId)) throw new Error("RESET_TARGET_INVALID");
  const database = `o_okul_reset_drill_${operationId}`, bucket = `o-okul-reset-drill-${operationId}`;
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  if ((await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database])).rows.length) throw new Error("RESET_DRILL_DELETE_UNVERIFIED");
  const missingBucket = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404 || (error as { name?: string }).name === "NoSuchBucket";
  try {
    // ponytail: 1000 keys per round, bounded; a drill bucket holds one tenant's objects.
    for (let round = 0; round < 10_000; round++) {
      const versions = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, MaxKeys: 1000 })) as { Versions?: Array<{ Key?: string; VersionId?: string }>; DeleteMarkers?: Array<{ Key?: string; VersionId?: string }> };
      const current = await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000 })) as { Contents?: Array<{ Key?: string }> };
      const targets = [...(versions.Versions ?? []), ...(versions.DeleteMarkers ?? []), ...(current.Contents ?? [])] as Array<{ Key?: string; VersionId?: string }>;
      // Absence proof: no current object, no old version and no delete marker remains.
      if (!targets.length) return;
      for (const target of targets) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: target.Key, ...(target.VersionId && target.VersionId !== "null" ? { VersionId: target.VersionId } : {}) }));
    }
  } catch (error) { if (missingBucket(error)) return; throw new Error("RESET_DRILL_DELETE_UNVERIFIED"); }
  throw new Error("RESET_DRILL_DELETE_UNVERIFIED");
}

export function signResetRestoreReceipt(body: object, key: Buffer): string { return createHmac("sha256", key).update(`TENANT_RESET_RESTORE_RECEIPT_V1:${resetDigest(body)}`).digest("hex"); }
