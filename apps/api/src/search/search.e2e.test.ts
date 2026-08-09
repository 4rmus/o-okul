import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { AuthService } from "../auth/auth.service.js";
import { type GuardianStudentStore, guardianStudentStoreToken } from "../school/guardian-student-store.js";
import { type TeacherStore, teacherStoreToken } from "../school/teacher-store.js";
import { registerTestLoginIdentity, testLoginBody } from "../test-auth.js";

describe("Global search API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAAccessToken: string;
  let tenantBAccessToken: string;
  let ownerAccessToken: string;
  let assistantAccessToken: string;
  let operationsAccessToken: string;
  let campusOperationsAccessToken: string;
  let financeAccessToken: string;
  let teacherAAccessToken: string;
  let studentAAccessToken: string;
  let guardianAAccessToken: string;
  let systemAccessToken: string;
  let hiddenClassId: string;
  let hiddenStudentId: string;
  let hiddenGuardianId: string;

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    registerStaffUser("owner-search@example.test", "user-owner-search", "TENANT_OWNER");
    registerStaffUser("operations-search@example.test", "user-operations-search", "OPERATIONS_STAFF");
    registerStaffUser(
      "campus-operations-search@example.test",
      "user-campus-operations-search",
      "OPERATIONS_STAFF",
      { scopeMode: "CAMPUSES", campusIds: ["campus-main"] },
    );
    registerStaffUser("finance-search@example.test", "user-finance-search", "FINANCE_STAFF");
    upsertInMemoryAuthUser({
      id: "user-search-dual",
      email: "dual-search@example.test",
      name: "Search Dual Persona",
      password: "password",
      tenantId: "tenant-a",
      roles: ["FINANCE_STAFF", "TEACHER"],
      membership: {
        id: "membership-search-dual",
        staffRole: "FINANCE_STAFF",
        hasTeacherPersona: true,
        hasStudentPersona: false,
        version: 1,
        scopeMode: "TENANT",
        campusIds: [],
      },
    });
    registerTestLoginIdentity("dual-search@example.test", { tenantSlug: "dna-egitim" });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    await app.get<TeacherStore>(teacherStoreToken).create({
      tenantId: "tenant-a",
      firstName: "Gizli",
      lastName: "Persona",
      branch: "Fen",
      userId: "user-search-dual",
    });

    tenantAAccessToken = await login("admin-a@example.test");
    tenantBAccessToken = await login("admin-b@example.test");
    ownerAccessToken = await login("owner-search@example.test");
    assistantAccessToken = await login("assistant-a@example.test");
    operationsAccessToken = await login("operations-search@example.test");
    campusOperationsAccessToken = await login("campus-operations-search@example.test");
    financeAccessToken = await login("finance-search@example.test");
    teacherAAccessToken = await login("teacher-a@example.test");
    studentAAccessToken = await login("student-a@example.test");
    guardianAAccessToken = await login("guardian-a@example.test");
    systemAccessToken = await login("system@example.test");

    hiddenClassId = (await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Gizli 9-Z", section: "Z" })
      .expect(201)).body.id as string;
    hiddenStudentId = (await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Gizli", lastName: "Ogrenci", classId: hiddenClassId })
      .expect(201)).body.id as string;
    hiddenGuardianId = (await request(server)
      .post("/guardians")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Gizli", lastName: "Kisi", phone: "5000000099" })
      .expect(201)).body.id as string;
    await request(server)
      .post(`/guardians/${hiddenGuardianId}/students`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ studentId: hiddenStudentId })
      .expect(201);

    const outOfScopeCampusId = (await request(server)
      .post("/campuses")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Uzak Kampus", code: "UZK" })
      .expect(201)).body.id as string;
    const outOfScopeClassId = (await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Uzak 9-Y", campusId: outOfScopeCampusId, section: "Y" })
      .expect(201)).body.id as string;
    const outOfScopeStudentId = (await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Uzak", lastName: "Ogrenci", classId: outOfScopeClassId })
      .expect(201)).body.id as string;
    await request(server)
      .patch(`/students/${outOfScopeStudentId}/profile`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ nationalId: "10000002362" })
      .expect(200);
    const outOfScopeGuardianId = (await request(server)
      .post("/guardians")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Uzak", lastName: "Kisi" })
      .expect(201)).body.id as string;
    await request(server)
      .post(`/guardians/${outOfScopeGuardianId}/students`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ studentId: outOfScopeStudentId })
      .expect(201);
    const outOfScopeTeacherId = (await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Uzak", lastName: "Personel", branch: "Fen" })
      .expect(201)).body.id as string;
    await request(server)
      .post(`/teachers/${outOfScopeTeacherId}/assignments`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ classId: outOfScopeClassId, role: "CLASS_TEACHER" })
      .expect(201);

    await request(server)
      .patch("/students/student-a/profile")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ nationalId: "10000002430", phone: "5551234567", email: "ada@example.test" })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    resetInMemoryAuthUsers();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  function registerStaffUser(
    email: string,
    id: string,
    staffRole: "TENANT_OWNER" | "OPERATIONS_STAFF" | "FINANCE_STAFF",
    scope: { scopeMode: "TENANT" | "CAMPUSES"; campusIds: string[] } = { scopeMode: "TENANT", campusIds: [] },
  ) {
    upsertInMemoryAuthUser({
      id,
      email,
      name: `Search ${staffRole}`,
      password: "password",
      tenantId: "tenant-a",
      roles: [staffRole],
      membership: {
        id: `membership-${id}`,
        staffRole,
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 1,
        scopeMode: scope.scopeMode,
        campusIds: scope.campusIds,
      },
    });
    registerTestLoginIdentity(email, { tenantSlug: "dna-egitim" });
  }

  it("kurum kullanıcısı öğrenci, öğretmen, veli ve sınıf sonuçlarını dar DTO ile arar", async () => {
    await request(server)
      .get("/search")
      .query({ q: "Ada", limit: "5" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            href: "/kurum/ogrenciler/student-a",
            id: "student-a",
            title: "Ada A",
            type: "students",
          }),
        ]);
        expect(JSON.stringify(body)).not.toContain("tenant-a");
        expect(JSON.stringify(body)).not.toContain("student-tenant-a");
        expect(JSON.stringify(body)).not.toContain("5551234567");
        expect(JSON.stringify(body)).not.toContain("ada@example.test");
        expect(JSON.stringify(body)).not.toContain("10000002430");
      });

    await request(server)
      .get("/search")
      .query({ q: "Ogretmen" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({ href: "/kurum/ogretmenler/teacher-a", title: "Ayse Ogretmen", type: "teachers" }),
        ]);
      });

    await request(server)
      .get("/search")
      .query({ q: "Veli", types: "guardians" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({ href: "/kurum/veliler/guardian-a", title: expect.stringMatching(/Veli$/), type: "guardians" }),
        ]);
        expect(JSON.stringify(body)).not.toContain("5000000001");
      });

    await request(server)
      .get("/search")
      .query({ q: "8-A", types: "classes" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({ href: "/kurum/siniflar/class-a", title: "8-A", type: "classes" }),
        ]);
      });
  });

  it("types ve limit parametrelerini uygular", async () => {
    await request(server)
      .get("/search")
      .query({ q: "A", types: "students", limit: "1" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(400);

    await request(server)
      .get("/search")
      .query({ q: "Ada", types: "students", limit: "1" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({ id: "student-a", type: "students" });
      });
  });

  it("exact search capability sahibi kurum rolleri ve öğretmen erişebilir", async () => {
    for (const token of [ownerAccessToken, tenantAAccessToken, assistantAccessToken, operationsAccessToken, teacherAAccessToken]) {
      await request(server)
        .get("/search")
        .query({ q: "Ada", types: "students" })
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
    }
  });

  it("tenant sınırı ve öğretmen kapsamını korur", async () => {
    await request(server)
      .get("/search")
      .query({ q: "Ada" })
      .set("Authorization", `Bearer ${tenantBAccessToken}`)
      .expect(200, []);

    await request(server)
      .get("/search")
      .query({ q: "Bora" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200, []);

    await request(server)
      .get("/search")
      .query({ q: "Ada", types: "students" })
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            href: "/ogretmen/ogrenci-takibi?studentId=student-a",
            id: "student-a",
            type: "students",
          }),
        ]);
      });

    await request(server)
      .get("/search")
      .query({ q: "Bora", types: "students,guardians" })
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200, []);

    await request(server)
      .get("/search")
      .query({ q: "Gizli", types: "students,guardians,classes,teachers" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: hiddenStudentId, type: "students" }),
          expect.objectContaining({ id: hiddenGuardianId, type: "guardians" }),
          expect.objectContaining({ id: hiddenClassId, type: "classes" }),
          expect.objectContaining({ title: "Gizli Persona", type: "teachers" }),
        ]));
      });

    await request(server)
      .get("/search")
      .query({ q: "Gizli", types: "students,guardians,classes,teachers" })
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200, []);
  });

  it("kampüs kapsamlı operasyon rolü yalnız bağlı kampüs sonuçlarını görür", async () => {
    for (const [query, type] of [
      ["Ada", "students"],
      ["8-A", "classes"],
      ["Ogretmen", "teachers"],
      ["Veli", "guardians"],
    ]) {
      await request(server)
        .get("/search")
        .query({ q: query, types: type })
        .set("Authorization", `Bearer ${campusOperationsAccessToken}`)
        .expect(200)
        .expect(({ body }) => {
          expect(body).not.toEqual([]);
        });
    }

    await request(server)
      .get("/search")
      .query({ q: "Uzak", types: "students,guardians,classes,teachers" })
      .set("Authorization", `Bearer ${campusOperationsAccessToken}`)
      .expect(200, []);
  });

  it("aktif persona capability'sini ayırır ve switch eski staff session'ını kapatır", async () => {
    const loginResponse = await request(server)
      .post("/auth/login")
      .send(testLoginBody("dual-search@example.test"))
      .expect(200);
    const staff = loginResponse.body as {
      accessToken: string;
      session: {
        id: string;
        userId: string;
        tenantId: string;
        membershipId: string;
        activePersona: "STAFF";
        membershipVersion: number;
        roles: string[];
      };
    };

    await request(server)
      .get("/search")
      .query({ q: "Ada" })
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .expect(403);

    const teacher = await app.get(AuthService).switchPersona({
      userId: staff.session.userId,
      sessionId: staff.session.id,
      tenantId: staff.session.tenantId,
      membershipId: staff.session.membershipId,
      activePersona: staff.session.activePersona,
      membershipVersion: staff.session.membershipVersion,
      roles: staff.session.roles,
      bypassRls: false,
    }, "TEACHER");

    await request(server)
      .get("/search")
      .query({ q: "Gizli", types: "teachers" })
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ title: "Gizli Persona", type: "teachers" })]);
      });

    await request(server)
      .get("/search")
      .query({ q: "Ada" })
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .expect(401);
  });

  it("PII pattern aramasını öğretmene açmaz ve response içinde PII döndürmez", async () => {
    await request(server)
      .get("/search")
      .query({ q: "10000002430", types: "students" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: "student-a", title: "Ada A", type: "students" })]);
        expect(JSON.stringify(body)).not.toContain("10000002430");
      });

    await request(server)
      .get("/search")
      .query({ q: "10000002430", types: "students" })
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200, []);

    for (const nationalId of ["10000002362", "10000000146"]) {
      await request(server)
        .get("/search")
        .query({ q: nationalId, types: "students" })
        .set("Authorization", `Bearer ${campusOperationsAccessToken}`)
        .expect(200, []);
    }

    const guardianStudentStore = vi.spyOn(app.get<GuardianStudentStore>(guardianStudentStoreToken), "listByStudentIds");
    guardianStudentStore.mockClear();
    await request(server)
      .get("/search")
      .query({ q: "5000000099", types: "guardians" })
      .set("Authorization", `Bearer ${campusOperationsAccessToken}`)
      .expect(200, []);
    expect(guardianStudentStore).toHaveBeenCalledTimes(1);

    guardianStudentStore.mockClear();
    await request(server)
      .get("/search")
      .query({ q: "5000000088", types: "guardians" })
      .set("Authorization", `Bearer ${campusOperationsAccessToken}`)
      .expect(200, []);
    expect(guardianStudentStore).toHaveBeenCalledTimes(1);
    guardianStudentStore.mockRestore();

    await request(server)
      .get("/search")
      .query({ q: "5000000001", types: "guardians" })
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200, []);
  });

  it("yetkisiz roller, system bypass denemesi ve geçersiz query değerlerini reddeder", async () => {
    for (const token of [financeAccessToken, studentAAccessToken, guardianAAccessToken, systemAccessToken]) {
      await request(server)
        .get("/search")
        .query({ q: "Ada" })
        .set("Authorization", `Bearer ${token}`)
        .expect(403);
    }

    await request(server)
      .get("/search")
      .query({ q: "Ada" })
      .set("Authorization", `Bearer ${systemAccessToken}`)
      .set("x-rls-bypass-reason", "Gate A search isolation negative")
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe("RLS_BYPASS_ROUTE_NOT_ALLOWED");
      });

    await request(server)
      .get("/search")
      .query({ q: "Ada", types: "unknown" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(400);

    await request(server)
      .get("/search")
      .query({ q: "Ada", limit: "0" })
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(400);
  });
});
