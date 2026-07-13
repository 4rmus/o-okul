import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("PrivacyController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let adminToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    adminToken = await login("admin-a@example.test");
    teacherToken = await login("teacher-a@example.test");
    await request(server)
      .patch("/students/student-a/profile")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        nationalId: "10000002430",
        phone: "5550000011",
        email: "student-inventory@example.test",
        photoKey: "students/student-a/inventory.jpg",
      })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("tenant admin KVKK envanterini PII-safe referanslarla görür", async () => {
    const response = await request(server)
      .get("/privacy/inventory")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "student-a",
        kind: "student",
        displayRef: expect.any(String),
        piiCategories: expect.arrayContaining(["Ad", "soyad", "T.C. kimlik no", "telefon", "e-posta", "fotoğraf"]),
        purgeAvailable: true,
      }),
      expect.objectContaining({
        kind: "user",
        displayRef: expect.any(String),
        piiCategories: expect.arrayContaining(["e-posta", "ad"]),
        purgeAvailable: true,
      }),
    ]));
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      "Ada",
      "admin-a@example.test",
      "student-tenant-a",
      "nationalId",
      "phone",
      "token",
      "userId",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("privacy envanteri privacy capability olmayan öğretmene kapalıdır", async () => {
    await request(server)
      .get("/privacy/inventory")
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(403);
  });

  it("veli kendi hesap PII temizliği response'unda ham PII veya token döndürmez", async () => {
    const guardianToken = await login("privacy@example.test");

    const response = await request(server)
      .post("/privacy/me/purge-pii")
      .set("Authorization", `Bearer ${guardianToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      userId: "user-privacy",
      tenantId: "tenant-a",
      purgedAt: expect.any(String),
    });
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      "privacy@example.test",
      "Privacy User",
      "password",
      "passwordHash",
      "refreshToken",
      "token",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
