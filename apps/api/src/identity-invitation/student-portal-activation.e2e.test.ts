import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers } from "../auth/auth-user-store.js";
import { apiPrefix, configureApiApp } from "../http/configure-api-app.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import { testLoginBody } from "../test-auth.js";

describe("Student portal activation", () => {
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
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
    const students = app.get<StudentStore>(studentStoreToken);
    await students.create({
      tenantId: "tenant-a",
      studentNo: "ACT-101",
      firstName: "Aktivasyon",
      lastName: "Öğrencisi",
      status: "ACTIVE",
    });
    await students.create({
      tenantId: "tenant-a",
      studentNo: "ACT-PASSIVE",
      firstName: "Pasif",
      lastName: "Öğrenci",
      status: "PASSIVE",
    });
    adminToken = await login("admin-a@example.test");
    otherTenantAdminToken = await login("admin-b@example.test");
    teacherToken = await login("teacher-a@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  it("tenant admin 12 karakterlik kodu bir kez alır; başka tenant ve öğretmen erişemez", async () => {
    const studentId = await findStudentId("ACT-101");
    const issued = await issue(studentId, adminToken);

    expect(issued).toMatchObject({
      studentId,
      tenantSlug: "dna-egitim",
      studentNo: "ACT-101",
      activationCode: expect.stringMatching(/^[A-HJ-NP-Z2-9]{12}$/),
      expiresAt: expect.any(String),
    });
    expect(issued.activationUrl).toContain("/aktivasyon#tenant=");
    expect(issued.activationUrl).not.toContain("/aktivasyon?");
    expect(issued.activationUrl).toContain(encodeURIComponent(issued.activationCode));
    expect(JSON.stringify(issued)).not.toContain("tokenHash");
    await request(server)
      .get(`/${apiPrefix}/identity-invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).not.toContain(issued.activationCode);
        expect(JSON.stringify(body)).not.toContain("tokenHash");
      });

    await request(server)
      .post(`/${apiPrefix}/students/${studentId}/portal-invitations`)
      .set("Authorization", `Bearer ${otherTenantAdminToken}`)
      .expect(404);
    await request(server)
      .post(`/${apiPrefix}/students/${studentId}/portal-invitations`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(403);
  });

  it("beş yanlış denemede kodu kilitler; yeni kodla atomik aktivasyon ve öğrenci no login çalışır", async () => {
    const studentId = await findStudentId("ACT-101");
    const first = await issue(studentId, adminToken);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await request(server)
        .post(`/${apiPrefix}/auth/activate`)
        .send({
          tenantSlug: "dna-egitim",
          studentNo: "ACT-101",
          code: "222222222222",
          password: "Secure-password-123",
        })
        .expect(401);
    }
    await request(server)
      .post(`/${apiPrefix}/auth/activate`)
      .send({
        tenantSlug: "dna-egitim",
        studentNo: "ACT-101",
        code: first.activationCode,
        password: "Secure-password-123",
      })
      .expect(401);

    const next = await issue(studentId, adminToken);
    const accepted = await request(server)
      .post(`/${apiPrefix}/auth/activate`)
      .send({
        tenantSlug: "dna-egitim",
        studentNo: "ACT-101",
        code: next.activationCode,
        password: "Secure-password-123",
      })
      .expect(200);
    expect(accepted.body.data).toMatchObject({ status: "ACCEPTED", loginName: "ACT-101" });
    expect(JSON.stringify(accepted.body)).not.toContain(next.activationCode);

    await request(server)
      .post(`/${apiPrefix}/auth/activate`)
      .send({
        tenantSlug: "dna-egitim",
        studentNo: "ACT-101",
        code: next.activationCode,
        password: "Secure-password-123",
      })
      .expect(401);

    await request(server)
      .post(`/${apiPrefix}/auth/login`)
      .send({ tenantSlug: "dna-egitim", loginName: "ACT-101", password: "Secure-password-123" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.session).toMatchObject({ tenantId: "tenant-a", roles: ["STUDENT"] });
      });
  });

  it("pasif öğrenci için kod üretmez", async () => {
    const studentId = await findStudentId("ACT-PASSIVE");
    await request(server)
      .post(`/${apiPrefix}/students/${studentId}/portal-invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(409);
  });

  async function findStudentId(studentNo: string): Promise<string> {
    const students = await app.get<StudentStore>(studentStoreToken).list();
    const student = students.find((candidate) => candidate.tenantId === "tenant-a" && candidate.studentNo === studentNo);
    if (!student) throw new Error(`TEST_STUDENT_NOT_FOUND:${studentNo}`);
    return student.id;
  }

  async function issue(studentId: string, accessToken: string) {
    const response = await request(server)
      .post(`/${apiPrefix}/students/${studentId}/portal-invitations`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(201);
    return response.body.data as {
      studentId: string;
      tenantSlug: string;
      studentNo: string;
      activationCode: string;
      activationUrl: string;
      expiresAt: string;
    };
  }

  async function login(email: string): Promise<string> {
    const response = await request(server)
      .post(`/${apiPrefix}/auth/login`)
      .send(testLoginBody(email))
      .expect(200);
    return response.body.data.accessToken as string;
  }
});
