import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { runWithRequestContext, type RequestContext } from "../context/request-context.js";
import { PostgresInstitutionDashboardStore } from "../me/me-institution-dashboard.store.js";
import { ClassOverviewService } from "./class-overview.service.js";
import { PostgresClassOverviewStore } from "./class-overview.store.js";

const appUrl = process.env.CLASS_OVERVIEW_POSTGRES_TEST_URL, adminUrl = process.env.CLASS_OVERVIEW_POSTGRES_ADMIN_URL;
if (process.env.CLASS_OVERVIEW_POSTGRES_REQUIRED === "1" && (!appUrl || !adminUrl)) throw new Error("CLASS_OVERVIEW_POSTGRES_URLS_REQUIRED");
for (const value of [appUrl, adminUrl].filter(Boolean)) {
  const url = new URL(value!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !(url.pathname === "/o_okul_class_overview_test" || (process.env.GITHUB_ACTIONS === "true" && url.pathname === "/o_okul"))) {
    throw new Error("DISPOSABLE_POSTGRES_REQUIRED");
  }
}

// 2026-11-02 08:00 UTC is 11:00 in Istanbul; the fixture mirrors class-overview.service.test.ts so the in-memory twin and
// the Postgres store are held to the same numbers.
const now = new Date("2026-11-02T08:00:00.000Z");
const today = "2026-11-02";
const run = appUrl && adminUrl ? describe : describe.skip;

run("Class 360 and dashboard academic-ops counts with restricted app role and RLS (DEC-20261102-04)", () => {
  const app = new pg.Pool({ connectionString: appUrl }), admin = new pg.Pool({ connectionString: adminUrl });
  const [tenantA, tenantB] = ["a", "b"].map((suffix) => `class-overview-${randomUUID()}-${suffix}`) as [string, string];
  const id = (tenant: string, name: string) => `${tenant}-${name}`;
  const context = (tenantId: string, extra: Partial<RequestContext> = {}): RequestContext => ({
    userId: "fixture", tenantId, roles: ["TENANT_ADMIN"], bypassRls: false, ...extra,
  });
  const overviews = () => new ClassOverviewService(new PostgresClassOverviewStore(app));

  beforeAll(async () => {
    const db = await admin.connect();
    try {
      await db.query("BEGIN");
      for (const tenant of [tenantA, tenantB]) {
        const t = (name: string) => id(tenant, name);
        await db.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
        await db.query('INSERT INTO "Tenant" (id,slug,name,status,"updatedAt") VALUES ($1,$1,\'Class overview fixture\',\'ACTIVE\',now())', [tenant]);
        for (const campus of ["campus-1", "campus-2"]) {
          await db.query('INSERT INTO "Campus" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,$3,now())', [t(campus), tenant, campus]);
        }
        for (const [klass, campus, deleted] of [["c1", "campus-1", false], ["c2", "campus-2", false], ["c-free", null, false], ["c-deleted", "campus-1", true]] as const) {
          await db.query(
            'INSERT INTO "Class" (id,"tenantId","campusId",name,"deletedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,now())',
            [t(klass), tenant, campus ? t(campus) : null, klass, deleted ? new Date("2026-10-01T00:00:00.000Z") : null],
          );
        }
        // s1-s3 are on the c1 roster today; s4 left yesterday, s5 is passive, s6 is deleted, s7 starts tomorrow.
        const students: Array<[string, string, string, boolean]> = [
          ["s1", "c1", "ACTIVE", false], ["s2", "c1", "ACTIVE", false], ["s3", "c1", "ACTIVE", false], ["s4", "c1", "ACTIVE", false],
          ["s5", "c1", "PASSIVE", false], ["s6", "c1", "ACTIVE", true], ["s7", "c1", "ACTIVE", false], ["s8", "c2", "ACTIVE", false],
        ];
        for (const [index, [student, klass, status, deleted]] of students.entries()) {
          await db.query(
            'INSERT INTO "Student" (id,"tenantId","classId","studentNo","firstName","lastName",status,"deletedAt","updatedAt") VALUES ($1,$2,$3,$4,\'ADA\',\'YILMAZ\',$5,$6,now())',
            [t(student), tenant, t(klass), String(100 + index), status, deleted ? new Date("2026-10-01T00:00:00.000Z") : null],
          );
        }
        const enrollments: Array<[string, string, string, string | null]> = [
          ["s1", "c1", "2026-09-01", null], ["s2", "c1", "2026-09-01", null], ["s3", "c1", "2026-09-01", today],
          ["s4", "c1", "2026-09-01", "2026-11-01"], ["s5", "c1", "2026-09-01", null], ["s6", "c1", "2026-09-01", null],
          ["s7", "c1", "2026-11-03", null], ["s8", "c2", "2026-09-01", null],
        ];
        for (const [student, klass, startsAt, endsAt] of enrollments) {
          await db.query(
            'INSERT INTO "StudentEnrollment" (id,"tenantId","studentId","classId",status,"startsAt","endsAt","updatedAt") VALUES ($1,$2,$3,$4,\'ACTIVE\',$5,$6,now())',
            [t(`enrollment-${student}`), tenant, t(student), t(klass), startsAt, endsAt],
          );
        }
        await db.query('INSERT INTO "Course" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,\'Matematik\',now()), ($3,$2,\'Türkçe\',now())', [t("math"), tenant, t("tr")]);
        await db.query(
          'INSERT INTO "AcademicYear" (id,"tenantId",name,"startsAt","endsAt","updatedAt") VALUES ($1,$2,\'2026-2027\',\'2026-09-01\',\'2027-06-30\',now()), ($3,$2,\'2025-2026\',\'2025-09-01\',\'2026-06-30\',now())',
          [t("year"), tenant, t("year-past")],
        );
        const terms: Array<[string, string, string, string, boolean]> = [
          ["term-current", "year", "2026-09-01", "2027-01-31", false],
          ["term-past", "year-past", "2026-02-01", "2026-06-30", false],
          ["term-deleted", "year", "2026-09-01", "2027-01-31", true],
        ];
        for (const [term, year, startsAt, endsAt, deleted] of terms) {
          await db.query(
            'INSERT INTO "AcademicTerm" (id,"tenantId","academicYearId",name,"startsAt","endsAt","deletedAt","updatedAt") VALUES ($1,$2,$3,$1,$4,$5,$6,now())',
            [t(term), tenant, t(year), startsAt, endsAt, deleted ? new Date("2026-10-01T00:00:00.000Z") : null],
          );
        }
        await db.query(
          'INSERT INTO "User" (id,"tenantId",name,"passwordHash","updatedAt") VALUES ($1,$2,\'Ayşe Demir\',\'fixture\',now()), ($3,$2,\'Biten Üyelik\',\'fixture\',now()), ($4,$2,\'Kontrol\',\'fixture\',now())',
          [t("u-class"), tenant, t("u-ended"), t("checker")],
        );
        await db.query(
          'INSERT INTO "TenantMembership" (id,"tenantId","userId",role,"hasTeacherPersona",status,"startsAt","endsAt","updatedAt") VALUES ($1,$2,$3,\'TEACHER\',true,\'ACTIVE\',\'2026-01-01T00:00:00Z\',NULL,now()), ($4,$2,$5,\'TEACHER\',true,\'ACTIVE\',\'2026-01-01T00:00:00Z\',\'2026-10-01T00:00:00Z\',now())',
          [t("m-class"), tenant, t("u-class"), t("m-ended"), t("u-ended")],
        );
        const teachers: Array<[string, string, string, string | null, boolean]> = [
          ["t-class", "Ayşe", "Demir", "u-class", false], ["t-math", "Can", "Arslan", null, false],
          ["t-deleted", "Eski", "Öğretmen", null, true], ["t-ended", "Biten", "Üyelik", "u-ended", false],
          ["t-guidance", "Rehber", "Öğretmen", null, false],
        ];
        for (const [teacher, firstName, lastName, userId, deleted] of teachers) {
          await db.query(
            'INSERT INTO "Teacher" (id,"tenantId","firstName","lastName","userId","deletedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())',
            [t(teacher), tenant, firstName, lastName, userId ? t(userId) : null, deleted ? new Date("2026-10-01T00:00:00.000Z") : null],
          );
        }
        const assignments: Array<[string, string, string, string, string | null, string | null, string | null, string | null]> = [
          ["as-class", "t-class", "c1", "CLASS_TEACHER", null, null, null, null],
          ["as-math", "t-math", "c1", "BRANCH_TEACHER", "math", "term-current", null, null],
          ["as-expired", "t-math", "c1", "BRANCH_TEACHER", "tr", null, null, "2026-10-31"],
          ["as-future", "t-math", "c1", "BRANCH_TEACHER", "tr", null, "2026-11-03", null],
          ["as-deleted-teacher", "t-deleted", "c1", "BRANCH_TEACHER", null, null, null, null],
          ["as-ended-membership", "t-ended", "c1", "BRANCH_TEACHER", null, null, null, null],
          ["as-guidance", "t-guidance", "c1", "GUIDANCE_COUNSELOR", null, null, null, null],
          ["as-other-class", "t-math", "c2", "BRANCH_TEACHER", null, null, null, null],
        ];
        for (const [assignment, teacher, klass, role, course, term, startsAt, endsAt] of assignments) {
          await db.query(
            'INSERT INTO "TeacherAssignment" (id,"tenantId","teacherId","classId","courseId","termId",role,"startsAt","endsAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())',
            [t(assignment), tenant, t(teacher), t(klass), course ? t(course) : null, term ? t(term) : null, role, startsAt, endsAt],
          );
        }
        // Lesson starts are stored as UTC wall time (ScheduleLesson.startsAt is timestamp without time zone).
        const lessons: Array<[string, string, string, boolean]> = [
          ["l-today", "c1", "2026-11-02T07:30:00.000Z", false],
          ["l-midnight", "c1", "2026-11-01T21:30:00.000Z", false],
          ["l-tomorrow", "c1", "2026-11-02T21:30:00.000Z", false],
          ["l-deleted", "c1", "2026-11-02T09:00:00.000Z", true],
          ["l-c2", "c2", "2026-11-02T09:00:00.000Z", false],
        ];
        for (const [lesson, klass, startsAt, deleted] of lessons) {
          await db.query(
            'INSERT INTO "ScheduleLesson" (id,"tenantId","classId","teacherId",title,"startsAt","endsAt","deletedAt","updatedAt") VALUES ($1,$2,$3,$4,\'Ders\',$5,($5::timestamp + interval \'40 minutes\'),$6,now())',
            [t(lesson), tenant, t(klass), t("t-math"), startsAt, deleted ? new Date("2026-10-30T00:00:00.000Z") : null],
          );
        }
        for (const [student, deleted] of [["s1", false], ["s2", true], ["s4", false]] as const) {
          await db.query(
            'INSERT INTO "Attendance" (id,"tenantId","studentId",date,status,"deletedAt","updatedAt") VALUES ($1,$2,$3,$4,\'PRESENT\',$5,now())',
            [t(`attendance-${student}`), tenant, t(student), today, deleted ? new Date() : null],
          );
        }
        for (const [homework, checked, deleted] of [["hw-open", false, false], ["hw-closed", true, false], ["hw-deleted", false, true]] as const) {
          await db.query(
            'INSERT INTO "Homework" (id,"tenantId","classId",title,"checkedAt","deletedAt","updatedAt") VALUES ($1,$2,$3,\'Ödev\',$4,$5,now())',
            [t(homework), tenant, t("c1"), checked ? new Date() : null, deleted ? new Date() : null],
          );
        }
        const submissions: Array<[string, string, boolean]> = [["hw-open", "s1", false], ["hw-open", "s2", true], ["hw-open", "s6", false], ["hw-closed", "s3", false]];
        for (const [homework, student, checked] of submissions) {
          await db.query(
            'INSERT INTO "HomeworkSubmission" (id,"tenantId","homeworkId","studentId","submittedAt","checkedAt","checkedById") VALUES ($1,$2,$3,$4,now(),$5,$6)',
            [t(`submission-${homework}-${student}`), tenant, t(homework), t(student), checked ? new Date() : null, checked ? t("checker") : null],
          );
        }
        const assessments: Array<[string, string, string, string, string, string, number | null]> = [
          ["a-math-1", "c1", "math", "term-current", "1. yazılı", "2026-10-20", 1],
          ["a-math-2", "c1", "math", "term-current", "Kısa sınav", "2026-10-28", null],
          ["a-tr-1", "c1", "tr", "term-current", "Türkçe yazılı", "2026-10-25", 1],
          ["a-past", "c1", "math", "term-past", "Eski", "2026-05-20", null],
          ["a-deleted-term", "c1", "math", "term-deleted", "Silinen", "2026-10-01", null],
          ["a-class-2", "c2", "math", "term-current", "2. sınıf", "2026-10-20", null],
        ];
        for (const [assessment, klass, course, term, title, heldOn, publishedVersion] of assessments) {
          await db.query(
            'INSERT INTO "GradeAssessment" (id,"tenantId","classId","courseId","termId",kind,title,"heldOn","publishedVersion","createdById") VALUES ($1,$2,$3,$4,$5,\'WRITTEN\',$6,$7,$8,\'fixture\')',
            [t(assessment), tenant, t(klass), t(course), t(term), title, heldOn, publishedVersion],
          );
        }
        // a-math-1: roster complete and published, s3 has an appended v2 correction draft (ADR-0011).
        const entries: Array<[string, string, number, boolean]> = [
          ["a-math-1", "s1", 1, true], ["a-math-1", "s2", 1, true], ["a-math-1", "s3", 1, true], ["a-math-1", "s3", 2, false],
          ["a-math-2", "s1", 1, false], ["a-math-2", "s2", 1, false], ["a-math-2", "s4", 1, false],
          ["a-tr-1", "s1", 1, true], ["a-tr-1", "s2", 1, true], ["a-tr-1", "s3", 1, true],
          ["a-past", "s1", 1, false], ["a-class-2", "s8", 1, false],
        ];
        for (const [assessment, student, version, published] of entries) {
          await db.query(
            'INSERT INTO "GradeEntry" (id,"tenantId","assessmentId","studentId",version,score,absent,"publishedAt","enteredById") VALUES ($1,$2,$3,$4,$5,87.5,false,$6,\'fixture\')',
            [t(`entry-${assessment}-${student}-${version}`), tenant, t(assessment), t(student), version, published ? new Date() : null],
          );
        }
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  });

  // Published GradeEntry rows cannot be deleted (ADR-0011 trigger); fixtures use random tenant ids in a disposable database.
  afterAll(async () => {
    await Promise.all([app.end(), admin.end()]);
  });

  it("returns the Class 360 counts with the attendance roster rule and Istanbul lesson day", async () => {
    const overview = await runWithRequestContext(context(tenantA), () => overviews().get(context(tenantA), id(tenantA, "c1"), now));

    expect(overview).toMatchObject({
      classId: id(tenantA, "c1"),
      date: today,
      rosterCount: 3,
      rollCall: { state: "PARTIAL", lessonCount: 2, markedCount: 1 },
      homework: { openCount: 1, waitingSubmissionCount: 1 },
      gradeEntry: { assessmentCount: 3, missingEntryAssessmentCount: 1, unpublishedDraftAssessmentCount: 2 },
    });
    expect(overview.teacherAssignments.map((assignment) => assignment.assignmentId)).toEqual([id(tenantA, "as-math"), id(tenantA, "as-class")]);
    const [math, classTeacher] = overview.teacherAssignments;
    expect(math).toMatchObject({ teacherName: "Can Arslan", courseName: "Matematik", assessmentCount: 2, missingEntryAssessmentCount: 1, unpublishedDraftAssessmentCount: 2 });
    expect(math?.assessments).toEqual([
      expect.objectContaining({ assessmentId: id(tenantA, "a-math-2"), heldOn: "2026-10-28", enteredCount: 2, rosterCount: 3, missingEntries: true, hasUnpublishedDraft: true }),
      expect.objectContaining({ assessmentId: id(tenantA, "a-math-1"), heldOn: "2026-10-20", enteredCount: 3, missingEntries: false, hasUnpublishedDraft: true, publishedVersion: 1 }),
    ]);
    expect(classTeacher).toMatchObject({ teacherName: "Ayşe Demir", role: "CLASS_TEACHER", assessmentCount: 3 });
    // Counts only: no score, no average and nothing from the other tenant (ADR-0011, RLS).
    const serialized = JSON.stringify(overview);
    for (const forbidden of ["87.5", "score", "average", tenantB, "a-past", "a-deleted-term", "Rehber", "Biten", "Eski"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("answers 404 for another tenant's class, a soft-deleted class and a class outside the campus scope", async () => {
    const service = overviews();
    for (const classId of [id(tenantB, "c1"), id(tenantA, "c-deleted")]) {
      await expect(runWithRequestContext(context(tenantA), () => service.get(context(tenantA), classId, now))).rejects.toMatchObject({ status: 404 });
    }
    const campusOne = context(tenantA, { roles: ["OPERATIONS_STAFF"], campusScope: { scopeMode: "CAMPUSES", campusIds: [id(tenantA, "campus-1")] } });
    await expect(runWithRequestContext(campusOne, () => service.get(campusOne, id(tenantA, "c1"), now))).resolves.toMatchObject({ rosterCount: 3 });
    for (const classId of [id(tenantA, "c2"), id(tenantA, "c-free")]) {
      await expect(runWithRequestContext(campusOne, () => service.get(campusOne, classId, now))).rejects.toMatchObject({ status: 404 });
    }
    const noScope = context(tenantA, { roles: ["OPERATIONS_STAFF"] });
    await expect(runWithRequestContext(noScope, () => service.get(noScope, id(tenantA, "c1"), now))).rejects.toMatchObject({ status: 404 });
  });

  it("RLS hides another tenant's rows even when the tenant id is passed explicitly", async () => {
    const store = new PostgresClassOverviewStore(app);
    await expect(runWithRequestContext(context(tenantA), () => store.findLiveClass(tenantB, id(tenantB, "c1")))).resolves.toBeUndefined();
    const source = await runWithRequestContext(context(tenantA), () => store.loadSource(tenantB, id(tenantB, "c1"), today));
    expect(source).toEqual({
      rosterCount: 0, lessonCount: 0, markedCount: 0, openHomeworkCount: 0, waitingSubmissionCount: 0, assignments: [], assessments: [],
    });
    await expect(runWithRequestContext(context(tenantA), () => store.loadAcademicOps(tenantB, today))).resolves.toEqual({
      rollCallMissingClassCount: 0, missingGradeEntryAssessmentCount: 0, unpublishedDraftAssessmentCount: 0,
    });
  });

  it("counts dashboard academic ops tenant-wide and per campus, matching Class 360", async () => {
    const db = await admin.connect();
    try {
      // Nobody marked today: c1 and c2 both had lessons and non-empty rosters.
      await db.query("BEGIN");
      await db.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantB]);
      await db.query('UPDATE "Attendance" SET "deletedAt" = now() WHERE "tenantId" = $1', [tenantB]);
      await db.query("COMMIT");
    } finally {
      db.release();
    }
    const store = new PostgresClassOverviewStore(app);
    await expect(runWithRequestContext(context(tenantB), () => store.loadAcademicOps(tenantB, today))).resolves.toEqual({
      rollCallMissingClassCount: 2, missingGradeEntryAssessmentCount: 1, unpublishedDraftAssessmentCount: 3,
    });
    await expect(runWithRequestContext(context(tenantB), () => store.loadAcademicOps(tenantB, today, [id(tenantB, "campus-2")]))).resolves.toEqual({
      rollCallMissingClassCount: 1, missingGradeEntryAssessmentCount: 0, unpublishedDraftAssessmentCount: 1,
    });
    for (const campusIds of [[], [id(tenantA, "campus-1")]]) {
      await expect(runWithRequestContext(context(tenantB), () => store.loadAcademicOps(tenantB, today, campusIds))).resolves.toEqual({
        rollCallMissingClassCount: 0, missingGradeEntryAssessmentCount: 0, unpublishedDraftAssessmentCount: 0,
      });
    }

    // Tenant A keeps s1 marked, so c1 is partially taken and only c2 waits for roll call.
    const dashboards = new PostgresInstitutionDashboardStore(app);
    const dashboard = await runWithRequestContext(context(tenantA), () => dashboards.load(tenantA, today, {}, { academicOps: true }));
    expect(dashboard.academicOps).toEqual({
      date: today, rollCallMissingClassCount: 1, missingGradeEntryAssessmentCount: 1, unpublishedDraftAssessmentCount: 3,
    });
    const scoped = await runWithRequestContext(context(tenantA), () =>
      dashboards.load(tenantA, today, { campusIds: [id(tenantA, "campus-1")] }, { academicOps: true }));
    expect(scoped.academicOps).toEqual({
      date: today, rollCallMissingClassCount: 0, missingGradeEntryAssessmentCount: 1, unpublishedDraftAssessmentCount: 2,
    });
    const withoutOps = await runWithRequestContext(context(tenantA), () => dashboards.load(tenantA, today));
    expect(withoutOps).not.toHaveProperty("academicOps");
  });
});
