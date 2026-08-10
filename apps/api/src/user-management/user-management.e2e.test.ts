import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { loginAsSettled } from "../test-auth.js";
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

  it("kurum yöneticisini sistem adminine özel MFA uçlarından uzak tutar", async () => {
    const tenantAdmin = await login("admin-a@example.test");

    await request(server)
      .get("/auth/totp/status")
      .set("Authorization", `Bearer ${tenantAdmin}`)
      .expect(403);
    await request(server)
      .post("/auth/step-up")
      .set("Authorization", `Bearer ${tenantAdmin}`)
      .send({ purpose: "OWNER_ADMIN_CHANGE", totpCode: "123456" })
      .expect(403);
  });

  async function login(email: string, password = "password"): Promise<string> {
    return loginAsSettled(server, email, password);
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

  it("kurum admin yalnız kendi tenant çalışan erişim projeksiyonunu listeler", async () => {
    const tenantA = await login("admin-a@example.test");
    const tenantB = await login("admin-b@example.test");

    await request(server)
      .get("/employees")
      .query({ q: "Tenant A", sort: "lastName" })
      .set("Authorization", `Bearer ${tenantA}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: "employee-admin-a", tenantId: "tenant-a" })]);
        expect(JSON.stringify(body)).not.toContain("admin-b@example.test");
      });

    await request(server)
      .get("/employees")
      .set("Authorization", `Bearer ${tenantB}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: "employee-admin-b", tenantId: "tenant-b" })]);
        expect(JSON.stringify(body)).not.toContain("admin-a@example.test");
      });

    await request(server)
      .get("/employees")
      .query({ page: "2" })
      .set("Authorization", `Bearer ${tenantA}`)
      .expect(422)
      .expect(({ body }) => expect(body.error?.code).toBe("VALIDATION_FAILED"));

    await request(server)
      .get("/employees")
      .query({ limit: "101" })
      .set("Authorization", `Bearer ${tenantA}`)
      .expect(422)
      .expect(({ body }) => expect(body.error?.code).toBe("VALIDATION_FAILED"));
  });

  it("çalışan profilini hesaptan bağımsız oluşturur ve güvenli rol daveti üretir", async () => {
    const tenantA = await login("admin-a@example.test");
    const tenantB = await login("admin-b@example.test");
    const created = await request(server)
      .post("/employees")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({
        employeeNo: "A-NEW-1",
        firstName: "Yeni",
        lastName: "Çalışan",
        workEmail: "yeni.calisan@example.test",
        status: "ACTIVE",
      })
      .expect(201);

    expect(created.body).toMatchObject({ tenantId: "tenant-a", status: "ACTIVE" });
    expect(created.body).not.toHaveProperty("userId");
    const employeeId = created.body.id as string;
    await request(server)
      .post(`/employees/${employeeId}/account-invitations`)
      .set("Authorization", `Bearer ${tenantB}`)
      .send({ email: "yeni.calisan@example.test", role: "OPERATIONS_STAFF" })
      .expect(404);

    await request(server)
      .post(`/employees/${employeeId}/account-invitations`)
      .set("Authorization", `Bearer ${tenantA}`)
      .send({ email: "yeni.calisan@example.test", role: "OPERATIONS_STAFF" })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({ subjectType: "EMPLOYEE", subjectId: employeeId, role: "OPERATIONS_STAFF", status: "PENDING" });
        expect(body).not.toHaveProperty("activationToken");
        expect(body).not.toHaveProperty("tokenHash");
      });

    const adminCandidate = await request(server)
      .post("/employees")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({ firstName: "Yeni", lastName: "Admin", status: "ACTIVE" })
      .expect(201);
    await request(server)
      .post(`/employees/${adminCandidate.body.id as string}/account-invitations`)
      .set("Authorization", `Bearer ${tenantA}`)
      .send({ email: "yeni.admin@example.test", role: "TENANT_ADMIN" })
      .expect(201)
      .expect(({ body }) => expect(body.role).toBe("TENANT_ADMIN"));
  });

  it("öğretmen kullanıcı yönetimi yapamaz", async () => {
    const teacher = await login("teacher-a@example.test");

    await request(server).get("/tenant-users").set("Authorization", `Bearer ${teacher}`).expect(403);
    await request(server).get("/employees").set("Authorization", `Bearer ${teacher}`).expect(403);
    await request(server)
      .patch("/tenant-memberships/membership-operations-a")
      .set("Authorization", `Bearer ${teacher}`)
      .send({
        campusIds: [],
        expectedVersion: 1,
        hasTeacherPersona: false,
        scopeMode: "TENANT",
        staffRole: "TENANT_ADMIN",
        status: "ACTIVE",
      })
      .expect(403);
  });

  it("doğrudan tenant kullanıcı oluşturma yolunu emekliye ayırır", async () => {
    const tenantA = await login("admin-a@example.test");
    await request(server)
      .post("/tenant-users")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({
        email: "created-user-a@example.test",
        name: "Created User A",
        nationalId: "10000002294",
        phone: "5551234567",
        roles: ["ASSISTANT_ADMIN"],
      })
      .expect(404);

    const tenantB = await login("admin-b@example.test");
    await request(server)
      .get("/tenant-users")
      .set("Authorization", `Bearer ${tenantB}`)
      .expect(200)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).not.toContain("created-user-a@example.test");
      });
  });

  it("eski rol yazma yolunu emekliye ayırır ve mevcut session'ı değiştirmez", async () => {
    const tenantA = await login("admin-a@example.test");
    await request(server)
      .patch("/tenant-users/user-operations-a/roles")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({ roles: ["ASSISTANT_ADMIN"] })
      .expect(410)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain("TENANT_USER_ROLE_WRITE_RETIRED");
      });

    await request(server).get("/tenant-users").set("Authorization", `Bearer ${tenantA}`).expect(200);
  });

  it("eski rol yazma yolu gövdeden bağımsız 410 döner", async () => {
    const tenantA = await login("admin-a@example.test");
    await request(server)
      .patch("/tenant-users/user-tenant-a/roles")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({ roles: ["UNKNOWN_ROLE"] })
      .expect(410);
  });

  it("eski rol yazma yolu kişi rolü için de kapalıdır", async () => {
    const tenantA = await login("admin-a@example.test");

    await request(server)
      .patch("/tenant-users/user-tenant-a/roles")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({ roles: ["TEACHER"] })
      .expect(410)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain("TENANT_USER_ROLE_WRITE_RETIRED");
      });
  });

  it("admin telefon-parolası reset yolu emekliye ayrılmıştır", async () => {
    const tenantA = await login("admin-a@example.test");
    const teacherToken = await login("teacher-a@example.test");

    await request(server).get("/me/profile").set("Authorization", `Bearer ${teacherToken}`).expect(200);

    await request(server)
      .post("/tenant-users/teacher-tenant-a/reset-password")
      .set("Authorization", `Bearer ${tenantA}`)
      .expect(404);

    await request(server).get("/me/profile").set("Authorization", `Bearer ${teacherToken}`).expect(200);
  });

  it("üyelik yazısını tenant, sürüm, owner ve kampüs kurallarıyla sınırlar", async () => {
    const tenantA = await login("admin-a@example.test");
    const tenantB = await login("admin-b@example.test");
    const body = {
      campusIds: ["campus-main"],
      expectedVersion: 1,
      hasTeacherPersona: true,
      scopeMode: "CAMPUSES",
      staffRole: "OPERATIONS_STAFF",
      status: "ACTIVE",
    };

    await request(server)
      .patch("/tenant-memberships/membership-operations-a")
      .set("Authorization", `Bearer ${tenantB}`)
      .send(body)
      .expect(404);

    await request(server)
      .patch("/tenant-memberships/membership-operations-a")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({ ...body, campusIds: [] })
      .expect(422);

    await request(server)
      .patch("/tenant-memberships/membership-operations-a")
      .set("Authorization", `Bearer ${tenantA}`)
      .send(body)
      .expect(200)
      .expect(({ body: responseBody }) => {
        expect(responseBody).toMatchObject({
          employee: {
            id: "employee-operations-a",
            accountStatus: "ACTIVE",
            access: {
              membershipId: "membership-operations-a",
              staffRole: "OPERATIONS_STAFF",
              hasTeacherPersona: true,
              status: "ACTIVE",
              version: 2,
              scopeMode: "CAMPUSES",
              campusIds: ["campus-main"],
            },
          },
          sessionsRevoked: 0,
        });
      });

    await request(server)
      .patch("/tenant-memberships/membership-operations-a")
      .set("Authorization", `Bearer ${tenantA}`)
      .send(body)
      .expect(409)
      .expect(({ body: responseBody }) => {
        expect(JSON.stringify(responseBody)).toContain("TENANT_MEMBERSHIP_VERSION_CONFLICT");
      });

    await request(server)
      .patch("/tenant-memberships/membership-operations-a")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({ ...body, expectedVersion: 2, staffRole: "TENANT_OWNER" })
      .expect(403)
      .expect(({ body: responseBody }) => {
        expect(JSON.stringify(responseBody)).toContain("TENANT_OWNER_MANAGE_REQUIRED");
      });

    await request(server)
      .patch("/tenant-memberships/membership-operations-a")
      .set("Authorization", `Bearer ${tenantA}`)
      .send({ ...body, campusIds: [], expectedVersion: 2, scopeMode: "TENANT", staffRole: "TENANT_ADMIN" })
      .expect(200)
      .expect(({ body: responseBody }) => {
        expect(responseBody.employee.access).toMatchObject({ staffRole: "TENANT_ADMIN", version: 3 });
      });
  });
});
