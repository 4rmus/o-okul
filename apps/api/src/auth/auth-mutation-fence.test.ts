import { InMemoryTenantStore } from "../tenant/tenant-store.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryAuthUserStore, PostgresAuthUserStore, resetInMemoryAuthUsers } from "./auth-user-store.js";
import { InMemorySessionStore, PostgresSessionStore } from "./session-store.js";
import { InMemoryPasswordResetStore } from "./password-reset-store.js";
import { mfaAttemptKey } from "./login-attempt-limiter.js";
import { AuthService } from "./auth.service.js";
afterEach(() => resetInMemoryAuthUsers());
describe("original auth generation fences", () => {
  it("stale MFA mutations cannot change new owner counter, recovery or secret; other tenant stays intact", async () => {
    resetInMemoryAuthUsers(); const users = new InMemoryAuthUserStore(); const id = "user-tenant-a";
    const original = (await users.findById(id))!; const other = await users.findById("user-tenant-b");
    const enabled = (await users.enableTotp({ userId: id, source: original, secretEncrypted: "secret", enabledAt: new Date().toISOString(), recoveryCodeHashes: ["recovery"] }))!;
    const next = (await users.updatePassword(id, "new-generation-hash", { source: enabled }))!;
    expect(await users.markTotpCounterUsed(id, "101", enabled)).toBe(false);
    expect(await users.consumeTotpRecoveryCode(id, "recovery", enabled)).toBe(false);
    expect(await users.disableTotp(id, enabled)).toBeUndefined();
    expect(await users.markTotpCounterUsed(id, "101", next)).toBe(true);
    expect(await users.consumeTotpRecoveryCode(id, "recovery", next)).toBe(true);
    expect(await users.findById("user-tenant-b")).toEqual(other);
  });
  it("Postgres counter CAS binds target tenant/version, rejects missing source and locks before User write", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []; let counter = "0";
    const db = { async query<T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
      calls.push({ sql, values }); const rows = (items: unknown[]) => ({ rows: items as T[] });
      if (sql.includes("pg_try_advisory_xact_lock_shared")) return rows([{ locked: true }]);
      if (sql.includes('FROM "Tenant" WHERE')) return rows([{ id: values[0] }]);
      if (sql.startsWith('UPDATE "User"')) { if (values[0] === "user-a" && values[2] === "tenant-a" && values[3] === 2) { counter = String(values[1]); return rows([{ id: "user-a" }]); } }
      return rows([]);
    }, release() {} };
    const users = new PostgresAuthUserStore({ query: db.query, connect: async () => db });
    expect(await users.markTotpCounterUsed("user-a", "101", { tenantId: "tenant-a", membershipVersion: 1 })).toBe(false);
    expect(await users.markTotpCounterUsed("user-a", "101", { tenantId: "tenant-b", membershipVersion: 2 })).toBe(false); expect(counter).toBe("0");
    expect(await users.markTotpCounterUsed("user-a", "101", { tenantId: "tenant-a", membershipVersion: 2 })).toBe(true);
    const update = calls.find(({ sql }) => sql.startsWith('UPDATE "User"'))!;
    expect(update.sql).toContain('"tenantId" = $3 AND "membershipVersion" = $4');
    expect(calls.findIndex(({ sql }) => sql.includes("pg_try_advisory_xact_lock_shared"))).toBeLessThan(calls.findIndex(({ sql }) => sql.includes('FROM "Tenant" WHERE')));
    await expect(users.markTotpCounterUsed("user-a", "102", undefined as never)).rejects.toThrow("AUTH_MUTATION_SOURCE_REQUIRED");
    expect(calls.some(({ sql }) => sql.includes("TenantMutationActivity"))).toBe(false);
  });
  it("original revocation cutoffs never close new generation or another tenant", async () => {
    const sessions = new InMemorySessionStore();
    const create = (tenantId: string, membershipVersion: number, token: string) => sessions.create({ userId: "user-a", tenantId, membershipVersion, roles: ["TENANT_ADMIN"], refreshToken: token, expiresAt: new Date(Date.now() + 60_000) });
    const old = await create("tenant-a", 1, "old"); const newer = await create("tenant-a", 2, "new"); const other = await create("tenant-b", 1, "other");
    await sessions.revokeByUser("user-a", { tenantId: "tenant-a", membershipVersion: 1 });
    expect((await sessions.findById(old.id))?.status).toBe("REVOKED");
    expect(await sessions.revokeOwned(newer.id, "user-a", "tenant-a", 1)).toBe(false);
    expect(await sessions.revokeAllOwned("user-a", "tenant-a", 1)).toBe(0);
    expect((await sessions.findById(newer.id))?.status).toBe("ACTIVE"); expect((await sessions.findById(other.id))?.status).toBe("ACTIVE");
  });
  it("family compromise uses original family/tenant/version and never current User lookup", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const newer = { tenantId: "tenant-a", tokenFamilyId: "new-family", membershipVersion: 2, status: "ACTIVE" };
    const db = { async query<T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
      calls.push({ sql, values });
      if (sql.includes("SELECT DISTINCT")) return { rows: [{ tenantId: "tenant-a", membershipVersion: 1 }] as T[] };
      if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
      if (sql.startsWith('UPDATE "AuthSession"') && values[0] === newer.tokenFamilyId && values[1] === newer.tenantId && values[2] === newer.membershipVersion) newer.status = "COMPROMISED";
      return { rows: [] };
    }, release() {} };
    const sessions = new PostgresSessionStore({ connect: async () => db } as never);
    await sessions.markFamilyCompromised("old-family");
    expect(newer.status).toBe("ACTIVE"); expect(calls.find(({ sql }) => sql.startsWith('UPDATE "AuthSession"'))?.values).toEqual(["old-family", "tenant-a", 1]);
    expect(calls.some(({ sql }) => sql.includes('FROM "User"'))).toBe(false);
  });
  it("password reset staged CAS cannot overwrite a concurrent password change or consume its token", async () => {
    resetInMemoryAuthUsers(); const users = new InMemoryAuthUserStore(), resets = new InMemoryPasswordResetStore(); const before = (await users.findById("user-tenant-a"))!;
    const reset = (await resets.issue({ userId: before.id, expectedMembershipVersion: before.membershipVersion, tokenHash: "hash", expiresAt: new Date(Date.now() + 60_000).toISOString(), resendNotBefore: "2000-01-01", delivery: { tenantId: before.tenantId, sourceScope: "TENANT", tenantLifecycleVersion: 0, purpose: "PASSWORD_RESET", expiresAt: new Date(Date.now() + 60_000).toISOString(), payloadEncrypted: "fixture" } }))!;
    await expect(resets.confirm(reset.id, new Date().toISOString(), async (transaction) => {
      expect(await users.updatePasswordForReset(before.id, "reset-hash", { source: before }, transaction)).toBe(true);
      await users.updatePassword(before.id, "concurrent-hash", { source: before });
    })).rejects.toThrow("AUTH_MUTATION_SOURCE_STALE");
    expect((await users.findById(before.id))?.passwordHash).toBe("concurrent-hash"); expect((await resets.findByTokenHash("hash"))?.status).toBe("PENDING");
  });
  it("old MFA attempt work stays in old TTL namespace and stale authenticated context cannot issue a new setup draft", async () => {
    expect(mfaAttemptKey("u", "login", "tenant-a", 1)).not.toBe(mfaAttemptKey("u", "login", "tenant-a", 2));
    expect(mfaAttemptKey("u", "login", "tenant-a", 1)).not.toBe(mfaAttemptKey("u", "login", "tenant-b", 1));
    const findById = vi.fn(async () => ({ id: "u", tenantId: "system", membershipVersion: 2, roles: ["SYSTEM_ADMIN"] }));
    const service = new AuthService({ findById } as never, new InMemorySessionStore(), new InMemoryPasswordResetStore(), {} as never);
    const saved = process.env.ADMIN_MFA_MODE; process.env.ADMIN_MFA_MODE = "optional";
    try { await expect(service.createTotpSetup({ userId: "u", tenantId: null, membershipVersion: 1, roles: ["SYSTEM_ADMIN"], bypassRls: false })).rejects.toThrow("AUTH_MUTATION_SOURCE_STALE"); }
    finally { if (saved === undefined) delete process.env.ADMIN_MFA_MODE; else process.env.ADMIN_MFA_MODE = saved; }
  });
});

it("confirmed password change retires old refresh and permits only a new password login", async () => {
  resetInMemoryAuthUsers(); const users = new InMemoryAuthUserStore(), sessions = new InMemorySessionStore();
  const auth = new AuthService(users, sessions, new InMemoryPasswordResetStore(), { resolve: vi.fn(async () => undefined) } as never, undefined, undefined, new InMemoryTenantStore());
  const pair = await auth.login({ tenantSlug: "dna-egitim", loginName: "admin-a@example.test", password: "password" });
  if ("status" in pair) throw new Error("Expected initial session");
  const source = { userId: pair.session.userId, tenantId: pair.session.tenantId, sessionId: pair.session.id, membershipVersion: pair.session.membershipVersion, roles: pair.session.roles, bypassRls: false };
  await auth.changeCurrentPassword(source, "password", "ChangedPassword123");
  expect((await sessions.findById(pair.session.id))?.status).toBe("REVOKED");
  await expect(auth.refresh(pair.refreshToken)).rejects.toThrow();
  const next = await auth.login({ tenantSlug: "dna-egitim", loginName: "admin-a@example.test", password: "ChangedPassword123" });
  if ("status" in next) throw new Error("Expected new session");
  expect(next.session.membershipVersion).toBeGreaterThan(pair.session.membershipVersion);
  await sessions.revokeByUser(source.userId, source);
  expect((await sessions.findById(next.session.id))?.status).toBe("ACTIVE");
});
