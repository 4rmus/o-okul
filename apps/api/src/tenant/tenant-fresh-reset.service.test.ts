import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { freshResetStatus, type FreshResetOperation } from "@o-okul/db";
import { TenantFreshResetService } from "./tenant-fresh-reset.service.js";
import { createAdminMfaStepUpProof } from "../auth/totp-mfa.js";
import type { RequestContext } from "../context/request-context.js";

const context: RequestContext = { userId: "platform", tenantId: null, roles: ["SYSTEM_ADMIN"], bypassRls: false, sessionId: "system-session", membershipVersion: 1 };
const body = { preset: "CLEAN_SETUP_V1" as const, expectedLifecycleVersion: 3, preflightDigest: "a".repeat(64), confirmationText: "alpha", reason: "OPERATIONS_REVIEW" as const };
const proof = (target = { tenantId: "tenant-a", preset: body.preset, expectedLifecycleVersion: body.expectedLifecycleVersion, preflightDigest: body.preflightDigest }) => createAdminMfaStepUpProof({ userId: context.userId, sessionId: context.sessionId!, membershipVersion: 1, purpose: "TENANT_CLEAN_RESET", target }).stepUpToken;
function fixture() {
  const service = new TenantFreshResetService({ preview: vi.fn() } as never);
  const op = { id: "a".repeat(32), status: "QUEUED", phase: "PREFLIGHT", errorCode: null, result: null, actorUserId: "private", backupReceipt: { private: "hidden" } } as unknown as FreshResetOperation;
  const create = vi.fn(async () => op), find = vi.fn(async () => op);
  Object.defineProperty(service, "store", { value: { create, find } });
  return { service, create, find, op };
}
describe("reset admission and read-only reconciliation", () => {
  it.each(["TENANT_OWNER", "TENANT_ADMIN", "TEACHER", "STUDENT", "GUARDIAN"])("rejects %s before storage", async (role) => {
    const f = fixture();
    await expect(f.service.create({ ...context, roles: [role] as never }, "tenant-a", body, "reset-idempotency-a", proof())).rejects.toMatchObject({ status: 403 });
    expect(f.create).not.toHaveBeenCalled();
  });
  it("rejects system tenant and missing idempotency/MFA", async () => {
    const f = fixture();
    await expect(f.service.create(context, "system", body, "key", proof())).rejects.toMatchObject({ status: 403 });
    await expect(f.service.create(context, "tenant-a", body, undefined, proof())).rejects.toMatchObject({ status: 400 });
    await expect(f.service.create(context, "tenant-a", body, "key")).rejects.toMatchObject({ status: 401 });
    expect(f.create).not.toHaveBeenCalled();
  });
  it.each(["tenant", "version", "digest"])("rejects cross-bound %s MFA proof", async (field) => {
    const f = fixture();
    const target = { tenantId: field === "tenant" ? "tenant-b" : "tenant-a", preset: body.preset, expectedLifecycleVersion: field === "version" ? 4 : 3, preflightDigest: field === "digest" ? "b".repeat(64) : body.preflightDigest };
    await expect(f.service.create(context, "tenant-a", body, "key", proof(target))).rejects.toMatchObject({ status: 401 });
    expect(f.create).not.toHaveBeenCalled();
  });
  it("write quiescence remains blocked with a genuine target proof", async () => {
    const f = fixture();
    f.create.mockImplementation(async (...args: unknown[]) => { await (args[3] as () => Promise<void>)(); return f.op; });
    await expect(f.service.create(context, "tenant-a", body, "reset-idempotency-a", proof())).rejects.toMatchObject({ status: 409, message: "RESET_WRITE_QUIESCENCE_UNVERIFIED" });
  });
  it("returns the accepted durable operation despite queue failure; status GET does no writes", async () => {
    const f = fixture();
    expect(await f.service.create(context, "tenant-a", body, "reset-idempotency-a", proof())).toEqual(freshResetStatus(f.op));
    f.create.mockClear();
    expect(await f.service.status(context, "tenant-a", f.op.id)).toEqual(freshResetStatus(f.op));
    expect(f.create).not.toHaveBeenCalled();
    expect(JSON.stringify(await f.service.status(context, "tenant-a", f.op.id))).not.toMatch(/private|receipt|actor|email|key|digest/i);
  });
});


describe("tenant management read metadata", () => {
  const tenant = { id: "tenant-a", status: "SUSPENDED", lifecycleVersion: 3 } as never;
  it.each(["QUEUED", "RUNNING", "BLOCKED", "FAILED"])("keeps lifecycle and reset locked for %s across actors", async (status) => {
    const service = new TenantFreshResetService({} as never);
    const query = vi.fn(async (sql: string) => ({ rows: sql.startsWith("SELECT \"id\"") ? [{ id: "a".repeat(32), status, phase: "PREFLIGHT", errorCode: null, result: null }] : [] }));
    Object.defineProperty(service, "pool", { value: { connect: async () => ({ query, release: vi.fn() }) } });
    const result = await service.management(context, tenant);
    expect(result).toMatchObject({ verified: true, currentReset: { status }, allowedActions: { suspend: false, reactivate: false, cleanReset: false } });
    expect(query.mock.calls.some(([sql]) => sql.includes('WHERE "tenantId" = $1') && sql.includes("LIMIT 1"))).toBe(true);
    expect(query.mock.calls.every(([sql]) => !/INSERT|UPDATE|DELETE FROM/.test(sql))).toBe(true);
  });
  it("fails closed when operation metadata cannot be read", async () => {
    const service = new TenantFreshResetService({} as never);
    Object.defineProperty(service, "pool", { value: { connect: async () => { throw new Error("unavailable"); } } });
    expect(await service.management(context, tenant)).toEqual({ verified: false, currentReset: null, allowedActions: { suspend: false, reactivate: false, cleanReset: false } });
  });
});

// Institution authority cannot be forged through the system-admin context or a different persona.
describe("institution request context boundary", () => {
  const institution: RequestContext = { userId: "admin-a", tenantId: "tenant-a", sessionId: "session-a", membershipId: "member-a", membershipVersion: 1, activePersona: "STAFF", roles: ["TENANT_ADMIN"], bypassRls: false };
  it.each([
    { roles: ["SYSTEM_ADMIN"] }, { roles: ["SYSTEM_ADMIN", "TENANT_ADMIN"] }, { roles: ["TEACHER"] },
    { activePersona: "TEACHER" as const }, { tenantId: "system" }, { tenantId: null }, { bypassRls: true },
    { membershipId: undefined }, { tenantAccessMode: "read_only" as const },
    { rolePreview: { id: "preview", actorUserId: "system-admin", mode: "READ_ONLY" as const, expiresAt: "2099-01-01" } },
  ])("rejects unauthorized request before persistence: %j", async (override) => {
    const f = fixture();
    await expect(f.service.changeInstitutionRequest({ ...institution, ...override }, null)).rejects.toMatchObject({ status: 403 });
  });
  it("accepts institution admin and owner role at the boundary; missing database remains unavailable", async () => {
    const f = fixture();
    for (const role of ["TENANT_ADMIN", "TENANT_OWNER"]) await expect(f.service.changeInstitutionRequest({ ...institution, roles: [role] }, null)).rejects.toMatchObject({ status: 503 });
  });
});

describe("reset metadata diagnosis", () => {
  it("requires system admin and bounded cursors before SQL", async () => {
    const f = fixture();
    await expect(f.service.diagnostics({ ...context, roles: ["TENANT_ADMIN"] }, "tenant-a")).rejects.toMatchObject({ status: 403 });
    await expect(f.service.diagnostics(context, "system")).rejects.toMatchObject({ status: 403 });
    await expect(f.service.diagnostics(context, "tenant-a", "bad;cursor")).rejects.toMatchObject({ status: 400 });
  });
  it("uses real READ ONLY, tenant predicates and 50-row pages without reference/payload fields", async () => {
    const f = fixture(); const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const rows = Array.from({ length: 51 }, (_, index) => ({ id: `activity-${index}`, kind: "WORKER_JOB", status: "UNCERTAIN", lifecycleVersion: 1, createdAt: "2026-09-07T00:00:00.000Z" }));
    const db = { async query<T>(sql: string, values?: unknown[]) { calls.push({ sql, values }); return { rows: (sql.includes('FROM "TenantMutationActivity"') && values?.[0] === "tenant-a" ? rows : []) as T[] }; }, release() {} };
    Object.defineProperty(f.service, "pool", { value: { query: db.query, connect: async () => db } });
    const result = await f.service.diagnostics(context, "tenant-a");
    expect(result.activities.items).toHaveLength(50); expect(result.activities.nextCursor).toBe("activity-49"); expect(result.reconciliation).toBe("EXTERNAL_PROOF_REQUIRED");
    expect((await f.service.diagnostics(context, "tenant-b")).activities.items).toHaveLength(0);
    expect(calls[0]?.sql).toBe("BEGIN READ ONLY"); expect(calls.some(({ sql }) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
    expect(calls.filter(({ sql }) => sql.includes('FROM "TenantMutationActivity"')).every(({ sql }) => sql.includes('"tenantId" = $1') && sql.includes('LIMIT 51'))).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/payload|referenceId|token|email/i);
  });
});

describe("owned outbox receipt diagnosis", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  function receiptFixture(overrides: Record<string, unknown> = {}) {
    const f = fixture();
    const row = { id: "outbox-1", tenantId: "tenant-a", sourceScope: "TENANT", lifecycleVersion: 2, providerMessageId: "provider-1", ...overrides };
    const query = vi.fn(async (sql: string, values?: unknown[]) => ({ rows: sql.includes('FROM "SecretDeliveryOutbox"') && values?.[0] === row.id && values?.[1] === row.tenantId ? [row] : [] }));
    Object.defineProperty(f.service, "pool", { value: { connect: async () => ({ query, release: vi.fn() }) } });
    const now = Date.now() - 1000;
    const lookup = { status: "PROVIDER_ACCEPTED", keyHash: hash("secret-delivery:outbox-1"), providerReceiptHash: hash("provider-1"), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 86400000).toISOString() };
    const fetch = vi.fn(async () => Response.json(lookup));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("NOTIFICATION_PROVIDER", "http"); vi.stubEnv("NOTIFICATION_HTTP_ENDPOINT", "https://notify.example.test/send"); vi.stubEnv("NOTIFICATION_HTTP_BEARER_TOKEN", "private-token");
    return { ...f, query, fetch, lookup };
  }
  it("checks role/target before lookup and rejects legacy provenance without upgrading epoch", async () => {
    const f = receiptFixture({ sourceScope: null, lifecycleVersion: null });
    await expect(f.service.deliveryReceipt({ ...context, roles: ["TENANT_ADMIN"] }, "tenant-a", "outbox-1")).rejects.toMatchObject({ status: 403 });
    await expect(f.service.deliveryReceipt(context, "system", "outbox-1")).rejects.toMatchObject({ status: 403 });
    await expect(f.service.deliveryReceipt(context, "tenant-a", "invalid/key")).rejects.toMatchObject({ status: 400 });
    expect(f.query).not.toHaveBeenCalled();
    await expect(f.service.deliveryReceipt(context, "tenant-b", "outbox-1")).rejects.toMatchObject({ status: 404 });
    await expect(f.service.deliveryReceipt(context, "tenant-a", "outbox-1")).rejects.toMatchObject({ status: 409 });
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("reads original row epoch, derives exact key and matches local receipt without mutation", async () => {
    const f = receiptFixture();
    const result = await f.service.deliveryReceipt(context, "tenant-a", "outbox-1");
    expect(result).toMatchObject({ lifecycleVersion: 2, status: "PROVIDER_ACCEPTED", correlation: "LOCAL_RECEIPT_MATCH", reconciliation: "EXTERNAL_PROOF_REQUIRED" });
    expect(f.query.mock.calls[0]?.[0]).toBe("BEGIN READ ONLY");
    expect(f.query.mock.calls.every(([sql]) => !/^(INSERT|UPDATE|DELETE)/.test(sql) && !sql.includes('FROM "Tenant"'))).toBe(true);
    expect(f.fetch).toHaveBeenCalledWith("https://notify.example.test/receipts?key=secret-delivery%3Aoutbox-1", expect.objectContaining({ method: "GET" }));
    expect(JSON.stringify(result)).not.toMatch(/private|provider-1|keyHash|fingerprint|token|payload/i);
  });
  it("reports key-only acceptance without a local receipt and rejects mismatched receipt", async () => {
    const missing = receiptFixture({ providerMessageId: null });
    expect(await missing.service.deliveryReceipt(context, "tenant-a", "outbox-1")).toMatchObject({ status: "PROVIDER_ACCEPTED", correlation: "KEY_ONLY" });
    const mismatch = receiptFixture({ providerMessageId: "different-provider-id" });
    expect(await mismatch.service.deliveryReceipt(context, "tenant-a", "outbox-1")).toMatchObject({ status: "UNVERIFIED", correlation: "UNVERIFIED", providerReceiptHash: null });
  });
});
