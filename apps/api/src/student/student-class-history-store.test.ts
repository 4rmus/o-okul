import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresStudentClassHistoryStore } from "./student-class-history-store.js";

describe("PostgresStudentClassHistoryStore", () => {
  it("StudentClassHistory işlemleri için beklenen SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [
            {
              id: "student-class-history-a",
              tenantId: "tenant-a",
              studentId: "student-a",
              classId: "class-a",
              startsAt: "2026-06-01",
              endsAt: null,
              reason: "CREATED",
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresStudentClassHistoryStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.listByStudent("student-a");
        await store.create({
          tenantId: "tenant-a",
          studentId: "student-a",
          classId: "class-a",
          startsAt: "2026-06-01",
          reason: "CREATED",
        });
        await store.closeActiveForStudent("student-a", "2026-06-02");
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config"));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('FROM "StudentClassHistory"');
    expect(businessQueries[0]?.values).toEqual(["student-a"]);
    expect(businessQueries[1]?.sql).toContain('INSERT INTO "StudentClassHistory"');
    expect(businessQueries[1]?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "student-a",
      "class-a",
      "2026-06-01",
      null,
      "CREATED",
    ]);
    expect(businessQueries[2]?.sql).toContain('UPDATE "StudentClassHistory"');
    expect(businessQueries[2]?.values).toEqual(["student-a", "2026-06-02"]);
  });
});
