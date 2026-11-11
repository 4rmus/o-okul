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

  it("student progress preserves frozen comparison scope and only the requested student's rows", async () => {
    const demo = (await new InMemoryReportSnapshotStore().listByExam("tenant-a", "exam-demo"))[0]!;
    const frozen = {
      ...demo,
      snapshotData: {
        ...demo.snapshotData,
        examType: "LGS", examYear: 2026, scoringProfileId: "TR-LGS-2026-NOSD-V1",
        examStartsAt: "2026-06-01T07:00:00Z", examTitle: "Deneme 1",
        students: [...(demo.snapshotData!.students as object[]), { studentId: "student-other", displayName: "Private other student" }],
        privateExtra: "do not project",
      },
    };
    const before = structuredClone(frozen);
    const store = new InMemoryReportSnapshotStore({ snapshots: [frozen, { ...frozen, id: "foreign", tenantId: "tenant-b" }] });
    const [projected] = await store.listReadyByStudent("tenant-a", "student-a", "exam-demo");
    expect(projected?.snapshotData).toEqual({
      generatedAt: "2026-06-06T09:00:00.000Z",
      examType: "LGS", examYear: 2026, scoringProfileId: "TR-LGS-2026-NOSD-V1",
      examStartsAt: "2026-06-01T07:00:00Z", examTitle: "Deneme 1",
      students: demo.snapshotData!.students,
    });
    expect(frozen).toEqual(before);
    expect(await store.listReadyByStudent("tenant-a", "missing")).toEqual([]);
    const legacy = (await new InMemoryReportSnapshotStore().listReadyByStudent("tenant-a", "student-a"))[0]!;
    for (const field of ["examType", "examYear", "scoringProfileId"]) expect(legacy.snapshotData).not.toHaveProperty(field);
  });

  it("Postgres student progress explicitly projects comparison scope with tenant/student guards", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresReportSnapshotStore({
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return { rows: [] as T[] };
      },
    });
    await runWithRequestContext(
      { tenantId: "tenant-a", userId: "user-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.listReadyByStudent("tenant-a", "student-a", "exam-a"),
    );
    const query = queries.find(({ sql }) => sql.includes('FROM "ReportSnapshot" AS snapshot'))!;
    for (const field of ["examType", "examYear", "scoringProfileId", "examStartsAt", "examTitle"]) {
      expect(query.sql).toContain(`'${field}', snapshot."snapshotData"->'${field}'`);
    }
    expect(query.sql).toContain('snapshot."tenantId" = $1');
    expect(query.sql).toContain('snapshot."status" = \'READY\'');
    expect(query.sql).toContain('snapshot."deletedAt" IS NULL');
    expect(query.sql).toContain('snapshot."examId" = $3');
    expect(query.sql).toContain("WHERE student->>'studentId' = $2");
    expect(query.sql).not.toContain('snapshot."snapshotData",');
    expect(query.values).toEqual(["tenant-a", "student-a", "exam-a"]);
  });

  it("in-memory portal indeksinde yalnız kimlik ve tarih alanlarını taşır", async () => {
    const store = new InMemoryReportSnapshotStore();

    const [snapshot] = await store.listIndexByTenant("tenant-a");

    expect(snapshot?.snapshotData).toEqual({
      generatedAt: "2026-06-06T09:00:00.000Z",
      students: [{ studentId: "student-a", classId: "class-a" }],
    });
    expect(JSON.stringify(snapshot)).not.toContain("Ada A");
    expect(JSON.stringify(snapshot)).not.toContain("1001");
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

  it("in-memory snapshot öğrenci kimliğini tenant kapsamında temizler", async () => {
    const store = new InMemoryReportSnapshotStore();

    await expect(store.purgeStudentIdentity("tenant-b", "student-a")).resolves.toBe(0);
    await expect(store.purgeStudentIdentity("tenant-a", "student-a")).resolves.toBe(1);
    const snapshot = await store.findById("tenant-a", "exam-demo", "snapshot-demo");
    const students = snapshot?.snapshotData?.students as Array<Record<string, unknown>> | undefined;
    const student = students?.[0];
    expect(student).toMatchObject({ studentId: "student-a", className: "8-A" });
    expect(student).not.toHaveProperty("displayName");
    expect(student).not.toHaveProperty("studentNo");
    await expect(store.purgeStudentIdentity("tenant-a", "student-a")).resolves.toBe(0);
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

  it("Postgres portal indeksinde tam snapshotData yerine öğrenci referansı projeksiyonu okur", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return { rows: [] as T[] };
      },
    };
    const store = new PostgresReportSnapshotStore(pool);

    await runWithRequestContext(
      { userId: "student-user-a", tenantId: "tenant-a", roles: ["STUDENT"], bypassRls: false },
      () => store.listIndexByTenant("tenant-a"),
    );

    const businessQuery = queries.find((query) => query.sql.includes('FROM "ReportSnapshot" AS snapshot'));
    expect(businessQuery?.sql).toContain("jsonb_build_object(");
    expect(businessQuery?.sql).toContain("'studentId', student->>'studentId'");
    expect(businessQuery?.sql).toContain("'classId', student->>'classId'");
    expect(businessQuery?.sql).not.toContain('snapshot."snapshotData",');
    expect(businessQuery?.values).toEqual(["tenant-a"]);
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
    expect(businessQueries[0]?.sql).toContain('linked_exam."tenantId" = $1');
    expect(businessQueries[0]?.sql).toContain('linked_exam."linkedTytExamId" = $2');
    expect(businessQueries[0]?.sql).toContain('"status" <> \'STALE\'');
    expect(businessQueries[0]?.values).toEqual([
      "tenant-a",
      "exam-a",
      JSON.stringify({ staleReason: "parser_config.approved" }),
    ]);
  });

  it("Postgres snapshot öğrenci kimliğini JSONB içinde tenant kapsamında temizler", async () => {
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
      () => store.purgeStudentIdentity("tenant-a", "student-a"),
    );

    const businessQuery = queries.find((query) => query.sql.includes('UPDATE "ReportSnapshot"'));
    expect(changed).toBe(2);
    expect(businessQuery?.sql).toContain('snapshot."tenantId" = $1');
    expect(businessQuery?.sql).toContain("student->>'studentId' = $2");
    expect(businessQuery?.sql).toContain("student - 'displayName' - 'studentNo'");
    expect(businessQuery?.values).toEqual(["tenant-a", "student-a"]);
  });

  it("Postgres seviye analitiği yalnız seviye snapshot projeksiyonunu tenant ve yayın koşuluyla okur (DEC-20261102-08)", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return { rows: [] as T[] };
      },
    };
    const store = new PostgresReportSnapshotStore(pool);

    await expect(runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.listGradeLevelAnalytics("tenant-a", { gradeLevelId: "grade-8", examType: "LGS" }),
    )).resolves.toEqual({ snapshots: [], examsWithoutLevelReport: [] });

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(businessQueries).toHaveLength(2);
    for (const query of businessQueries) {
      expect(query.values).toEqual(["tenant-a", "grade-8", "LGS", null, "EXAM_RESULT_SUMMARY"]);
      expect(query.sql).toContain('exam."tenantId" = $1');
      expect(query.sql).toContain(`exam."status" = 'PUBLISHED'`);
      expect(query.sql).toContain('snapshot."gradeLevelId" = $2');
      expect(query.sql).toContain('snapshot."classId" IS NULL');
      expect(query.sql).toContain('snapshot."campusId" IS NULL');
      expect(query.sql).toContain('snapshot."courseId" IS NULL');
      expect(query.sql).toContain('snapshot."deletedAt" IS NULL');
    }
    expect(businessQueries[0]?.sql).toContain('snapshot."tenantId" = $1');
    // Projection: only averages and resultCount leave the snapshot JSON; the student array is never read.
    expect(businessQueries[0]?.sql).not.toContain("students");
    expect(businessQueries[0]?.sql).not.toMatch(/snapshot\."snapshotData",/);
  });

  it("in-memory seviye analitiği varsayılan demo snapshot'ını seviye rakamı saymaz", async () => {
    const store = new InMemoryReportSnapshotStore();

    await expect(store.listGradeLevelAnalytics("tenant-a", { gradeLevelId: "grade-8" }))
      .resolves.toEqual({ snapshots: [], examsWithoutLevelReport: [] });
  });
});
