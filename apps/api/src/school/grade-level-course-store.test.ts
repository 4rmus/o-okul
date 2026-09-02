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
});
