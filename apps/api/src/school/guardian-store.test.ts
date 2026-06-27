import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresGuardianStore } from "./guardian-store.js";

describe("PostgresGuardianStore", () => {
  it("Guardian CRUD için beklenen SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [
            {
              id: "guardian-a",
              tenantId: "tenant-a",
              firstName: "Ali",
              lastName: "Veli",
              phone: "5000000001",
              deletedAt: null,
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresGuardianStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.list();
        await store.findById("guardian-a");
        await store.create({ tenantId: "tenant-a", firstName: "Can", lastName: "Veli", phone: "5000000010" });
        await store.update("guardian-a", { phone: "5000000011" });
        await store.purgePii("guardian-a");
        await store.softDelete("guardian-a", "2026-06-01T12:00:00.000Z");
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('SELECT * FROM "Guardian"');
    expect(businessQueries[1]?.values).toEqual(["guardian-a"]);
    expect(businessQueries[2]?.sql).toContain('INSERT INTO "Guardian"');
    expect(businessQueries[2]?.values).toEqual([expect.any(String), "tenant-a", "Can", "Veli", "5000000010", null, null]);
    expect(businessQueries[4]?.sql).toContain('UPDATE "Guardian"');
    expect(businessQueries[4]?.values).toEqual(["guardian-a", null, null, true, "5000000011", null, null]);
    expect(businessQueries[6]?.sql).toContain('"phone" = NULL');
    expect(businessQueries[8]?.values).toEqual(["guardian-a", "2026-06-01T12:00:00.000Z"]);
  });
});
