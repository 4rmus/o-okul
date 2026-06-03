import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresTeacherStore } from "./teacher-store.js";

describe("PostgresTeacherStore", () => {
  it("Teacher CRUD için beklenen SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [
            {
              id: "teacher-a",
              tenantId: "tenant-a",
              firstName: "Ayse",
              lastName: "Ogretmen",
              branch: "Matematik",
              deletedAt: null,
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresTeacherStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.list();
        await store.findById("teacher-a");
        await store.create({ tenantId: "tenant-a", firstName: "Ece", lastName: "Ogretmen", branch: "Fen" });
        await store.update("teacher-a", { firstName: "Ayse Guncel" });
        await store.purgePii("teacher-a");
        await store.softDelete("teacher-a", "2026-06-01T12:00:00.000Z");
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('SELECT * FROM "Teacher"');
    expect(businessQueries[1]?.values).toEqual(["teacher-a"]);
    expect(businessQueries[2]?.sql).toContain('INSERT INTO "Teacher"');
    expect(businessQueries[2]?.values).toEqual([expect.any(String), "tenant-a", "Ece", "Ogretmen", "Fen"]);
    expect(businessQueries[4]?.sql).toContain('UPDATE "Teacher"');
    expect(businessQueries[4]?.values).toEqual(["teacher-a", "Ayse Guncel", null, false, null]);
    expect(businessQueries[6]?.sql).toContain('"firstName" = \'Anonim\'');
    expect(businessQueries[8]?.values).toEqual(["teacher-a", "2026-06-01T12:00:00.000Z"]);
  });
});
