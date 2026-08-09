import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresAnnouncementStore } from "./announcement-store.js";

describe("PostgresAnnouncementStore", () => {
  it("Announcement akışı için beklenen tenant-aware SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [
            {
              id: "announcement-a",
              tenantId: "tenant-a",
              title: "Veli toplantısı",
              body: "Cuma günü 8-A sınıfı için veli toplantısı yapılacaktır.",
              audience: "SCHOOL",
              campusId: "campus-main",
              gradeLevelId: "grade-8",
              classId: "class-a",
              courseId: "course-math",
              termId: "term-2026-spring",
              studentId: "student-a",
              publishedAt: new Date("2026-06-08T09:00:00.000Z"),
              deletedAt: null,
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresAnnouncementStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.list();
        await store.findById("announcement-a");
        await store.create({
          tenantId: "tenant-a",
          title: "Servis saati",
          body: "Pazartesi servisleri 08:30'da hareket edecektir.",
          audience: "SCHOOL",
          campusId: "campus-main",
          gradeLevelId: "grade-8",
          classId: "class-a",
          courseId: "course-math",
          termId: "term-2026-spring",
          studentId: "student-a",
          publishedAt: "2026-06-08T10:00:00.000Z",
        });
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('SELECT * FROM "Announcement"');
    expect(businessQueries[1]?.sql).toContain('WHERE "id" = $1');
    expect(businessQueries[1]?.values).toEqual(["announcement-a"]);
    expect(businessQueries[2]?.sql).toContain('INSERT INTO "Announcement"');
    expect(businessQueries[2]?.values?.[0]).toEqual(expect.any(String));
    expect(businessQueries[2]?.values?.slice(1)).toEqual([
      "tenant-a",
      "Servis saati",
      "Pazartesi servisleri 08:30'da hareket edecektir.",
      "SCHOOL",
      "campus-main",
      "grade-8",
      "class-a",
      "course-math",
      "term-2026-spring",
      "student-a",
      "2026-06-08T10:00:00.000Z",
    ]);
  });
});
