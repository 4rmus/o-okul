import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("Me access matrix", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let adminToken: string;
  let teacherToken: string;
  let studentToken: string;
  let guardianToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    adminToken = await login("admin-a@example.test");
    teacherToken = await login("teacher-a@example.test");
    studentToken = await login("student-a@example.test");
    guardianToken = await login("guardian-a@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("öğrenci /me yüzeylerini yalnız öğrenci subject'i açar", async () => {
    const studentEndpoints = [
      "/me/student",
      "/me/student/profile",
      "/me/student/guardians",
      "/me/student/guardian-links",
      "/me/student/class-history",
      "/me/student/enrollments",
      "/me/student/homework/material-assignments",
      "/me/student/attendance",
      "/me/student/attendance/summary",
      "/me/student/teacher-notes",
      "/me/student/announcements",
      "/me/student/support-tickets",
      "/me/student/reports/exam-demo/latest",
      "/me/student/reports/exam-demo/latest/error-booklet",
      "/me/student/reports/exam-demo/snapshots/snapshot-demo",
      "/me/student/reports/exam-demo/snapshots/snapshot-demo/error-booklet",
      "/me/student/reports/exam-demo/progress",
    ];

    for (const endpoint of studentEndpoints) {
      await request(server).get(endpoint).set("Authorization", `Bearer ${studentToken}`).expect(200);
      await request(server).get(endpoint).set("Authorization", `Bearer ${guardianToken}`).expect(403);
      await request(server).get(endpoint).set("Authorization", `Bearer ${teacherToken}`).expect(403);
      await request(server).get(endpoint).set("Authorization", `Bearer ${adminToken}`).expect(403);
    }
  });

  it("veli /me yüzeylerini yalnız bağlı veli subject'i açar", async () => {
    const guardianEndpoints = [
      "/me/guardian/students",
      "/me/guardian/homework/material-assignments",
      "/me/guardian/students/student-a/profile",
      "/me/guardian/students/student-a/class-history",
      "/me/guardian/students/student-a/enrollments",
      "/me/guardian/students/student-a/attendance",
      "/me/guardian/students/student-a/attendance/summary",
      "/me/guardian/students/student-a/teacher-notes",
      "/me/guardian/students/student-a/announcements",
      "/me/guardian/students/student-a/notification-preferences",
      "/me/guardian/students/student-a/support-tickets",
      "/me/guardian/students/student-a/payment-plans",
      "/me/guardian/students/student-a/reports/exam-demo/latest",
      "/me/guardian/students/student-a/reports/exam-demo/latest/error-booklet",
      "/me/guardian/students/student-a/reports/exam-demo/snapshots/snapshot-demo",
      "/me/guardian/students/student-a/reports/exam-demo/snapshots/snapshot-demo/error-booklet",
      "/me/guardian/students/student-a/reports/exam-demo/progress",
    ];

    for (const endpoint of guardianEndpoints) {
      await request(server).get(endpoint).set("Authorization", `Bearer ${guardianToken}`).expect(200);
      await request(server).get(endpoint).set("Authorization", `Bearer ${studentToken}`).expect(403);
      await request(server).get(endpoint).set("Authorization", `Bearer ${teacherToken}`).expect(403);
      await request(server).get(endpoint).set("Authorization", `Bearer ${adminToken}`).expect(403);
    }
  });

  it("veli başka tenant veya bağlı olmayan öğrenci IDOR denemesinde kayıt alamaz", async () => {
    const idorEndpoints = [
      "/me/guardian/students/student-b/profile",
      "/me/guardian/students/student-b/class-history",
      "/me/guardian/students/student-b/enrollments",
      "/me/guardian/students/student-b/attendance",
      "/me/guardian/students/student-b/attendance/summary",
      "/me/guardian/students/student-b/teacher-notes",
      "/me/guardian/students/student-b/announcements",
      "/me/guardian/students/student-b/notification-preferences",
      "/me/guardian/students/student-b/support-tickets",
      "/me/guardian/students/student-b/payment-plans",
      "/me/guardian/students/student-b/reports/exam-demo/latest",
      "/me/guardian/students/student-b/reports/exam-demo/latest/error-booklet",
      "/me/guardian/students/student-b/reports/exam-demo/snapshots/snapshot-demo",
      "/me/guardian/students/student-b/reports/exam-demo/snapshots/snapshot-demo/error-booklet",
      "/me/guardian/students/student-b/reports/exam-demo/progress",
    ];

    for (const endpoint of idorEndpoints) {
      const response = await request(server).get(endpoint).set("Authorization", `Bearer ${guardianToken}`).expect(403);
      expect(JSON.stringify(response.body)).not.toContain("student-b");
      expect(JSON.stringify(response.body)).not.toContain("payment-plan-b");
      expect(JSON.stringify(response.body)).not.toContain("teacher-note-b");
    }
  });

  it("öğretmen /me yüzeylerini yalnız öğretmen subject'i açar", async () => {
    const teacherEndpoints = ["/me/teacher", "/me/teacher/schedule", "/me/teacher/announcements"];

    for (const endpoint of teacherEndpoints) {
      await request(server).get(endpoint).set("Authorization", `Bearer ${teacherToken}`).expect(200);
      await request(server).get(endpoint).set("Authorization", `Bearer ${studentToken}`).expect(403);
      await request(server).get(endpoint).set("Authorization", `Bearer ${guardianToken}`).expect(403);
      await request(server).get(endpoint).set("Authorization", `Bearer ${adminToken}`).expect(403);
    }
  });

  it("tenant admin role preview tokenı ile portal sorgularını salt-okuma açar", async () => {
    const created = await request(server)
      .post("/role-previews")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ targetRole: "TEACHER", targetSubjectId: "teacher-a" })
      .expect(201);
    const previewToken = (created.body as { previewToken: string }).previewToken;

    await request(server).get("/me/teacher").set("Authorization", `Bearer ${adminToken}`).expect(403);
    await request(server)
      .get("/me/teacher")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-role-preview-token", previewToken)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: "teacher-a" });
      });
    await request(server)
      .get("/me/profile")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-role-preview-token", previewToken)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          userId: "user-tenant-a",
          roles: ["TEACHER"],
          subjectType: "TEACHER",
          subjectId: "teacher-a",
        });
      });
    await request(server)
      .post("/me/teacher/support-tickets")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-role-preview-token", previewToken)
      .send({ subject: "Preview write should fail" })
      .expect(403);
  });

  it("öğretmen rapor yüzeyleri yanlış rol ve başka tenant öğrenci denemesinde veri sızdırmaz", async () => {
    const teacherReportEndpoints = [
      "/exams/exam-demo/reports/snapshots",
      "/exams/exam-demo/reports/snapshots/snapshot-demo/students/student-a",
      "/exams/exam-demo/reports/snapshots/snapshot-demo/students/student-a/error-booklet",
      "/exams/exam-demo/reports/students/student-a/progress",
    ];

    for (const endpoint of teacherReportEndpoints) {
      await request(server).get(endpoint).set("Authorization", `Bearer ${teacherToken}`).expect(200);
      await request(server).get(endpoint).set("Authorization", `Bearer ${adminToken}`).expect(200);
      await request(server).get(endpoint).set("Authorization", `Bearer ${studentToken}`).expect(403);
      await request(server).get(endpoint).set("Authorization", `Bearer ${guardianToken}`).expect(403);
    }

    const response = await request(server)
      .get("/exams/exam-demo/reports/snapshots/snapshot-demo/students/student-b")
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(403);
    expect(JSON.stringify(response.body)).not.toContain("student-b");
  });

  it("parametresiz /me/profile sadece oturum context'i döner, kaynak kaydı döndürmez", async () => {
    await request(server)
      .get("/me/profile")
      .set("Authorization", `Bearer ${studentToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ userId: "student-tenant-a", subjectType: "STUDENT", subjectId: "student-a" });
        expect(body.firstName).toBeUndefined();
        expect(body.nationalIdMasked).toBeUndefined();
      });

    await request(server).get("/me/profile").expect(401);
  });

  it("kullanıcı kendi push cihaz tokenını kaydeder, listeler ve kapatır", async () => {
    const create = await request(server)
      .post("/me/notification-devices")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ provider: "fcm", token: "student-access-matrix-device", platform: "web" })
      .expect(201);

    expect(create.body).toMatchObject({
      tenantId: "tenant-a",
      userId: "student-tenant-a",
      subjectType: "STUDENT",
      subjectId: "student-a",
      provider: "fcm",
      token: "student-access-matrix-device",
      platform: "web",
    });

    await request(server)
      .get("/me/notification-devices")
      .set("Authorization", `Bearer ${studentToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            id: create.body.id,
            token: "student-access-matrix-device",
          }),
        ]);
      });

    await request(server)
      .delete(`/me/notification-devices/${create.body.id}`)
      .set("Authorization", `Bearer ${studentToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: create.body.id,
          disabledAt: expect.any(String),
        });
      });

    await request(server)
      .post("/me/notification-devices")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ platform: 123, provider: "", token: "" })
      .expect(422)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({
          code: "VALIDATION_FAILED",
          details: {
            fields: expect.arrayContaining([
              expect.objectContaining({ path: "platform" }),
              expect.objectContaining({ path: "provider" }),
              expect.objectContaining({ path: "token" }),
            ]),
          },
        });
      });

    await request(server)
      .get("/me/notification-devices")
      .expect(401);
  });
});
