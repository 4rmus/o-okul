import { describe, expect, it, vi } from "vitest";
import { PostgresInstitutionResetRequests, assertInstitutionResetRequest, parseInstitutionResetRequest, type InstitutionResetRequest } from "./tenant-reset-request.js";
import { PostgresFreshResetStore, type FreshResetOperation } from "./tenant-fresh-reset.js";
import { resetDataDigest } from "./tenant-reset-snapshot.js";
import { tenantResetTableNames, type TenantResetTable } from "./tenant-reset-catalog.js";
const request: InstitutionResetRequest = { id: "b".repeat(32), tenantId: "tenant-a", requestedBy: "admin-a", requestedAt: "2026-09-07T00:00:00.000Z", lifecycleVersion: 2, status: "PENDING", operationId: null };
const actor = { tenantId: "tenant-a", userId: "admin-a", sessionId: "session-a", membershipId: "member-a", membershipVersion: 1 };
function fixture(initial: InstitutionResetRequest | null = null) {
  let tenant = { id: "tenant-a", slug: "alpha", status: "ACTIVE", lifecycleVersion: 2, resetRequest: initial };
  let operations: FreshResetOperation[] = []; let backup: { tenant: typeof tenant; operations: FreshResetOperation[] } | undefined;
  let authorized = true; const calls: { sql: string; values: unknown[] }[] = [];
  const db = { async query<T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    calls.push({ sql, values }); const rows = (value: unknown[]) => ({ rows: value as T[] });
    if (sql.includes("pg_try_advisory_xact_lock_shared")) return rows([{ locked: true }]);
    if (sql === "BEGIN") backup = structuredClone({ tenant, operations });
    if (sql === "ROLLBACK" && backup) ({ tenant, operations } = backup);
    if (sql.includes('FROM "TenantMembership"')) return rows(authorized ? [{ id: "member-a" }] : []);
    if (sql.includes('FROM "AuthSession"')) return rows([{ id: "system-session" }]);
    if (sql.includes('FROM "Tenant"')) return rows(values[0] === tenant.id ? [tenant] : []);
    if (sql.startsWith('SELECT * FROM "TenantFreshResetOperation"')) return rows(operations.filter((op) => op.actorUserId === values[0] && op.idempotencyKey === values[1]));
    if (sql.startsWith('SELECT "status" FROM "TenantFreshResetOperation"')) return rows(operations.filter((op) => op.status !== "COMPLETED" && op.status !== "CANCELLED"));
    if (sql.startsWith('INSERT INTO "TenantFreshResetOperation"')) { const op = { id: values[0], tenantId: values[1], actorUserId: values[2], idempotencyKey: values[3], requestHash: values[4], status: "QUEUED", institutionRequestId: values[9] } as FreshResetOperation; operations.push(op); return rows([op]); }
    if (sql.startsWith('UPDATE "Tenant"')) tenant.resetRequest = JSON.parse(String(values[1]));
    return rows([]);
  }, release() {} };
  const pool = { query: db.query, connect: async () => db };
  return { requests: new PostgresInstitutionResetRequests(pool), resets: new PostgresFreshResetStore(pool), tenant: () => tenant, operations: () => operations, calls, authorize: (value: boolean) => { authorized = value; } };
}
const resetActor = { userId: "system-admin", sessionId: "system-session", membershipVersion: 1, key: "key-a", requestHash: "hash-a" };
const body = { preset: "CLEAN_SETUP_V1" as const, expectedLifecycleVersion: 3, preflightDigest: "a".repeat(64), confirmationText: "alpha", reason: "INSTITUTION_REQUEST" as const };
describe("institution reset request authority", () => {
  it("binds own-tenant actor, deduplicates, revokes idempotently and rejects stale reposts", async () => {
    const f = fixture(); const first = await f.requests.change(actor, null, false);
    expect(first).toMatchObject({ tenantId: actor.tenantId, requestedBy: actor.userId, status: "PENDING" });
    expect(await f.requests.change(actor, null, false)).toEqual(first);
    expect((await f.requests.change(actor, first.id, true)).status).toBe("REVOKED");
    expect((await f.requests.change(actor, first.id, true)).status).toBe("REVOKED");
    await expect(f.requests.change(actor, null, false)).rejects.toThrow("RESET_REQUEST_CHANGED");
    await expect(f.requests.change({ ...actor, tenantId: "tenant-b" }, first.id, false)).rejects.toThrow("RESET_REQUEST_TENANT_INACTIVE");
    const next = await f.requests.change(actor, first.id, false); expect(next.id).not.toBe(first.id);
    expect(f.calls.filter(({ sql }) => sql.includes('FROM "TenantMembership"')).every(({ sql }) => sql.includes('FOR SHARE OF m,s,u') && sql.includes('u."accountStatus" = \'ACTIVE\'') && sql.includes('s."membershipVersion" = m."version"'))).toBe(true);
  });
  it("rejects stale membership/session without writing authority", async () => {
    const f = fixture(); f.authorize(false);
    await expect(f.requests.change(actor, null, false)).rejects.toThrow("RESET_REQUEST_ACTOR_INVALID");
    expect(f.tenant().resetRequest).toBeNull(); expect(f.calls.some(({ sql }) => sql.startsWith("UPDATE"))).toBe(false);
  });
  it("claims only the same pending request with the operation and prevents reuse/revocation", async () => {
    const f = fixture(request); f.tenant().status = "SUSPENDED"; f.tenant().lifecycleVersion = 3;
    const validate = vi.fn(async () => {});
    const op = await f.resets.create("tenant-a", body, resetActor, validate);
    expect(f.tenant().resetRequest).toEqual({ ...request, status: "ACCEPTED", operationId: op.id });
    expect(op.institutionRequestId).toBe(request.id);
    expect(await f.resets.create("tenant-a", body, resetActor, validate)).toEqual(op); expect(validate).toHaveBeenCalledTimes(1);
    await expect(f.resets.create("tenant-a", body, { ...resetActor, key: "another" }, validate)).rejects.toThrow("RESET_OPERATION_IN_PROGRESS");
    f.tenant().status = "ACTIVE";
    await expect(f.requests.change(actor, request.id, true)).rejects.toThrow("RESET_REQUEST_ALREADY_ACCEPTED");
  });
  it("retains pending authority when preflight fails and rejects revoked authority before preflight", async () => {
    const f = fixture(request); f.tenant().status = "SUSPENDED"; f.tenant().lifecycleVersion = 3;
    await expect(f.resets.create("tenant-a", body, resetActor, async () => { throw new Error("RESET_WRITE_QUIESCENCE_UNVERIFIED"); })).rejects.toThrow("RESET_WRITE_QUIESCENCE_UNVERIFIED");
    expect(f.tenant().resetRequest).toEqual(request); expect(f.operations()).toHaveLength(0);
    f.tenant().resetRequest = { ...request, status: "REVOKED" };
    const validate = vi.fn(async () => {});
    await expect(f.resets.create("tenant-a", body, resetActor, validate)).rejects.toThrow("RESET_INSTITUTION_REQUEST_REQUIRED"); expect(validate).not.toHaveBeenCalled();
  });
  it("rejects malformed, stale, cross-tenant and differently claimed provenance after requester deletion", () => {
    const tenant = { id: "tenant-a", status: "SUSPENDED", lifecycleVersion: 3 };
    expect(() => assertInstitutionResetRequest(request, tenant)).not.toThrow();
    for (const value of [null, { ...request, tenantId: "tenant-b" }, { ...request, status: "REVOKED" }, { ...request, lifecycleVersion: 0 }]) expect(() => assertInstitutionResetRequest(value, tenant)).toThrow();
    expect(() => parseInstitutionResetRequest({ ...request, forged: true })).toThrow("RESET_INSTITUTION_REQUEST_INVALID");
    const op = { id: "a".repeat(32), institutionRequestId: request.id };
    const accepted = { ...request, status: "ACCEPTED", operationId: op.id };
    expect(() => assertInstitutionResetRequest(accepted, tenant, op)).not.toThrow();
    expect(() => assertInstitutionResetRequest(accepted, tenant, { ...op, id: "c".repeat(32) })).toThrow();
  });
  it("normalizes only the same request claim while preserving exact archive and other tenant drift", () => {
    const raw = Object.fromEntries(tenantResetTableNames.map((name) => [name, []])) as unknown as Record<TenantResetTable, string[]>;
    raw.Tenant = [JSON.stringify({ id: "tenant-a", updatedAt: "original", resetRequest: request })];
    const before = resetDataDigest("schema", raw); const opId = "a".repeat(32);
    const accepted = structuredClone(raw); accepted.Tenant = [JSON.stringify({ id: "tenant-a", updatedAt: "original", resetRequest: { ...request, status: "ACCEPTED", operationId: opId } })];
    expect(resetDataDigest("schema", accepted, opId)).toBe(before);
    expect(accepted.Tenant[0]).toContain('"ACCEPTED"');
    expect(resetDataDigest("schema", accepted, "c".repeat(32))).not.toBe(before);
    accepted.Tenant = [accepted.Tenant[0]!.replace('"original"', '"changed"')];
    expect(resetDataDigest("schema", accepted, opId)).not.toBe(before);
  });
});

it("restricts worker authority writes to exact completion of its matching operation", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync("prisma/migrations/20260907140000_tenant_reset_request/migration.sql", "utf8");
  expect(sql).toContain("current_user = 'o_okul_reset_worker'");
  expect(sql).toContain('OLD."resetRequest" IS NULL');
  expect(sql).toContain('NEW."resetRequest" IS DISTINCT FROM jsonb_set(OLD."resetRequest", \'{status}\', \'"COMPLETED"\'::jsonb)');
  expect(sql).toContain('o."institutionRequestId" = OLD."resetRequest"->>\'id\' AND o."status" = \'COMPLETED\'');
});
