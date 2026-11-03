import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { runWithRequestContext, type RequestContext } from "../context/request-context.js";
import { reportSnapshotPreferenceExpectedOrder, reportSnapshotPreferenceFixture } from "../report/report-snapshot-preference.fixture.js";
import { reportSnapshotPreferenceOrderBySql } from "../report/report-snapshot-preference.js";
import { PostgresClassStore } from "../school/class-store.js";
import { PostgresStudentStore } from "../student/student-store.js";
import { PostgresSupportTicketStore } from "../support-ticket/support-ticket-store.js";
import { SupportTicketService } from "../support-ticket/support-ticket.service.js";
import { PostgresInstitutionDashboardStore } from "./me-institution-dashboard.store.js";

const appUrl = process.env.INSTITUTION_DASHBOARD_POSTGRES_TEST_URL, adminUrl = process.env.INSTITUTION_DASHBOARD_POSTGRES_ADMIN_URL;
if (process.env.INSTITUTION_DASHBOARD_POSTGRES_REQUIRED === "1" && (!appUrl || !adminUrl)) throw new Error("INSTITUTION_DASHBOARD_POSTGRES_URLS_REQUIRED");
for (const value of [appUrl, adminUrl].filter(Boolean)) {
  const url = new URL(value!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !(url.pathname === "/o_okul_institution_dashboard_test" || (process.env.GITHUB_ACTIONS === "true" && url.pathname === "/o_okul"))) {
    throw new Error("DISPOSABLE_POSTGRES_REQUIRED");
  }
}

const today = "2026-11-02";
const run = appUrl && adminUrl ? describe : describe.skip;

// SEC-CAMPUS: the dashboard counts only rows attributable to the viewer's campuses; tenant-wide figures that cannot be
// attributed (import quarantine, the latest exam and its report) are left out instead of shown.
run("institution dashboard campus scope with restricted app role and RLS", () => {
  const app = new pg.Pool({ connectionString: appUrl }), admin = new pg.Pool({ connectionString: adminUrl });
  const [tenantA, tenantB] = ["a", "b"].map((suffix) => `institution-dashboard-${randomUUID()}-${suffix}`) as [string, string];
  const id = (tenant: string, name: string) => `${tenant}-${name}`;
  const context = (tenantId: string): RequestContext => ({ userId: "fixture", tenantId, roles: ["ASSISTANT_ADMIN"], bypassRls: false });
  const campusContext = (tenantId: string, campusIds: string[]): RequestContext => ({
    ...context(tenantId),
    campusScope: { scopeMode: "CAMPUSES", campusIds },
  });
  // Only the stores the staff list path reads; the dashboard counter and the list must share one attribution rule.
  const supportTickets = () => new SupportTicketService(
    new PostgresSupportTicketStore(app),
    {} as never,
    {} as never,
    new PostgresClassStore(app),
    {} as never,
    {} as never,
    {} as never,
    new PostgresStudentStore(app),
    {} as never,
    {} as never,
    {} as never,
  );

  beforeAll(async () => {
    const db = await admin.connect();
    try {
      await db.query("BEGIN");
      for (const tenant of [tenantA, tenantB]) {
        const t = (name: string) => id(tenant, name);
        await db.query('INSERT INTO "Tenant" (id,slug,name,status,"updatedAt") VALUES ($1,$1,\'Dashboard fixture\',\'ACTIVE\',now())', [tenant]);
        for (const campus of ["campus-1", "campus-2"]) {
          await db.query('INSERT INTO "Campus" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,$3,now())', [t(campus), tenant, campus]);
        }
        // c3 has no campus and s4 has no class: neither can be attributed to a campus.
        for (const [klass, campus] of [["c1", "campus-1"], ["c2", "campus-2"], ["c3", null]] as const) {
          await db.query('INSERT INTO "Class" (id,"tenantId","campusId",name,"updatedAt") VALUES ($1,$2,$3,$4,now())', [t(klass), tenant, campus ? t(campus) : null, klass]);
        }
        for (const [index, [student, klass]] of ([["s1", "c1"], ["s2", "c2"], ["s3", "c3"], ["s4", null]] as const).entries()) {
          await db.query(
            'INSERT INTO "Student" (id,"tenantId","classId","studentNo","firstName","lastName",status,"updatedAt") VALUES ($1,$2,$3,$4,\'ADA\',\'YILMAZ\',\'ACTIVE\',now())',
            [t(student), tenant, klass ? t(klass) : null, String(100 + index)],
          );
        }
        for (const student of ["s1", "s2", "s3"]) {
          await db.query(
            'INSERT INTO "Attendance" (id,"tenantId","studentId",date,status,"updatedAt") VALUES ($1,$2,$3,$4,\'ABSENT\',now())',
            [t(`attendance-${student}`), tenant, t(student), today],
          );
        }
        await db.query('INSERT INTO "Exam" (id,"tenantId",title,status,"startsAt","updatedAt") VALUES ($1,$2,\'Deneme\',\'PUBLISHED\',now(),now())', [t("exam"), tenant]);
        // s4 is auto-registered (class roster) and then matched by the raw import: its status stays REGISTERED and only
        // the ExamResult row says it attended. s3 is marked absent and has only a deleted result.
        for (const [student, status] of [["s1", "ATTENDED"], ["s2", "ATTENDED"], ["s3", "ABSENT"], ["s4", "REGISTERED"]] as const) {
          await db.query(
            'INSERT INTO "ExamParticipant" (id,"tenantId","examId","studentId",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())',
            [t(`participant-${student}`), tenant, t("exam"), t(student), status],
          );
        }
        const snapshotData = {
          resultCount: 3,
          averages: { correct: 30, wrong: 6, blank: 4, net: 28 },
          classes: [
            { classId: t("c1"), className: "c1", resultCount: 1, averages: { correct: 32, wrong: 4, blank: 4, net: 31 } },
            { classId: t("c2"), className: "c2", resultCount: 1, averages: { correct: 28, wrong: 8, blank: 4, net: 26 } },
            { classId: t("c3"), className: "c3", resultCount: 1, averages: { correct: 30, wrong: 6, blank: 4, net: 28 } },
          ],
        };
        await db.query(
          'INSERT INTO "ReportSnapshot" (id,"tenantId","examId","reportType","contentHash","inputRefs",status,"snapshotData","generatedAt","updatedAt") VALUES ($1,$2,$3,\'EXAM\',\'h\',\'{}\'::jsonb,\'READY\',$4::jsonb,now(),now())',
          [t("snapshot"), tenant, t("exam"), JSON.stringify(snapshotData)],
        );
        // Newer scoped snapshots of the same exam: campus-only (one filter) and campus+class (two filters). The
        // tenant-wide snapshot above stays the headline; without it the campus-only one wins over the newer class one.
        for (const [name, campusId, classId, resultCount, hoursAhead] of [
          ["snapshot-campus", t("campus-1"), null, 11, 1],
          ["snapshot-class", t("campus-1"), t("c1"), 22, 2],
        ] as const) {
          await db.query(
            'INSERT INTO "ReportSnapshot" (id,"tenantId","examId","campusId","classId","reportType","contentHash","inputRefs",status,"snapshotData","generatedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,\'EXAM\',$1,\'{}\'::jsonb,\'READY\',$6::jsonb,now()+($7::int * interval \'1 hour\'),now())',
            [t(name), tenant, t("exam"), campusId, classId, JSON.stringify({ ...snapshotData, resultCount }), hoursAhead],
          );
        }
        await db.query('INSERT INTO "RawImport" (id,"tenantId","examId","sourceType","fileName","s3Key",sha256,"parserConfigVersion","updatedAt") VALUES ($1,$2,$3,\'TXT\',\'a.txt\',\'k\',\'s\',\'v1\',now())', [t("raw"), tenant, t("exam")]);
        await db.query('INSERT INTO "AnswerKey" (id,"tenantId","examId",version,"keyData","updatedAt") VALUES ($1,$2,$3,\'v1\',\'{}\'::jsonb,now())', [t("answer-key"), tenant, t("exam")]);
        for (const [student, deletedAt] of [["s4", null], ["s3", "2026-11-01T00:00:00Z"]] as const) {
          await db.query(
            'INSERT INTO "ExamResult" (id,"tenantId","examId","studentId","participantId","rawImportId","answerKeyId","answerKeyVersion","parserConfigVersion","engineVersion","resultKey","scoreData","computedAt","deletedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,\'v1\',\'v1\',\'e1\',$1,\'{}\'::jsonb,now(),$8::timestamptz,now())',
            [t(`result-${student}`), tenant, t("exam"), t(student), t(`participant-${student}`), t("raw"), t("answer-key"), deletedAt],
          );
        }
        await db.query('INSERT INTO "ImportQuarantine" (id,"tenantId","examId","rawImportId","rowNumber","rawRow",reason,status,"updatedAt") VALUES ($1,$2,$3,$4,1,\'{}\'::jsonb,\'NO_MATCH\',\'OPEN\',now())', [t("quarantine"), tenant, t("exam"), t("raw")]);
        // t1 names campus-1, t2 a campus-2 class, t3 a campus-1 student, t4 nothing attributable, t5 a campusless class
        // and a campus-1 student (falls through to the student's class campus).
        const tickets: Array<[string, string | null, string | null, string | null]> = [
          ["t1", t("campus-1"), null, null], ["t2", null, t("c2"), null], ["t3", null, null, t("s1")], ["t4", null, null, null],
          ["t5", null, t("c3"), t("s1")],
        ];
        for (const [ticket, campusId, classId, studentId] of tickets) {
          await db.query(
            'INSERT INTO "SupportTicket" (id,"tenantId","campusId","classId","studentId",subject,message,status,"updatedAt") VALUES ($1,$2,$3,$4,$5,\'Konu\',\'Mesaj\',\'OPEN\',now())',
            [t(ticket), tenant, campusId, classId, studentId],
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

  afterAll(async () => {
    try {
      for (const table of ["SupportTicket", "ImportQuarantine", "ExamResult", "AnswerKey", "RawImport", "ReportSnapshot", "ExamParticipant", "Exam", "Attendance", "Student", "Class", "Campus"]) {
        await admin.query(`DELETE FROM "${table}" WHERE "tenantId"=ANY($1::text[])`, [[tenantA, tenantB]]);
      }
      await admin.query('DELETE FROM "Tenant" WHERE id=ANY($1::text[])', [[tenantA, tenantB]]);
    } finally {
      await Promise.all([app.end(), admin.end()]);
    }
  });

  it("tenant-wide viewers keep every count and the tenant averages", async () => {
    const store = new PostgresInstitutionDashboardStore(app);
    const dashboard = await runWithRequestContext(context(tenantA), () => store.load(tenantA, today));

    expect(dashboard).toMatchObject({
      activeStudentCount: 4,
      attention: { attendanceAlertCount: 3, openImportQuarantineCount: 1, openSupportTicketCount: 5 },
      latestExam: {
        registeredParticipantCount: 4,
        attendedParticipantCount: 3,
        absentParticipantCount: 1,
        report: { snapshotId: id(tenantA, "snapshot"), resultCount: 3, net: 28 },
      },
    });
    expect(dashboard.latestExam?.report?.classes).toHaveLength(3);
  });

  it("the headline report is the tenant-wide snapshot, else the fewest-filter one, never just the newest", async () => {
    const store = new PostgresInstitutionDashboardStore(app);
    const headline = async () => {
      const dashboard = await runWithRequestContext(context(tenantA), () => store.load(tenantA, today));
      return dashboard.latestExam?.report;
    };
    // The newer campus and campus+class snapshots exist, yet the unfiltered one is the headline.
    expect(await headline()).toMatchObject({ snapshotId: id(tenantA, "snapshot"), resultCount: 3 });

    await admin.query('UPDATE "ReportSnapshot" SET "deletedAt"=now() WHERE "tenantId"=$1 AND id=$2', [tenantA, id(tenantA, "snapshot")]);
    try {
      // Without a tenant-wide snapshot the campus-only one (one filter) beats the newer campus+class one (two filters).
      expect(await headline()).toMatchObject({ snapshotId: id(tenantA, "snapshot-campus"), resultCount: 11 });
    } finally {
      await admin.query('UPDATE "ReportSnapshot" SET "deletedAt"=NULL WHERE "tenantId"=$1 AND id=$2', [tenantA, id(tenantA, "snapshot")]);
    }
    expect(await headline()).toMatchObject({ snapshotId: id(tenantA, "snapshot") });
  });

  it("the SQL preference ranks the shared fixture like the TS comparator, a NULL generatedAt row by its createdAt", async () => {
    // Same rows as report-snapshot-preference.test.ts, on a separate exam held before the headline exam; the single
    // scope filter of the fixture is campus-1 here (ReportSnapshot.campusId references Campus).
    await admin.query('INSERT INTO "Exam" (id,"tenantId",title,status,"startsAt","updatedAt") VALUES ($1,$2,\'Sıralama\',\'PUBLISHED\',\'2020-01-01T00:00:00Z\',now())', [id(tenantA, "exam-order"), tenantA]);
    try {
      for (const row of reportSnapshotPreferenceFixture) {
        await admin.query(
          'INSERT INTO "ReportSnapshot" (id,"tenantId","examId","campusId","reportType","contentHash","inputRefs",status,"snapshotData","generatedAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,\'EXAM\',$1,\'{}\'::jsonb,\'READY\',\'{}\'::jsonb,$5::timestamptz,$6::timestamptz,now())',
          [id(tenantA, row.id), tenantA, id(tenantA, "exam-order"), row.campusId ? id(tenantA, "campus-1") : null, row.generatedAt ?? null, row.createdAt],
        );
      }
      const ordered = await admin.query<{ id: string }>(
        `SELECT snapshot."id" FROM "ReportSnapshot" snapshot WHERE snapshot."tenantId" = $1 AND snapshot."examId" = $2 ORDER BY ${reportSnapshotPreferenceOrderBySql("snapshot")}`,
        [tenantA, id(tenantA, "exam-order")],
      );
      expect(ordered.rows.map((row) => row.id)).toEqual(reportSnapshotPreferenceExpectedOrder.map((name) => id(tenantA, name)));
    } finally {
      await admin.query('DELETE FROM "ReportSnapshot" WHERE "tenantId"=$1 AND "examId"=$2', [tenantA, id(tenantA, "exam-order")]);
      await admin.query('DELETE FROM "Exam" WHERE "tenantId"=$1 AND id=$2', [tenantA, id(tenantA, "exam-order")]);
    }
  });

  it("a campus-scoped viewer sees only its campus rows and no tenant-wide latest exam", async () => {
    const store = new PostgresInstitutionDashboardStore(app);
    const dashboard = await runWithRequestContext(
      context(tenantA),
      () => store.load(tenantA, today, { campusIds: [id(tenantA, "campus-1")] }),
    );

    expect(dashboard).toMatchObject({
      activeStudentCount: 1,
      attention: { attendanceAlertCount: 1, openImportQuarantineCount: 0, openSupportTicketCount: 3 },
    });
    expect(dashboard).not.toHaveProperty("latestExam");
    expect(JSON.stringify(dashboard)).not.toContain(id(tenantA, "snapshot"));
  });

  it("the open-ticket counter equals what the same campus scope can list", async () => {
    const store = new PostgresInstitutionDashboardStore(app);
    const service = supportTickets();
    for (const campusIds of [[id(tenantA, "campus-1")], [id(tenantA, "campus-2")], [id(tenantB, "campus-1")]]) {
      const scoped = campusContext(tenantA, campusIds);
      const dashboard = await runWithRequestContext(scoped, () => store.load(tenantA, today, { campusIds }));
      const listed = await runWithRequestContext(scoped, () => service.list(scoped));
      const open = listed.filter((ticket) => ticket.status === "OPEN" || ticket.status === "IN_PROGRESS");
      expect(open.length).toBe(dashboard.attention.openSupportTicketCount);
    }
    const campusOne = campusContext(tenantA, [id(tenantA, "campus-1")]);
    const listed = await runWithRequestContext(campusOne, () => service.list(campusOne));
    expect(listed.map((ticket) => ticket.id).sort()).toEqual([id(tenantA, "t1"), id(tenantA, "t3"), id(tenantA, "t5")]);

    const tenantWide = context(tenantA);
    const all = await runWithRequestContext(tenantWide, () => service.list(tenantWide));
    const dashboard = await runWithRequestContext(tenantWide, () => store.load(tenantA, today));
    expect(all).toHaveLength(dashboard.attention.openSupportTicketCount);
  });

  it("an empty or foreign campus scope counts nothing", async () => {
    const store = new PostgresInstitutionDashboardStore(app);
    for (const campusIds of [[], [id(tenantB, "campus-1")]]) {
      const dashboard = await runWithRequestContext(context(tenantA), () => store.load(tenantA, today, { campusIds }));
      expect(dashboard).toMatchObject({
        activeStudentCount: 0,
        attention: { attendanceAlertCount: 0, openImportQuarantineCount: 0, openSupportTicketCount: 0 },
      });
      expect(dashboard).not.toHaveProperty("latestExam");
    }
  });
});
