import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresStudentEnrollmentStore } from "./student-enrollment-store.js";

describe("PostgresStudentEnrollmentStore", () => {
  it("birden çok öğrencinin enrollment kayıtlarını tek sorguda okur", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return { rows: [] as T[] };
      },
    };

    const store = new PostgresStudentEnrollmentStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.listByStudents(["student-a", "student-b"]),
    );

    const businessQuery = queries.find((query) => query.sql.includes('FROM "StudentEnrollment"'));
    expect(businessQuery?.sql).toContain('ANY($1::text[])');
    expect(businessQuery?.values).toEqual([["student-a", "student-b"]]);
  });

  it("StudentEnrollment işlemleri için beklenen SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [
            {
              id: "student-enrollment-a",
              tenantId: "tenant-a",
              studentId: "student-a",
              academicYearId: "academic-year-2026",
              termId: "term-2026-spring",
              classId: "class-a",
              status: "ACTIVE",
              startsAt: "2026-06-01",
              endsAt: null,
              reason: "CREATED",
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresStudentEnrollmentStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.listByStudent("student-a");
        await store.create({
          tenantId: "tenant-a",
          studentId: "student-a",
          academicYearId: "academic-year-2026",
          termId: "term-2026-spring",
          classId: "class-a",
          status: "ACTIVE",
          startsAt: "2026-06-01",
          reason: "RENEWED",
        });
        await store.closeActiveForStudent("student-a", "2026-06-30", "GRADUATED");
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('FROM "StudentEnrollment"');
    expect(businessQueries[0]?.values).toEqual(["student-a"]);
    expect(businessQueries[1]?.sql).toContain('INSERT INTO "StudentEnrollment"');
    expect(businessQueries[1]?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "student-a",
      "academic-year-2026",
      "term-2026-spring",
      "class-a",
      "ACTIVE",
      "2026-06-01",
      null,
      "RENEWED",
    ]);
    expect(businessQueries[2]?.sql).toContain('UPDATE "StudentEnrollment"');
    expect(businessQueries[2]?.values).toEqual(["student-a", "2026-06-30", "GRADUATED"]);
  });
});
