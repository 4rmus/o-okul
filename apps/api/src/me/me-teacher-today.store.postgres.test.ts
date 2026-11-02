import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { runWithRequestContext, type RequestContext } from "../context/request-context.js";
import { PostgresTeacherTodayStore, type TeacherTodayInboxInput } from "./me-teacher-today.store.js";

const appUrl = process.env.TEACHER_TODAY_POSTGRES_TEST_URL, adminUrl = process.env.TEACHER_TODAY_POSTGRES_ADMIN_URL;
if (process.env.TEACHER_TODAY_POSTGRES_REQUIRED === "1" && (!appUrl || !adminUrl)) throw new Error("TEACHER_TODAY_POSTGRES_URLS_REQUIRED");
for (const value of [appUrl, adminUrl].filter(Boolean)) {
  const url = new URL(value!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !(url.pathname === "/o_okul_teacher_today_test" || (process.env.GITHUB_ACTIONS === "true" && url.pathname === "/o_okul"))) {
    throw new Error("DISPOSABLE_POSTGRES_REQUIRED");
  }
}

const today = "2026-10-01";
const run = appUrl && adminUrl ? describe : describe.skip;

run("teacher Bugün inbox counts with restricted app role and RLS", () => {
  const app = new pg.Pool({ connectionString: appUrl }), admin = new pg.Pool({ connectionString: adminUrl });
  const [tenantA, tenantB] = ["a", "b"].map((suffix) => `teacher-today-${randomUUID()}-${suffix}`) as [string, string];
  const id = (tenant: string, name: string) => `${tenant}-${name}`;
  const teacherContext = (tenantId: string): RequestContext => ({
    userId: "fixture", tenantId, roles: ["TEACHER"], subjectType: "TEACHER", subjectId: "teacher-fixture", bypassRls: false,
  });
  // What MeTeacherTodayService passes: today's classes, open homework, teacher-visible students (not s2), authorable assessments.
  const inboxInput = (tenant: string, tenantId = tenant): TeacherTodayInboxInput => ({
    tenantId,
    date: today,
    classIds: [id(tenant, "c1"), id(tenant, "c2")],
    homeworkIds: ["h-open", "h-closed", "h-deleted"].map((name) => id(tenant, name)),
    studentIds: ["s1", "s3", "s4", "s6", "s7", "s8", "s-moved"].map((name) => id(tenant, name)),
    assessmentIds: ["a-draft", "a-published", "a-corrected"].map((name) => id(tenant, name)),
  });

  beforeAll(async () => {
    const db = await admin.connect();
    try {
      await db.query("BEGIN");
      for (const tenant of [tenantA, tenantB]) {
        const t = (name: string) => id(tenant, name);
        await db.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
        await db.query('INSERT INTO "Tenant" (id,slug,name,status,"updatedAt") VALUES ($1,$1,\'Teacher today fixture\',\'ACTIVE\',now())', [tenant]);
        await db.query('INSERT INTO "Course" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,\'Matematik\',now())', [t("math"), tenant]);
        await db.query('INSERT INTO "AcademicYear" (id,"tenantId",name,"startsAt","endsAt","updatedAt") VALUES ($1,$2,\'2026-2027\',\'2026-09-01\',\'2027-06-30\',now())', [t("year"), tenant]);
        await db.query('INSERT INTO "AcademicTerm" (id,"tenantId","academicYearId",name,"startsAt","endsAt","updatedAt") VALUES ($1,$2,$3,\'1. Dönem\',\'2026-09-01\',\'2027-01-31\',now())', [t("term"), tenant, t("year")]);
        for (const [klass, name] of [["c1", "8-A"], ["c2", "8-B"]] as const) {
          await db.query('INSERT INTO "Class" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,$3,now())', [t(klass), tenant, name]);
        }
        const students: Array<[string, string, boolean]> = [
          ["s1", "c1", false], ["s2", "c1", false], ["s3", "c1", true], ["s4", "c2", false],
          ["s6", "c1", false], ["s7", "c1", false], ["s8", "c1", false], ["s-moved", "c2", false], ["s-left", "c2", false],
        ];
        for (const [index, [student, klass, deleted]] of students.entries()) {
          await db.query(
            'INSERT INTO "Student" (id,"tenantId","classId","studentNo","firstName","lastName",status,"deletedAt","updatedAt") VALUES ($1,$2,$3,$4,\'ADA\',\'YILMAZ\',\'ACTIVE\',$5,now())',
            [t(student), tenant, t(klass), String(100 + index), deleted ? new Date("2026-09-20T00:00:00.000Z") : null],
          );
        }
        // Attendance follows the enrollment on the record date: s1 marks 8-A today; s-left's enrollment in 8-B ended,
        // s4's 8-B row is from yesterday, and a deleted 8-B row today does not count.
        const enrollments: Array<[string, string, string, string | null]> = [
          ["s1", "c1", "2026-09-01", null], ["s4", "c2", "2026-09-01", null], ["s-left", "c2", "2026-09-01", "2026-09-15"], ["s-moved", "c2", "2026-09-01", null],
        ];
        for (const [student, klass, startsAt, endsAt] of enrollments) {
          await db.query(
            'INSERT INTO "StudentEnrollment" (id,"tenantId","studentId","classId",status,"startsAt","endsAt","updatedAt") VALUES ($1,$2,$3,$4,\'ACTIVE\',$5,$6,now())',
            [t(`enrollment-${student}`), tenant, t(student), t(klass), startsAt, endsAt],
          );
        }
        const attendance: Array<[string, string, boolean]> = [["s1", today, false], ["s4", "2026-09-30", false], ["s-left", today, false], ["s-moved", today, true]];
        for (const [student, date, deleted] of attendance) {
          await db.query(
            'INSERT INTO "Attendance" (id,"tenantId","studentId",date,status,"deletedAt","updatedAt") VALUES ($1,$2,$3,$4,\'ABSENT\',$5,now())',
            [t(`attendance-${student}-${date}`), tenant, t(student), date, deleted ? new Date() : null],
          );
        }
        for (const [homework, checked, deleted] of [["h-open", false, false], ["h-closed", true, false], ["h-deleted", false, true]] as const) {
          await db.query(
            'INSERT INTO "Homework" (id,"tenantId","classId",title,"checkedAt","deletedAt","updatedAt") VALUES ($1,$2,$3,\'Ödev\',$4,$5,now())',
            [t(homework), tenant, t("c1"), checked ? new Date() : null, deleted ? new Date() : null],
          );
        }
        // h-open waits on s1 and s8 only: s2 is outside the teacher's students, s3 is deleted, s-moved left the class,
        // s6 has not submitted and s7 is already checked. h-closed and h-deleted never count.
        const submissions: Array<[string, string, boolean, boolean]> = [
          ["h-open", "s1", true, false], ["h-open", "s8", true, false], ["h-open", "s2", true, false], ["h-open", "s3", true, false],
          ["h-open", "s-moved", true, false], ["h-open", "s6", false, false], ["h-open", "s7", true, true],
          ["h-closed", "s1", true, false], ["h-deleted", "s1", true, false],
        ];
        for (const [homework, student, submitted, checked] of submissions) {
          await db.query(
            'INSERT INTO "HomeworkSubmission" (id,"tenantId","homeworkId","studentId","submittedAt","checkedAt") VALUES ($1,$2,$3,$4,$5,$6)',
            [t(`submission-${homework}-${student}`), tenant, t(homework), t(student), submitted ? new Date() : null, checked ? new Date() : null],
          );
        }
        // a-draft: unpublished entries; a-published: v1 published only; a-corrected: v1 published plus a v2 draft
        // (ADR-0011, appended); a-other-class: a draft outside the ids the service passes.
        for (const [assessment, klass, publishedVersion] of [["a-draft", "c1", null], ["a-published", "c1", 1], ["a-corrected", "c1", 1], ["a-other-class", "c2", null]] as const) {
          await db.query(
            'INSERT INTO "GradeAssessment" (id,"tenantId","classId","courseId","termId",kind,title,"heldOn","publishedVersion","createdById") VALUES ($1,$2,$3,$4,$5,\'WRITTEN\',\'1. Yazılı\',\'2026-09-20\',$6,\'fixture\')',
            [t(assessment), tenant, t(klass), t("math"), t("term"), publishedVersion],
          );
        }
        const entries: Array<[string, string, number, boolean]> = [
          ["a-draft", "s1", 1, false], ["a-draft", "s6", 1, false], ["a-published", "s1", 1, true],
          ["a-corrected", "s1", 1, true], ["a-corrected", "s1", 2, false], ["a-other-class", "s4", 1, false],
        ];
        for (const [assessment, student, version, published] of entries) {
          await db.query(
            'INSERT INTO "GradeEntry" (id,"tenantId","assessmentId","studentId",version,score,absent,"publishedAt","enteredById") VALUES ($1,$2,$3,$4,$5,70,false,$6,\'fixture\')',
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

  it("counts attendance, waiting submissions and draft assessments only inside the given scope", async () => {
    const store = new PostgresTeacherTodayStore(app);
    for (const tenant of [tenantA, tenantB]) {
      const counts = await runWithRequestContext(teacherContext(tenant), () => store.loadInbox(inboxInput(tenant)));
      expect(counts).toEqual({ attendanceClassIds: [id(tenant, "c1")], pendingSubmissionCount: 2, unpublishedGradeDraftCount: 2 });
    }
  });

  it("an empty student scope counts no submission, and unknown scopes leave the counters out", async () => {
    const store = new PostgresTeacherTodayStore(app);
    const noStudents = await runWithRequestContext(teacherContext(tenantA), () => store.loadInbox({ ...inboxInput(tenantA), studentIds: [] }));
    expect(noStudents).toMatchObject({ pendingSubmissionCount: 0 });
    const { studentIds: _students, assessmentIds: _assessments, ...unknownScopes } = inboxInput(tenantA);
    const unknown = await runWithRequestContext(teacherContext(tenantA), () => store.loadInbox(unknownScopes));
    expect(unknown).toEqual({ attendanceClassIds: [id(tenantA, "c1")] });
  });

  it("never counts another tenant's rows, whether by id or by tenant parameter under RLS", async () => {
    const store = new PostgresTeacherTodayStore(app);
    const foreignIds = await runWithRequestContext(teacherContext(tenantA), () => store.loadInbox(inboxInput(tenantB, tenantA)));
    expect(foreignIds).toEqual({ attendanceClassIds: [], pendingSubmissionCount: 0, unpublishedGradeDraftCount: 0 });

    const rlsProbe = await runWithRequestContext(teacherContext(tenantA), () => store.loadInbox(inboxInput(tenantB)));
    expect(rlsProbe).toEqual({ attendanceClassIds: [], pendingSubmissionCount: 0, unpublishedGradeDraftCount: 0 });
  });
});
