import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { testLoginBody } from "../test-auth.js";

describe("SetupReadinessController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it("setup:manage sahibi tenant adminine yalnız sayım ve durum döndürür", async () => {
    const issued = await login("admin-a@example.test");
    const response = await request(server)
      .get("/setup/readiness")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      status: expect.stringMatching(/^(READY|ACTION_REQUIRED)$/),
      completedCount: expect.any(Number),
      totalCount: 9,
      steps: expect.arrayContaining([
        expect.objectContaining({ key: "academic-term", ready: expect.any(Boolean) }),
        expect.objectContaining({ key: "student", ready: expect.any(Boolean) }),
      ]),
    });
    expect(JSON.stringify(response.body)).not.toContain("Ada");
    expect(JSON.stringify(response.body)).not.toContain("Ayse");
    expect(JSON.stringify(response.body)).not.toContain("example.test");
  });

  it("TEACHER personasını setup read modelinden capability katmanında reddeder", async () => {
    const issued = await login("teacher-a@example.test");
    await request(server)
      .get("/setup/readiness")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .expect(403);
  });

  async function login(email: string) {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return response.body as { accessToken: string };
  }
});
