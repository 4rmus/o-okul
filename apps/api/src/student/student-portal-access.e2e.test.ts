import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers } from "../auth/auth-user-store.js";
import { apiPrefix, configureApiApp } from "../http/configure-api-app.js";
import { testLoginBody } from "../test-auth.js";
import { type StudentStore, studentStoreToken } from "./student-store.js";

describe("Student portal access management", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAdminToken: string;
  let otherTenantAdminToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApiApp(app);
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
    await app.get<StudentStore>(studentStoreToken).create({
      tenantId: "tenant-a",
      studentNo: "101",
      firstName: "Cem",
      lastName: "C",
      status: "ACTIVE",
    });
    tenantAdminToken = await login("admin-a@example.test");
    otherTenantAdminToken = await login("admin-b@example.test");
    teacherToken = await login("teacher-a@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  it("tenant-scope cursor sayfası döner ve sonraki cursor ile devam eder", async () => {
    const first = await request(server)
      .get(`/${apiPrefix}/students/portal-access`)
      .query({ limit: 1 })
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .expect(200);

    expect(first.body).toEqual({
      data: [expect.objectContaining({ studentId: "student-a", tenantId: "tenant-a", accessState: "ACTIVE" })],
      meta: {
        limit: 1,
        nextCursor: expect.any(String),
      },
    });

    await request(server)
      .get(`/${apiPrefix}/students/portal-access`)
      .query({ cursor: first.body.meta.nextCursor, direction: "next", limit: 1 })
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual([expect.objectContaining({ tenantId: "tenant-a", accessState: "NOT_INVITED" })]);
        expect(body.meta).toEqual({ limit: 1, previousCursor: expect.any(String) });
        expect(JSON.stringify(body)).not.toContain("student-b");
      });

    await request(server)
      .get(`/${apiPrefix}/students/portal-access`)
      .set("Authorization", `Bearer ${otherTenantAdminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual([expect.objectContaining({ studentId: "student-b", tenantId: "tenant-b" })]);
        expect(JSON.stringify(body)).not.toContain("student-a");
      });
  });

  it("arama SQL/store sınırına taşınır; bozuk cursor ve yetkisiz rol reddedilir", async () => {
    await request(server)
      .get(`/${apiPrefix}/students/portal-access`)
      .query({ q: "Cem" })
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual([expect.objectContaining({ firstName: "Cem" })]);
      });

    await request(server)
      .get(`/${apiPrefix}/students/portal-access`)
      .query({ cursor: "not+base64" })
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .expect(400);

    await request(server)
      .get(`/${apiPrefix}/students/portal-access`)
      .query({ direction: "previous" })
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .expect(422);

    await request(server)
      .get(`/${apiPrefix}/students/portal-access`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(403);
  });

  it("portal erişimini expectedVersion ile askıya alır ve yeniden açar", async () => {
    await request(server)
      .patch(`/${apiPrefix}/students/student-a/portal-access`)
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .send({ status: "SUSPENDED", expectedVersion: 1 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          studentId: "student-a",
          tenantId: "tenant-a",
          accountStatus: "DISABLED",
          membership: { status: "SUSPENDED", version: 2 },
        });
      });

    await request(server)
      .patch(`/${apiPrefix}/students/student-a/portal-access`)
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .send({ status: "ACTIVE", expectedVersion: 1 })
      .expect(409);

    await request(server)
      .patch(`/${apiPrefix}/students/student-a/portal-access`)
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .send({ status: "ACTIVE", expectedVersion: 2 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          accountStatus: "ACTIVE",
          membership: { status: "ACTIVE", version: 3 },
        });
      });

    await request(server)
      .patch(`/${apiPrefix}/students/student-a/portal-access`)
      .set("Authorization", `Bearer ${otherTenantAdminToken}`)
      .send({ status: "SUSPENDED", expectedVersion: 3 })
      .expect(404);

    await request(server)
      .patch(`/${apiPrefix}/students/student-a/portal-access`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ status: "SUSPENDED", expectedVersion: 3 })
      .expect(403);
  });

  async function login(email: string): Promise<string> {
    const response = await request(server)
      .post(`/${apiPrefix}/auth/login`)
      .send(testLoginBody(email))
      .expect(200);
    return response.body.data.accessToken as string;
  }
});
