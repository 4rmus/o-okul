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
      "/me/student/homework/material-assignments",
      "/me/student/attendance",
      "/me/student/attendance/summary",
      "/me/student/teacher-notes",
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
      "/me/guardian/students/student-a/attendance",
      "/me/guardian/students/student-a/attendance/summary",
      "/me/guardian/students/student-a/teacher-notes",
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
      "/me/guardian/students/student-b/attendance",
      "/me/guardian/students/student-b/attendance/summary",
      "/me/guardian/students/student-b/teacher-notes",
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
    const teacherEndpoints = ["/me/teacher", "/me/teacher/schedule"];

    for (const endpoint of teacherEndpoints) {
      await request(server).get(endpoint).set("Authorization", `Bearer ${teacherToken}`).expect(200);
      await request(server).get(endpoint).set("Authorization", `Bearer ${studentToken}`).expect(403);
      await request(server).get(endpoint).set("Authorization", `Bearer ${guardianToken}`).expect(403);
      await request(server).get(endpoint).set("Authorization", `Bearer ${adminToken}`).expect(403);
    }
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
});
