import { randomUUID } from "node:crypto";
import { withTenantDb, type Queryable, type TenantQueryable } from "./tenant-db.js";
export interface TenantMutationAdmission { tenantId: string; lifecycleVersion: number; referenceId?: string; kind: "HTTP_MUTATION" | "S3_MUTATION" | "QUEUE_ADMISSION" | "WORKER_JOB" | "AUTH_MUTATION" | "ADMIN_MUTATION" | "PROVIDER_MUTATION"; source?: { type: "INVITATION" | "PASSWORD_RESET"; id: string; tokenHash: string; membershipVersion?: number }; actor?: { userId: string; sessionId: string; membershipVersion: number; platform?: boolean }; }
export type TenantMutationRunner = <T>(admission: TenantMutationAdmission, run: () => Promise<T>) => Promise<T>;
/** Durable in-flight evidence has no lease expiry: lost processes and uncertain remote effects require reconciliation. */
export async function runTenantMutationActivity<T>(pool: TenantQueryable, admission: TenantMutationAdmission, run: () => Promise<T>): Promise<T> {
  if (!pool.connect) throw new Error("TENANT_ACTIVITY_TRANSACTION_REQUIRED");
  if (!admission.tenantId || admission.tenantId === "system" || !Number.isInteger(admission.lifecycleVersion) || admission.lifecycleVersion < 0 || admission.lifecycleVersion > 2147483646 || !["HTTP_MUTATION", "S3_MUTATION", "QUEUE_ADMISSION", "WORKER_JOB", "AUTH_MUTATION", "ADMIN_MUTATION", "PROVIDER_MUTATION"].includes(admission.kind)) throw new Error("TENANT_ACTIVITY_CONTEXT_INVALID");
  if (admission.referenceId !== undefined && (typeof admission.referenceId !== "string" || !admission.referenceId || admission.referenceId.length > 512)) throw new Error("TENANT_ACTIVITY_CONTEXT_INVALID");
  const actor = admission.actor;
  if (!["WORKER_JOB", "AUTH_MUTATION"].includes(admission.kind) && (!actor || !actor.userId || !actor.sessionId || !Number.isInteger(actor.membershipVersion) || actor.membershipVersion < 1)) throw new Error("TENANT_ACTIVITY_CONTEXT_INVALID");
  const id = randomUUID();
  try { await withTenantDb(pool, { tenantId: admission.tenantId, bypassRls: admission.kind === "ADMIN_MUTATION" }, async (db) => {
    const tenant = (await db.query<{ status: string; lifecycleVersion: number }>('SELECT "status", "lifecycleVersion" FROM "Tenant" WHERE "id" = $1 FOR SHARE', [admission.tenantId])).rows[0];
    if (!tenant || (admission.kind === "ADMIN_MUTATION" ? !["ACTIVE", "SUSPENDED"].includes(tenant.status) : tenant.status !== "ACTIVE")) throw new Error("TENANT_ACTIVITY_INACTIVE");
    if (tenant.lifecycleVersion !== admission.lifecycleVersion) throw new Error("TENANT_ACTIVITY_STALE");
    if (admission.kind === "AUTH_MUTATION") {
      const source = admission.source;
      if (!source || !/^[a-f0-9]{64}$/.test(source.tokenHash) || !source.id) throw new Error("TENANT_ACTIVITY_CONTEXT_INVALID");
      const verified = source.type === "INVITATION"
        ? await db.query<{ id: string }>(`SELECT "id" FROM "IdentityInvitation" WHERE "id" = $1 AND "tenantId" = $2 AND "tokenHash" = $3 AND "status" = 'PENDING' AND "expiresAt" > now() FOR SHARE`, [source.id, admission.tenantId, source.tokenHash])
        : source.type === "PASSWORD_RESET" && Number.isInteger(source.membershipVersion)
        ? await db.query<{ id: string }>(`SELECT p."id" FROM "PasswordResetToken" p JOIN "User" u ON u."id" = p."userId" WHERE p."id" = $1 AND u."tenantId" = $2 AND p."tokenHash" = $3 AND p."status" = 'PENDING' AND p."expiresAt" > now() AND u."membershipVersion" = $4 FOR SHARE OF p,u`, [source.id, admission.tenantId, source.tokenHash, source.membershipVersion])
        : { rows: [] };
      if (verified.rows[0]?.id !== source.id) throw new Error("TENANT_ACTIVITY_ACTOR_STALE");
    }
    if (actor?.platform) {
      if (admission.kind !== "ADMIN_MUTATION") throw new Error("TENANT_ACTIVITY_CONTEXT_INVALID");
      const active = await db.query<{ id: string }>(`SELECT s."id" FROM "AuthSession" s JOIN "User" u ON u."id" = s."userId" WHERE s."tenantId" = 'system' AND u."tenantId" = s."tenantId" AND s."id" = $1 AND s."userId" = $2 AND s."membershipVersion" = $3 AND s."status" = 'ACTIVE' AND s."expiresAt" > now() AND 'SYSTEM_ADMIN' = ANY(s."roles") AND u."accountStatus" = 'ACTIVE' AND u."membershipVersion" = s."membershipVersion" FOR SHARE OF s,u`, [actor.sessionId, actor.userId, actor.membershipVersion]);
      if (active.rows[0]?.id !== actor.sessionId) throw new Error("TENANT_ACTIVITY_ACTOR_STALE");
    } else if (actor) {
      if (admission.kind === "ADMIN_MUTATION") throw new Error("TENANT_ACTIVITY_CONTEXT_INVALID");
      const active = await db.query<{ id: string }>(`SELECT s."id" FROM "AuthSession" s JOIN "User" u ON u."id" = s."userId" AND u."tenantId" = s."tenantId" JOIN "TenantMembership" m ON m."id" = s."membershipId" AND m."tenantId" = s."tenantId" AND m."userId" = s."userId" WHERE s."tenantId" = $1 AND s."id" = $2 AND s."userId" = $3 AND s."membershipVersion" = $4 AND s."status" = 'ACTIVE' AND s."expiresAt" > now() AND u."accountStatus" = 'ACTIVE' AND u."membershipVersion" = s."membershipVersion" AND m."version" = s."membershipVersion" AND m."status" = 'ACTIVE' AND m."startsAt" <= now() AND (m."endsAt" IS NULL OR m."endsAt" > now()) FOR SHARE OF s,u,m`, [admission.tenantId, actor.sessionId, actor.userId, actor.membershipVersion]);
      if (active.rows[0]?.id !== actor.sessionId) throw new Error("TENANT_ACTIVITY_ACTOR_STALE");
    }
    if (admission.referenceId) {
      const previous = await db.query('SELECT "id" FROM "TenantMutationActivity" WHERE "tenantId" = $1 AND "lifecycleVersion" = $2 AND "kind" = $3 AND "referenceId" = $4 LIMIT 1', [admission.tenantId, admission.lifecycleVersion, admission.kind, admission.referenceId]);
      if (previous.rows.length) throw new Error("TENANT_ACTIVITY_UNRESOLVED");
    }
    const inserted = await db.query<{ id: string }>('INSERT INTO "TenantMutationActivity" ("id", "tenantId", "lifecycleVersion", "kind", "status", "referenceId") VALUES ($1,$2,$3,$4,\'RUNNING\',$5) RETURNING "id"', [id, admission.tenantId, admission.lifecycleVersion, admission.kind, admission.referenceId ?? null]);
    if (inserted.rows[0]?.id !== id) throw new Error("TENANT_ACTIVITY_ADMISSION_UNVERIFIED");
  }); } catch (error) {
    if ((error as { code?: string; constraint?: string })?.code === "23505" && (error as { constraint?: string }).constraint === "TenantMutationActivity_reference_key") throw new Error("TENANT_ACTIVITY_UNRESOLVED");
    throw error;
  }
  let result: T;
  try { result = await run(); }
  catch (error) {
    try { await withTenantDb(pool, { tenantId: admission.tenantId }, async (db) => {
      const marked = await db.query<{ id: string }>('UPDATE "TenantMutationActivity" SET "status" = \'UNCERTAIN\' WHERE "id" = $1 AND "tenantId" = $2 AND "lifecycleVersion" = $3 RETURNING "id"', [id, admission.tenantId, admission.lifecycleVersion]);
      if (marked.rows[0]?.id !== id) throw new Error("TENANT_ACTIVITY_SETTLEMENT_UNVERIFIED");
    }); } catch { /* The durable RUNNING row still blocks reset if uncertainty could not be recorded. */ }
    throw error;
  }
  // Only known callback completion permits deletion. Lost cleanup ACK is an error,
  // but if COMMIT succeeded then absence is safe: the awaited work has already ended.
  await withTenantDb(pool, { tenantId: admission.tenantId }, async (db) => {
    const removed = await db.query<{ id: string }>('DELETE FROM "TenantMutationActivity" WHERE "id" = $1 AND "tenantId" = $2 AND "lifecycleVersion" = $3 AND "status" = \'RUNNING\' RETURNING "id"', [id, admission.tenantId, admission.lifecycleVersion]);
    if (removed.rows[0]?.id !== id) throw new Error("TENANT_ACTIVITY_SETTLEMENT_UNVERIFIED");
  });
  return result;
}

export async function requireNoTenantMutationActivity(db: Queryable, tenantId: string): Promise<void> {
  const active = await db.query<{ id: string }>('SELECT "id" FROM "TenantMutationActivity" WHERE "tenantId" = $1 LIMIT 1', [tenantId]);
  if (active.rows.length) throw new Error("RESET_MUTATION_ACTIVITY_PRESENT");
}
