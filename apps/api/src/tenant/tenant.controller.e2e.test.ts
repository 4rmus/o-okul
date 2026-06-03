import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("TenantController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let systemToken: string;
  let adminToken: string;
  let expiredTenantToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    systemToken = await login("system@example.test");
    adminToken = await login("admin-a@example.test");
    expiredTenantToken = await login("expired-tenant@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("SYSTEM_ADMIN tenant listesini görür, oluşturur ve lisans alanlarını günceller", async () => {
    await request(server)
      .get("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ id: "tenant-a", plan: "PRO" })]));
      });

    await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({
        id: "tenant-e2e",
        name: "Tenant E2E",
        slug: "tenant-e2e",
        plan: "STANDARD",
        licenseEndsAt: "2030-01-01T00:00:00.000Z",
        seatLimit: 250,
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: "tenant-e2e",
          plan: "STANDARD",
          seatLimit: 250,
          status: "ACTIVE",
        });
      });

    await request(server)
      .patch("/tenants/tenant-e2e")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({ plan: "PRO", status: "SUSPENDED" })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: "tenant-e2e",
          plan: "PRO",
          status: "SUSPENDED",
        });
      });
  });

  it("TENANT_ADMIN tenant yönetim endpoint'lerine giremez", async () => {
    await request(server)
      .get("/tenants")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(403);
  });

  it("expired tenant bearer token ile normal request başlatamaz", async () => {
    await request(server)
      .get("/me/profile")
      .set("Authorization", `Bearer ${expiredTenantToken}`)
      .expect(403)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain("TENANT_INACTIVE_OR_EXPIRED");
      });
  });
});
