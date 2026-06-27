import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { upsertInMemoryAuthUser } from "../auth/auth-user-store.js";

describe("Tenant user management", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string, password = "password"): Promise<string> {
    const response = await request(server).post("/auth/login").send({ email, password }).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("kurum admin yalnız kendi tenant kullanıcılarını listeler", async () => {
    const tenantA = await login("admin-a@example.test");
    const tenantB = await login("admin-b@example.test");

    const response = await request(server)
      .get("/tenant-users")
      .set("Authorization", `Bearer ${tenantA}`)
      .expect(200);

    expect(JSON.stringify(response.body)).toContain("admin-a@example.test");
    expect(JSON.stringify(response.body)).toContain("teacher-a@example.test");
    expect(JSON.stringify(response.body)).not.toContain("admin-b@example.test");

    await request(server)
      .get("/tenant-users")
      .query({ q: "teacher", sort: "email", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${tenantA}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ email: "teacher-a@example.test" })]);
      });

    await request(server)
      .get("/tenant-users")
      .set("Authorization", `Bearer ${tenantB}`)
      .expect(200)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain("admin-b@example.test");
        expect(JSON.stringify(body)).not.toContain("admin-a@example.test");
      });
  });

  it("öğretmen kullanıcı yönetimi yapamaz", async () => {
    const teacher = await login("teacher-a@example.test");

    await request(server).get("/tenant-users").set("Authorization", `Bearer ${teacher}`).expect(403);
  });

  it("tenant admin kullanıcı oluşturur ve tenant içi rolleri günceller", async () => {
    const tenantA = await login("admin-a@example.test");
    const created = await request(server)
      .post("/tenant-users")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({
        email: "created-user-a@example.test",
        name: "Created User A",
        password: "password1",
        roles: ["ASSISTANT_ADMIN"],
      })
      .expect(201);

    expect(created.body).toMatchObject({
      email: "created-user-a@example.test",
      name: "Created User A",
      tenantId: "tenant-a",
      roles: ["ASSISTANT_ADMIN"],
    });
    expect(created.body).not.toHaveProperty("password");
    expect(created.body).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(created.body)).not.toContain("password1");

    const userId = (created.body as { id: string }).id;
    await request(server)
      .patch(`/tenant-users/${userId}/roles`)
      .set("Authorization", `Bearer ${tenantA}`)
      .send({ roles: ["TENANT_ADMIN"] })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: userId,
          tenantId: "tenant-a",
          roles: ["TENANT_ADMIN"],
        });
      });

    const tenantB = await login("admin-b@example.test");
    await request(server)
      .get("/tenant-users")
      .set("Authorization", `Bearer ${tenantB}`)
      .expect(200)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).not.toContain("created-user-a@example.test");
      });
  });

  it("rol düşürülünce eski access token ve audit PII sızıntısı engellenir", async () => {
    const tenantA = await login("admin-a@example.test");
    const email = "revoked-admin-a@example.test";
    const created = await request(server)
      .post("/tenant-users")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({
        email,
        name: "Revoked Admin A",
        password: "password1",
        roles: ["TENANT_ADMIN"],
      })
      .expect(201);

    const userId = (created.body as { id: string }).id;
    upsertInMemoryAuthUser({
      id: userId,
      email,
      name: "Revoked Admin A",
      password: "password1",
      roles: ["TENANT_ADMIN"],
      tenantId: "tenant-a",
    });

    const auditResponse = await request(server)
      .get("/audit-logs")
      .query({ entityId: userId, entityType: "User" })
      .set("Authorization", `Bearer ${tenantA}`)
      .expect(200);

    expect(auditResponse.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "user.membership_created",
        diff: expect.objectContaining({ emailProvided: true, roles: ["TENANT_ADMIN"] }),
      }),
    ]));
    expect(JSON.stringify(auditResponse.body)).not.toContain(email);

    const elevatedToken = await login(email, "password1");
    await request(server).get("/tenant-users").set("Authorization", `Bearer ${elevatedToken}`).expect(200);

    await request(server)
      .patch(`/tenant-users/${userId}/roles`)
      .set("Authorization", `Bearer ${tenantA}`)
      .send({ roles: ["ASSISTANT_ADMIN"] })
      .expect(200);

    await request(server).get("/tenant-users").set("Authorization", `Bearer ${elevatedToken}`).expect(401);
  });

  it("koltuk limiti dolu tenantta yeni kullanıcı oluşturmaz", async () => {
    const system = await login("system@example.test");
    await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${system}`)
      .send({
        id: "tenant-seat-users",
        name: "Seat Users Tenant",
        slug: "seat-users-tenant",
        seatLimit: 1,
        firstAdmin: {
          name: "Seat Users Admin",
          email: "seat-users-admin@example.test",
          mode: "password",
          password: "password1",
        },
      })
      .expect(201);

    const admin = await login("seat-users-admin@example.test", "password1");
    await request(server)
      .post("/tenant-users")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        email: "seat-users-new@example.test",
        name: "Seat Users New",
        password: "password1",
        roles: ["ASSISTANT_ADMIN"],
      })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain("TENANT_SEAT_LIMIT_EXCEEDED");
      });
  });

  it("tenant kullanıcı gövdelerini Zod ile doğrular", async () => {
    const tenantA = await login("admin-a@example.test");
    const invalidCreate = await request(server)
      .post("/tenant-users")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({
        email: "gecersiz-email",
        name: " ",
        password: "short",
        roles: [],
      })
      .expect(422);

    expect(invalidCreate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "email" }),
          expect.objectContaining({ path: "name" }),
          expect.objectContaining({ path: "password" }),
          expect.objectContaining({ path: "roles" }),
        ]),
      },
    });

    const invalidRoles = await request(server)
      .patch("/tenant-users/user-tenant-a/roles")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({ roles: ["UNKNOWN_ROLE"] })
      .expect(422);

    expect(invalidRoles.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "roles.0" })],
      },
    });
  });

  it("tenant admin SYSTEM_ADMIN veya kişi rolü veremez ve kendi admin rolünü düşüremez", async () => {
    const tenantA = await login("admin-a@example.test");

    await request(server)
      .post("/tenant-users")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({
        email: "system-role-a@example.test",
        name: "System Role",
        password: "password1",
        roles: ["SYSTEM_ADMIN"],
      })
      .expect(422);

    await request(server)
      .post("/tenant-users")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({
        email: "subject-role-a@example.test",
        name: "Subject Role",
        password: "password1",
        roles: ["TEACHER"],
      })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain("TENANT_USER_SUBJECT_ROLE_FORBIDDEN");
      });

    await request(server)
      .patch("/tenant-users/user-tenant-a/roles")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({ roles: ["TEACHER"] })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain("TENANT_USER_SUBJECT_ROLE_FORBIDDEN");
      });
  });

  it("admin kullanıcı şifresini kişinin telefonuna sıfırlar ve eski oturumları iptal eder", async () => {
    const tenantA = await login("admin-a@example.test");
    const teacherToken = await login("teacher-a@example.test");

    await request(server).get("/me/profile").set("Authorization", `Bearer ${teacherToken}`).expect(200);

    await request(server)
      .post("/tenant-users/teacher-tenant-a/reset-password")
      .set("Authorization", `Bearer ${tenantA}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          userId: "teacher-tenant-a",
          mustChangePassword: true,
        });
        expect(body.resetAt).toEqual(expect.any(String));
        expect(JSON.stringify(body)).not.toContain("5550000010");
      });

    await request(server).get("/me/profile").set("Authorization", `Bearer ${teacherToken}`).expect(401);

    const resetLogin = await request(server)
      .post("/auth/login")
      .send({ email: "teacher-a@example.test", password: "5550000010" })
      .expect(200);
    const resetToken = (resetLogin.body as { accessToken: string }).accessToken;
    expect(resetLogin.body.session).toMatchObject({ mustChangePassword: true });

    await request(server).get("/me/profile").set("Authorization", `Bearer ${resetToken}`).expect(423);
    await request(server)
      .post("/me/password")
      .set("Authorization", `Bearer ${resetToken}`)
      .send({ currentPassword: "5550000010", newPassword: "password" })
      .expect(200);
  });
});
