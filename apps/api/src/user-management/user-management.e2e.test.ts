import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

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

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
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
        roles: ["TEACHER"],
      })
      .expect(201);

    expect(created.body).toMatchObject({
      email: "created-user-a@example.test",
      name: "Created User A",
      tenantId: "tenant-a",
      roles: ["TEACHER"],
    });

    const userId = (created.body as { id: string }).id;
    await request(server)
      .patch(`/tenant-users/${userId}/roles`)
      .set("Authorization", `Bearer ${tenantA}`)
      .send({ roles: ["STUDENT", "GUARDIAN"] })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: userId,
          tenantId: "tenant-a",
          roles: ["STUDENT", "GUARDIAN"],
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

  it("tenant admin SYSTEM_ADMIN veremez ve kendi admin rolünü düşüremez", async () => {
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
      .expect(400);

    await request(server)
      .patch("/tenant-users/user-tenant-a/roles")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({ roles: ["TEACHER"] })
      .expect(400);
  });
});
