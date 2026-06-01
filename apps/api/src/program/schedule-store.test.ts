import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresScheduleStore } from "./schedule-store.js";

describe("PostgresScheduleStore", () => {
  it("ScheduleLesson CRUD için beklenen SQL parametrelerini kullanır", async () => {
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
              id: "lesson-a",
              tenantId: "tenant-a",
              classId: "class-a",
              teacherId: "teacher-a",
              title: "Matematik",
              startsAt: new Date("2026-06-01T09:00:00.000Z"),
              endsAt: new Date("2026-06-01T10:00:00.000Z"),
              deletedAt: null,
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresScheduleStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.list();
        await store.findById("lesson-a");
        await store.create({
          tenantId: "tenant-a",
          classId: "class-a",
          teacherId: "teacher-a",
          title: "Geometri",
          startsAt: "2026-06-01T10:00:00.000Z",
          endsAt: "2026-06-01T11:00:00.000Z",
        });
        await store.update("lesson-a", { title: "Analitik Geometri" });
        await store.softDelete("lesson-a", "2026-06-01T12:00:00.000Z");
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config"));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('SELECT * FROM "ScheduleLesson"');
    expect(businessQueries[1]?.values).toEqual(["lesson-a"]);
    const insertQuery = businessQueries.find((query) => query.sql.includes('INSERT INTO "ScheduleLesson"'));
    expect(insertQuery?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "class-a",
      "teacher-a",
      "Geometri",
      "2026-06-01T10:00:00.000Z",
      "2026-06-01T11:00:00.000Z",
    ]);
    const lessonConflictChecks = businessQueries.filter((query) => query.sql.includes('FROM "ScheduleLesson"') && query.sql.includes("SELECT 1 AS exists"));
    expect(lessonConflictChecks[0]?.values).toEqual([
      "tenant-a",
      "teacher-a",
      "2026-06-01T10:00:00.000Z",
      "2026-06-01T11:00:00.000Z",
      null,
    ]);
    const updateQueries = businessQueries.filter((query) => query.sql.includes('UPDATE "ScheduleLesson"'));
    expect(updateQueries[0]?.values).toEqual(["lesson-a", null, null, "Analitik Geometri", null, null]);
    expect(updateQueries[1]?.values).toEqual(["lesson-a", "2026-06-01T12:00:00.000Z"]);
  });

  it("Postgres yazımında öğretmen saat çakışmasını store katmanında reddeder", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes("SELECT 1 AS exists")) {
          return { rows: [{ exists: 1 }] as T[] };
        }
        return { rows: [] as T[] };
      },
    };

    const store = new PostgresScheduleStore(pool);

    await expect(
      runWithRequestContext(
        { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
        () =>
          store.create({
            tenantId: "tenant-a",
            classId: "class-a",
            teacherId: "teacher-a",
            title: "Geometri",
            startsAt: "2026-06-01T10:00:00.000Z",
            endsAt: "2026-06-01T11:00:00.000Z",
          }),
      ),
    ).rejects.toThrow("SCHEDULE_TEACHER_CONFLICT");

    expect(queries.some((query) => query.sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(queries.some((query) => query.sql.includes('INSERT INTO "ScheduleLesson"'))).toBe(false);
  });
});
