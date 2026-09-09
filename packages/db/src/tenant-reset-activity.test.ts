import { describe, expect, it, vi } from "vitest";
import { requireNoTenantMutationActivity, runTenantMutationActivity, type TenantMutationAdmission } from "./tenant-mutation-activity.js";
const admission: TenantMutationAdmission = { tenantId: "tenant-a", lifecycleVersion: 2, kind: "HTTP_MUTATION", actor: { userId: "admin", sessionId: "session", membershipVersion: 1 } };
function fixture() {
  let rows = new Map<string, { id: string; tenantId: string; lifecycleVersion: number; kind: string; status: string; referenceId?: string | null }>();
  const tenant = { status: "ACTIVE", lifecycleVersion: 2 }; const calls: string[] = [];
  let sourceValid = true;
  const bypass: unknown[] = [];
  let failCommit = 0; let commits = 0; let shared = true;
  const pool = { async query<T>() { return { rows: [] as T[] }; }, async connect() {
    let before = new Map(rows);
    return { async query<T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
      calls.push(sql);
      if (sql.includes("set_config('app.bypass_rls'")) bypass.push(values[0]);
      if (sql.includes('FROM "IdentityInvitation"')) return { rows: (sourceValid ? [{ id: "invite-a" }] : []) as T[] }; const result = (values: unknown[]) => ({ rows: values as T[] });
      if (sql === "BEGIN") before = new Map([...rows].map(([key, row]) => [key, { ...row }]));
      if (sql === "ROLLBACK") rows = before;
      if (sql === "COMMIT") { commits++; before = new Map(rows); if (commits === failCommit) throw new Error("COMMIT_ACK_LOST"); }
      if (sql.includes("pg_try_advisory_xact_lock_shared")) return result([{ locked: shared }]);
      if (sql.includes('FROM "AuthSession"')) return result([{ id: "session" }]);
      if (sql.includes('FROM "Tenant"')) return result(values[0] === admission.tenantId ? [tenant] : []);
      if (sql.startsWith('INSERT INTO "TenantMutationActivity"')) { const row = { id: String(values[0]), tenantId: String(values[1]), lifecycleVersion: Number(values[2]), kind: String(values[3]), status: "RUNNING", referenceId: values[4] == null ? null : String(values[4]) }; rows.set(row.id, row); return result([{ id: row.id }]); }
      if (sql.startsWith('UPDATE "TenantMutationActivity"')) { const row = rows.get(String(values[0])); if (row && row.tenantId === values[1] && row.lifecycleVersion === values[2]) { row.status = "UNCERTAIN"; return result([{ id: row.id }]); } }
      if (sql.startsWith('DELETE FROM "TenantMutationActivity"')) { const row = rows.get(String(values[0])); if (row && row.tenantId === values[1] && row.lifecycleVersion === values[2] && row.status === "RUNNING") { rows.delete(row.id); return result([{ id: row.id }]); } }
      if (sql.includes('"referenceId" = $4')) return result([...rows.values()].filter((row) => row.tenantId === values[0] && row.lifecycleVersion === values[1] && row.kind === values[2] && row.referenceId === values[3]));
      if (sql.startsWith('SELECT "id" FROM "TenantMutationActivity"')) return result([...rows.values()].filter((row) => row.tenantId === values[0]).slice(0, 1));
      return result([]);
    }, release() {} };
  } };
  return { pool, tenant, calls, bypass, denySource() { sourceValid = false; }, rows: () => [...rows.values()], failCommit: (at: number) => { failCommit = at; }, denyShared: () => { shared = false; } };
}
describe("durable tenant mutation admission and uncertainty", () => {
  it.each(["inactive", "stale", "legacy", "other-tenant", "exclusive"])("rejects %s before callback and activity insertion", async (mode) => {
    const f = fixture(); const run = vi.fn(async () => "effect");
    if (mode === "inactive") f.tenant.status = "SUSPENDED";
    if (mode === "stale") f.tenant.lifecycleVersion = 3;
    if (mode === "exclusive") f.denyShared();
    await expect(runTenantMutationActivity(f.pool, { ...admission, ...(mode === "legacy" ? { lifecycleVersion: undefined as never } : {}), ...(mode === "other-tenant" ? { tenantId: "tenant-b" } : {}) }, run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled(); expect(f.rows()).toEqual([]);
  });
  it("commits durable record before awaited work and removes only its own record after confirmed success", async () => {
    const f = fixture(); let finish!: () => void; let started!: () => void;
    const start = new Promise<void>((resolve) => { started = resolve; }); const wait = new Promise<void>((resolve) => { finish = resolve; });
    const pending = runTenantMutationActivity(f.pool, admission, async () => { started(); await wait; return "done"; });
    await start; expect(f.rows()).toMatchObject([{ tenantId: "tenant-a", lifecycleVersion: 2, status: "RUNNING" }]);
    const db = await f.pool.connect(); await expect(requireNoTenantMutationActivity(db, "tenant-a")).rejects.toThrow("RESET_MUTATION_ACTIVITY_PRESENT");
    await expect(requireNoTenantMutationActivity(db, "tenant-b")).resolves.toBeUndefined();
    finish(); expect(await pending).toBe("done"); expect(f.rows()).toEqual([]);
  });
  it("retains uncertainty even when an outer controller catches remote failure and returns success", async () => {
    const f = fixture();
    await runTenantMutationActivity(f.pool, admission, async () => {
      try { await runTenantMutationActivity(f.pool, { ...admission, kind: "S3_MUTATION" }, async () => { throw new Error("REMOTE_OUTCOME_UNKNOWN"); }); } catch {}
      return "handled";
    });
    expect(f.rows()).toMatchObject([{ kind: "S3_MUTATION", status: "UNCERTAIN" }]);
    expect(f.calls.filter((sql) => sql.includes('"TenantMutationActivity"')).some((sql) => /expires|interval|stale/i.test(sql))).toBe(false);
    await expect(requireNoTenantMutationActivity(await f.pool.connect(), "tenant-a")).rejects.toThrow("RESET_MUTATION_ACTIVITY_PRESENT");
  });
  it("lost admission ACK never starts work; durable row, if committed, remains a blocker", async () => {
    const f = fixture(); f.failCommit(1); const run = vi.fn(async () => {});
    await expect(runTenantMutationActivity(f.pool, admission, run)).rejects.toThrow("COMMIT_ACK_LOST");
    expect(run).not.toHaveBeenCalled(); expect(f.rows()).toMatchObject([{ status: "RUNNING" }]);
  });
  it("cleanup ACK loss does not report success; absence after committed cleanup is safe because work ended", async () => {
    const f = fixture(); f.failCommit(2); const run = vi.fn(async () => "finished");
    await expect(runTenantMutationActivity(f.pool, admission, run)).rejects.toThrow("COMMIT_ACK_LOST");
    expect(run).toHaveBeenCalledTimes(1); expect(f.rows()).toEqual([]);
  });
});

it("same stable worker operation cannot retry an uncertain send; another reference remains independent", async () => {
  const f = fixture(); const send = vi.fn(async () => { throw new Error("PROVIDER_UNKNOWN"); });
  const job = { ...admission, actor: undefined, kind: "WORKER_JOB" as const, referenceId: "sms-batch:job-a" };
  await expect(runTenantMutationActivity(f.pool, job, send)).rejects.toThrow("PROVIDER_UNKNOWN");
  await expect(runTenantMutationActivity(f.pool, job, send)).rejects.toThrow("TENANT_ACTIVITY_UNRESOLVED");
  expect(send).toHaveBeenCalledTimes(1);
  await expect(runTenantMutationActivity(f.pool, { ...job, referenceId: "sms-batch:job-b" }, async () => "ok")).resolves.toBe("ok");
  expect(f.rows()).toHaveLength(1);
});
it("revoked credential source is rejected before activity or callback; stale snapshot cannot use new epoch", async () => {
  for (const changed of ["source", "epoch"]) {
    const f = fixture(); if (changed === "source") f.denySource(); else f.tenant.lifecycleVersion = 3;
    const run = vi.fn(async () => {});
    await expect(runTenantMutationActivity(f.pool, { ...admission, actor: undefined, kind: "AUTH_MUTATION", source: { type: "INVITATION", id: "invite-a", tokenHash: "a".repeat(64) } }, run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled(); expect(f.rows()).toHaveLength(0);
  }
});
it("ADMIN admission alone may inspect system actor through bypass and mutate SUSPENDED target; cleanup is ordinary tenant RLS", async () => {
  const f = fixture(); f.tenant.status = "SUSPENDED";
  await runTenantMutationActivity(f.pool, { ...admission, kind: "ADMIN_MUTATION", actor: { ...admission.actor!, platform: true } }, async () => "ok");
  expect(f.bypass).toEqual(["true", "false"]);
  expect(f.calls.some((sql) => sql.includes("'SYSTEM_ADMIN' = ANY(s.\"roles\")") && sql.includes('u."tenantId" = s."tenantId"'))).toBe(true);
  const run = vi.fn(async () => {});
  await expect(runTenantMutationActivity(f.pool, { ...admission, kind: "ADMIN_MUTATION" }, run)).rejects.toThrow("TENANT_ACTIVITY_CONTEXT_INVALID"); expect(run).not.toHaveBeenCalled();
});
it.each([123, {}, ""])("invalid reference %j never reaches SQL", async (referenceId) => {
  const f = fixture(); await expect(runTenantMutationActivity(f.pool, { ...admission, referenceId } as never, async () => {})).rejects.toThrow("TENANT_ACTIVITY_CONTEXT_INVALID"); expect(f.calls).toHaveLength(0);
});
it("new provenance constraints fail closed on NULL and forbid attempted rows returning to PENDING", async () => {
  const { readFileSync } = await import("node:fs"); const sql = readFileSync("prisma/migrations/20260907180000_delivery_provenance_and_retry_fence/migration.sql", "utf8");
  expect(sql).toContain('CHECK (COALESCE(('); expect(sql).toContain('"tenantLifecycleVersion" IS NOT NULL'); expect(sql).toContain('"tenantId" <> \'system\'');
  expect(sql).toContain('OLD."attempts" > 0 AND NEW."status" = \'PENDING\''); expect(sql).toContain('OLD."status" = \'UNCERTAIN\' AND NEW."status" <> \'UNCERTAIN\'');
  expect(sql).not.toContain('SET "sourceScope"');
});
