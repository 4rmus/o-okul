import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { InMemoryReportSnapshotStore, PostgresReportSnapshotStore } from "./report-snapshot-store.js";

describe("ReportSnapshotStore", () => {
  it("in-memory demo snapshotları tenant ve sınava göre süzer", async () => {
    const store = new InMemoryReportSnapshotStore();

    await expect(store.listByExam("tenant-a", "exam-demo")).resolves.toHaveLength(1);
    await expect(store.listByExam("tenant-b", "exam-demo")).resolves.toEqual([]);
    await expect(store.findById("tenant-a", "exam-demo", "snapshot-demo")).resolves.toMatchObject({
      id: "snapshot-demo",
    });
    await expect(store.findById("tenant-b", "exam-demo", "snapshot-demo")).resolves.toBeUndefined();
  });

  it("in-memory snapshotları sınav bazında STALE yapar", async () => {
    const store = new InMemoryReportSnapshotStore();

    await expect(store.markStaleByExam("tenant-a", "exam-demo", "answer_key.created")).resolves.toBe(1);
    await expect(store.findById("tenant-a", "exam-demo", "snapshot-demo")).resolves.toMatchObject({
      status: "STALE",
      inputRefs: expect.objectContaining({ staleReason: "answer_key.created" }),
    });
    await expect(store.markStaleByExam("tenant-a", "exam-demo", "answer_key.created")).resolves.toBe(0);
  });

  it("Postgres snapshot listesi için tenant-aware SQL kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [{
            id: "snapshot-a",
            tenantId: "tenant-a",
            examId: "exam-a",
            campusId: "campus-main",
            gradeLevelId: "grade-8",
            classId: "class-a",
            courseId: "course-math",
            termId: "term-2026-spring",
            reportType: "EXAM_RESULT_SUMMARY",
            status: "READY",
            inputRefs: { resultKeys: ["result-a"] },
            snapshotData: { resultCount: 1 },
            generatedAt: new Date("2026-06-06T09:00:00.000Z"),
            staleAt: null,
            deletedAt: null,
            createdAt: new Date("2026-06-06T09:00:00.000Z"),
            updatedAt: new Date("2026-06-06T09:00:00.000Z"),
          }] as T[],
        };
      },
    };
    const store = new PostgresReportSnapshotStore(pool);

    const snapshots = await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.listByExam("tenant-a", "exam-a"),
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('FROM "ReportSnapshot"');
    expect(businessQueries[0]?.sql).toContain('"tenantId" = $1');
    expect(businessQueries[0]?.values).toEqual(["tenant-a", "exam-a"]);
    expect(snapshots[0]).toMatchObject({
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
    });
    expect(snapshots[0]?.generatedAt).toBe("2026-06-06T09:00:00.000Z");
  });

  it("Postgres snapshot detayını tenant ve sınavla sınırlar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [{
            id: "snapshot-a",
            tenantId: "tenant-a",
            examId: "exam-a",
            campusId: null,
            gradeLevelId: null,
            classId: null,
            courseId: null,
            termId: null,
            reportType: "EXAM_RESULT_SUMMARY",
            status: "READY",
            inputRefs: { resultKeys: ["result-a"] },
            snapshotData: { resultCount: 1 },
            generatedAt: new Date("2026-06-06T09:00:00.000Z"),
            staleAt: null,
            deletedAt: null,
            createdAt: new Date("2026-06-06T09:00:00.000Z"),
            updatedAt: new Date("2026-06-06T09:00:00.000Z"),
          }] as T[],
        };
      },
    };
    const store = new PostgresReportSnapshotStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.findById("tenant-a", "exam-a", "snapshot-a"),
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(businessQueries[0]?.sql).toContain('"tenantId" = $1');
    expect(businessQueries[0]?.sql).toContain('"examId" = $2');
    expect(businessQueries[0]?.sql).toContain('"id" = $3');
    expect(businessQueries[0]?.values).toEqual(["tenant-a", "exam-a", "snapshot-a"]);
  });

  it("Postgres snapshotları tenant ve sınav bazında STALE yapar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return { rows: [] as T[], rowCount: sql.includes('UPDATE "ReportSnapshot"') ? 2 : 0 };
      },
    };
    const store = new PostgresReportSnapshotStore(pool);

    const changed = await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.markStaleByExam("tenant-a", "exam-a", "parser_config.approved"),
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(changed).toBe(2);
    expect(businessQueries[0]?.sql).toContain('UPDATE "ReportSnapshot"');
    expect(businessQueries[0]?.sql).toContain('"status" = \'STALE\'');
    expect(businessQueries[0]?.sql).toContain('"tenantId" = $1');
    expect(businessQueries[0]?.sql).toContain('"examId" = $2');
    expect(businessQueries[0]?.sql).toContain('"status" <> \'STALE\'');
    expect(businessQueries[0]?.values).toEqual([
      "tenant-a",
      "exam-a",
      JSON.stringify({ staleReason: "parser_config.approved" }),
    ]);
  });
});
