import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresStudySessionStore } from "./study-session-store.js";

describe("PostgresStudySessionStore", () => {
  it("StudySession ve öğrenci bağlantıları için beklenen SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes("pg_advisory_xact_lock") || sql.includes("SELECT 1 AS exists")) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "study-a",
              tenantId: "tenant-a",
              classId: "class-a",
              teacherId: "teacher-a",
              studentIds: ["student-a"],
              title: "Matematik Etut",
              capacity: 4,
              startsAt: new Date("2026-06-02T13:00:00.000Z"),
              endsAt: new Date("2026-06-02T14:00:00.000Z"),
              deletedAt: null,
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresStudySessionStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.list();
        await store.findById("study-a");
        await store.create({
          tenantId: "tenant-a",
          classId: "class-a",
          teacherId: "teacher-a",
          studentIds: ["student-a"],
          title: "Problem Çözümü",
          capacity: 2,
          startsAt: "2026-06-02T14:00:00.000Z",
          endsAt: "2026-06-02T15:00:00.000Z",
        });
        await store.update("study-a", { title: "Problem Tekrarı", capacity: 3, studentIds: ["student-a"] });
        await store.update("study-a", { title: "Problem Pekiştirme" });
        await store.softDelete("study-a", "2026-06-02T16:00:00.000Z");
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config"));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('LEFT JOIN "StudySessionStudent"');
    expect(businessQueries[1]?.values).toEqual(["study-a"]);
    const insertSessionQuery = businessQueries.find((query) => query.sql.includes('INSERT INTO "StudySession"'));
    expect(insertSessionQuery?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "class-a",
      "teacher-a",
      "Problem Çözümü",
      2,
      "2026-06-02T14:00:00.000Z",
      "2026-06-02T15:00:00.000Z",
    ]);
    const studentDeleteQueries = businessQueries.filter((query) => query.sql.includes('DELETE FROM "StudySessionStudent"'));
    expect(studentDeleteQueries[0]?.values).toEqual(["tenant-a", "study-a"]);
    const studentInsertQueries = businessQueries.filter((query) => query.sql.includes('INSERT INTO "StudySessionStudent"'));
    expect(studentInsertQueries[0]?.values).toEqual([[expect.any(String)], "tenant-a", "study-a", ["student-a"]]);
    const conflictChecks = businessQueries.filter((query) => query.sql.includes("SELECT 1 AS exists"));
    expect(conflictChecks[0]?.values).toEqual([
      "tenant-a",
      "teacher-a",
      "2026-06-02T14:00:00.000Z",
      "2026-06-02T15:00:00.000Z",
      null,
    ]);
    expect(conflictChecks[1]?.values).toEqual([
      "tenant-a",
      ["student-a"],
      "2026-06-02T14:00:00.000Z",
      "2026-06-02T15:00:00.000Z",
      null,
    ]);
    const updateQueries = businessQueries.filter((query) => query.sql.includes('UPDATE "StudySession"'));
    expect(updateQueries[0]?.values).toEqual(["study-a", null, null, "Problem Tekrarı", 3, null, null]);
    expect(studentDeleteQueries[1]?.values).toEqual(["tenant-a", "study-a"]);
    expect(studentInsertQueries[1]?.values).toEqual([[expect.any(String)], "tenant-a", "study-a", ["student-a"]]);
    expect(updateQueries[1]?.values).toEqual(["study-a", null, null, "Problem Pekiştirme", null, null, null]);
    expect(updateQueries[2]?.values).toEqual(["study-a", "2026-06-02T16:00:00.000Z"]);
  });

  it("Postgres yazımında öğrenci saat çakışmasını store katmanında reddeder", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('INNER JOIN "StudySessionStudent"')) {
          return { rows: [{ exists: 1 }] as T[] };
        }
        return { rows: [] as T[] };
      },
    };

    const store = new PostgresStudySessionStore(pool);

    await expect(
      runWithRequestContext(
        { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
        () =>
          store.create({
            tenantId: "tenant-a",
            classId: "class-a",
            teacherId: "teacher-a",
            studentIds: ["student-a"],
            title: "Problem Çözümü",
            capacity: 2,
            startsAt: "2026-06-02T14:00:00.000Z",
            endsAt: "2026-06-02T15:00:00.000Z",
          }),
      ),
    ).rejects.toThrow("STUDY_SESSION_STUDENT_CONFLICT");

    expect(queries.some((query) => query.sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(queries.some((query) => query.sql.includes('INSERT INTO "StudySession"'))).toBe(false);
  });
});
