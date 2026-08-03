import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { loginAsSettled, registerTestLoginIdentity } from "../test-auth.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { hashTcIdentity } from "../student/tc-identity.js";

describe("TenantController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let systemToken: string;
  let adminToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    systemToken = await login("system@example.test");
    adminToken = await login("admin-a@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string, password?: string): Promise<string> {
    return loginAsSettled(server, email, password);
  }

  it("SYSTEM_ADMIN tenant listesini görür, oluşturur ve operasyonel alanları günceller", async () => {
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
      .send({ status: "SUSPENDED" })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: "tenant-e2e",
          plan: "STANDARD",
          status: "SUSPENDED",
        });
      });

    await request(server)
      .delete("/tenants/tenant-e2e")
      .set("Authorization", `Bearer ${systemToken}`)
      .expect(410)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          error: { code: "TENANT_HARD_DELETE_RETIRED" },
        });
      });

    await request(server)
      .get("/tenants/tenant-e2e")
      .set("Authorization", `Bearer ${systemToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: "tenant-e2e", status: "SUSPENDED" });
      });

    await request(server)
      .get("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ id: "tenant-e2e" })]));
      });
  });

  it("SYSTEM_ADMIN eklemeli LicenseTerm oluşturur ve çakışmayı reddeder", async () => {
    await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({ id: "tenant-license-term-e2e", name: "LICENSE TERM TENANT", slug: "license-term-tenant" })
      .expect(201);

    const body = {
      planCode: "PRO",
      startsAt: "2031-01-01T00:00:00.000Z",
      endsAt: "2032-01-01T00:00:00.000Z",
      activeStudentLimit: 500,
      auditReference: "contract-2031",
    };
    await request(server)
      .post("/tenants/tenant-license-term-e2e/license-terms")
      .set("Authorization", `Bearer ${systemToken}`)
      .send(body)
      .expect(201)
      .expect(({ body: responseBody }) => {
        expect(responseBody).toMatchObject({ tenantId: "tenant-license-term-e2e", ...body });
      });

    await request(server)
      .post("/tenants/tenant-license-term-e2e/license-terms")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({ ...body, auditReference: "overlap-contract" })
      .expect(400)
      .expect(({ body: responseBody }) => {
        expect(JSON.stringify(responseBody)).toContain("LICENSE_TERM_OVERLAP");
      });

    await request(server)
      .post("/tenants/tenant-license-term-e2e/license-terms")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({ ...body, startsAt: body.endsAt, endsAt: body.startsAt })
      .expect(422);
  });

  it("TENANT_ADMIN tenant yönetim endpoint'lerine giremez", async () => {
    await request(server)
      .get("/tenants")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(403);
  });

  it("TENANT_ADMIN kendi lisans dönem geçmişini salt-okunur listeler", async () => {
    await request(server)
      .get("/tenants/current/license-terms")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({ tenantId: "tenant-a", planCode: "PRO", state: "ACTIVE" }),
        ]);
      });
  });

  it("first-admin tenant create response'unda davet tokenı dönmez", async () => {
    await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({
        id: "tenant-phone-admin-e2e",
        name: "Tenant Phone Admin E2E",
        slug: "tenant-phone-admin-e2e",
        firstAdmin: {
          name: "Phone Admin",
          email: "phone-admin@example.test",
          nationalId: "10000000450",
        },
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          tenant: expect.objectContaining({ id: "tenant-phone-admin-e2e" }),
          admin: expect.objectContaining({
            email: "phone-admin@example.test",
            tenantId: "tenant-phone-admin-e2e",
          }),
        });
        expect(body.admin).not.toHaveProperty("activationToken");
        expect(JSON.stringify(body)).not.toContain("tokenHash");
      });
  });

  it("canonical onboarding lisans, kampüs ve TENANT_OWNER çalışanını idempotent oluşturur", async () => {
    const body = {
      id: "tenant-owner-e2e",
      name: "TENANT OWNER E2E",
      slug: "tenant-owner-e2e",
      campuses: [{ name: "MERKEZ KAMPÜS", code: "MRK", unitType: "SCHOOL" }],
      licenseTerm: {
        planCode: "PRO",
        startsAt: "2032-01-01T00:00:00.000Z",
        endsAt: "2033-01-01T00:00:00.000Z",
        activeStudentLimit: 400,
        auditReference: "contract-owner-e2e",
      },
      firstOwner: { name: "İLK SAHİP", email: "owner-e2e@example.test" },
    };

    const first = await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .set("Idempotency-Key", "tenant-owner-e2e-1")
      .send(body)
      .expect(201);
    const replay = await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .set("Idempotency-Key", "tenant-owner-e2e-1")
      .send(body)
      .expect(201);

    expect(replay.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      tenant: { id: "tenant-owner-e2e", plan: "PRO", seatLimit: 400 },
      campuses: [{ tenantId: "tenant-owner-e2e", name: "MERKEZ KAMPÜS", unitType: "SCHOOL" }],
      licenseTerm: { tenantId: "tenant-owner-e2e", planCode: "PRO", activeStudentLimit: 400 },
      owner: { tenantId: "tenant-owner-e2e", roles: ["TENANT_OWNER"] },
    });
    expect(JSON.stringify(first.body)).not.toContain("tokenHash");
    expect(JSON.stringify(first.body)).not.toContain("owner-e2e@example.test");

    await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .set("Idempotency-Key", "tenant-owner-e2e-1")
      .send({ ...body, name: "FARKLI KURUM" })
      .expect(409);
  });

  it("tenant yönetim gövdelerini Zod ile doğrular", async () => {
    const invalidCreate = await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({
        firstAdmin: {
          email: "gecersiz",
          name: " ",
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
          expect.objectContaining({ path: "firstAdmin.nationalId" }),
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
          nationalId: "10000000450",
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
          expect.objectContaining({ path: "logoUrl" }),
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

  it("legacy lisans alanlarının PATCH ile değiştirilmesini reddeder", async () => {
    await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({
        id: "tenant-readonly-expired-e2e",
        name: "Tenant Readonly Expired E2E",
        slug: "tenant-readonly-expired-e2e",
        licenseEndsAt: "2030-01-01T00:00:00.000Z",
        firstAdmin: {
          name: "Readonly Expired Admin",
          email: "readonly-expired-admin@example.test",
          nationalId: "10000002126",
        },
      })
      .expect(201);

    const activatedPassword = "readonly-expired-admin-password";
    upsertInMemoryAuthUser({
      id: "readonly-expired-admin-test",
      email: "readonly-expired-admin@example.test",
      name: "Readonly Expired Admin",
      nationalIdHash: hashTcIdentity("10000002126"),
      password: activatedPassword,
      tenantId: "tenant-readonly-expired-e2e",
      roles: ["TENANT_ADMIN"],
      mustChangePassword: false,
    });
    registerTestLoginIdentity("readonly-expired-admin@example.test", {
      password: activatedPassword,
      tenantSlug: "tenant-readonly-expired-e2e",
    });
    const expiredTenantToken = await login("readonly-expired-admin@example.test", activatedPassword);

    await request(server)
      .patch("/tenants/tenant-readonly-expired-e2e")
      .set("Authorization", `Bearer ${systemToken}`)
      .send({ licenseEndsAt: "2020-01-01T00:00:00.000Z" })
      .expect(422);

    await request(server)
      .get("/me/profile")
      .set("Authorization", `Bearer ${expiredTenantToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          tenantId: "tenant-readonly-expired-e2e",
          roles: ["TENANT_ADMIN"],
        });
      });

    await request(server)
      .get("/me/profile")
      .set("Authorization", `Bearer ${expiredTenantToken}`)
      .expect(200);
  });
});
