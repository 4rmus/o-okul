import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { apiPrefix, configureApiApp } from "./configure-api-app.js";

describe("API success response envelope", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApiApp(app);
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    const login = await request(server)
      .post(`/${apiPrefix}/auth/login`)
      .send({ email: "admin-a@example.test", password: "password" })
      .expect(200);
    accessToken = (login.body as { data: { accessToken: string } }).data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("tekil başarılı yanıtları data zarfıyla döner", async () => {
    const response = await request(server)
      .get(`/${apiPrefix}/classes/class-a`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toEqual({
      data: {
        id: "class-a",
        tenantId: "tenant-a",
        campusId: "campus-main",
        gradeLevelId: "grade-8",
        name: "8-A",
        level: "8",
        section: "A",
      },
    });
  });

  it("liste yanıtlarını data ve meta zarfıyla döner", async () => {
    const response = await request(server)
      .get(`/${apiPrefix}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toEqual({
      data: [{
        id: "class-a",
        tenantId: "tenant-a",
        campusId: "campus-main",
        gradeLevelId: "grade-8",
        name: "8-A",
        level: "8",
        section: "A",
      }],
      meta: { total: 1, page: 1, limit: 1, totalPages: 1 },
    });
  });

  it("silme yanıtını boş bırakır ve health yanıtını sarmalarmaz", async () => {
    const created = await request(server)
      .post(`/${apiPrefix}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "10-A", level: "10" })
      .expect(201);
    const classId = (created.body as { data: { id: string } }).data.id;

    await request(server)
      .delete(`/${apiPrefix}/classes/${classId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(204)
      .expect(({ text }) => {
        expect(text).toBe("");
      });

    await request(server).get("/health").expect(200, { status: "ok" });
  });

  it("metrics yanıtını üretim prefix'i altında raw text bırakır", async () => {
    const response = await request(server)
      .get(`/${apiPrefix}/metrics`)
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("# TYPE o_okul_process_uptime_seconds gauge");
    expect(response.text).not.toContain("\"data\"");
  });
});
