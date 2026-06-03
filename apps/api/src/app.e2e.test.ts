import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "./app.module.js";

describe("API auth + tenant isolation", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string) {
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
    const refreshCookie = getRefreshCookie(response.headers["set-cookie"]);
    const csrfCookie = getCookie(response.headers["set-cookie"], "csrfToken");

    expect(refreshCookie).toContain("HttpOnly");

    return {
      ...(response.body as {
        accessToken: string;
        session: { id: string; subjectType?: string; subjectId?: string };
      }),
      refreshCookie,
      csrfCookie,
      csrfToken: readCookieValue(csrfCookie, "csrfToken"),
    };
  }

  it("login, refresh rotation ve logout akışını HTTP üzerinden doğrular", async () => {
    const issued = await login("admin-a@example.test");

    const rotated = await request(server)
      .post("/auth/refresh")
      .set("Cookie", [issued.refreshCookie, issued.csrfCookie])
      .set("X-CSRF-Token", issued.csrfToken)
      .expect(200);

    const rotatedCookie = getRefreshCookie(rotated.headers["set-cookie"]);
    const rotatedCsrfCookie = getCookie(rotated.headers["set-cookie"], "csrfToken");
    const rotatedCsrfToken = readCookieValue(rotatedCsrfCookie, "csrfToken");
    expect(rotatedCookie).toContain("HttpOnly");
    expect(rotatedCookie).not.toBe(issued.refreshCookie);

    await request(server)
      .post("/auth/refresh")
      .set("Cookie", [issued.refreshCookie, issued.csrfCookie])
      .set("X-CSRF-Token", issued.csrfToken)
      .expect(401);
    await request(server)
      .post("/auth/logout")
      .set("Cookie", [rotatedCookie, rotatedCsrfCookie])
      .set("X-CSRF-Token", rotatedCsrfToken)
      .expect(204);
    await request(server)
      .post("/auth/refresh")
      .set("Cookie", [rotatedCookie, rotatedCsrfCookie])
      .set("X-CSRF-Token", rotatedCsrfToken)
      .expect(401);
  });

  it("refresh ve logout CSRF header olmadan reddedilir", async () => {
    const issued = await login("admin-a@example.test");

    await request(server).post("/auth/refresh").set("Cookie", [issued.refreshCookie, issued.csrfCookie]).expect(403);
    await request(server)
      .post("/auth/refresh")
      .set("Cookie", [issued.refreshCookie, issued.csrfCookie])
      .set("X-CSRF-Token", "wrong")
      .expect(403);
    await request(server).post("/auth/logout").set("Cookie", [issued.refreshCookie, issued.csrfCookie]).expect(403);
  });

  it("şifre reset tokenı şifreyi değiştirir ve eski oturumları iptal eder", async () => {
    const issued = await login("system@example.test");
    const resetRequest = await request(server)
      .post("/auth/password-reset/request")
      .send({ email: "system@example.test" })
      .expect(200);
    const resetToken = (resetRequest.body as { resetToken?: string }).resetToken;
    expect(resetRequest.body).toMatchObject({ status: "ISSUED" });
    expect(resetToken).toBeTruthy();

    await request(server)
      .post("/auth/password-reset/confirm")
      .send({ token: resetToken, password: "new-password" })
      .expect(200)
      .expect(({ body }) => {
        expect(Date.parse((body as { resetAt: string }).resetAt)).not.toBeNaN();
      });

    await request(server)
      .post("/auth/refresh")
      .set("Cookie", [issued.refreshCookie, issued.csrfCookie])
      .set("X-CSRF-Token", issued.csrfToken)
      .expect(401);
    await request(server)
      .post("/auth/password-reset/confirm")
      .send({ token: resetToken, password: "another-password" })
      .expect(400);
    await request(server).post("/auth/login").send({ email: "system@example.test", password: "password" }).expect(401);
    await request(server)
      .post("/auth/login")
      .send({ email: "system@example.test", password: "new-password" })
      .expect(200);
  });

  it("tenant A liste endpointinde tenant B öğrencisini göremez", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .get("/students")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: "student-a",
        tenantId: "tenant-a",
        firstName: "Ada",
        lastName: "A",
        classId: "class-a",
        responsibleTeacherId: "teacher-a",
        status: "ACTIVE",
        userId: "student-tenant-a",
      },
    ]);
  });

  it("tenant A, tenant B tekil kaynağına erişemez", async () => {
    const issued = await login("admin-a@example.test");

    await request(server)
      .get("/students/student-b")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(403);

    await request(server)
      .patch("/students/student-b")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ firstName: "Gizli" })
      .expect(403);

    await request(server).delete("/students/student-b").set("Authorization", `Bearer ${issued.accessToken}`).expect(403);
  });

  it("student ve guardian aynı tenant içinde başka öğrencinin profilini göremez", async () => {
    const admin = await login("admin-a@example.test");
    const created = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ firstName: "Idor", lastName: "Deneme" })
      .expect(201);
    const otherStudentId = (created.body as { id: string }).id;

    const student = await login("student-a@example.test");
    expect(student.session).toMatchObject({ subjectType: "STUDENT", subjectId: "student-a" });
    await request(server).get("/students/student-a").set("Authorization", `Bearer ${student.accessToken}`).expect(200);
    await request(server).get(`/students/${otherStudentId}`).set("Authorization", `Bearer ${student.accessToken}`).expect(403);

    const guardian = await login("guardian-a@example.test");
    expect(guardian.session).toMatchObject({ subjectType: "GUARDIAN", subjectId: "guardian-a" });
    await request(server).get("/students/student-a").set("Authorization", `Bearer ${guardian.accessToken}`).expect(200);
    await request(server).get(`/students/${otherStudentId}`).set("Authorization", `Bearer ${guardian.accessToken}`).expect(403);

    const teacher = await login("teacher-a@example.test");
    expect(teacher.session).toMatchObject({ subjectType: "TEACHER", subjectId: "teacher-a" });
    await request(server).get("/students/student-a").set("Authorization", `Bearer ${teacher.accessToken}`).expect(200);
    await request(server)
      .get("/students")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            id: "student-a",
            responsibleTeacherId: "teacher-a",
          }),
        ]);
        expect(JSON.stringify(body)).not.toContain(otherStudentId);
      });

    await request(server).delete(`/students/${otherStudentId}`).set("Authorization", `Bearer ${admin.accessToken}`).expect(204);
  });

  it("me profile oturum subject bilgisini parametresiz döner", async () => {
    const admin = await login("admin-a@example.test");
    await request(server)
      .get("/me/profile")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"] });
        expect(body.subjectType).toBeUndefined();
        expect(body.subjectId).toBeUndefined();
      });

    const student = await login("student-a@example.test");
    await request(server)
      .get("/me/profile")
      .set("Authorization", `Bearer ${student.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          userId: "student-tenant-a",
          tenantId: "tenant-a",
          roles: ["STUDENT"],
          subjectType: "STUDENT",
          subjectId: "student-a",
        });
      });

    await request(server).get("/me/profile").expect(401);
  });

  it("me öğrenci ve veli veri endpointleri subject dışına çıkmaz", async () => {
    const student = await login("student-a@example.test");
    await request(server)
      .get("/me/student")
      .set("Authorization", `Bearer ${student.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: "student-a",
          tenantId: "tenant-a",
          firstName: "Ada",
          lastName: "A",
          userId: "student-tenant-a",
        });
      });
    await request(server).get("/me/guardian/students").set("Authorization", `Bearer ${student.accessToken}`).expect(403);

    const guardian = await login("guardian-a@example.test");
    await request(server)
      .get("/me/guardian/students")
      .set("Authorization", `Bearer ${guardian.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          {
            id: "student-a",
            tenantId: "tenant-a",
            firstName: "Ada",
            lastName: "A",
            classId: "class-a",
            responsibleTeacherId: "teacher-a",
            status: "ACTIVE",
            userId: "student-tenant-a",
          },
        ]);
      });
    await request(server).get("/me/student").set("Authorization", `Bearer ${guardian.accessToken}`).expect(403);

    const teacher = await login("teacher-a@example.test");
    await request(server).get("/me/student").set("Authorization", `Bearer ${teacher.accessToken}`).expect(403);
    await request(server).get("/me/guardian/students").set("Authorization", `Bearer ${teacher.accessToken}`).expect(403);
  });

  it("me öğretmen veri endpointleri yalnız kendi subject verisini döner", async () => {
    const teacher = await login("teacher-a@example.test");
    await request(server)
      .get("/me/teacher")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: "teacher-a",
          tenantId: "tenant-a",
          firstName: "Ayse",
          lastName: "Ogretmen",
          branch: "Matematik",
          userId: "teacher-tenant-a",
        });
      });
    await request(server)
      .get("/me/teacher/schedule")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          {
            id: "lesson-a",
            tenantId: "tenant-a",
            classId: "class-a",
            teacherId: "teacher-a",
            courseId: "course-math",
            termId: "term-2026-spring",
            title: "Matematik",
            startsAt: "2026-06-01T09:00:00.000Z",
            endsAt: "2026-06-01T10:00:00.000Z",
          },
        ]);
      });

    const admin = await login("admin-a@example.test");
    await request(server).get("/me/teacher").set("Authorization", `Bearer ${admin.accessToken}`).expect(403);
    await request(server).get("/me/teacher/schedule").set("Authorization", `Bearer ${admin.accessToken}`).expect(403);

    const student = await login("student-a@example.test");
    await request(server).get("/me/teacher").set("Authorization", `Bearer ${student.accessToken}`).expect(403);
    await request(server).get("/me/teacher/schedule").set("Authorization", `Bearer ${student.accessToken}`).expect(403);
  });

  it("me ödev materyal atamaları yalnız bağlı öğrenci kapsamını döner", async () => {
    const student = await login("student-a@example.test");
    await request(server)
      .get("/me/student/homework/material-assignments")
      .set("Authorization", `Bearer ${student.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          {
            id: "material-assignment-a",
            tenantId: "tenant-a",
            materialId: "material-a",
            materialTitle: "Kesirler Çalışma Kağıdı",
            studentId: "student-a",
            courseId: "course-math",
            termId: "term-2026-spring",
            assignedById: "user-tenant-a",
            note: "Bireysel tekrar",
            dueAt: "2026-06-09T12:00:00.000Z",
            createdAt: "2026-06-08T09:20:00.000Z",
          },
        ]);
      });

    const guardian = await login("guardian-a@example.test");
    await request(server)
      .get("/me/guardian/homework/material-assignments")
      .set("Authorization", `Bearer ${guardian.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.map((assignment: { studentId: string }) => assignment.studentId)).toEqual(["student-a"]);
      });

    const teacher = await login("teacher-a@example.test");
    await request(server)
      .get("/me/student/homework/material-assignments")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(403);
    await request(server)
      .get("/me/guardian/homework/material-assignments")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(403);
  });

  it("me devamsızlık endpointleri öğrenci ve veliyi bağlı öğrenciyle sınırlar", async () => {
    const student = await login("student-a@example.test");
    await request(server)
      .get("/me/student/attendance")
      .set("Authorization", `Bearer ${student.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          {
            id: "attendance-a",
            tenantId: "tenant-a",
            studentId: "student-a",
            courseId: "course-math",
            termId: "term-2026-spring",
            date: "2026-06-03",
            status: "ABSENT",
          },
        ]);
      });
    await request(server)
      .get("/me/student/attendance/summary")
      .set("Authorization", `Bearer ${student.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ studentId: "student-a", total: 1, present: 0, absent: 1, late: 0, excused: 0 });
      });

    const guardian = await login("guardian-a@example.test");
    await request(server)
      .get("/me/guardian/students/student-a/attendance")
      .set("Authorization", `Bearer ${guardian.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.map((record: { studentId: string }) => record.studentId)).toEqual(["student-a"]);
      });
    await request(server)
      .get("/me/guardian/students/student-b/attendance")
      .set("Authorization", `Bearer ${guardian.accessToken}`)
      .expect(403);

    const teacher = await login("teacher-a@example.test");
    await request(server).get("/me/student/attendance").set("Authorization", `Bearer ${teacher.accessToken}`).expect(403);
    await request(server)
      .get("/me/guardian/students/student-a/attendance")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(403);
  });

  it("me öğretmen notları INTERNAL kayıtları öğrenci ve veliden saklar", async () => {
    const student = await login("student-a@example.test");
    await request(server)
      .get("/me/student/teacher-notes")
      .set("Authorization", `Bearer ${student.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          {
            id: "teacher-note-visible-a",
            tenantId: "tenant-a",
            studentId: "student-a",
            teacherId: "teacher-a",
            courseId: "course-math",
            termId: "term-2026-spring",
            visibility: "GUARDIAN_STUDENT",
            body: "Problem çözme rutini güçleniyor.",
            developmentStatus: "IMPROVING",
            createdAt: "2026-06-04T10:00:00.000Z",
          },
        ]);
      });

    const guardian = await login("guardian-a@example.test");
    await request(server)
      .get("/me/guardian/students/student-a/teacher-notes")
      .set("Authorization", `Bearer ${guardian.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.map((note: { visibility: string }) => note.visibility)).toEqual(["GUARDIAN_STUDENT"]);
        expect(JSON.stringify(body)).not.toContain("Dikkat takibi iç notu");
      });
    await request(server)
      .get("/me/guardian/students/student-b/teacher-notes")
      .set("Authorization", `Bearer ${guardian.accessToken}`)
      .expect(403);

    const teacher = await login("teacher-a@example.test");
    await request(server).get("/me/student/teacher-notes").set("Authorization", `Bearer ${teacher.accessToken}`).expect(403);
    await request(server)
      .get("/me/guardian/students/student-a/teacher-notes")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(403);
  });

  it("me duyuruları rol ve öğrenci kapsamına göre listeler", async () => {
    const student = await login("student-a@example.test");
    await request(server)
      .get("/me/student/announcements")
      .set("Authorization", `Bearer ${student.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            id: "announcement-a",
            tenantId: "tenant-a",
            title: "Veli toplantısı",
            audience: "SCHOOL",
            classId: "class-a",
          }),
        ]);
      });
    await request(server)
      .post("/me/student/announcements/announcement-a/read")
      .set("Authorization", `Bearer ${student.accessToken}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual(expect.objectContaining({ id: "announcement-a", readAt: expect.any(String) }));
      });
    await request(server)
      .get("/me/student/announcements")
      .set("Authorization", `Bearer ${student.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body[0]).toEqual(expect.objectContaining({ id: "announcement-a", readAt: expect.any(String) }));
      });

    const guardian = await login("guardian-a@example.test");
    await request(server)
      .get("/me/guardian/students/student-a/announcements")
      .set("Authorization", `Bearer ${guardian.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.map((announcement: { id: string }) => announcement.id)).toEqual(["announcement-a"]);
      });
    await request(server)
      .post("/me/guardian/students/student-a/announcements/announcement-a/read")
      .set("Authorization", `Bearer ${guardian.accessToken}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual(expect.objectContaining({ id: "announcement-a", readAt: expect.any(String) }));
      });
    await request(server)
      .get("/me/guardian/students/student-b/announcements")
      .set("Authorization", `Bearer ${guardian.accessToken}`)
      .expect(403);
    await request(server)
      .post("/me/guardian/students/student-b/announcements/announcement-a/read")
      .set("Authorization", `Bearer ${guardian.accessToken}`)
      .expect(403);

    const teacher = await login("teacher-a@example.test");
    await request(server)
      .get("/me/teacher/announcements")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.map((announcement: { id: string }) => announcement.id)).toEqual(["announcement-a"]);
      });
    await request(server)
      .post("/me/teacher/announcements/announcement-a/read")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual(expect.objectContaining({ id: "announcement-a", readAt: expect.any(String) }));
      });
  });

  it("me rapor endpointleri öğrenci ve veliyi bağlı öğrenciyle sınırlar", async () => {
    const student = await login("student-a@example.test");
    await request(server)
      .get("/me/student/reports/exam-demo/latest")
      .set("Authorization", `Bearer ${student.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          tenantId: "tenant-a",
          examId: "exam-demo",
          snapshotId: "snapshot-demo",
          studentId: "student-a",
          courseId: "course-math",
          termId: "term-2026-spring",
        });
      });
    await request(server)
      .get("/me/student/reports/exam-demo/latest/error-booklet")
      .set("Authorization", `Bearer ${student.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ studentId: "student-a", items: [] });
      });
    await request(server)
      .get("/me/student/reports/exam-demo/snapshots/snapshot-demo")
      .set("Authorization", `Bearer ${student.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          tenantId: "tenant-a",
          examId: "exam-demo",
          snapshotId: "snapshot-demo",
          studentId: "student-a",
          classId: "class-a",
          className: "8-A",
          courseId: "course-math",
          termId: "term-2026-spring",
        });
      });
    await request(server)
      .get("/me/student/reports/exam-demo/snapshots/snapshot-demo/error-booklet")
      .set("Authorization", `Bearer ${student.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ studentId: "student-a", items: [] });
      });
    await request(server)
      .get("/me/student/reports/exam-demo/progress")
      .set("Authorization", `Bearer ${student.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ studentId: "student-a" });
        expect(body.points).toHaveLength(1);
      });

    const guardian = await login("guardian-a@example.test");
    await request(server)
      .get("/me/guardian/students/student-a/reports/exam-demo/latest")
      .set("Authorization", `Bearer ${guardian.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          studentId: "student-a",
          courseId: "course-math",
          termId: "term-2026-spring",
        });
      });
    await request(server)
      .get("/me/guardian/students/student-a/reports/exam-demo/snapshots/snapshot-demo")
      .set("Authorization", `Bearer ${guardian.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          studentId: "student-a",
          courseId: "course-math",
          termId: "term-2026-spring",
        });
      });
    await request(server)
      .get("/me/guardian/students/student-b/reports/exam-demo/snapshots/snapshot-demo")
      .set("Authorization", `Bearer ${guardian.accessToken}`)
      .expect(403);

    const teacher = await login("teacher-a@example.test");
    await request(server)
      .get("/me/student/reports/exam-demo/snapshots/snapshot-demo")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(403);
  });

  it("student CRUD akışını tenant içinde tamamlar", async () => {
    const issued = await login("admin-a@example.test");

    const created = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ firstName: "Can", lastName: "Ogrenci" })
      .expect(201);

    const studentId = (created.body as { id: string }).id;
    expect(created.body).toMatchObject({ tenantId: "tenant-a", firstName: "Can", lastName: "Ogrenci" });

    const updated = await request(server)
      .patch(`/students/${studentId}`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ firstName: "Cem" })
      .expect(200);

    expect(updated.body).toMatchObject({ id: studentId, tenantId: "tenant-a", firstName: "Cem", lastName: "Ogrenci" });

    await request(server).delete(`/students/${studentId}`).set("Authorization", `Bearer ${issued.accessToken}`).expect(204);
    await request(server).get(`/students/${studentId}`).set("Authorization", `Bearer ${issued.accessToken}`).expect(404);
  });

  it("student Excel dry-run geçerli satırları yazmadan raporlar", async () => {
    const issued = await login("admin-a@example.test");
    const fileBase64 = await createStudentWorkbookBase64([["Ece", "Import"]]);

    const response = await request(server)
      .post("/students/imports/dry-run")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ fileBase64 })
      .expect(201);

    expect(response.body).toMatchObject({
      dryRun: true,
      totalRows: 1,
      validRows: [{ row: 2, firstName: "Ece", lastName: "Import" }],
      errors: [],
      quota: { limit: 2, current: 1, incoming: 1, wouldExceed: false },
      wouldImport: true,
    });

    const students = await request(server).get("/students").set("Authorization", `Bearer ${issued.accessToken}`).expect(200);
    expect(students.body).toEqual([
      {
        id: "student-a",
        tenantId: "tenant-a",
        firstName: "Ada",
        lastName: "A",
        classId: "class-a",
        responsibleTeacherId: "teacher-a",
        status: "ACTIVE",
        userId: "student-tenant-a",
      },
    ]);
  });

  it("student Excel dry-run hatalı satır için satır-bazlı hata döner", async () => {
    const issued = await login("admin-a@example.test");
    const fileBase64 = await createStudentWorkbookBase64([["Eksik", ""]]);

    const response = await request(server)
      .post("/students/imports/dry-run")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ fileBase64 })
      .expect(201);

    expect(response.body).toMatchObject({
      dryRun: true,
      totalRows: 1,
      validRows: [],
      errors: [{ row: 2, field: "lastName", code: "REQUIRED" }],
      wouldImport: false,
    });
  });

  it("student Excel dry-run kota aşımını kayıt yazmadan raporlar", async () => {
    const issued = await login("admin-a@example.test");
    const fileBase64 = await createStudentWorkbookBase64([
      ["Ece", "Import"],
      ["Deniz", "Import"],
    ]);

    const response = await request(server)
      .post("/students/imports/dry-run")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ fileBase64 })
      .expect(201);

    expect(response.body).toMatchObject({
      dryRun: true,
      totalRows: 2,
      validRows: [],
      errors: [{ row: 0, field: "quota", code: "STUDENT_QUOTA_EXCEEDED" }],
      quota: { limit: 2, current: 1, incoming: 2, wouldExceed: true },
      wouldImport: false,
    });

    const students = await request(server).get("/students").set("Authorization", `Bearer ${issued.accessToken}`).expect(200);
    expect(students.body).toEqual([
      {
        id: "student-a",
        tenantId: "tenant-a",
        firstName: "Ada",
        lastName: "A",
        classId: "class-a",
        responsibleTeacherId: "teacher-a",
        status: "ACTIVE",
        userId: "student-tenant-a",
      },
    ]);
  });

  it("student Excel export tenant öğrencilerini xlsx olarak döner", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .get("/students/export")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      fileName: "students.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      rowCount: 1,
    });

    await expect(readStudentWorkbookRows(response.body.fileBase64 as string)).resolves.toEqual([["Ada", "A"]]);
  });

  it("student Excel import hata veya kota aşımında rollback davranışı gösterir", async () => {
    const issued = await login("admin-a@example.test");

    await request(server)
      .post("/students/imports")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ fileBase64: await createStudentWorkbookBase64([["Eksik", ""]]) })
      .expect(400);

    let students = await request(server).get("/students").set("Authorization", `Bearer ${issued.accessToken}`).expect(200);
    expect(students.body).toEqual([
      {
        id: "student-a",
        tenantId: "tenant-a",
        firstName: "Ada",
        lastName: "A",
        classId: "class-a",
        responsibleTeacherId: "teacher-a",
        status: "ACTIVE",
        userId: "student-tenant-a",
      },
    ]);

    await request(server)
      .post("/students/imports")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ fileBase64: await createStudentWorkbookBase64([["Ece", "Import"], ["Eksik", ""]]) })
      .expect(400);

    students = await request(server).get("/students").set("Authorization", `Bearer ${issued.accessToken}`).expect(200);
    expect(students.body).toEqual([
      {
        id: "student-a",
        tenantId: "tenant-a",
        firstName: "Ada",
        lastName: "A",
        classId: "class-a",
        responsibleTeacherId: "teacher-a",
        status: "ACTIVE",
        userId: "student-tenant-a",
      },
    ]);

    const imported = await request(server)
      .post("/students/imports")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ fileBase64: await createStudentWorkbookBase64([["Ece", "Import"]]) })
      .expect(201);

    expect(imported.body).toMatchObject({
      importedRows: 1,
      students: [{ tenantId: "tenant-a", firstName: "Ece", lastName: "Import" }],
    });

    await request(server)
      .post("/students/imports")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ fileBase64: await createStudentWorkbookBase64([["Fazla", "Import"]]) })
      .expect(409);

    students = await request(server).get("/students").set("Authorization", `Bearer ${issued.accessToken}`).expect(200);
    expect(students.body).toHaveLength(2);
    expect(students.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ firstName: "Ada", lastName: "A" }),
        expect.objectContaining({ firstName: "Ece", lastName: "Import" }),
      ]),
    );
  });

  it("student create kotası tenant için 409 hard-block uygular", async () => {
    const issued = await login("admin-b@example.test");

    await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ firstName: "Yeni", lastName: "Ogrenci" })
      .expect(201);

    await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ firstName: "Fazla", lastName: "Ogrenci" })
      .expect(409);
  });

  it("tenant A, tenant B tenantId ile create veya update yapamaz", async () => {
    const issued = await login("admin-a@example.test");

    await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ tenantId: "tenant-b", firstName: "Kotu", lastName: "Deneme" })
      .expect(403);

    await request(server)
      .patch("/students/student-a/tenant")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ tenantId: "tenant-b" })
      .expect(403);
  });

  it("yetkisiz request student endpointine erişemez", async () => {
    await request(server).get("/students").expect(401);
  });

  it("tekrarlı hatalı login denemelerini kilitler", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server)
        .post("/auth/login")
        .send({ email: "admin-b@example.test", password: "yanlis" })
        .expect(401);
    }

    await request(server)
      .post("/auth/login")
      .send({ email: "admin-b@example.test", password: "password" })
      .expect(429);
  });
});

function getRefreshCookie(header: string | string[] | undefined): string {
  return getCookie(header, "refreshToken");
}

function getCookie(header: string | string[] | undefined, name: string): string {
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = cookies.find((candidate) => candidate.startsWith(`${name}=`));
  expect(cookie).toBeDefined();
  return cookie ?? "";
}

function readCookieValue(cookie: string, name: string): string {
  const value = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  expect(value).toBeDefined();
  return decodeURIComponent(value?.slice(name.length + 1) ?? "");
}

async function createStudentWorkbookBase64(rows: Array<[string, string]>): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Students");
  worksheet.addRow(["firstName", "lastName"]);
  for (const row of rows) {
    worksheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}

async function readStudentWorkbookRows(fileBase64: string): Promise<Array<[string, string]>> {
  const workbook = new ExcelJS.Workbook();
  const bytes = Buffer.from(fileBase64, "base64");
  const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await workbook.xlsx.load(file as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
  const worksheet = workbook.worksheets[0];
  expect(worksheet).toBeDefined();

  const rows: Array<[string, string]> = [];
  worksheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    rows.push([String(row.getCell(1).value ?? ""), String(row.getCell(2).value ?? "")]);
  });
  return rows;
}
