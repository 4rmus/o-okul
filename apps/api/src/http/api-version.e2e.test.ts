import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { apiPrefix, configureApiApp } from "./configure-api-app.js";

describe("API version prefix", () => {
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

  it("auth ve kaynak endpointlerini /api/v1 altında sunar", async () => {
    await request(server)
      .get(`/${apiPrefix}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          data: [{ id: "class-a", tenantId: "tenant-a", name: "8-A", level: "8" }],
          meta: { total: 1, page: 1, limit: 1, totalPages: 1 },
        });
      });

    const createdClass = await request(server)
      .post(`/${apiPrefix}/classes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "7-C", level: "7" })
      .expect(201);

    await request(server)
      .get(`/${apiPrefix}/classes`)
      .query({ page: "1", limit: "1", sort: "-name" })
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toHaveLength(1);
        expect(body.meta).toEqual({ total: 2, page: 1, limit: 1, totalPages: 2 });
      });

    await request(server)
      .delete(`/${apiPrefix}/classes/${createdClass.body.data.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(204);

    await request(server)
      .get(`/${apiPrefix}/homework`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data[0]).toMatchObject({ id: "homework-a", tenantId: "tenant-a" });
        expect(body.meta).toEqual({ total: 1, page: 1, limit: 1, totalPages: 1 });
      });
  });

  it("health endpointlerini altyapı sinyali olarak kökte bırakır", async () => {
    await request(server).get("/health").expect(200, { status: "ok" });
  });
});
