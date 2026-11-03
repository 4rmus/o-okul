import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { runWithRequestContext, type RequestContext } from "../context/request-context.js";
import { IdempotencyService, PostgresIdempotencyStore } from "../http/idempotency.js";
import { PostgresAcademicCalendarStore } from "../school/academic-calendar-store.js";
import { PostgresStudentStore } from "./student-store.js";

const appUrl = process.env.TERM_TRANSITION_POSTGRES_TEST_URL, adminUrl = process.env.TERM_TRANSITION_POSTGRES_ADMIN_URL;
if (process.env.TERM_TRANSITION_POSTGRES_REQUIRED === "1" && (!appUrl || !adminUrl)) throw new Error("TERM_TRANSITION_POSTGRES_URLS_REQUIRED");
for (const value of [appUrl, adminUrl].filter(Boolean)) {
  const url = new URL(value!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !(url.pathname === "/o_okul_term_test" || (process.env.GITHUB_ACTIONS === "true" && url.pathname === "/o_okul"))) {
    throw new Error("DISPOSABLE_POSTGRES_REQUIRED");
  }
}

const run = appUrl && adminUrl ? describe : describe.skip;

// DEC-20261102-08: the term-transition wizard's writes on the restricted app role with RLS.
run("term transition with restricted app role and RLS", () => {
  const app = new pg.Pool({ connectionString: appUrl, max: 4 }), admin = new pg.Pool({ connectionString: adminUrl });
  const calendar = new PostgresAcademicCalendarStore(app);
  const students = new PostgresStudentStore(app);
  const idempotency = new IdempotencyService(new PostgresIdempotencyStore(app));
  const [tenantA, tenantB] = ["a", "b"].map((suffix) => `term-${randomUUID()}-${suffix}`) as [string, string];
  const id = (tenant: string, name: string) => `${tenant}-${name}`;
  const context = (tenantId: string): RequestContext => ({
    userId: "fixture", tenantId, activePersona: "STAFF", roles: ["TENANT_ADMIN"], bypassRls: false,
  });
  const inTenant = <T>(tenantId: string, work: () => Promise<T>) => runWithRequestContext(context(tenantId), work);
  const today = new Date().toISOString().slice(0, 10);
  const days = (offset: number) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    const db = await admin.connect();
    try {
      await db.query("BEGIN");
      for (const tenant of [tenantA, tenantB]) {
        const t = (name: string) => id(tenant, name);
        await db.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
        await db.query('INSERT INTO "Tenant" (id,slug,name,status,"updatedAt") VALUES ($1,$1,\'Term fixture\',\'ACTIVE\',now())', [tenant]);
        await db.query(
          `INSERT INTO "LicenseTerm" ("id","tenantId","planCode","startsAt","endsAt","activeStudentLimit","updatedAt")
           VALUES ($1,$2,'TEST',now() - interval '1 day',now() + interval '1 day',10,now())`,
          [t("license"), tenant],
        );
        await db.query('INSERT INTO "GradeLevel" (id,"tenantId",name,code,"updatedAt") VALUES ($1,$2,\'8. Sınıf\',\'8\',now())', [t("grade-8"), tenant]);
        await db.query('INSERT INTO "Class" (id,"tenantId",name,"gradeLevelId",section,"updatedAt") VALUES ($1,$2,\'8-A\',$3,\'A\',now())', [t("class-8a"), tenant, t("grade-8")]);
        await db.query(
          'INSERT INTO "AcademicYear" (id,"tenantId",name,"startsAt","endsAt","isActive","updatedAt") VALUES ($1,$2,\'2025-2026\',$3::date,$4::date,true,now()), ($5,$2,\'2026-2027\',$6::date,$7::date,false,now())',
          [t("year-old"), tenant, days(-400), days(-30), t("year-new"), days(-20), days(300)],
        );
        await db.query(
          `INSERT INTO "AcademicTerm" (id,"tenantId","academicYearId",name,"startsAt","endsAt","isActive","updatedAt") VALUES
           ($1,$2,$3,'2. Dönem',$4::date,$5::date,true,now()),
           ($6,$2,$7,'1. Dönem',$8::date,$9::date,false,now()),
           ($10,$2,$7,'2. Dönem',$11::date,$12::date,false,now())`,
          [t("term-old"), tenant, t("year-old"), days(-150), days(-30), t("term-new"), t("year-new"), days(-5), days(100), t("term-future"), days(120), days(280)],
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
    await admin.query('DELETE FROM "Tenant" WHERE id = ANY($1::text[])', [[tenantA, tenantB]]);
    await Promise.all([app.end(), admin.end()]);
  });

  async function activeCalendar(tenant: string) {
    const years = await admin.query<{ id: string }>('SELECT id FROM "AcademicYear" WHERE "tenantId" = $1 AND "isActive" ORDER BY id', [tenant]);
    const terms = await admin.query<{ id: string }>('SELECT id FROM "AcademicTerm" WHERE "tenantId" = $1 AND "isActive" ORDER BY id', [tenant]);
    return { years: years.rows.map((row) => row.id), terms: terms.rows.map((row) => row.id) };
  }

  it("aktivasyon tek transaction'da yalnız kendi kurumunun takvimini değiştirir; gelecek dönem ve yarıda kalan yazma geri alınır", async () => {
    const a = (name: string) => id(tenantA, name);
    await expect(calendar.activate({ tenantId: tenantA, academicYearId: a("year-new"), termId: a("term-future"), today }))
      .rejects.toThrow("ACADEMIC_CALENDAR_NOT_STARTED");
    await expect(calendar.activate({ tenantId: tenantA, academicYearId: id(tenantB, "year-new"), termId: id(tenantB, "term-new"), today }))
      .rejects.toThrow("ACADEMIC_YEAR_NOT_FOUND");
    await expect(calendar.activate({ tenantId: tenantA, academicYearId: a("year-new"), termId: a("term-old"), today }))
      .rejects.toThrow("ACADEMIC_TERM_YEAR_MISMATCH");
    await expect(calendar.activate({
      tenantId: tenantA,
      academicYearId: a("year-new"),
      termId: a("term-new"),
      today,
      finalize: async () => { throw new Error("FINALIZE_FAILED"); },
    })).rejects.toThrow("FINALIZE_FAILED");
    await expect(activeCalendar(tenantA)).resolves.toEqual({ years: [a("year-old")], terms: [a("term-old")] });

    const result = await calendar.activate({ tenantId: tenantA, academicYearId: a("year-new"), termId: a("term-new"), today });
    expect(result).toMatchObject({
      academicYear: { id: a("year-new"), isActive: true },
      term: { id: a("term-new"), isActive: true },
      deactivatedAcademicYearIds: [a("year-old")],
      deactivatedTermIds: [a("term-old")],
    });
    await expect(activeCalendar(tenantA)).resolves.toEqual({ years: [a("year-new")], terms: [a("term-new")] });
    await expect(activeCalendar(tenantB)).resolves.toEqual({ years: [id(tenantB, "year-old")], terms: [id(tenantB, "term-old")] });
  });

  it("eşzamanlı iki aktivasyon sonunda kurumda tek aktif yıl ve dönem bırakır", async () => {
    const b = (name: string) => id(tenantB, name);
    await Promise.all([
      calendar.activate({ tenantId: tenantB, academicYearId: b("year-new"), termId: b("term-new"), today }),
      calendar.activate({ tenantId: tenantB, academicYearId: b("year-old"), termId: b("term-old"), today }),
      calendar.activate({ tenantId: tenantB, academicYearId: b("year-new"), termId: b("term-new"), today }),
    ]);
    const state = await activeCalendar(tenantB);
    expect(state.years).toHaveLength(1);
    expect(state.terms).toHaveLength(1);
    expect(state.terms[0]).toBe(state.years[0] === b("year-new") ? b("term-new") : b("term-old"));
  });

  it("yenileme beklenen durum değişmişse yazmaz; kota yeni öğrenciyi sınırda durdurur; idempotency anahtarı yazmayla birlikte tamamlanır", async () => {
    const a = (name: string) => id(tenantA, name);
    const create = (studentNo: string, status: "ACTIVE" | "GRADUATED") => inTenant(tenantA, () => students.createWithEnrollment(
      { tenantId: tenantA, studentNo, firstName: "ADA", lastName: "YILMAZ", gradeLevelId: a("grade-8"), classId: a("class-8a"), status },
      { gradeLevelId: a("grade-8"), classId: a("class-8a"), academicYearId: a("year-old"), termId: a("term-old"), startsAt: days(-100), status, reason: "CREATED" },
    ));
    const licensed = await create("300", "ACTIVE");
    const graduate = await create("301", "GRADUATED");
    const renewal = {
      closeActive: { endsAt: today },
      create: { gradeLevelId: a("grade-8"), classId: a("class-8a"), academicYearId: a("year-new"), termId: a("term-new"), startsAt: today, status: "ACTIVE" as const, reason: "RENEWED" },
    };
    const enrollmentCount = async (studentId: string) => Number((await admin.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM "StudentEnrollment" WHERE "studentId" = $1', [studentId],
    )).rows[0]?.count ?? 0);

    await expect(inTenant(tenantA, () => students.updateWithEnrollmentTransition(graduate.id, { status: "ACTIVE" }, {
      ...renewal,
      expectedStatus: "ACTIVE",
    }))).rejects.toThrow("STUDENT_STATUS_CHANGED");
    expect(await enrollmentCount(graduate.id)).toBe(1);
    expect((await admin.query('SELECT status FROM "Student" WHERE id = $1', [graduate.id])).rows[0]).toEqual({ status: "GRADUATED" });

    // The licence allows 10; the renewal's own limit of 1 must stop the reactivation of the graduate.
    await expect(inTenant(tenantA, () => students.updateWithEnrollmentTransition(graduate.id, { status: "ACTIVE" }, {
      ...renewal,
      activeStudentLimit: 1,
    }))).rejects.toThrow("ACTIVE_STUDENT_LIMIT_REACHED");
    expect(await enrollmentCount(graduate.id)).toBe(1);
    expect((await admin.query('SELECT status FROM "Student" WHERE id = $1', [graduate.id])).rows[0]).toEqual({ status: "GRADUATED" });

    const key = `term-renew-${randomUUID()}`;
    const renewed = await inTenant(tenantA, () => idempotency.run(
      context(tenantA),
      { key, operation: "student.enrollment.bulk-renew", request: { studentId: licensed.id } },
      (completion) => students.updateWithEnrollmentTransition(licensed.id, { status: "ACTIVE" }, {
        ...renewal,
        expectedStatus: "ACTIVE",
        finalize: completion ? (client, result) => completion.complete(client, result.enrollment) : undefined,
      }).then((result) => result?.enrollment),
    ));
    expect(renewed).toMatchObject({ studentId: licensed.id, academicYearId: a("year-new"), termId: a("term-new"), reason: "RENEWED" });
    expect((await admin.query('SELECT status FROM "IdempotencyKey" WHERE "tenantId" = $1 AND key = $2', [tenantA, key])).rows)
      .toEqual([{ status: "COMPLETED" }]);
    const replay = await inTenant(tenantA, () => idempotency.run(
      context(tenantA),
      { key, operation: "student.enrollment.bulk-renew", request: { studentId: licensed.id } },
      async () => { throw new Error("REPLAY_MUST_NOT_WRITE"); },
    ));
    expect(replay).toEqual(JSON.parse(JSON.stringify(renewed)));
    expect(await enrollmentCount(licensed.id)).toBe(2);

    const failedKey = `term-renew-${randomUUID()}`;
    await expect(inTenant(tenantA, () => idempotency.run(
      context(tenantA),
      { key: failedKey, operation: "student.enrollment.bulk-renew", request: { studentId: graduate.id } },
      (completion) => students.updateWithEnrollmentTransition(graduate.id, { status: "ACTIVE" }, {
        ...renewal,
        expectedStatus: "ACTIVE",
        finalize: completion ? (client, result) => completion.complete(client, result.enrollment) : undefined,
      }),
    ))).rejects.toThrow("STUDENT_STATUS_CHANGED");
    expect((await admin.query('SELECT 1 FROM "IdempotencyKey" WHERE "tenantId" = $1 AND key = $2', [tenantA, failedKey])).rows).toEqual([]);
  });

  it("toplu mezuniyet açık kaydı mezun durumuyla kapatır ve başka kurumun öğrencisine dokunmaz", async () => {
    const a = (name: string) => id(tenantA, name);
    const student = await inTenant(tenantA, () => students.createWithEnrollment(
      { tenantId: tenantA, studentNo: "310", firstName: "CAN", lastName: "KAYA", gradeLevelId: a("grade-8"), classId: a("class-8a"), status: "ACTIVE" },
      { gradeLevelId: a("grade-8"), classId: a("class-8a"), startsAt: days(-100), status: "ACTIVE", reason: "CREATED" },
    ));
    const result = await inTenant(tenantA, () => students.updateWithEnrollmentTransition(student.id, { status: "GRADUATED" }, {
      closeActive: { endsAt: today, status: "GRADUATED" },
      suspendPortalAccess: { reason: "STUDENT_STATUS_GRADUATED" },
      expectedStatus: "ACTIVE",
    }));
    expect(result?.student.status).toBe("GRADUATED");
    expect(result?.portalAccess).toMatchObject({ membershipSuspended: false, sessionsRevoked: 0 });
    expect((await admin.query('SELECT status, "endsAt" IS NOT NULL AS closed FROM "StudentEnrollment" WHERE "studentId" = $1', [student.id])).rows)
      .toEqual([{ status: "GRADUATED", closed: true }]);

    await expect(inTenant(tenantB, () => students.updateWithEnrollmentTransition(student.id, { status: "TRANSFERRED" }, {
      closeActive: { endsAt: today, status: "TRANSFERRED" },
      expectedStatus: "GRADUATED",
    }))).resolves.toBeUndefined();
    expect((await admin.query('SELECT status FROM "Student" WHERE id = $1', [student.id])).rows[0]).toEqual({ status: "GRADUATED" });
  });
});
