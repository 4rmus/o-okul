import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("RolePreview API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAAccessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    tenantAAccessToken = await login("admin-a@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("tenant admin starts a read-only role preview session", async () => {
    await request(server)
      .post("/role-previews")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        targetRole: "STUDENT",
        targetSubjectId: "student-a",
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          tenantId: "tenant-a",
          actorUserId: "user-tenant-a",
          targetRole: "STUDENT",
          targetSubjectType: "STUDENT",
          targetSubjectId: "student-a",
          mode: "READ_ONLY",
        });
        expect(body.previewToken).toEqual(expect.any(String));
        expect(body.expiresAt).toEqual(expect.any(String));
        expect(body).not.toHaveProperty("accessToken");
        expect(body).not.toHaveProperty("password");
        expect(body).not.toHaveProperty("passwordHash");
        expect(body).not.toHaveProperty("refreshToken");
      });
  });

  it("does not issue a role preview token for missing or cross-tenant subjects", async () => {
    for (const targetSubjectId of ["student-missing", "student-b"]) {
      const response = await request(server)
        .post("/role-previews")
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .send({
          targetRole: "STUDENT",
          targetSubjectId,
        })
        .expect(404);

      expect(response.body).toMatchObject({
        error: { code: "ROLE_PREVIEW_SUBJECT_NOT_FOUND" },
      });
      expect(response.body.previewToken).toBeUndefined();
    }
  });

  it("validates role preview start bodies with Zod", async () => {
    const invalidCreate = await request(server)
      .post("/role-previews")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        targetRole: "SYSTEM_ADMIN",
        targetSubjectId: " ",
      })
      .expect(422);

    expect(invalidCreate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "targetRole" }),
          expect.objectContaining({ path: "targetSubjectId" }),
        ]),
      },
    });
  });
});
