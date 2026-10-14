import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { InMemoryGradeLevelCourseStore, PostgresGradeLevelCourseStore } from "./grade-level-course-store.js";

const input = {
  tenantId: "tenant-a",
  gradeLevelId: "grade-8",
  courseId: "course-science",
  courseName: "Fen Bilgisi",
  courseCode: "FEN",
};

describe("GradeLevelCourseStore", () => {
  it("memory adapter aynı tenant-seviye-ders bağlantısını bir kez oluşturur", async () => {
    const store = new InMemoryGradeLevelCourseStore();

    const first = await store.ensure(input);
    const second = await store.ensure(input);

    expect(first).toBeTruthy();
    expect(second).toBeUndefined();
    await expect(store.listByGradeLevel(input.gradeLevelId)).resolves.toHaveLength(2);
  });

  it("postgres adapter mevcut kısmi unique indeksini idempotent kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('INSERT INTO "GradeLevelCourse"')) return { rows: [{ id: "grade-course-science" }] as T[] };
        return { rows: [] as T[] };
      },
    };

    const result = await runWithRequestContext(
      { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => new PostgresGradeLevelCourseStore(pool).ensure(input),
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(result).toBe("grade-course-science");
    expect(businessQueries[0]?.sql).toContain('ON CONFLICT ("tenantId", "gradeLevelId", "courseId") WHERE "alanId" IS NULL DO NOTHING');
    expect(businessQueries[0]?.values).toEqual([expect.any(String), "tenant-a", "grade-8", "course-science"]);
  });

  it("postgres adapter bağı tek sorguda aktif atama korumasıyla siler, 0 satırda IN_USE/NOT_FOUND ayırır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    let deletedRows: Array<{ id: string }> = [{ id: "grade-course-science" }];
    let existingRows: Array<{ id: string }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('DELETE FROM "GradeLevelCourse"')) return { rows: deletedRows as T[] };
        if (sql.includes('SELECT "id" FROM "GradeLevelCourse"')) return { rows: existingRows as T[] };
        return { rows: [] as T[] };
      },
    };
    const store = new PostgresGradeLevelCourseStore(pool);
    const input = { tenantId: "tenant-a", gradeLevelId: "grade-8", courseId: "course-science" };

    await expect(runWithRequestContext({ userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false }, () => store.remove(input))).resolves.toEqual({ outcome: "REMOVED", id: "grade-course-science" });
    const business = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(business).toHaveLength(1);
    expect(business[0]?.sql).toContain('"alanId" IS NULL');
    expect(business[0]?.sql).toContain('FROM "TeacherAssignment" ta');
    expect(business[0]?.sql).toContain('ta."endsAt" >= CURRENT_DATE');
    expect(business[0]?.sql).toContain('alt."alanId" = c."alanId"');
    expect(business[0]?.sql).toContain('RETURNING glc."id"');
    expect(business[0]?.values).toEqual(["tenant-a", "grade-8", "course-science"]);

    deletedRows = [];
    existingRows = [{ id: "grade-course-science" }];
    await expect(runWithRequestContext({ userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false }, () => store.remove(input))).resolves.toEqual({ outcome: "IN_USE" });
    existingRows = [];
    await expect(runWithRequestContext({ userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false }, () => store.remove(input))).resolves.toEqual({ outcome: "NOT_FOUND" });
  });
});
