import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresAttendanceStore } from "./attendance-store.js";

describe("PostgresAttendanceStore", () => {
  it("günlük sınıf kayıtlarını öğrenci kimlikleriyle tek sorguda okur", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return { rows: [] as T[] };
      },
    };
    const store = new PostgresAttendanceStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.listByStudentsDate(["student-a", "student-b"], "2026-06-03"),
    );

    const businessQuery = queries.find((query) => query.sql.includes('FROM "Attendance"'));
    expect(businessQuery?.sql).toContain('ANY($1::text[])');
    expect(businessQuery?.sql).toContain('"date" = $2::date');
    expect(businessQuery?.values).toEqual([["student-a", "student-b"], "2026-06-03"]);
  });
});
