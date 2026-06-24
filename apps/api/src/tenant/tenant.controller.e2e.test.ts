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

    await request(server)
      .delete("/tenants/tenant-e2e")
      .set("Authorization", `Bearer ${systemToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: "tenant-e2e",
          status: "DELETED",
        });
      });

    await request(server)
      .get("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "tenant-e2e" })]));
      });
  });

  it("TENANT_ADMIN tenant yönetim endpoint'lerine giremez", async () => {
    await request(server)
      .get("/tenants")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(403);
  });

  it("first-admin invitation tenant create response'unda ham aktivasyon tokenı dönmez", async () => {
    await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({
        id: "tenant-invitation-e2e",
        name: "Tenant Invitation E2E",
        slug: "tenant-invitation-e2e",
        firstAdmin: {
          name: "Invitation Admin",
          email: "invitation-admin@example.test",
          mode: "invitation",
        },
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          tenant: expect.objectContaining({ id: "tenant-invitation-e2e" }),
          admin: expect.objectContaining({
            email: "invitation-admin@example.test",
            tenantId: "tenant-invitation-e2e",
            activationTokenIssued: true,
            activationTokenExpiresAt: expect.any(String),
          }),
        });
        expect(body.admin).not.toHaveProperty("activationToken");
        expect(JSON.stringify(body)).not.toContain("tokenHash");
      });
  });

  it("tenant yönetim gövdelerini Zod ile doğrular", async () => {
    const invalidCreate = await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({
        firstAdmin: {
          email: "gecersiz",
          mode: "password",
          name: " ",
          password: "short",
        },
        name: " ",
        seatLimit: 1.5,
        slug: " ",
      })
      .expect(422);

    expect(invalidCreate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "firstAdmin.email" }),
          expect.objectContaining({ path: "firstAdmin.name" }),
          expect.objectContaining({ path: "firstAdmin.password" }),
          expect.objectContaining({ path: "name" }),
          expect.objectContaining({ path: "seatLimit" }),
          expect.objectContaining({ path: "slug" }),
        ]),
      },
    });

    const invalidUpdate = await request(server)
      .patch("/tenants/tenant-a")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({
        contactEmail: "gecersiz",
        firstAdmin: {
          email: "ignored-admin@example.test",
          name: "Ignored Admin",
          password: "password1",
        },
        id: "tenant-forbidden",
        licenseEndsAt: "2026-02-29T00:00:00.000Z",
        logoUrl: "ftp://cdn.example.test/logo.png",
        seatLimit: 0,
      })
      .expect(422);

    expect(invalidUpdate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "contactEmail" }),
          expect.objectContaining({ path: "$" }),
          expect.objectContaining({ path: "licenseEndsAt" }),
          expect.objectContaining({ path: "logoUrl" }),
          expect.objectContaining({ path: "seatLimit" }),
        ]),
      },
    });
  });

  it("kurum profil gövdesini Zod ile doğrular", async () => {
    const invalidProfile = await request(server)
      .patch("/me/tenant")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        contactEmail: "gecersiz",
        logoUrl: "ftp://cdn.example.test/logo.png",
        name: 123,
      })
      .expect(422);

    expect(invalidProfile.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "contactEmail" }),
          expect.objectContaining({ path: "logoUrl" }),
          expect.objectContaining({ path: "name" }),
        ]),
      },
    });
  });

  it("SYSTEM_ADMIN tenant listesini arama, sıralama ve sayfalama ile alır", async () => {
    await request(server)
      .get("/tenants")
      .query({ q: "demo", sort: "slug", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${systemToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({ slug: "demo-kurum-b" });
      });
  });

  it("expired tenant bearer token ile okuma yapar ama yazma isteği başlatamaz", async () => {
    await request(server)
      .get("/me/profile")
      .set("Authorization", `Bearer ${expiredTenantToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          tenantId: "tenant-expired",
          roles: ["TENANT_ADMIN"],
        });
      });

    await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${expiredTenantToken}`)
      .send({})
      .expect(403)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain("TENANT_LICENSE_EXPIRED_READ_ONLY");
      });
  });
});
