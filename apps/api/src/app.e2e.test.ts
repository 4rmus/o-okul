import "reflect-metadata";
import { readFile } from "node:fs/promises";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import ExcelJS from "exceljs";
import request from "supertest";
import { testLoginBody } from "./test-auth.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "./app.module.js";

describe("API auth + tenant isolation", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  const originalStudentQuota = process.env.STUDENT_QUOTA;

  beforeAll(async () => {
    process.env.STUDENT_QUOTA = "2";
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app.close();
    if (originalStudentQuota === undefined) {
      delete process.env.STUDENT_QUOTA;
    } else {
      process.env.STUDENT_QUOTA = originalStudentQuota;
    }
  });

  async function login(email: string) {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    const refreshCookie = getRefreshCookie(response.headers["set-cookie"]);
    const csrfCookie = getCookie(response.headers["set-cookie"], "csrfToken");

    expect(refreshCookie).toContain("HttpOnly");
    expectPublicSession(response.body.session);

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
    expectPublicSession(rotated.body.session);

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

  it("refresh ve logout refresh token'ı sadece HttpOnly cookie'den okur", async () => {
    const issued = await login("admin-a@example.test");

    await request(server)
      .post("/auth/refresh")
      .set("Cookie", [issued.refreshCookie, issued.csrfCookie])
      .set("X-CSRF-Token", issued.csrfToken)
      .send({ refreshToken: "body-token" })
      .expect(422);
    await request(server)
      .post("/auth/logout")
      .set("Cookie", [issued.refreshCookie, issued.csrfCookie])
      .set("X-CSRF-Token", issued.csrfToken)
      .send({ refreshToken: "body-token" })
      .expect(422);
    await request(server)
      .post("/auth/refresh")
      .set("Cookie", [issued.refreshCookie, issued.csrfCookie])
      .set("X-CSRF-Token", issued.csrfToken)
      .expect(200);
  });

  it("şifre reset isteği token sızdırmadan nötr yanıt döner", async () => {
    await login("system@example.test");
    const resetRequest = await request(server)
      .post("/auth/password-reset/request")
      .send({ email: "system@example.test" })
      .expect(200);

    expect(resetRequest.body).toEqual({ status: "ACCEPTED" });
    expect(JSON.stringify(resetRequest.body)).not.toContain("resetToken");
    expect(JSON.stringify(resetRequest.body)).not.toContain("expiresAt");
    await request(server).post("/auth/password-reset/request").send({ email: "missing@example.test" }).expect(200).expect({
      status: "ACCEPTED",
    });
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
        studentNo: "100",
        firstName: "Ada",
        lastName: "A",
        classId: "class-a",
        responsibleTeacherId: "teacher-a",
        status: "ACTIVE",
      },
    ]);
    expectStudentCoreResponseIsPublic(response.body);
  });

  it("öğrenci liste query validasyon hatalarını 422 alan listesiyle döner", async () => {
    const issued = await login("admin-a@example.test");

    await request(server)
      .get("/students")
      .query({ status: "UNKNOWN" })
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(422)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          error: {
            code: "VALIDATION_FAILED",
            message: "Sorgu parametreleri geçersiz.",
            details: {
              fields: expect.arrayContaining([
                expect.objectContaining({ path: "status" }),
              ]),
            },
          },
        });
      });

    await request(server)
      .get("/students")
      .query({ guardianLinked: "maybe" })
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(422)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          error: {
            code: "VALIDATION_FAILED",
            message: "Sorgu parametreleri geçersiz.",
            details: {
              fields: expect.arrayContaining([
                expect.objectContaining({ path: "guardianLinked" }),
              ]),
            },
          },
        });
      });

    await request(server)
      .get("/students")
      .query({ guardianLinked: "" })
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: "student-a" })]);
      });
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
        });
        expect(body).not.toHaveProperty("userId");
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
            studentNo: "100",
            firstName: "Ada",
            lastName: "A",
            classId: "class-a",
            responsibleTeacherId: "teacher-a",
            status: "ACTIVE",
          },
        ]);
        expect(JSON.stringify(body)).not.toContain("student-tenant-a");
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
        });
        expect(body).not.toHaveProperty("userId");
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
    await request(server)
      .get("/me/teacher/students")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.map((student: { id: string }) => student.id)).toEqual(["student-a"]);
      });
    await request(server)
      .get("/me/teacher/attendance")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.map((record: { id: string; studentId: string }) => `${record.id}:${record.studentId}`)).toEqual(["attendance-a:student-a"]);
      });
    await request(server)
      .get("/me/teacher/homework")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.map((record: { id: string }) => record.id)).toEqual(["homework-a"]);
      });
    await request(server)
      .get("/me/teacher/homework/materials")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.map((record: { id: string }) => record.id)).toEqual(["material-a"]);
      });
    await request(server)
      .get("/me/teacher/homework/materials/material-a/assignments")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.map((assignment: { id: string; studentId: string }) => `${assignment.id}:${assignment.studentId}`)).toEqual(["material-assignment-a:student-a"]);
      });
    await request(server)
      .get("/me/teacher/teacher-notes")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.map((note: { id: string; studentId: string }) => `${note.id}:${note.studentId}`)).toEqual([
          "teacher-note-internal-a:student-a",
          "teacher-note-visible-a:student-a",
        ]);
      });

    const admin = await login("admin-a@example.test");
    await request(server).get("/me/teacher").set("Authorization", `Bearer ${admin.accessToken}`).expect(403);
    await request(server).get("/me/teacher/schedule").set("Authorization", `Bearer ${admin.accessToken}`).expect(403);
    await request(server).get("/me/teacher/students").set("Authorization", `Bearer ${admin.accessToken}`).expect(403);

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
    await request(server)
      .get("/me/guardian/students/student-a/homework/material-assignments")
      .set("Authorization", `Bearer ${guardian.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.map((assignment: { studentId: string }) => assignment.studentId)).toEqual(["student-a"]);
      });
    await request(server)
      .get("/me/guardian/students/student-b/homework/material-assignments")
      .set("Authorization", `Bearer ${guardian.accessToken}`)
      .expect(403);

    const teacher = await login("teacher-a@example.test");
    await request(server)
      .get("/me/student/homework/material-assignments")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(403);
    await request(server)
      .get("/me/guardian/homework/material-assignments")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(403);
    await request(server)
      .get("/me/guardian/students/student-a/homework/material-assignments")
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

  it("student create işlemini Idempotency-Key ile tekilleştirir", async () => {
    const issued = await login("admin-a@example.test");
    const body = { firstName: "Idempotent", lastName: "Ogrenci", classId: "class-a", status: "ACTIVE" };
    const key = "student-create-idempotency-a";

    const first = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const studentId = (first.body as { id: string }).id;

    const second = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);

    await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send({ ...body, lastName: "Farkli" })
      .expect(409)
      .expect(({ body: errorBody }) => {
        expect(JSON.stringify(errorBody)).toContain("IDEMPOTENCY_KEY_BODY_MISMATCH");
      });

    await request(server)
      .get("/students")
      .query({ q: "Idempotent" })
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200)
      .expect(({ body: students }) => {
        expect(students).toEqual([expect.objectContaining({ id: studentId, firstName: "Idempotent" })]);
      });

    await request(server).delete(`/students/${studentId}`).set("Authorization", `Bearer ${issued.accessToken}`).expect(204);
  });

  it("student create guardian hatasında yan etki oluşturmaz", async () => {
    const issued = await login("admin-a@example.test");

    await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", "student-create-invalid-guardian-a")
      .send({ firstName: "YanEtki", lastName: "Ogrenci", guardian: {} })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain("GUARDIAN_CONTACT_REQUIRED");
      });

    await request(server)
      .get("/students")
      .query({ q: "YanEtki" })
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([]);
      });
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
        studentNo: "100",
        firstName: "Ada",
        lastName: "A",
        classId: "class-a",
        responsibleTeacherId: "teacher-a",
        status: "ACTIVE",
      },
    ]);
  });

  it("student CSV dry-run sihirbaz şablonundaki sınıf adını çözer", async () => {
    const issued = await login("admin-a@example.test");
    const fileBase64 = Buffer.from("\uFEFFokul_no;ad;soyad;sinif\n320;Ece;Csv;8-A\n", "utf8").toString("base64");

    const response = await request(server)
      .post("/students/imports/dry-run")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ fileBase64 })
      .expect(201);

    expect(response.body).toMatchObject({
      dryRun: true,
      totalRows: 1,
      validRows: [{ row: 2, studentNo: "320", firstName: "Ece", lastName: "Csv", classId: "class-a" }],
      errors: [],
      wouldImport: true,
    });
  });

  it("student CSV dry-run TC hatasında ham kimlik numarası döndürmez", async () => {
    const issued = await login("admin-a@example.test");
    const fileBase64 = Buffer.from("\uFEFFad;soyad;tc_kimlik_no;telefon\nEce;Kimlik;11111111111;5550000014\n", "utf8").toString("base64");

    const response = await request(server)
      .post("/students/imports/dry-run")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ fileBase64 })
      .expect(201);

    expect(response.body).toMatchObject({
      dryRun: true,
      totalRows: 1,
      validRows: [],
      errors: [{ row: 2, field: "nationalId", code: "INVALID_NATIONAL_ID", value: "*******1111" }],
      wouldImport: false,
    });
    expect(JSON.stringify(response.body)).not.toContain("11111111111");
  });

  it("student CSV dry-run hesap önizlemesini maskeli döner", async () => {
    const issued = await login("admin-a@example.test");
    const fileBase64 = Buffer.from("\uFEFFad;soyad;tc_kimlik_no;telefon\nEce;Hesap;10000001204;0555 000 0014\n", "utf8").toString("base64");

    const response = await request(server)
      .post("/students/imports/dry-run")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ fileBase64 })
      .expect(201);

    expect(response.body).toMatchObject({
      dryRun: true,
      totalRows: 1,
      validRows: [
        {
          row: 2,
          firstName: "Ece",
          lastName: "Hesap",
          accountPreview: {
            usernameMasked: "*******1204",
            willCreate: true,
          },
        },
      ],
      errors: [],
      wouldImport: true,
    });
    expect(response.body.validRows[0]).not.toHaveProperty("nationalId");
    expect(response.body.validRows[0]).not.toHaveProperty("phone");
    expect(JSON.stringify(response.body)).not.toContain("10000001204");
    expect(JSON.stringify(response.body)).not.toContain("5550000014");
  });

  it("student CSV dry-run TC tek başına gelirse hesap oluşturmayı sessiz geçmez", async () => {
    const issued = await login("admin-a@example.test");
    const fileBase64 = Buffer.from("\uFEFFad;soyad;tc_kimlik_no\nEce;EksikTelefon;10000001372\n", "utf8").toString("base64");

    const response = await request(server)
      .post("/students/imports/dry-run")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ fileBase64 })
      .expect(201);

    expect(response.body).toMatchObject({
      dryRun: true,
      totalRows: 1,
      validRows: [],
      errors: [{ row: 2, field: "phone", code: "REQUIRED" }],
      wouldImport: false,
    });
    expect(JSON.stringify(response.body)).not.toContain("10000001372");
  });

  it("student Excel dry-run üst açıklama satırını atlayıp başlıkları doğru çözer", async () => {
    const issued = await login("admin-a@example.test");
    const fileBase64 = await createStudentWorkbookBase64(
      [["320", "Ece", "Baslikli", "8-A"]],
      ["okul_no", "ad", "soyad", "sinif"],
      [["ogrenci-aktarim-sablonu (3)"]],
    );

    const response = await request(server)
      .post("/students/imports/dry-run")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ fileBase64 })
      .expect(201);

    expect(response.body).toMatchObject({
      dryRun: true,
      totalRows: 1,
      validRows: [{ row: 3, studentNo: "320", firstName: "Ece", lastName: "Baslikli", classId: "class-a" }],
      errors: [],
      wouldImport: true,
    });
  });

  it("student import XLSX şablonunda TC hatası üretmez", async () => {
    const issued = await login("admin-a@example.test");
    const template = await readFile("../web/public/templates/ogrenci-aktarim-sablonu.xlsx");

    const response = await request(server)
      .post("/students/imports/dry-run")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ fileBase64: template.toString("base64") })
      .expect(201);

    expect(response.body.totalRows).toBe(0);
    expect(response.body.validRows).toEqual([]);
    expect(response.body.errors).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "nationalId", code: "INVALID_NATIONAL_ID" })]),
    );
  });

  it("student Excel import veli bilgilerini oluşturup öğrenciye bağlar", async () => {
    const issued = await login("admin-a@example.test");
    let studentId = "";

    try {
      const imported = await request(server)
        .post("/students/imports")
        .set("Authorization", `Bearer ${issued.accessToken}`)
        .send({
          fileBase64: await createStudentWorkbookBase64(
            [[
              "321",
              "Ece",
              "Velili",
              "8-A",
              "ece.velili@example.test",
              "10000001440",
              "5553219999",
              "Fatma",
              "Velili",
              "5553210000",
              "10000001990",
            ]],
            [
              "okul_no",
              "ad",
              "soyad",
              "sinif",
              "email",
              "tc_kimlik_no",
              "telefon",
              "veli_ad",
              "veli_soyad",
              "veli_telefon",
              "veli_tc_kimlik_no",
            ],
          ),
        })
        .expect(201);

      studentId = imported.body.students[0].id;
      expect(imported.body).toMatchObject({
        importedRows: 1,
        students: [{ tenantId: "tenant-a", studentNo: "321", firstName: "Ece", lastName: "Velili", classId: "class-a" }],
      });

      await request(server)
        .get(`/students/${encodeURIComponent(studentId)}/guardians`)
        .set("Authorization", `Bearer ${issued.accessToken}`)
        .expect(200)
        .expect(({ body }) => {
          expect(body).toEqual([expect.objectContaining({ firstName: "Fatma", lastName: "Velili", phone: "5553210000" })]);
        });

      await request(server)
        .get(`/students/${encodeURIComponent(studentId)}/guardian-links`)
        .set("Authorization", `Bearer ${issued.accessToken}`)
        .expect(200)
        .expect(({ body }) => {
          expect(body).toEqual([
            expect.objectContaining({
              canViewFinance: true,
              canReceiveSms: true,
              canReceiveAnnouncements: true,
              canOpenSupportTickets: true,
            }),
          ]);
        });

      await request(server)
        .get(`/students/${encodeURIComponent(studentId)}/profile`)
        .set("Authorization", `Bearer ${issued.accessToken}`)
        .expect(200)
        .expect(({ body }) => {
          expect(body).toMatchObject({
            email: "ece.velili@example.test",
            nationalIdMasked: "*******1440",
            phone: "5553219999",
          });
          expect(JSON.stringify(body)).not.toContain("10000001440");
        });
    } finally {
      if (studentId) {
        await request(server).delete(`/students/${encodeURIComponent(studentId)}`).set("Authorization", `Bearer ${issued.accessToken}`);
      }
    }
  });

  it("student Excel import commit işlemini Idempotency-Key ile tekilleştirir", async () => {
    const issued = await login("admin-a@example.test");
    const key = "student-import-idempotency-a";
    const fileBase64 = await createStudentWorkbookBase64(
      [["322", "Ece", "Idempotent", "8-A"]],
      ["okul_no", "ad", "soyad", "sinif"],
    );
    let studentId = "";

    try {
      const first = await request(server)
        .post("/students/imports")
        .set("Authorization", `Bearer ${issued.accessToken}`)
        .set("Idempotency-Key", key)
        .send({ fileBase64 })
        .expect(201);
      studentId = first.body.students[0].id;

      const second = await request(server)
        .post("/students/imports")
        .set("Authorization", `Bearer ${issued.accessToken}`)
        .set("Idempotency-Key", key)
        .send({ fileBase64 })
        .expect(201);

      expect(second.body).toEqual(first.body);

      await request(server)
        .post("/students/imports")
        .set("Authorization", `Bearer ${issued.accessToken}`)
        .set("Idempotency-Key", key)
        .send({
          fileBase64: await createStudentWorkbookBase64(
            [["323", "Ece", "Farkli", "8-A"]],
            ["okul_no", "ad", "soyad", "sinif"],
          ),
        })
        .expect(409);

      await request(server)
        .get("/students")
        .set("Authorization", `Bearer ${issued.accessToken}`)
        .expect(200)
        .expect(({ body }) => {
          expect((body as Array<{ studentNo?: string }>).filter((student) => student.studentNo === "322")).toHaveLength(1);
        });
    } finally {
      if (studentId) {
        await request(server).delete(`/students/${encodeURIComponent(studentId)}`).set("Authorization", `Bearer ${issued.accessToken}`);
      }
    }
  });

  it("student CSV dry-run okul no çakışmasını satır bazında raporlar", async () => {
    const issued = await login("admin-a@example.test");
    const fileBase64 = Buffer.from("\uFEFFokul_no;ad;soyad;sinif\n100;Ece;Csv;8-A\n", "utf8").toString("base64");

    const response = await request(server)
      .post("/students/imports/dry-run")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ fileBase64 })
      .expect(201);

    expect(response.body).toMatchObject({
      dryRun: true,
      totalRows: 1,
      validRows: [],
      errors: [{ row: 2, field: "studentNo", code: "STUDENT_NO_DUPLICATE", value: "100" }],
      wouldImport: false,
    });
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
      validRows: [
        { row: 2, firstName: "Ece", lastName: "Import" },
        { row: 3, firstName: "Deniz", lastName: "Import" },
      ],
      errors: [{ row: 0, field: "quota", code: "STUDENT_QUOTA_EXCEEDED" }],
      quota: { limit: 2, current: 1, incoming: 2, wouldExceed: true },
      wouldImport: false,
    });

    const students = await request(server).get("/students").set("Authorization", `Bearer ${issued.accessToken}`).expect(200);
    expect(students.body).toEqual([
      {
        id: "student-a",
        tenantId: "tenant-a",
        studentNo: "100",
        firstName: "Ada",
        lastName: "A",
        classId: "class-a",
        responsibleTeacherId: "teacher-a",
        status: "ACTIVE",
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

    await expect(readStudentWorkbookRows(response.body.fileBase64 as string)).resolves.toEqual([["100", "Ada", "A", "8-A"]]);
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
        studentNo: "100",
        firstName: "Ada",
        lastName: "A",
        classId: "class-a",
        responsibleTeacherId: "teacher-a",
        status: "ACTIVE",
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
        studentNo: "100",
        firstName: "Ada",
        lastName: "A",
        classId: "class-a",
        responsibleTeacherId: "teacher-a",
        status: "ACTIVE",
      },
    ]);

    const imported = await request(server)
      .post("/students/imports")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ fileBase64: await createStudentWorkbookBase64([["320", "Ece", "Import", "8-A"]], ["okul_no", "ad", "soyad", "sinif"]) })
      .expect(201);

    expect(imported.body).toMatchObject({
      importedRows: 1,
      students: [{ tenantId: "tenant-a", studentNo: "320", firstName: "Ece", lastName: "Import", classId: "class-a" }],
    });
    expectStudentCoreResponseIsPublic(imported.body.students);

    await request(server)
      .get(`/students/${encodeURIComponent(imported.body.students[0].id)}/enrollments`)
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ classId: "class-a", status: "ACTIVE", reason: "CREATED" })]);
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
        .send(testLoginBody("admin-b@example.test", "yanlis"))
        .expect(401);
    }

    await request(server)
      .post("/auth/login")
      .send(testLoginBody("admin-b@example.test"))
      .expect(429);
  });
});

function getRefreshCookie(header: string | string[] | undefined): string {
  return getCookie(header, "refreshToken");
}

function expectPublicSession(session: unknown): void {
  expect(session).toEqual(expect.objectContaining({
    id: expect.any(String),
    userId: expect.any(String),
    tenantId: expect.any(String),
    roles: expect.any(Array),
    membershipVersion: expect.any(Number),
    status: expect.any(String),
  }));
  expect(session).not.toHaveProperty("refreshTokenHash");
  expect(session).not.toHaveProperty("tokenFamilyId");
  expect(session).not.toHaveProperty("createdAt");
  expect(session).not.toHaveProperty("updatedAt");
}

function expectStudentCoreResponseIsPublic(body: unknown): void {
  const serialized = JSON.stringify(body);
  for (const forbidden of [
    "student-tenant-a",
    "userId",
    "birthDate",
    "nationalId",
    "nationalIdEncrypted",
    "nationalIdHash",
    "phone",
    "photoKey",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
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

async function createStudentWorkbookBase64(rows: string[][], headers = ["firstName", "lastName"], leadingRows: string[][] = []): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Students");
  for (const row of leadingRows) {
    worksheet.addRow(row);
  }
  worksheet.addRow(headers);
  for (const row of rows) {
    worksheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}

async function readStudentWorkbookRows(fileBase64: string): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  const bytes = Buffer.from(fileBase64, "base64");
  const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await workbook.xlsx.load(file as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
  const worksheet = workbook.worksheets[0];
  expect(worksheet).toBeDefined();

  const rows: string[][] = [];
  worksheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    rows.push([
      String(row.getCell(1).value ?? ""),
      String(row.getCell(2).value ?? ""),
      String(row.getCell(3).value ?? ""),
      String(row.getCell(4).value ?? ""),
    ]);
  });
  return rows;
}
