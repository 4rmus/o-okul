import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { registerTestLoginIdentity, testLoginBody } from "../test-auth.js";

// SEC-CAMPUS: a CAMPUSES membership sees and writes only rows attributable to its campuses. Demo data: class-a and
// student-a sit in campus-main; "campus-other" owns nothing in tenant-a. Campus-scoped memberships are canonical
// OPERATIONS_STAFF; the ASSISTANT_ADMIN paths are covered by the service tests.
describe("kampüs kapsamlı çalışan erişimi", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let adminToken: string;
  let mainToken: string;
  let otherToken: string;

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    for (const [id, campusId] of [["main", "campus-main"], ["other", "campus-other"]] as const) {
      upsertInMemoryAuthUser({
        id: `user-campus-${id}`,
        email: `campus-${id}@example.test`,
        name: "Campus Probe",
        password: "password",
        tenantId: "tenant-a",
        roles: ["OPERATIONS_STAFF"],
        membership: {
          id: `membership-campus-${id}`,
          staffRole: "OPERATIONS_STAFF",
          hasTeacherPersona: false,
          hasStudentPersona: false,
          version: 1,
          scopeMode: "CAMPUSES",
          campusIds: [campusId],
        },
      });
      registerTestLoginIdentity(`campus-${id}@example.test`, { tenantSlug: "dna-egitim" });
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    server = app.getHttpServer() as Parameters<typeof request>[0];

    adminToken = await login("admin-a@example.test");
    mainToken = await login("campus-main@example.test");
    otherToken = await login("campus-other@example.test");
  });

  afterAll(async () => {
    await app?.close();
    resetInMemoryAuthUsers();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  function get(path: string, token: string) {
    return request(server).get(path).set("Authorization", `Bearer ${token}`);
  }

  function ids(body: unknown): string[] {
    return (body as Array<{ id: string }>).map((record) => record.id);
  }

  it("duyuru: başka kampüsün duyurusu gizli, okul geneli duyuru görünür ama yönetilemez", async () => {
    const schoolWide = await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Okul geneli", body: "Tüm kampüsler", audience: "SCHOOL" })
      .expect(201);
    const schoolWideId = (schoolWide.body as { id: string }).id;

    const adminList = await get("/announcements", adminToken).expect(200);
    expect(ids(adminList.body)).toEqual(expect.arrayContaining(["announcement-a", schoolWideId]));

    const otherList = await get("/announcements", otherToken).expect(200);
    expect(ids(otherList.body)).toContain(schoolWideId);
    expect(ids(otherList.body)).not.toContain("announcement-a");
    const single = await get("/announcements/announcement-a", otherToken).expect(403);
    expect(single.body.error.code).toBe("ANNOUNCEMENT_CAMPUS_SCOPE_FORBIDDEN");
    await get(`/announcements/${schoolWideId}`, otherToken).expect(200);
    await get("/announcements/announcement-a/recipients", otherToken).expect(403);
    await get(`/announcements/${schoolWideId}/recipients`, otherToken).expect(403);
    await get(`/announcements/${schoolWideId}/delivery-reports`, mainToken).expect(403);

    const mainList = await get("/announcements", mainToken).expect(200);
    expect(ids(mainList.body)).toEqual(expect.arrayContaining(["announcement-a", schoolWideId]));
    await get("/announcements/announcement-a/recipients", mainToken).expect(200);
  });

  it("duyuru: kampüs kapsamlı kullanıcı yalnız kendi kampüsüne duyuru oluşturur", async () => {
    const schoolWide = await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${mainToken}`)
      .send({ title: "Okul geneli", body: "Kapsam dışı", audience: "SCHOOL" })
      .expect(403);
    expect(schoolWide.body.error.code).toBe("ANNOUNCEMENT_CAMPUS_SCOPE_FORBIDDEN");

    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ title: "Başka kampüs", body: "Kapsam dışı", audience: "SCHOOL", classId: "class-a" })
      .expect(403);

    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${mainToken}`)
      .send({ title: "Merkez kampüs", body: "Kapsam içi", audience: "SCHOOL", campusId: "campus-main" })
      .expect(201);
  });

  it("toplu SMS: başka kampüsün velileri önizlemede yok, kapsam dışı duyuru, kampüs ve sınıf reddedilir", async () => {
    const originalSmsEnabled = process.env.SMS_ENABLED;
    process.env.SMS_ENABLED = "true";
    try {
      const preview = (token: string, body: Record<string, unknown>) => request(server)
        .post("/sms-batches/recipients/preview")
        .set("Authorization", `Bearer ${token}`)
        .send(body);

      const otherAll = await preview(otherToken, {}).expect(201);
      expect(otherAll.body).toEqual({ recipients: [], recipientCount: 0 });
      for (const [body, code] of [
        [{ announcementId: "announcement-a" }, "ANNOUNCEMENT_CAMPUS_SCOPE_FORBIDDEN"],
        [{ campusId: "campus-main" }, "SMS_BATCH_CAMPUS_SCOPE_FORBIDDEN"],
        [{ classId: "class-a" }, "SMS_BATCH_CAMPUS_SCOPE_FORBIDDEN"],
      ] as const) {
        const rejected = await preview(otherToken, body).expect(403);
        expect(rejected.body.error.code).toBe(code);
      }

      const adminClass = await preview(adminToken, { classId: "class-a" }).expect(201);
      const mainClass = await preview(mainToken, { classId: "class-a" }).expect(201);
      expect(mainClass.body).toEqual(adminClass.body);
      await preview(mainToken, { announcementId: "announcement-a" }).expect(201);

      const enqueue = await request(server)
        .post("/sms-batches")
        .set("Authorization", `Bearer ${otherToken}`)
        .send({ recipientScope: { announcementId: "announcement-a" }, templateId: "message-template-a", recipients: [{ to: "5000000001" }] })
        .expect(403);
      expect(enqueue.body.error.code).toBe("ANNOUNCEMENT_CAMPUS_SCOPE_FORBIDDEN");
    } finally {
      if (originalSmsEnabled === undefined) delete process.env.SMS_ENABLED;
      else process.env.SMS_ENABLED = originalSmsEnabled;
    }
  });

  it("yoklama: başka kampüsün kayıtları listede ve özette yok", async () => {
    const adminList = await get("/attendance", adminToken).expect(200);
    expect(ids(adminList.body)).toContain("attendance-a");

    const otherList = await get("/attendance", otherToken).expect(200);
    expect(otherList.body).toEqual([]);
    const otherStudent = await get("/attendance?studentId=student-a", otherToken).expect(200);
    expect(otherStudent.body).toEqual([]);
    const otherAggregate = await get("/attendance/aggregate", otherToken).expect(200);
    expect(otherAggregate.body).toMatchObject({ total: 0 });
    const daily = await get("/attendance/daily?classId=class-a&date=2026-06-03", otherToken).expect(403);
    expect(daily.body.error.code).toBe("ATTENDANCE_CAMPUS_SCOPE_FORBIDDEN");

    const mainList = await get("/attendance", mainToken).expect(200);
    expect(ids(mainList.body)).toContain("attendance-a");
  });

  it("öğretmen notu: başka kampüs öğrencisinin notu listede yok ve değiştirilemez", async () => {
    const adminList = await get("/teacher-notes", adminToken).expect(200);
    expect(ids(adminList.body)).toContain("teacher-note-internal-a");

    const otherList = await get("/teacher-notes", otherToken).expect(200);
    expect(otherList.body).toEqual([]);
    const update = await request(server)
      .patch("/teacher-notes/teacher-note-internal-a")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ body: "Kapsam dışı düzenleme" })
      .expect(403);
    expect(update.body.error.code).toBe("TEACHER_NOTE_CAMPUS_SCOPE_FORBIDDEN");
    await request(server)
      .delete("/teacher-notes/teacher-note-internal-a")
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(403);

    const mainList = await get("/teacher-notes", mainToken).expect(200);
    expect(ids(mainList.body)).toEqual(expect.arrayContaining(["teacher-note-internal-a", "teacher-note-visible-a"]));
  });

  it("etüt: başka kampüs sınıfının etüdü listede yok, tekil okuma ve silme reddedilir", async () => {
    const adminList = await get("/study-sessions", adminToken).expect(200);
    expect(ids(adminList.body)).toContain("study-a");

    const otherList = await get("/study-sessions", otherToken).expect(200);
    expect(ids(otherList.body)).not.toContain("study-a");
    const single = await get("/study-sessions/study-a", otherToken).expect(403);
    expect(single.body.error.code).toBe("STUDY_SESSION_CAMPUS_SCOPE_FORBIDDEN");
    await request(server)
      .delete("/study-sessions/study-a")
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(403);

    const mainList = await get("/study-sessions", mainToken).expect(200);
    expect(ids(mainList.body)).toContain("study-a");
    await get("/study-sessions/study-a", mainToken).expect(200);
  });

  it("gelişim değerlendirmesi: başka kampüs öğrencisinin değerlendirmesi listede yok, yenisi yazılamaz", async () => {
    const criterion = await request(server)
      .post("/development/criteria")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Kampüs kapsamı ölçütü" })
      .expect(201);
    const criterionId = (criterion.body as { id: string }).id;
    // GUARDIAN: OPERATIONS_STAFF never reads INTERNAL records (DEC-20261102-05, RK-6); this case checks campus scope.
    const input = { studentId: "student-a", teacherId: "teacher-a", periodLabel: "2026 Kasım", visibility: "GUARDIAN", scores: [{ criterionId, score: 3 }] };
    const assessment = await request(server)
      .post("/development/assessments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(input)
      .expect(201);
    const assessmentId = (assessment.body as { id: string }).id;

    const adminList = await get("/development/assessments", adminToken).expect(200);
    expect(ids(adminList.body)).toContain(assessmentId);

    const otherList = await get("/development/assessments", otherToken).expect(200);
    expect(ids(otherList.body)).not.toContain(assessmentId);
    const otherStudent = await get("/development/assessments?studentId=student-a", otherToken).expect(200);
    expect(otherStudent.body).toEqual([]);
    const write = await request(server)
      .post("/development/assessments")
      .set("Authorization", `Bearer ${otherToken}`)
      .send(input)
      .expect(403);
    expect(write.body.error.code).toBe("DEVELOPMENT_CAMPUS_SCOPE_FORBIDDEN");

    const mainList = await get("/development/assessments", mainToken).expect(200);
    expect(ids(mainList.body)).toContain(assessmentId);
  });

  it("kurum paneli kampüs kapsamlı yanıtı işaretler, kurum geneli yanıt değişmez", async () => {
    const admin = await get("/me/institution-dashboard", adminToken).expect(200);
    expect(admin.body).not.toHaveProperty("campusScoped");

    const scoped = await get("/me/institution-dashboard", otherToken).expect(200);
    expect(scoped.body).toMatchObject({ campusScoped: true });
  });
});
