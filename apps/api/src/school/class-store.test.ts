import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresClassStore } from "./class-store.js";

describe("PostgresClassStore", () => {
  it("Class CRUD için beklenen SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [
            {
              id: "class-a",
              tenantId: "tenant-a",
              name: "8-A",
              level: "8",
              deletedAt: null,
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresClassStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.list();
        await store.findById("class-a");
        await store.create({ tenantId: "tenant-a", name: "9-A", level: "9" });
        await store.update("class-a", { name: "9 Fen" });
        await store.softDelete("class-a", "2026-05-29T20:00:00.000Z");
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('SELECT * FROM "Class"');
    expect(businessQueries[1]?.values).toEqual(["class-a"]);
    expect(businessQueries[2]?.sql).toContain('INSERT INTO "Class"');
    expect(businessQueries[2]?.values).toEqual([expect.any(String), "tenant-a", null, null, "9-A", "9", null]);
    expect(businessQueries[4]?.sql).toContain('UPDATE "Class"');
    expect(businessQueries[4]?.values).toEqual(["class-a", "9 Fen", false, null, false, null, false, null, false, null]);
    expect(businessQueries[6]?.values).toEqual(["class-a", "2026-05-29T20:00:00.000Z"]);
  });
});
