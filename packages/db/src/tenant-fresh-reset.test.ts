import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PostgresFreshResetStore, freshResetStatus, purgeResetDatabase, requireResetLegalClearance, requireResetWriteQuiescence, resetDeleteOrder, type FreshResetOperation } from "./tenant-fresh-reset.js";
import { runFreshReset, resetWorkerDatabaseUrl, signResetRestoreReceipt, type FreshResetServices } from "./tenant-fresh-reset-runner.js";
import { readResetSnapshot, resetDataDigest } from "./tenant-reset-snapshot.js";
import { resetDigest, tenantResetCatalog, tenantResetColumns, tenantResetTableNames, type ResetTables } from "./tenant-reset-catalog.js";
import type { TenantResetPackage } from "./tenant-reset-backup.js";

function fixture() {
  const tables = Object.fromEntries(tenantResetTableNames.map((name) => [name, []])) as unknown as ResetTables;
  tables.Tenant = [{ id: "tenant-a", slug: "alpha", status: "SUSPENDED", lifecycleVersion: 3 }, { id: "tenant-b", slug: "beta", status: "ACTIVE", lifecycleVersion: 0 }];
  for (const id of ["owner-1", "owner-2", "other"]) {
    tables.User.push({ id, tenantId: "tenant-a", accountStatus: "ACTIVE", membershipVersion: 1, mustChangePassword: false });
    tables.Employee.push({ id: `employee-${id}`, tenantId: "tenant-a", userId: id, status: "ACTIVE", deletedAt: null });
    tables.AuthSession.push({ id: `session-${id}`, tenantId: "tenant-a", tokenFamilyId: id });
    tables.PasswordResetToken.push({ id: `reset-${id}`, userId: id });
    tables.ConsumedRefreshToken.push({ tokenFamilyId: id });
    tables.IdentityInvitation.push({ id: `invite-${id}`, tenantId: "tenant-a" });
    tables.NotificationDeviceToken.push({ id, tenantId: "tenant-a" });
    tables.SecretDeliveryOutbox.push({ id, tenantId: null, purpose: "PASSWORD_RESET", sourceId: `reset-${id}`, status: "DELIVERED" });
  }
  tables.Employee.push({ id: "unlinked", userId: null, tenantId: "tenant-a" });
  tables.Employee.push({ id: "historical-owner", userId: "owner-1", tenantId: "tenant-a", status: "INACTIVE" });
  for (const id of ["owner-1", "owner-2"]) tables.TenantMembership.push({ id: `member-${id}`, tenantId: "tenant-a", userId: id, role: "TENANT_OWNER", staffRole: "TENANT_OWNER", status: "ACTIVE", startsAt: "2020-01-01", version: 1, hasTeacherPersona: id === "owner-1", hasStudentPersona: false, scopeMode: "CAMPUSES" });
  tables.TenantMembership.push({ id: "teacher-persona", tenantId: "tenant-a", userId: "owner-1", role: "TEACHER", status: "ACTIVE", startsAt: "2020-01-01" });
  for (const name of ["Teacher", "Campus", "Class", "Exam", "MembershipCampusScope"] as const) tables[name].push({ id: name, tenantId: "tenant-a" });
  tables.User.push({ id: "unrelated", tenantId: "tenant-b" });
  tables.AuthSession.push({ id: "unrelated-session", tenantId: "tenant-b", tokenFamilyId: "unrelated" });
  tables.ConsumedRefreshToken.push({ tokenFamilyId: "unrelated" });
  tables.LicenseTerm.push({ id: "license", tenantId: "tenant-a" });
  tables.LicenseUsage.push({ id: "usage", tenantId: "tenant-a", peakActiveStudentCount: 10 });
  tables.AuditLog.push({ id: "old-audit", tenantId: "tenant-a", action: "old" });
  const op: FreshResetOperation = { id: "a".repeat(32), tenantId: "tenant-a", actorUserId: "platform", idempotencyKey: "reset-idempotency-a", requestHash: "hash", preset: "CLEAN_SETUP_V1", expectedLifecycleVersion: 3, preflightDigest: "digest", reason: "OPERATIONS_REVIEW", status: "QUEUED", phase: "PREFLIGHT", errorCode: null, backupReceipt: null, result: null };
  tables.TenantFreshResetOperation.push(op as unknown as Record<string, unknown>);
  let state = structuredClone(tables); let tx: ResetTables | undefined;
  const calls: string[] = [];
  let fail = "";
  let tenantLockResult: unknown = true, operationLockResult: unknown = true;
  const released: Array<boolean | undefined> = [];
  const owned = (name: keyof ResetTables) => {
    const users = state.User.filter((row) => row.tenantId === "tenant-a").map((row) => row.id);
    const families = state.AuthSession.filter((row) => row.tenantId === "tenant-a").map((row) => row.tokenFamilyId);
    return state[name].filter((row) => name === "Tenant" ? row.id === "tenant-a" : name === "PasswordResetToken" ? users.includes(row.userId) : name === "ConsumedRefreshToken" ? families.includes(row.tokenFamilyId) : name === "SecretDeliveryOutbox" ? row.tenantId === "tenant-a" || state.PasswordResetToken.some((token) => token.id === row.sourceId && users.includes(token.userId)) : row.tenantId === "tenant-a");
  };
  const db = { async query<T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    calls.push(sql);
    if (fail && sql.includes(fail)) throw new Error("private-driver-error");
    const rows = (value: unknown[]) => ({ rows: value as T[] });
    if (sql.includes("pg_try_advisory_xact_lock_shared")) return rows([{ locked: true }]);
    if (sql.startsWith("BEGIN")) { tx = structuredClone(state); return rows([]); }
    if (sql === "ROLLBACK") { if (tx) state = tx; tx = undefined; return rows([]); }
    if (sql === "COMMIT") { tx = undefined; return rows([]); }
    if (sql.includes("pg_roles")) return rows([{ valid: true }]);
    if (sql.includes("pg_try_advisory_lock")) return rows([{ locked: sql.includes("$1, 0") ? tenantLockResult : operationLockResult }]);
    if (sql.includes("array_agg(a.attname")) return rows(Object.entries(tenantResetColumns).map(([name, columns]) => ({ name, columns })));
    if (sql.includes("SELECT c.relname AS name")) return rows(tenantResetTableNames.map((name) => ({ name })));
    if (sql.includes("FROM pg_inherits")) return rows([{ count: "0" }]);
    if (sql.includes('FROM "_prisma_migrations"')) return rows([{ row: '{"migration_name":"fixture","finished_at":"2026-01-01"}' }]);
    if (sql.includes('SELECT "id" FROM "TenantMutationActivity"')) return rows(owned("TenantMutationActivity"));
    if (sql.includes('SELECT "id" FROM "Tenant"')) return rows(state.Tenant.map((row) => ({ id: row.id })));
    if (sql.includes('SELECT "id", "tenantId" FROM "Student"')) return rows(state.Student);
    if (sql.includes("AS row FROM")) { const name = sql.match(/AS row FROM "(\w+)"/)![1] as keyof ResetTables; return rows(owned(name).map((row) => ({ row: JSON.stringify(row) })).sort((a,b) => a.row.localeCompare(b.row))); }
    if (sql.includes('SELECT "id", "status", "lifecycleVersion", "resetRequest" FROM "Tenant"')) return rows(owned("Tenant"));
    if (sql.includes('SELECT "status", "lifecycleVersion" FROM "Tenant"')) return rows(owned("Tenant"));
    if (sql.includes('SELECT * FROM "TenantFreshResetOperation"')) return rows(state.TenantFreshResetOperation.filter((row) => sql.includes('"actorUserId"') ? row.actorUserId === values[0] && row.idempotencyKey === values[1] : row.id === values[0]));
    if (sql.startsWith('UPDATE "TenantFreshResetOperation"')) {
      const row = state.TenantFreshResetOperation[0]!;
      if (sql.includes('"status" = $3')) Object.assign(row, { status: values[2], phase: values[3], errorCode: values[4] });
      else if (sql.includes('"backupReceipt" =')) row.backupReceipt = JSON.parse(String(values[2]));
      else if (sql.includes('"result" =')) row.result = JSON.parse(String(values[2]));
      return rows([{ id: row.id }]);
    }
    if (sql.startsWith('INSERT INTO "AuditLog"')) { state.AuditLog.push({ id: values[0], tenantId: values[1], entityType: "TenantFreshResetOperation", entityId: values[3], action: values[4] }); return rows([]); }
    if (sql.startsWith("DELETE")) {
      const name = sql.match(/DELETE FROM "(\w+)"/)![1] as keyof ResetTables;
      const targets = owned(name);
      state[name] = state[name].filter((row) => !targets.includes(row) || (values[1] as string[] | undefined)?.includes(String(row.id)));
      return rows([]);
    }
    if (sql.includes('SELECT count(*)::int AS count FROM "ConsumedRefreshToken"')) return rows([{ count: state.ConsumedRefreshToken.filter((row) => (values[0] as string[]).includes(String(row.tokenFamilyId))).length }]);
    if (sql.startsWith('UPDATE "TenantMembership"')) { for (const row of owned("TenantMembership")) Object.assign(row, { version: Number(row.version) + 1, hasTeacherPersona: false, hasStudentPersona: false, role: "TENANT_OWNER", scopeMode: "TENANT" }); return rows([]); }
    if (sql.startsWith('UPDATE "User"')) { for (const row of owned("User")) Object.assign(row, { mustChangePassword: true, membershipVersion: 2 }); return rows([]); }
    if (sql.includes('SET "resetRequest" = jsonb_set')) { if (state.Tenant[0]?.resetRequest) (state.Tenant[0].resetRequest as Record<string, unknown>).status = "COMPLETED"; return rows([]); }
    if (sql.startsWith('UPDATE "Tenant"')) { Object.assign(state.Tenant[0]!, { status: "ACTIVE", lifecycleVersion: 4 }); return rows([{ id: "tenant-a" }]); }
    return rows([]);
  }, release(destroy?: boolean) { released.push(destroy); } };
  return { released, tenantLock: (value: unknown) => { tenantLockResult = value; }, operationLock: (value: unknown) => { operationLockResult = value; }, db, pool: { query: db.query, connect: async () => db }, calls, state: () => state, op, fail: (value: string) => { fail = value; } };
}
async function runnerFixture() {
  const f = fixture();
  const snapshot = await readResetSnapshot(f.db, "tenant-a", f.op.id);
  const pkg = { manifest: { tenantId: "tenant-a", lifecycleVersion: 3, dataDigest: snapshot.dataDigest, objects: [{ key: "owned-object", size: 1, sha256: "hash" }] } } as TenantResetPackage;
  let objectPresent = true;
  const services: FreshResetServices = { clearance: vi.fn(async () => {}), quiescence: vi.fn(async () => {}), preflight: vi.fn(async () => {}), backup: vi.fn(async () => ({ verified: "fixture-only" })), package: vi.fn(async () => pkg), deleteObjects: vi.fn(async (_pkg, fence) => { await fence(); objectPresent = false; }), verifyObjects: vi.fn(async () => { if (objectPresent) throw new Error("RESET_OBJECT_STILL_PRESENT"); }) };
  return { ...f, services };
}
describe("fresh reset PostgreSQL adapter and phase runner (injected SQL)", () => {
  it("fixed deletion set exactly covers DELETE catalog; immutable records never get DELETE", () => {
    expect([...resetDeleteOrder].sort()).toEqual(Object.keys(tenantResetCatalog).filter((name) => tenantResetCatalog[name as keyof typeof tenantResetCatalog] === "DELETE").sort());
    const migration = readFileSync("prisma/migrations/20260907120000_tenant_fresh_reset_operation/migration.sql", "utf8");
    expect(migration).toContain('WHERE "status" <> \'COMPLETED\'');
    expect(migration).toContain('AS RESTRICTIVE TO o_okul_reset_worker');
    expect(migration).not.toMatch(/GRANT DELETE ON "(?:Tenant|AuditLog|PaymentTransaction|LicenseTerm)"/);
  });
  it("preserves every active owner including teacher-owner, deletes NULL employee and all old credentials, preserves other tenant", async () => {
    const f = await runnerFixture();
    const result = await runFreshReset(f.pool, "tenant-a", f.op.id, f.services);
    expect(result).toMatchObject({ status: "COMPLETED", phase: "DONE", result: { preservedOwnerCount: 2, deletedObjectCount: 1 } });
    expect(f.state().Tenant[0]).toMatchObject({ status: "ACTIVE", lifecycleVersion: 4 });
    expect(f.state().User.map((row) => row.id)).toEqual(["owner-1", "owner-2", "unrelated"]);
    expect(f.state().User.slice(0,2).every((row) => row.mustChangePassword === true && row.membershipVersion === 2)).toBe(true);
    expect(f.state().Employee).toHaveLength(2); expect(f.state().TenantMembership).toHaveLength(2);
    expect(f.state().ConsumedRefreshToken).toEqual([{ tokenFamilyId: "unrelated" }]);
    expect(f.state().AuthSession.map((row) => row.id)).toEqual(["unrelated-session"]);
    expect(f.state().PasswordResetToken).toEqual([]); expect(f.state().IdentityInvitation).toEqual([]);
    expect(f.state().SecretDeliveryOutbox).toEqual([]); expect(f.state().NotificationDeviceToken).toEqual([]);
    expect(f.state().LicenseTerm).toHaveLength(1); expect(f.state().LicenseUsage[0]?.peakActiveStudentCount).toBe(10);
    expect(f.state().AuditLog[0]?.id).toBe("old-audit");
    expect(f.calls.findIndex((sql) => sql.startsWith('SELECT count(*)::int AS count FROM "ConsumedRefreshToken"'))).toBeLessThan(f.calls.findIndex((sql) => sql.startsWith('DELETE FROM "AuthSession"')));
    const deletes = f.calls.filter((sql) => sql.startsWith("DELETE"));
    await runFreshReset(f.pool, "tenant-a", f.op.id, f.services);
    expect(f.calls.filter((sql) => sql.startsWith("DELETE"))).toEqual(deletes);
  });
  it.each(['DELETE FROM "AuthSession"', 'UPDATE "User"', 'INSERT INTO "AuditLog"'])("SQL failure %s rolls back purge and never calls objects", async (failure) => {
    const f = await runnerFixture();
    f.fail(failure);
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_EXECUTION_FAILED");
    expect(f.state().Tenant[0]?.status).toBe("SUSPENDED");
    expect(f.state().User).toHaveLength(4); expect(f.state().AuthSession).toHaveLength(4);
    expect(f.services.deleteObjects).not.toHaveBeenCalled();
  });
  it("object failure remains SUSPENDED and resumes the SAME operation without another DB purge", async () => {
    const f = await runnerFixture();
    vi.mocked(f.services.deleteObjects).mockRejectedValueOnce(new Error("RESET_OBJECT_CHANGED"));
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_OBJECT_CHANGED");
    expect(f.state().Tenant[0]?.status).toBe("SUSPENDED"); expect(f.state().TenantFreshResetOperation[0]?.phase).toBe("OBJECTS");
    const deleteCount = f.calls.filter((sql) => sql.startsWith("DELETE")).length;
    await runFreshReset(f.pool, "tenant-a", f.op.id, f.services);
    expect(f.calls.filter((sql) => sql.startsWith("DELETE"))).toHaveLength(deleteCount);
    expect(f.services.backup).toHaveBeenCalledTimes(1);
  });
  it("real institution authority survives requester deletion and completes with the same operation", async () => {
    const f = await runnerFixture();
    f.state().Tenant[0]!.resetRequest = { id: "b".repeat(32), tenantId: "tenant-a", requestedBy: "other", requestedAt: "2026-09-07T00:00:00.000Z", lifecycleVersion: 2, status: "ACCEPTED", operationId: f.op.id };
    f.state().TenantFreshResetOperation[0]!.institutionRequestId = "b".repeat(32);
    const snapshot = await readResetSnapshot(f.db, "tenant-a", f.op.id);
    const pkg = await f.services.package(f.op); pkg.manifest.dataDigest = snapshot.dataDigest;
    f.services.clearance = requireResetLegalClearance;
    expect((await runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).status).toBe("COMPLETED");
    expect(f.state().User.some((row) => row.id === "other")).toBe(false);
    expect(f.state().Tenant[0]!.resetRequest).toMatchObject({ id: "b".repeat(32), requestedBy: "other", status: "COMPLETED", operationId: f.op.id });
  });
  it("missing institution authority fails closed independently inside purge and runner", async () => {
    const f = await runnerFixture();
    await expect(purgeResetDatabase(f.db, f.op, "digest")).rejects.toThrow("RESET_INSTITUTION_REQUEST_REQUIRED");
    f.services.clearance = requireResetLegalClearance;
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_INSTITUTION_REQUEST_REQUIRED");
    expect(f.state().TenantFreshResetOperation[0]?.status).toBe("BLOCKED");
    expect(f.calls.some((sql) => sql.startsWith("DELETE"))).toBe(false);
    expect(f.services.backup).not.toHaveBeenCalled();
  });
  it("legal clearance alone cannot bypass missing write quiescence", async () => {
    const f = await runnerFixture(); f.services.quiescence = requireResetWriteQuiescence;
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_WRITE_QUIESCENCE_UNVERIFIED");
    expect(f.services.backup).not.toHaveBeenCalled(); expect(f.services.deleteObjects).not.toHaveBeenCalled();
    expect(f.calls.some((sql) => sql.startsWith("DELETE"))).toBe(false);
    await expect(purgeResetDatabase(f.db, f.op, "digest", async () => {})).rejects.toThrow("RESET_WRITE_QUIESCENCE_UNVERIFIED");
  });
  it("no broad DATABASE_URL fallback and unsafe worker role fails before any data write", async () => {
    const original = process.env.TENANT_RESET_DATABASE_URL; delete process.env.TENANT_RESET_DATABASE_URL;
    expect(resetWorkerDatabaseUrl).toThrow("RESET_DATABASE_ROLE_INVALID");
    if (original) process.env.TENANT_RESET_DATABASE_URL = original;
    const f = await runnerFixture(); const query = f.db.query.bind(f.db);
    f.db.query = async (sql, values) => sql.includes("pg_roles") ? { rows: [{ valid: false }] as never } : query(sql, values);
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_DATABASE_ROLE_INVALID");
    expect(f.services.backup).not.toHaveBeenCalled();
  });
  it("digest excludes ONLY current bookkeeping while full archived raw rows remain present", async () => {
    const f = fixture(); const a = await readResetSnapshot(f.db, "tenant-a", f.op.id);
    f.state().TenantFreshResetOperation[0]!.status = "RUNNING";
    const b = await readResetSnapshot(f.db, "tenant-a", f.op.id);
    expect(f.calls.filter((sql) => sql === "SET LOCAL TIME ZONE 'UTC'")).toHaveLength(2);
    expect(a.dataDigest).toBe(b.dataDigest); expect(a.rawTables.TenantFreshResetOperation).not.toEqual(b.rawTables.TenantFreshResetOperation);
    f.state().AuditLog[0]!.action = "tampered";
    expect((await readResetSnapshot(f.db, "tenant-a", f.op.id)).dataDigest).not.toBe(a.dataDigest);
    expect(JSON.stringify(freshResetStatus(f.op))).not.toMatch(/actorUserId|preflightDigest|backupReceipt|idempotencyKey|requestHash/);
  });
});

describe("runner tenant lock ownership", () => {
  it.each(["RUNNING", "UNCERTAIN"])("durable %s activity blocks backup and purge despite injected quiescence", async (status) => {
    const f = await runnerFixture(); f.state().TenantMutationActivity.push({ id: "activity", tenantId: "tenant-a", status });
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_MUTATION_ACTIVITY_PRESENT");
    await expect(purgeResetDatabase(f.db, f.op, "digest", async () => {}, async () => {})).rejects.toThrow("RESET_MUTATION_ACTIVITY_PRESENT");
    expect(f.services.backup).not.toHaveBeenCalled(); expect(f.calls.some((sql) => sql.startsWith("DELETE"))).toBe(false);
  });

  it.each([false, undefined, "true"])("tenant exclusive denial (%s) leaves queued operation untouched", async (locked) => {
    const f = await runnerFixture(); f.tenantLock(locked); f.calls.length = 0;
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_TENANT_DATABASE_BUSY");
    expect(f.state().TenantFreshResetOperation[0]?.status).toBe("QUEUED");
    expect(f.calls.some((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
    expect(f.services.preflight).not.toHaveBeenCalled();
    expect(f.calls.filter((sql) => sql.includes("pg_advisory_unlock"))).toHaveLength(1);
    expect(f.released).toEqual([true]);
  });
  it("malformed operation lock never attempts tenant lock", async () => {
    const f = await runnerFixture(); f.operationLock("true"); f.calls.length = 0;
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_OPERATION_BUSY");
    expect(f.calls.some((sql) => sql.includes("hashtextextended($1, 0)"))).toBe(false);
    expect(f.released).toEqual([true]);
  });
  it("completed operation returns early but releases tenant then operation lock and discards session", async () => {
    const f = await runnerFixture(); f.state().TenantFreshResetOperation[0]!.status = "COMPLETED"; f.calls.length = 0;
    expect((await runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).status).toBe("COMPLETED");
    const exclusiveIndex = f.calls.findIndex((sql) => sql.includes("pg_try_advisory_lock(hashtextextended($1, 0)"));
    const sharedIndex = f.calls.findIndex((sql) => sql.includes("pg_try_advisory_xact_lock_shared"));
    expect(exclusiveIndex).toBeGreaterThan(0); expect(sharedIndex).toBeGreaterThan(exclusiveIndex);
    expect(f.calls.slice(-2)).toEqual(["SELECT pg_advisory_unlock(hashtextextended($1, 0))", "SELECT pg_advisory_unlock(hashtextextended($1, 1))"]);
    expect(f.services.preflight).not.toHaveBeenCalled(); expect(f.released).toEqual([true]);
  });
  it.each(["unlock", "connection"])("ambiguous %s failure always discards the lock-owning session", async (mode) => {
    const f = await runnerFixture();
    f.services.preflight = vi.fn(async () => { f.fail(mode === "unlock" ? "pg_advisory_unlock" : "SELECT"); throw new Error("RESET_SOURCE_CHANGED"); });
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_SOURCE_CHANGED");
    expect(f.services.backup).not.toHaveBeenCalled(); expect(f.services.deleteObjects).not.toHaveBeenCalled();
    expect(f.released).toEqual([true]);
  });
});

describe("operation receipt and replay", () => {
  it("accepts PostgreSQL JSONB key reordering but never a changed receipt value", () => {
    const key = Buffer.alloc(32, 7);
    expect(signResetRestoreReceipt({ tenantId: "a", verified: { z: 1, a: 2 } }, key)).toBe(signResetRestoreReceipt({ verified: { a: 2, z: 1 }, tenantId: "a" }, key));
    expect(signResetRestoreReceipt({ tenantId: "b", verified: { z: 1, a: 2 } }, key)).not.toBe(signResetRestoreReceipt({ tenantId: "a", verified: { z: 1, a: 2 } }, key));
  });
  it("same idempotency key replays its existing operation before stale version; mismatch never writes", async () => {
    const f = fixture(); const op = f.op; const calls: string[] = [];
    const db = { async query<T>(sql: string): Promise<{ rows: T[] }> { calls.push(sql); return { rows: (sql.includes("pg_try_advisory_xact_lock_shared") ? [{ locked: true }] : sql.includes('FROM "AuthSession"') ? [{ id: "system-session" }] : sql.includes('FROM "TenantFreshResetOperation"') ? [op] : []) as T[] }; }, release() {} };
    const store = new PostgresFreshResetStore({ query: db.query, connect: async () => db });
    const validate = vi.fn(); const input = { preset: "CLEAN_SETUP_V1" as const, expectedLifecycleVersion: 0, preflightDigest: "digest", confirmationText: "alpha", reason: "OPERATIONS_REVIEW" as const };
    const actor = { userId: "platform", sessionId: "system-session", membershipVersion: 1, key: "reset-idempotency-a", requestHash: "hash" };
    expect(await store.create("tenant-a", input, actor, validate)).toEqual(op);
    expect(validate).not.toHaveBeenCalled(); expect(calls.some((sql) => sql.startsWith("INSERT"))).toBe(false);
    await expect(store.create("tenant-a", input, { ...actor, requestHash: "different" }, validate)).rejects.toThrow("IDEMPOTENCY_KEY_BODY_MISMATCH");
    expect(calls).toContain("ROLLBACK");
  });
});

it("read-only key lookup scopes the stored operation to tenant AND actor AND original key", async () => {
  const op = fixture().op;
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db = { async query<T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    calls.push({ sql, values });
    return { rows: sql.startsWith('SELECT * FROM "TenantFreshResetOperation"') && values[0] === op.tenantId && values[1] === op.actorUserId && values[2] === op.idempotencyKey ? [op] as T[] : [] };
  }, release() {} };
  const store = new PostgresFreshResetStore({ query: db.query, connect: async () => db });
  expect(await store.findByKey(op.tenantId, op.actorUserId, op.idempotencyKey)).toEqual(op);
  expect(await store.findByKey("tenant-b", op.actorUserId, op.idempotencyKey)).toBeUndefined();
  expect(await store.findByKey(op.tenantId, "other-actor", op.idempotencyKey)).toBeUndefined();
  expect(await store.findByKey(op.tenantId, op.actorUserId, "unknown-key")).toBeUndefined();
  const reads = calls.filter((call) => call.sql.includes('FROM "TenantFreshResetOperation"'));
  expect(reads).toHaveLength(4);
  expect(reads.every((call) => call.sql.includes('WHERE "tenantId" = $1 AND "actorUserId" = $2 AND "idempotencyKey" = $3'))).toBe(true);
  expect(calls.some((call) => /^(INSERT|UPDATE|DELETE)/.test(call.sql))).toBe(false);
});
