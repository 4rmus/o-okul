import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { withTenantQuery } from "./tenant-query.js";

describe("withTenantQuery", () => {
  it("tenant context olmadan DB erişimini reddeder", async () => {
    await expect(withTenantQuery({ async query() { return { rows: [] }; } }, async () => "ok")).rejects.toThrow(
      "REQUEST_CONTEXT_MISSING",
    );
  });

  it("tenant ayarlarını transaction içinde set eder ve commit eder", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return { rows: [{ ok: true }] as T[] };
      },
      release() {
        queries.push({ sql: "RELEASE" });
      },
    };
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return { rows: [] as T[] };
      },
      async connect() {
        return client;
      },
    };

    const result = await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => withTenantQuery(pool, (db) => db.query("SELECT 1")),
    );

    expect(result.rows).toEqual([{ ok: true }]);
    expect(queries.map((query) => query.sql)).toEqual([
      "BEGIN",
      "SELECT set_config('app.bypass_rls', $1, true)",
      "SELECT set_config('app.current_tenant_id', $1, true)",
      "SELECT 1",
      "COMMIT",
      "RELEASE",
    ]);
    expect(queries[1]?.values).toEqual(["false"]);
    expect(queries[2]?.values).toEqual(["tenant-a"]);
  });

  it("hata olursa rollback eder", async () => {
    const queries: string[] = [];
    const client = {
      async query<T>(sql: string) {
        queries.push(sql);
        if (sql === "SELECT broken") throw new Error("BROKEN_QUERY");
        return { rows: [] as T[] };
      },
      release() {
        queries.push("RELEASE");
      },
    };
    const pool = {
      async query<T>(sql: string) {
        queries.push(sql);
        return { rows: [] as T[] };
      },
      async connect() {
        return client;
      },
    };

    await expect(
      runWithRequestContext(
        { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
        () => withTenantQuery(pool, (db) => db.query("SELECT broken")),
      ),
    ).rejects.toThrow("BROKEN_QUERY");

    expect(queries).toEqual([
      "BEGIN",
      "SELECT set_config('app.bypass_rls', $1, true)",
      "SELECT set_config('app.current_tenant_id', $1, true)",
      "SELECT broken",
      "ROLLBACK",
      "RELEASE",
    ]);
  });

  it("system admin için bypass ayarını tenant id olmadan set eder", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return { rows: [] as T[] };
      },
    };

    await runWithRequestContext(
      { userId: "user-system", tenantId: null, roles: ["SYSTEM_ADMIN"], bypassRls: true },
      () => withTenantQuery(pool, (db) => db.query("SELECT system_scope")),
    );

    expect(queries).toEqual([
      { sql: "SELECT set_config('app.bypass_rls', $1, true)", values: ["true"] },
      { sql: "SELECT system_scope", values: undefined },
    ]);
  });
});
