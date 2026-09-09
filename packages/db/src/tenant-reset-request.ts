import { randomBytes, randomUUID } from "node:crypto";
import { withTenantDb, type Queryable, type TenantQueryable } from "./tenant-db.js";

export interface InstitutionResetRequest {
  id: string; tenantId: string; requestedBy: string; requestedAt: string; lifecycleVersion: number;
  status: "PENDING" | "REVOKED" | "ACCEPTED" | "COMPLETED"; operationId: string | null;
}
export function parseInstitutionResetRequest(value: unknown): InstitutionResetRequest | null {
  if (value == null) return null;
  const r = value as InstitutionResetRequest;
  if (typeof r !== "object" || Object.keys(r).sort().join(",") !== "id,lifecycleVersion,operationId,requestedAt,requestedBy,status,tenantId" || typeof r.id !== "string" || !/^[a-f0-9]{32}$/.test(r.id) || typeof r.tenantId !== "string" || !r.tenantId || r.tenantId === "system" || typeof r.requestedBy !== "string" || !r.requestedBy || typeof r.requestedAt !== "string" || !Number.isFinite(Date.parse(r.requestedAt)) || !Number.isInteger(r.lifecycleVersion) || r.lifecycleVersion < 0 || !["PENDING", "REVOKED", "ACCEPTED", "COMPLETED"].includes(r.status) || (["ACCEPTED", "COMPLETED"].includes(r.status) ? typeof r.operationId !== "string" || !/^[a-f0-9]{32}$/.test(r.operationId) : r.operationId !== null)) throw new Error("RESET_INSTITUTION_REQUEST_INVALID");
  return r;
}
export function assertInstitutionResetRequest(value: unknown, tenant: { id: string; status: string; lifecycleVersion: number }, operation?: { id: string; institutionRequestId?: string | null }): InstitutionResetRequest {
  const r = parseInstitutionResetRequest(value);
  if (!r || r.tenantId !== tenant.id || (operation ? r.status !== "ACCEPTED" || r.operationId !== operation.id || r.id !== operation.institutionRequestId : r.status !== "PENDING") || !(r.lifecycleVersion === tenant.lifecycleVersion || (tenant.status === "SUSPENDED" && r.lifecycleVersion + 1 === tenant.lifecycleVersion))) throw new Error("RESET_INSTITUTION_REQUEST_REQUIRED");
  return r;
}
export async function requireResetInstitutionRequest(db: Queryable, tenantId: string, operation?: { id: string; institutionRequestId?: string | null }): Promise<void> {
  const tenant = (await db.query<{ id: string; status: string; lifecycleVersion: number; resetRequest: unknown }>('SELECT "id", "status", "lifecycleVersion", "resetRequest" FROM "Tenant" WHERE "id" = $1', [tenantId])).rows[0];
  if (!tenant) throw new Error("RESET_TARGET_INVALID");
  assertInstitutionResetRequest(tenant.resetRequest, tenant, operation);
}
export interface ResetRequestActor { tenantId: string; userId: string; sessionId: string; membershipId: string; membershipVersion: number; }
export class PostgresInstitutionResetRequests {
  constructor(readonly pool: TenantQueryable) {}
  async read(tenantId: string): Promise<InstitutionResetRequest | null> {
    return withTenantDb(this.pool, { tenantId }, async (db) => parseInstitutionResetRequest((await db.query<{ resetRequest: unknown }>('SELECT "resetRequest" FROM "Tenant" WHERE "id" = $1', [tenantId])).rows[0]?.resetRequest));
  }
  async change(actor: ResetRequestActor, expectedRequestId: string | null, revoke: boolean): Promise<InstitutionResetRequest> {
    return withTenantDb(this.pool, { tenantId: actor.tenantId }, async (db) => {
      const tenant = (await db.query<{ id: string; status: string; lifecycleVersion: number; resetRequest: unknown }>('SELECT "id", "status", "lifecycleVersion", "resetRequest" FROM "Tenant" WHERE "id" = $1 FOR UPDATE', [actor.tenantId])).rows[0];
      if (!tenant || tenant.id === "system" || tenant.status !== "ACTIVE") throw new Error("RESET_REQUEST_TENANT_INACTIVE");
      // Lock the same membership and session which authorized this request; JWT roles alone are insufficient.
      const member = await db.query(`SELECT m."id" FROM "TenantMembership" m JOIN "User" u ON u."id" = m."userId" AND u."tenantId" = m."tenantId" JOIN "AuthSession" s ON s."membershipId" = m."id" AND s."tenantId" = m."tenantId" AND s."userId" = m."userId" WHERE m."tenantId" = $1 AND m."userId" = $2 AND m."id" = $3 AND m."version" = $4 AND m."status" = 'ACTIVE' AND m."startsAt" <= now() AND (m."endsAt" IS NULL OR m."endsAt" > now()) AND m."staffRole" IN ('TENANT_OWNER','TENANT_ADMIN') AND m."scopeMode" = 'TENANT' AND u."accountStatus" = 'ACTIVE' AND u."membershipVersion" = m."version" AND s."id" = $5 AND s."status" = 'ACTIVE' AND s."expiresAt" > now() AND s."membershipVersion" = m."version" FOR SHARE OF m,s,u`, [actor.tenantId, actor.userId, actor.membershipId, actor.membershipVersion, actor.sessionId]);
      if (!member.rows.length) throw new Error("RESET_REQUEST_ACTOR_INVALID");
      const previous = parseInstitutionResetRequest(tenant.resetRequest);
      if (previous?.status === "ACCEPTED") throw new Error("RESET_REQUEST_ALREADY_ACCEPTED");
      if (revoke && previous?.status === "REVOKED" && previous.id === expectedRequestId) return previous;
      if (!revoke && previous?.status === "PENDING" && previous.lifecycleVersion === tenant.lifecycleVersion && (expectedRequestId === null || previous.id === expectedRequestId)) return previous;
      if ((previous?.id ?? null) !== expectedRequestId || (revoke && previous?.status !== "PENDING")) throw new Error("RESET_REQUEST_CHANGED");
      const request: InstitutionResetRequest = revoke ? { ...previous!, status: "REVOKED" } : { id: randomBytes(16).toString("hex"), tenantId: actor.tenantId, requestedBy: actor.userId, requestedAt: new Date().toISOString(), lifecycleVersion: tenant.lifecycleVersion, status: "PENDING", operationId: null };
      await db.query('UPDATE "Tenant" SET "resetRequest" = $2::jsonb WHERE "id" = $1', [actor.tenantId, JSON.stringify(request)]);
      await db.query(`INSERT INTO "AuditLog" ("id", "tenantId", "actorUserId", "entityType", "entityId", "action", "diff") VALUES ($1,$2,$3,'TenantResetRequest',$4,$5,$6::jsonb)`, [randomUUID(), actor.tenantId, actor.userId, request.id, revoke ? "tenant.reset-request.revoked" : "tenant.reset-request.created", JSON.stringify(request)]);
      return request;
    });
  }
}
