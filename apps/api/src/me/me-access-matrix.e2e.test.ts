import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { testLoginBody } from "../test-auth.js";
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
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
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
      "/me/student/development-assessments",
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
      "/me/guardian/students/student-a/homework/material-assignments",
      "/me/guardian/students/student-a/attendance",
      "/me/guardian/students/student-a/attendance/summary",
      "/me/guardian/students/student-a/teacher-notes",
      "/me/guardian/students/student-a/development-assessments",
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
      "/me/guardian/students/student-b/homework/material-assignments",
      "/me/guardian/students/student-b/attendance",
      "/me/guardian/students/student-b/attendance/summary",
      "/me/guardian/students/student-b/teacher-notes",
      "/me/guardian/students/student-b/development-assessments",
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

  it("öğrenci ve veli public öğrenci kayıtlarında subject userId dönmez", async () => {
    const responses = [
      await request(server).get("/me/student").set("Authorization", `Bearer ${studentToken}`).expect(200),
      await request(server).get("/me/student/profile").set("Authorization", `Bearer ${studentToken}`).expect(200),
      await request(server).get("/me/guardian/students").set("Authorization", `Bearer ${guardianToken}`).expect(200),
      await request(server).get("/me/guardian/students/student-a/profile").set("Authorization", `Bearer ${guardianToken}`).expect(200),
    ];

    for (const response of responses) {
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain("userId");
      expect(serialized).not.toContain("student-tenant-a");
      expect(serialized).not.toContain("nationalIdEncrypted");
      expect(serialized).not.toContain("nationalIdHash");
      expect(serialized).not.toContain("token");
    }
  });

  it("veli aynı tenant içinde bağlı olmayan öğrencinin portal alt kaynaklarını okuyamaz ve değiştiremez", async () => {
    const otherStudent = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "BagliOlmayan", lastName: "Ogrenci" })
      .expect(201);
    const otherStudentId = (otherStudent.body as { id: string }).id;
    const endpointPrefix = `/me/guardian/students/${otherStudentId}`;
    const idorEndpoints: PortalEndpoint[] = [
      { method: "get", path: `${endpointPrefix}/profile` },
      { method: "get", path: `${endpointPrefix}/class-history` },
      { method: "get", path: `${endpointPrefix}/enrollments` },
      { method: "get", path: `${endpointPrefix}/homework/material-assignments` },
      { method: "get", path: `${endpointPrefix}/attendance` },
      { method: "get", path: `${endpointPrefix}/attendance/summary` },
      { method: "get", path: `${endpointPrefix}/teacher-notes` },
      { method: "get", path: `${endpointPrefix}/development-assessments` },
      { method: "get", path: `${endpointPrefix}/announcements` },
      { method: "post", path: `${endpointPrefix}/announcements/announcement-a/read` },
      { method: "get", path: `${endpointPrefix}/notification-preferences` },
      {
        body: { canOpenSupportTickets: true, canReceiveAnnouncements: true, canReceiveSms: true },
        method: "patch",
        path: `${endpointPrefix}/notification-preferences`,
      },
      { method: "get", path: `${endpointPrefix}/support-tickets` },
      {
        body: { message: "Bağlı olmayan öğrenci için açılmamalı.", priority: "LOW", subject: "IDOR denemesi" },
        method: "post",
        path: `${endpointPrefix}/support-tickets`,
      },
      { method: "get", path: `${endpointPrefix}/payment-plans` },
      { method: "get", path: `${endpointPrefix}/reports/exam-demo/latest` },
      { method: "get", path: `${endpointPrefix}/reports/exam-demo/latest/error-booklet` },
      { method: "get", path: `${endpointPrefix}/reports/exam-demo/progress` },
    ];

    for (const endpoint of idorEndpoints) {
      const response = await requestForEndpoint(endpoint)
        .set("Authorization", `Bearer ${guardianToken}`)
        .send(endpoint.body ?? {})
        .expect(403);
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain(otherStudentId);
      expect(serialized).not.toContain("BagliOlmayan");
      expect(serialized).not.toContain("payment-plan");
      expect(serialized).not.toContain("support-ticket");
      expect(serialized).not.toContain("announcement-a");
      expect(serialized).not.toContain("snapshot");
    }
  });

  it("öğretmen /me yüzeylerini yalnız öğretmen subject'i açar", async () => {
    const teacherEndpoints = [
      "/me/teacher",
      "/me/teacher/lookups",
      "/me/teacher/schedule",
      "/me/teacher/announcements",
      "/me/teacher/students",
      "/me/teacher/attendance",
      "/me/teacher/homework",
      "/me/teacher/homework/materials",
      "/me/teacher/homework/materials/material-a/assignments",
      "/me/teacher/teacher-notes",
      "/me/teacher/support-tickets",
      "/me/teacher/reports/exam-demo/snapshots",
      "/me/teacher/reports/exam-demo/snapshots/snapshot-demo/students/student-a",
      "/me/teacher/reports/exam-demo/snapshots/snapshot-demo/students/student-a/error-booklet",
      "/me/teacher/reports/exam-demo/students/student-a/progress",
    ];

    for (const endpoint of teacherEndpoints) {
      const teacherResponse = await request(server).get(endpoint).set("Authorization", `Bearer ${teacherToken}`);
      expect(teacherResponse.status, `${endpoint} should be teacher-only readable`).toBe(200);
      const studentResponse = await request(server).get(endpoint).set("Authorization", `Bearer ${studentToken}`);
      expect(studentResponse.status, `${endpoint} should reject student`).toBe(403);
      const guardianResponse = await request(server).get(endpoint).set("Authorization", `Bearer ${guardianToken}`);
      expect(guardianResponse.status, `${endpoint} should reject guardian`).toBe(403);
      const adminResponse = await request(server).get(endpoint).set("Authorization", `Bearer ${adminToken}`);
      expect(adminResponse.status, `${endpoint} should reject tenant admin without role preview`).toBe(403);
    }
  });

  it("öğretmen profil cevabı public teacher alanlarıyla sınırlıdır", async () => {
    const response = await request(server)
      .get("/me/teacher")
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: "teacher-a",
      tenantId: "tenant-a",
      firstName: expect.any(String),
      lastName: expect.any(String),
    });
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      "userId",
      "email",
      "phone",
      "nationalId",
      "nationalIdEncrypted",
      "nationalIdHash",
      "photoKey",
      "token",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("öğretmen öğrenci listesi public öğrenci alanlarıyla sınırlıdır", async () => {
    const response = await request(server)
      .get("/me/teacher/students")
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({
        id: "student-a",
        tenantId: "tenant-a",
        firstName: "Ada",
        lastName: "A",
        status: "ACTIVE",
      }),
    ]);
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      "userId",
      "student-tenant-a",
      "email",
      "phone",
      "nationalId",
      "nationalIdEncrypted",
      "nationalIdHash",
      "photoKey",
      "token",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("öğretmen lookup cevabı referans listeleriyle sınırlıdır", async () => {
    const response = await request(server)
      .get("/me/teacher/lookups")
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      campuses: expect.any(Array),
      classes: expect.any(Array),
      courses: expect.any(Array),
      gradeLevels: expect.any(Array),
      terms: expect.any(Array),
    });
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      "userId",
      "email",
      "phone",
      "nationalId",
      "nationalIdEncrypted",
      "nationalIdHash",
      "photoKey",
      "token",
    ]) {
      expect(serialized).not.toContain(forbidden);
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

  it("portal mutasyonları yanlış rol ve role-preview ile kapalı kalır", async () => {
    const portalMutations: PortalMutation[] = [
      {
        method: "post",
        path: "/me/student/announcements/announcement-a/read",
        previewRole: "STUDENT",
        previewSubjectId: "student-a",
        wrongTokens: [guardianToken, teacherToken, adminToken],
      },
      {
        body: { message: "Yanlış rol açamamalı.", priority: "LOW", subject: "Kapsam dışı" },
        method: "post",
        path: "/me/student/support-tickets",
        previewRole: "STUDENT",
        previewSubjectId: "student-a",
        wrongTokens: [guardianToken, teacherToken, adminToken],
      },
      {
        method: "post",
        path: "/me/guardian/students/student-a/announcements/announcement-a/read",
        previewRole: "GUARDIAN",
        previewSubjectId: "guardian-a",
        wrongTokens: [studentToken, teacherToken, adminToken],
      },
      {
        body: { canOpenSupportTickets: true, canReceiveAnnouncements: true, canReceiveSms: true },
        method: "patch",
        path: "/me/guardian/students/student-a/notification-preferences",
        previewRole: "GUARDIAN",
        previewSubjectId: "guardian-a",
        wrongTokens: [studentToken, teacherToken, adminToken],
      },
      {
        body: { message: "Yanlış rol açamamalı.", priority: "LOW", subject: "Kapsam dışı" },
        method: "post",
        path: "/me/guardian/students/student-a/support-tickets",
        previewRole: "GUARDIAN",
        previewSubjectId: "guardian-a",
        wrongTokens: [studentToken, teacherToken, adminToken],
      },
      {
        method: "post",
        path: "/me/teacher/announcements/announcement-a/read",
        previewRole: "TEACHER",
        previewSubjectId: "teacher-a",
        wrongTokens: [studentToken, guardianToken, adminToken],
      },
      {
        body: { message: "Yanlış rol açamamalı.", priority: "LOW", subject: "Kapsam dışı" },
        method: "post",
        path: "/me/teacher/support-tickets",
        previewRole: "TEACHER",
        previewSubjectId: "teacher-a",
        wrongTokens: [studentToken, guardianToken, adminToken],
      },
    ];

    for (const mutation of portalMutations) {
      for (const token of mutation.wrongTokens) {
        const response = await mutableRequest(mutation).set("Authorization", `Bearer ${token}`).send(mutation.body ?? {}).expect(403);
        expect(JSON.stringify(response.body)).not.toContain("Yanlış rol");
        expect(JSON.stringify(response.body)).not.toContain("announcement-a");
      }

      const previewToken = await createRolePreviewToken(mutation.previewRole, mutation.previewSubjectId);
      const previewResponse = await mutableRequest(mutation)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("x-role-preview-token", previewToken)
        .send(mutation.body ?? {})
        .expect(403);
      expect(JSON.stringify(previewResponse.body)).toContain("ROLE_PREVIEW_READ_ONLY");
      expect(JSON.stringify(previewResponse.body)).not.toContain("Yanlış rol");
      expect(JSON.stringify(previewResponse.body)).not.toContain("announcement-a");
    }
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

    const scopedIdorEndpoints = [
      "/me/teacher/reports/exam-demo/snapshots/snapshot-demo/students/student-b",
      "/me/teacher/reports/exam-demo/snapshots/snapshot-demo/students/student-b/error-booklet",
      "/me/teacher/reports/exam-demo/students/student-b/progress",
    ];

    for (const endpoint of scopedIdorEndpoints) {
      const scopedResponse = await request(server).get(endpoint).set("Authorization", `Bearer ${teacherToken}`).expect(403);
      expect(JSON.stringify(scopedResponse.body)).not.toContain("student-b");
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

  it("kullanıcı kendi push cihaz tokenını kaydeder, listeler ve kapatır", async () => {
    const create = await request(server)
      .post("/me/notification-devices")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ provider: "fcm", token: "student-access-matrix-device", platform: "web" })
      .expect(201);

    expect(create.body).toMatchObject({
      tenantId: "tenant-a",
      subjectType: "STUDENT",
      subjectId: "student-a",
      provider: "fcm",
      platform: "web",
    });
    expect(JSON.stringify(create.body)).not.toContain("student-access-matrix-device");
    expect(JSON.stringify(create.body)).not.toContain("student-tenant-a");

    await request(server)
      .get("/me/notification-devices")
      .set("Authorization", `Bearer ${studentToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            id: create.body.id,
            provider: "fcm",
            platform: "web",
          }),
        ]);
        expect(JSON.stringify(body)).not.toContain("student-access-matrix-device");
        expect(JSON.stringify(body)).not.toContain("student-tenant-a");
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
        expect(JSON.stringify(body)).not.toContain("student-access-matrix-device");
        expect(JSON.stringify(body)).not.toContain("student-tenant-a");
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

  async function createRolePreviewToken(targetRole: "GUARDIAN" | "STUDENT" | "TEACHER", targetSubjectId: string): Promise<string> {
    const created = await request(server)
      .post("/role-previews")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ targetRole, targetSubjectId })
      .expect(201);
    return (created.body as { previewToken: string }).previewToken;
  }

  function mutableRequest(mutation: PortalMutation) {
    return requestForEndpoint(mutation);
  }

  function requestForEndpoint(endpoint: PortalEndpoint) {
    if (endpoint.method === "get") {
      return request(server).get(endpoint.path);
    }
    if (endpoint.method === "patch") {
      return request(server).patch(endpoint.path);
    }
    return request(server).post(endpoint.path);
  }
});

interface PortalEndpoint {
  body?: Record<string, unknown>;
  method: "get" | "patch" | "post";
  path: string;
}

interface PortalMutation extends PortalEndpoint {
  method: "patch" | "post";
  previewRole: "GUARDIAN" | "STUDENT" | "TEACHER";
  previewSubjectId: string;
  wrongTokens: string[];
}
