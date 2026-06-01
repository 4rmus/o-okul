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

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config"));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('FROM "ReportSnapshot"');
    expect(businessQueries[0]?.sql).toContain('"tenantId" = $1');
    expect(businessQueries[0]?.values).toEqual(["tenant-a", "exam-a"]);
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

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config"));
    expect(businessQueries[0]?.sql).toContain('"tenantId" = $1');
    expect(businessQueries[0]?.sql).toContain('"examId" = $2');
    expect(businessQueries[0]?.sql).toContain('"id" = $3');
    expect(businessQueries[0]?.values).toEqual(["tenant-a", "exam-a", "snapshot-a"]);
  });
});
