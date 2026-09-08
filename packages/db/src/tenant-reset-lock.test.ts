import { describe, expect, it, vi } from "vitest";
import { tenantDatabaseLockKey, withTenantDb } from "./tenant-db.js";
function locks() {
  const exclusive = new Map<string, number>(), shared = new Map<string, Set<number>>();
  const calls: Array<{ client: number; sql: string; values?: unknown[] }> = []; const releases: Array<{ client: number; destroy?: boolean }> = [];
  let sequence = 0; let rollbackFails = false;
  const pool = { async query<T>() { return { rows: [] as T[] }; }, async connect() {
    const id = ++sequence; let readOnly = false;
    const clearShared = () => { for (const holders of shared.values()) holders.delete(id); };
    return { async query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ client: id, sql, values }); const key = String(values?.[0]);
      if (sql.endsWith("READ ONLY")) readOnly = true;
      if (readOnly && sql.startsWith("UPDATE")) throw new Error("READ_ONLY_TRANSACTION");
      if (sql.includes("pg_try_advisory_xact_lock_shared")) {
        const locked = !exclusive.has(key) || exclusive.get(key) === id;
        if (locked) { const holders = shared.get(key) ?? new Set(); holders.add(id); shared.set(key, holders); }
        return { rows: [{ locked }] as T[] };
      }
      if (sql.includes("pg_try_advisory_lock")) {
        const locked = (!exclusive.has(key) || exclusive.get(key) === id) && ![...(shared.get(key) ?? [])].some((holder) => holder !== id);
        if (locked) exclusive.set(key, id); return { rows: [{ locked }] as T[] };
      }
      if (sql === "ROLLBACK" && rollbackFails) throw new Error("CONNECTION_LOST");
      if (sql === "COMMIT" || sql === "ROLLBACK") clearShared();
      return { rows: [] };
    }, release(destroy?: boolean) {
      releases.push({ client: id, destroy });
      if (destroy) { clearShared(); for (const [key, owner] of exclusive) if (owner === id) exclusive.delete(key); }
    } };
  } };
  return { pool, calls, releases, shared, rollbackFailure() { rollbackFails = true; } };
}
describe("tenant database shared/exclusive coordination (injected lock model)", () => {
  it("repeatable export transactions remain read-only and tenant scoped", async () => {
    const f = locks();
    await expect(withTenantDb(f.pool, { tenantId: "tenant-a", readOnly: true, repeatableRead: true }, db => db.query("UPDATE forbidden"))).rejects.toThrow("READ_ONLY_TRANSACTION");
    expect(f.calls[0]?.sql).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(f.calls.find(call => call.sql.includes("app.bypass_rls"))?.values).toEqual(["false"]);
    expect(f.calls.find(call => call.sql.includes("app.current_tenant_id"))?.values).toEqual(["tenant-a"]);
    const bad = locks();
    await expect(withTenantDb(bad.pool, { tenantId: "tenant-a", repeatableRead: true }, async () => {})).rejects.toThrow("TENANT_CONTEXT_INVALID");
    expect(bad.calls).toHaveLength(0);
  });

  it("same-tenant exclusive blocks callback, other tenant proceeds and read-only polls remain available", async () => {
    const f = locks(); const reset = await f.pool.connect();
    await reset.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [tenantDatabaseLockKey("tenant-a")]);
    const callback = vi.fn(async () => "changed");
    await expect(withTenantDb(f.pool, { tenantId: "tenant-a" }, callback)).rejects.toThrow("TENANT_DATABASE_BUSY"); expect(callback).not.toHaveBeenCalled();
    expect(await withTenantDb(f.pool, { tenantId: "tenant-b" }, callback)).toBe("changed");
    const reads = f.calls.length;
    await withTenantDb(f.pool, { tenantId: "tenant-a", readOnly: true }, async (db) => { await db.query("SELECT operation_status"); });
    expect(f.calls.slice(reads).map((call) => call.sql)).toContain("BEGIN READ ONLY");
    expect(f.calls.slice(reads).some((call) => call.sql.includes("advisory"))).toBe(false);
    await expect(withTenantDb(f.pool, { tenantId: "tenant-a", readOnly: true }, (db) => db.query("UPDATE forbidden"))).rejects.toThrow("READ_ONLY_TRANSACTION");
    reset.release(true);
  });
  it("existing shared transaction prevents exclusive acquisition until commit; same connection can reenter", async () => {
    const f = locks(); const reset = await f.pool.connect(); const key = tenantDatabaseLockKey("tenant-a");
    await withTenantDb(f.pool, { tenantId: "tenant-a" }, async () => {
      expect((await reset.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [key])).rows[0]?.locked).toBe(false);
    });
    expect((await reset.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [key])).rows[0]?.locked).toBe(true);
    await withTenantDb({ query: reset.query, connect: async () => ({ query: reset.query, release() {} }) }, { tenantId: "tenant-a" }, async () => {});
    const tx = f.calls.filter((call) => call.client === 2).map((call) => call.sql);
    expect(tx[0]).toBe("BEGIN"); expect(tx[1]).toContain("pg_try_advisory_xact_lock_shared"); expect(tx.at(-1)).toBe("COMMIT");
    reset.release(true);
  });
  it("rollback releases shared lock; failed rollback discards the connection and preserves original error", async () => {
    for (const broken of [false, true]) {
      const f = locks(); if (broken) f.rollbackFailure();
      await expect(withTenantDb(f.pool, { tenantId: "tenant-a" }, async () => { throw new Error("CALLBACK_FAILED"); })).rejects.toThrow("CALLBACK_FAILED");
      expect(f.releases).toEqual([{ client: 1, destroy: broken || undefined }]);
      expect([...(f.shared.get(tenantDatabaseLockKey("tenant-a")) ?? [])]).toHaveLength(0);
    }
  });
  it("malformed context never reaches database; no-connect and global bypass are explicitly outside coordination", async () => {
    const f = locks(); const callback = vi.fn(async () => "legacy");
    for (const tenantId of ["", " ", " tenant-a", undefined]) await expect(withTenantDb(f.pool, { tenantId, bypassRls: true } as never, callback)).rejects.toThrow();
    await expect(withTenantDb(f.pool, { tenantId: null, bypassRls: "true" } as never, callback)).rejects.toThrow();
    expect(f.calls).toHaveLength(0); expect(callback).not.toHaveBeenCalled();
    await withTenantDb(f.pool, { tenantId: null, bypassRls: true }, callback);
    expect(f.calls.some((call) => call.sql.includes("advisory"))).toBe(false);
    await expect(withTenantDb({ query: f.pool.query }, { tenantId: "tenant-a", readOnly: true }, callback)).rejects.toThrow("TENANT_DB_TRANSACTION_REQUIRED");
    expect(await withTenantDb({ query: f.pool.query }, { tenantId: "tenant-a" }, callback)).toBe("legacy");
  });
});
