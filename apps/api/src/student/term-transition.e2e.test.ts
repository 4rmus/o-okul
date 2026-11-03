import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers } from "../auth/auth-user-store.js";
import { apiPrefix, configureApiApp } from "../http/configure-api-app.js";
import { testLoginBody } from "../test-auth.js";

// DEC-20261102-08: the three term-transition wizard endpoints on the in-memory stores.
describe("Dönem geçişi uçları", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let adminToken: string;
  let otherTenantAdminToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApiApp(app);
    await app.listen(0, "127.0.0.1");
    server = app.getHttpServer() as Parameters<typeof request>[0];
    adminToken = await login("admin-a@example.test");
    otherTenantAdminToken = await login("admin-b@example.test");
    teacherToken = await login("teacher-a@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  it("yıl ve dönemi tek adımda etkinleştirir; gelecek, eşleşmeyen ve başka kurumun takvimini reddeder", async () => {
    const year = (await post("/academic-years", adminToken, {
      name: "2026-2027",
      startsAt: daysFromToday(-60),
      endsAt: daysFromToday(300),
    }).expect(201)).body.data as { id: string };
    const term = (await post("/academic-terms", adminToken, {
      academicYearId: year.id,
      name: "1. Dönem",
      startsAt: daysFromToday(-10),
      endsAt: daysFromToday(80),
    }).expect(201)).body.data as { id: string };
    const futureTerm = (await post("/academic-terms", adminToken, {
      academicYearId: year.id,
      name: "2. Dönem",
      startsAt: daysFromToday(30),
      endsAt: daysFromToday(150),
    }).expect(201)).body.data as { id: string };

    await post("/academic-calendar/activate", teacherToken, { academicYearId: year.id, termId: term.id }).expect(403);
    await post("/academic-calendar/activate", adminToken, { academicYearId: year.id }).expect(422);
    await post("/academic-calendar/activate", adminToken, { academicYearId: year.id, termId: futureTerm.id })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe("ACADEMIC_CALENDAR_NOT_STARTED"));
    await post("/academic-calendar/activate", adminToken, { academicYearId: year.id, termId: "term-2026-spring" })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("ACADEMIC_TERM_YEAR_MISMATCH"));
    await post("/academic-calendar/activate", otherTenantAdminToken, { academicYearId: year.id, termId: term.id })
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe("ACADEMIC_YEAR_NOT_FOUND"));

    const activated = await post("/academic-calendar/activate", adminToken, { academicYearId: year.id, termId: term.id })
      .set("Idempotency-Key", "academic-calendar-activate-idempotency-a")
      .expect(201);
    expect(activated.body.data).toEqual({
      academicYear: expect.objectContaining({ id: year.id, isActive: true }),
      term: expect.objectContaining({ id: term.id, academicYearId: year.id, isActive: true }),
      deactivatedAcademicYearIds: ["academic-year-2026"],
      deactivatedTermIds: ["term-2026-spring"],
    });
    await post("/academic-calendar/activate", adminToken, { academicYearId: year.id, termId: term.id })
      .set("Idempotency-Key", "academic-calendar-activate-idempotency-a")
      .expect(201)
      .expect(({ body }) => expect(body).toEqual(activated.body));

    const years = await get("/academic-years", adminToken).expect(200);
    expect((years.body.data as Array<{ id: string; isActive: boolean }>).filter((record) => record.isActive).map((record) => record.id))
      .toEqual([year.id]);
    const terms = await get("/academic-terms", adminToken).expect(200);
    expect((terms.body.data as Array<{ id: string; isActive: boolean }>).filter((record) => record.isActive).map((record) => record.id))
      .toEqual([term.id]);
    const otherYears = await get("/academic-years", otherTenantAdminToken).expect(200);
    expect(otherYears.body.data).toEqual([expect.objectContaining({ id: "academic-year-2026-b", isActive: true })]);
  });

  it("toplu mezuniyet onay ve anahtar ister; ön izleme yazmadan çakışmayı gösterir, yenileme aktif olmayanı reddeder", async () => {
    const graduate = (await post("/students", adminToken, {
      firstName: "Mezun",
      lastName: "Aday",
      classId: "class-a",
    }).expect(201)).body.data as { id: string };
    const bulkStatus = { studentIds: [graduate.id], status: "GRADUATED", confirmIrreversible: true };

    await post("/students/bulk-status", teacherToken, bulkStatus)
      .set("Idempotency-Key", "student-bulk-status-teacher")
      .expect(403);
    await post("/students/bulk-status", adminToken, bulkStatus)
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED"));
    await post("/students/bulk-status", adminToken, { ...bulkStatus, confirmIrreversible: false })
      .set("Idempotency-Key", "student-bulk-status-unconfirmed")
      .expect(422);
    await post("/students/bulk-status", adminToken, { ...bulkStatus, status: "ACTIVE" })
      .set("Idempotency-Key", "student-bulk-status-active")
      .expect(422);
    await post("/students/bulk-status", otherTenantAdminToken, bulkStatus)
      .set("Idempotency-Key", "student-bulk-status-other-tenant")
      .expect(403);

    const graduated = await post("/students/bulk-status", adminToken, bulkStatus)
      .set("Idempotency-Key", "student-bulk-status-idempotency-a")
      .expect(201);
    expect(graduated.body.data).toEqual({
      updatedCount: 1,
      unchangedCount: 0,
      results: [{ studentId: graduate.id, outcome: "UPDATED", previousStatus: "ACTIVE", status: "GRADUATED", portalAccessSuspended: false }],
    });
    await post("/students/bulk-status", adminToken, bulkStatus)
      .set("Idempotency-Key", "student-bulk-status-idempotency-a")
      .expect(201)
      .expect(({ body }) => expect(body).toEqual(graduated.body));
    await get(`/students/${graduate.id}`, adminToken)
      .expect(200)
      .expect(({ body }) => expect(body.data.status).toBe("GRADUATED"));

    const renewal = {
      studentIds: ["student-a", graduate.id],
      classId: "class-a",
      academicYearId: "academic-year-2026",
      termId: "term-2026-spring",
    };
    const enrollmentsBefore = (await get("/students/student-a/enrollments", adminToken).expect(200)).body.data as unknown[];

    await post("/students/enrollments/bulk-renew/dry-run", adminToken, { ...renewal, termId: undefined })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("STUDENT_BULK_ENROLLMENT_ACADEMIC_CONTEXT_REQUIRED"));
    await post("/students/enrollments/bulk-renew/dry-run", teacherToken, renewal).expect(403);
    await post("/students/enrollments/bulk-renew/dry-run", otherTenantAdminToken, renewal)
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("STUDENT_ENROLLMENT_ACADEMIC_YEAR_INVALID"));
    await post("/students/enrollments/bulk-renew/dry-run", otherTenantAdminToken, {
      ...renewal,
      academicYearId: "academic-year-2026-b",
      termId: "term-2026-spring-b",
    }).expect(403);
    const preview = await post("/students/enrollments/bulk-renew/dry-run", adminToken, renewal).expect(201);
    expect(preview.body.data).toMatchObject({
      dryRun: true,
      academicYearId: "academic-year-2026",
      termId: "term-2026-spring",
      termStartsAt: "2026-02-01",
      termStarted: true,
      conflictStudentIds: [graduate.id],
      quota: { incoming: 0, wouldExceed: false },
    });
    expect(preview.body.data.items).toEqual([
      expect.objectContaining({ studentId: "student-a", status: "ACTIVE", sourceClassId: "class-a", targetClassId: "class-a", addsToQuota: false }),
      expect.objectContaining({ studentId: graduate.id, status: "GRADUATED", conflict: "STUDENT_NOT_ACTIVE", addsToQuota: false }),
    ]);

    await post("/students/enrollments/bulk-renew", adminToken, renewal)
      .set("Idempotency-Key", "student-bulk-renew-not-active")
      .expect(409)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({ code: "STUDENT_BULK_RENEW_NOT_ACTIVE", details: { studentIds: [graduate.id] } });
      });
    await get("/students/student-a/enrollments", adminToken)
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual(enrollmentsBefore));
    await get(`/students/${graduate.id}`, adminToken)
      .expect(200)
      .expect(({ body }) => expect(body.data.status).toBe("GRADUATED"));
  });

  function post(path: string, token: string, body: unknown) {
    return request(server).post(`/${apiPrefix}${path}`).set("Authorization", `Bearer ${token}`).send(body as object);
  }

  function get(path: string, token: string) {
    return request(server).get(`/${apiPrefix}${path}`).set("Authorization", `Bearer ${token}`);
  }

  async function login(email: string): Promise<string> {
    const response = await request(server)
      .post(`/${apiPrefix}/auth/login`)
      .send(testLoginBody(email))
      .expect(200);
    return response.body.data.accessToken as string;
  }
});

function daysFromToday(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
