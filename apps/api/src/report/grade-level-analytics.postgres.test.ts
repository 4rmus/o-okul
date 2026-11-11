import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { runWithRequestContext, type RequestContext } from "../context/request-context.js";
import { GradeLevelAnalyticsService, type GradeLevelAnalyticsQuery } from "./grade-level-analytics.service.js";
import { createGradeLevelAnalyticsFixtures, gradeLevelAnalyticsTermBoundaryExtras } from "./grade-level-analytics.test-support.js";
import { InMemoryReportSnapshotStore, PostgresReportSnapshotStore } from "./report-snapshot-store.js";

const appUrl = process.env.LEVEL_ANALYTICS_POSTGRES_TEST_URL, adminUrl = process.env.LEVEL_ANALYTICS_POSTGRES_ADMIN_URL;
if (process.env.LEVEL_ANALYTICS_POSTGRES_REQUIRED === "1" && (!appUrl || !adminUrl)) throw new Error("LEVEL_ANALYTICS_POSTGRES_URLS_REQUIRED");
for (const value of [appUrl, adminUrl].filter(Boolean)) {
  const url = new URL(value!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !(url.pathname === "/o_okul_level_analytics_test" || (process.env.GITHUB_ACTIONS === "true" && url.pathname === "/o_okul"))) {
    throw new Error("DISPOSABLE_POSTGRES_REQUIRED");
  }
}

// DEC-20261102-08 (G3): the Postgres projection is loaded with the same fixture as the in-memory twin
// (grade-level-analytics.test-support.ts) and must return the same analytics, under the restricted app role and RLS.
const run = appUrl && adminUrl ? describe : describe.skip;

run("grade-level analytics projection with restricted app role and RLS", () => {
  const app = new pg.Pool({ connectionString: appUrl }), admin = new pg.Pool({ connectionString: adminUrl });
  const [tenantA, tenantB] = ["a", "b"].map((suffix) => `level-analytics-${randomUUID()}-${suffix}`) as [string, string];
  const tenantMap = new Map([["tenant-a", tenantA], ["tenant-b", tenantB]]);
  const scoped = (tenant: string, value: string) => `${tenant}-${value}`;
  // The grade-6 term-boundary witnesses ride on the shared fixture; they never touch the grade-8/grade-7 assertions.
  const fixtures = createGradeLevelAnalyticsFixtures(gradeLevelAnalyticsTermBoundaryExtras());
  const context = (tenantId: string): RequestContext => ({
    userId: "fixture",
    tenantId,
    roles: ["TENANT_ADMIN"],
    bypassRls: false,
    activePersona: "STAFF",
    campusScope: { scopeMode: "TENANT", campusIds: [] },
  });

  beforeAll(async () => {
    const db = await admin.connect();
    try {
      await db.query("BEGIN");
      for (const tenant of [tenantA, tenantB]) {
        const t = (value: string) => scoped(tenant, value);
        await db.query('INSERT INTO "Tenant" (id,slug,name,status,"updatedAt") VALUES ($1,$1,\'Level analytics fixture\',\'ACTIVE\',now())', [tenant]);
        for (const gradeLevel of ["grade-6", "grade-7", "grade-8"]) {
          await db.query('INSERT INTO "GradeLevel" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,$3,now())', [t(gradeLevel), tenant, gradeLevel]);
        }
        await db.query('INSERT INTO "Campus" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,\'Merkez\',now())', [t("campus-main"), tenant]);
        await db.query('INSERT INTO "Class" (id,"tenantId","campusId","gradeLevelId",name,"updatedAt") VALUES ($1,$2,$3,$4,\'8-A\',now())', [t("class-8a"), tenant, t("campus-main"), t("grade-8")]);
        await db.query('INSERT INTO "Course" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,\'Matematik\',now())', [t("course-math"), tenant]);
        await db.query('INSERT INTO "AcademicYear" (id,"tenantId",name,"startsAt","endsAt","updatedAt") VALUES ($1,$2,\'2026-2027\',\'2026-09-01\',\'2027-06-30\',now())', [t("year"), tenant]);
      }
      for (const term of fixtures.terms ?? []) {
        const tenant = tenantMap.get(term.tenantId)!;
        await db.query(
          'INSERT INTO "AcademicTerm" (id,"tenantId","academicYearId",name,"startsAt","endsAt","updatedAt") VALUES ($1,$2,$3,\'1. Dönem\',$4,$5,now())',
          [scoped(tenant, term.id), tenant, scoped(tenant, "year"), term.startsAt, term.endsAt],
        );
      }
      for (const exam of fixtures.exams ?? []) {
        const tenant = tenantMap.get(exam.tenantId)!;
        await db.query(
          'INSERT INTO "Exam" (id,"tenantId","gradeLevelId","examType",title,status,"startsAt","deletedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())',
          [
            scoped(tenant, exam.id), tenant, exam.gradeLevelId ? scoped(tenant, exam.gradeLevelId) : null, exam.examType ?? null,
            exam.title, exam.status, toUtcWallTime(exam.startsAt), toDate(exam.deletedAt),
          ],
        );
      }
      for (const snapshot of fixtures.snapshots ?? []) {
        const tenant = tenantMap.get(snapshot.tenantId)!;
        const ref = (value: string | undefined) => value ? scoped(tenant, value) : null;
        await db.query(
          `INSERT INTO "ReportSnapshot" (id,"tenantId","examId","campusId","gradeLevelId","classId","courseId","termId","reportType","contentHash",status,"inputRefs","snapshotData","generatedAt","staleAt","deletedAt","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$1,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17)`,
          [
            scoped(tenant, snapshot.id), tenant, scoped(tenant, snapshot.examId), ref(snapshot.campusId), ref(snapshot.gradeLevelId),
            ref(snapshot.classId), ref(snapshot.courseId), ref(snapshot.termId), snapshot.reportType, snapshot.status,
            JSON.stringify(snapshot.inputRefs), JSON.stringify(snapshot.snapshotData ?? null), toDate(snapshot.generatedAt),
            toDate(snapshot.staleAt), toDate(snapshot.deletedAt), toDate(snapshot.createdAt), toDate(snapshot.updatedAt),
          ],
        );
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  });

  afterAll(async () => {
    try {
      for (const table of ["ReportSnapshot", "Exam", "AcademicTerm", "AcademicYear", "Course", "Class", "Campus", "GradeLevel"]) {
        await admin.query(`DELETE FROM "${table}" WHERE "tenantId"=ANY($1::text[])`, [[tenantA, tenantB]]);
      }
      await admin.query('DELETE FROM "Tenant" WHERE id=ANY($1::text[])', [[tenantA, tenantB]]);
    } finally {
      await Promise.all([app.end(), admin.end()]);
    }
  });

  async function postgresAnalytics(tenant: string, query: GradeLevelAnalyticsQuery) {
    const service = new GradeLevelAnalyticsService(new PostgresReportSnapshotStore(app));
    const scopedQuery = {
      ...query,
      ...(query.gradeLevelId ? { gradeLevelId: scoped(tenant, query.gradeLevelId) } : {}),
      ...(query.termId ? { termId: scoped(tenant, query.termId) } : {}),
    };
    const analytics = await runWithRequestContext(context(tenant), () => service.getGradeLevelAnalytics(context(tenant), scopedQuery));
    // Map tenant-prefixed ids back to the fixture ids so the result compares with the in-memory twin.
    return JSON.parse(JSON.stringify(analytics).replaceAll(`${tenant}-`, "").replaceAll(tenant, tenant === tenantA ? "tenant-a" : "tenant-b"));
  }

  async function inMemoryAnalytics(tenantId: string, query: GradeLevelAnalyticsQuery) {
    const service = new GradeLevelAnalyticsService(new InMemoryReportSnapshotStore(createGradeLevelAnalyticsFixtures(gradeLevelAnalyticsTermBoundaryExtras())));
    return service.getGradeLevelAnalytics(context(tenantId), query);
  }

  it("matches the in-memory twin: level snapshots only, PUBLISHED exams only, STALE as needs-refresh", async () => {
    for (const query of [
      { gradeLevelId: "grade-8" },
      { gradeLevelId: "grade-8", examType: "LGS" },
      { gradeLevelId: "grade-8", termId: "term-fall" },
      { gradeLevelId: "grade-7" },
    ]) {
      const fromPostgres = await postgresAnalytics(tenantA, query);
      expect(fromPostgres).toEqual(await inMemoryAnalytics("tenant-a", query));
    }

    const levelEight = await postgresAnalytics(tenantA, { gradeLevelId: "grade-8" });
    const plotted = levelEight.series.flatMap((series: { points: Array<{ snapshotId: string }> }) => series.points.map((point) => point.snapshotId));
    expect(plotted).toEqual(["level-lgs-1", "level-lgs-2", "level-tyt-1"]);
    expect(levelEight.needsRefresh.map((item: { snapshotId: string }) => item.snapshotId)).toEqual(["level-lgs-3-stale"]);
    expect(levelEight.withoutLevelReport.map((item: { examId: string }) => item.examId)).toEqual(["exam-lgs-no-level"]);
    expect(levelEight.series[0].points[0]).toMatchObject({ successRate: 61.5, net: 55.35, questionCount: 90, participantCount: 40 });
    // The DRAFT exam and the deleted snapshot of grade 7 never reach the grade-7 view either.
    const levelSeven = await postgresAnalytics(tenantA, { gradeLevelId: "grade-7" });
    expect(levelSeven.series.flatMap((series: { points: Array<{ snapshotId: string }> }) => series.points.map((point) => point.snapshotId))).toEqual(["level-grade-7"]);
  });

  it("filters the term on the exam's Türkiye calendar day, not the UTC day", async () => {
    for (const query of [{ gradeLevelId: "grade-6" }, { gradeLevelId: "grade-6", termId: "term-fall" }]) {
      expect(await postgresAnalytics(tenantA, query)).toEqual(await inMemoryAnalytics("tenant-a", query));
    }
    const fall = await postgresAnalytics(tenantA, { gradeLevelId: "grade-6", termId: "term-fall" });
    // 2026-08-31T21:30Z is 1 September 00:30 in Istanbul (inside term-fall); 2026-09-30T21:30Z is 1 October 00:30.
    expect(fall.series.flatMap((series: { points: Array<{ examId: string }> }) => series.points.map((point) => point.examId)))
      .toEqual(["exam-boundary-start"]);
    expect(fall.series[0].points[0].startsAt).toBe("2026-08-31T21:30:00.000Z");
    expect(fall.withoutLevelReport.map((item: { examId: string }) => item.examId)).toEqual(["exam-boundary-no-level"]);
  });

  it("carries frozen comparison provenance and leaves legacy provenance null in the student progress projection", async () => {
    const store = new PostgresReportSnapshotStore(app);
    const records = await runWithRequestContext(context(tenantA), () =>
      store.listReadyByStudent(tenantA, "student-a", scoped(tenantA, "exam-boundary-start")));
    // Frozen values must survive the real JSONB projection under the restricted app role, including the numeric year.
    // The fixture snapshot stored no exam title; its projection key is JSON null (readText ignores it).
    expect(records.map((record) => record.snapshotData)).toEqual([{
      generatedAt: null,
      examStartsAt: "2026-08-31T21:30:00.000Z",
      examTitle: null,
      examType: "LGS",
      examYear: 2026,
      scoringProfileId: "TR-LGS-2026-NOSD-V1",
      students: [{ studentId: "student-a", displayName: "Ada A", total: { net: 1 } }],
    }]);

    const legacy = await runWithRequestContext(context(tenantA), () =>
      store.listReadyByStudent(tenantA, "student-a", scoped(tenantA, "exam-boundary-end")));
    // The live exam is LGS, but omitted frozen context must stay unknown rather than being filled from that row.
    expect(legacy.map((record) => record.snapshotData)).toEqual([{
      generatedAt: null,
      examStartsAt: null,
      examTitle: null,
      examType: null,
      examYear: null,
      scoringProfileId: null,
      students: [{ studentId: "student-a", displayName: "Ada A", total: { net: 1 } }],
    }]);
    expect(records.map((record) => record.tenantId)).toEqual([tenantA]);
    expect(legacy.map((record) => record.tenantId)).toEqual([tenantA]);
  });

  it("keeps tenants apart: RLS hides another tenant's snapshots even when its ids are requested", async () => {
    const tenantBView = await postgresAnalytics(tenantB, { gradeLevelId: "grade-8" });
    expect(tenantBView.series.flatMap((series: { points: Array<{ snapshotId: string }> }) => series.points.map((point) => point.snapshotId))).toEqual(["level-tenant-b"]);

    const store = new PostgresReportSnapshotStore(app);
    const probe = await runWithRequestContext(context(tenantA), () =>
      store.listGradeLevelAnalytics(tenantB, { gradeLevelId: scoped(tenantB, "grade-8") }));
    expect(probe).toEqual({ snapshots: [], examsWithoutLevelReport: [] });
  });
});

// Date objects round-trip through node-pg for the timestamp(3) columns regardless of the runner's time zone.
function toDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

// Exam.startsAt is written as UTC wall time, the way Prisma stores it; casting the ISO text to timestamp drops the "Z"
// without shifting by the runner's time zone, so the Istanbul-day term rule is exercised on any runner.
function toUtcWallTime(value: string | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}
