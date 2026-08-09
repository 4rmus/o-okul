import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { registerTestLoginIdentity, testLoginBody } from "../test-auth.js";

describe("Me setup readiness API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    registerOperationsUser("operations-tenant-setup@example.test", "operations-tenant-setup", "TENANT", []);
    registerOperationsUser("operations-campus-setup@example.test", "operations-campus-setup", "CAMPUSES", ["campus-main"]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
    for (const email of [
      "admin-a@example.test",
      "assistant-a@example.test",
      "teacher-a@example.test",
      "student-a@example.test",
      "system@example.test",
      "operations-tenant-setup@example.test",
      "operations-campus-setup@example.test",
    ]) {
      const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
      tokens.set(email, (response.body as { accessToken: string }).accessToken);
    }
  });

  afterAll(async () => {
    await app.close();
    resetInMemoryAuthUsers();
  });

  it("tenant query override'ını yok sayar ve yalnız PII-safe aggregate döndürür", async () => {
    const token = tokens.get("admin-a@example.test")!;
    const base = await request(server).get("/me/setup-readiness").set("Authorization", `Bearer ${token}`).expect(200);
    const overridden = await request(server).get("/me/setup-readiness?tenantId=tenant-b").set("Authorization", `Bearer ${token}`).expect(200);

    expect(overridden.body).toEqual(base.body);
    expect(base.body).toMatchObject({ totalCount: 7, steps: expect.any(Array) });
    expect(base.body.steps).toHaveLength(7);
    expect(JSON.stringify(base.body)).not.toMatch(/tenantId|firstName|lastName|email|phone|nationalId/i);
  });

  it("yalnız setup:manage rolleri açar", async () => {
    for (const email of ["admin-a@example.test", "assistant-a@example.test", "operations-tenant-setup@example.test"]) {
      await request(server).get("/me/setup-readiness").set("Authorization", `Bearer ${tokens.get(email)!}`).expect(200);
    }
    for (const email of ["teacher-a@example.test", "student-a@example.test", "system@example.test"]) {
      await request(server).get("/me/setup-readiness").set("Authorization", `Bearer ${tokens.get(email)!}`).expect(403);
    }
  });

  it("kampüs-kapsamlı operasyon rolüne tenant-geneli sayıları açmaz", async () => {
    await request(server)
      .get("/me/setup-readiness")
      .set("Authorization", `Bearer ${tokens.get("operations-campus-setup@example.test")!}`)
      .expect(403)
      .expect(({ body }) => expect(body.error?.code).toBe("SETUP_TENANT_SCOPE_REQUIRED"));
  });

  function registerOperationsUser(
    email: string,
    id: string,
    scopeMode: "TENANT" | "CAMPUSES",
    campusIds: string[],
  ) {
    upsertInMemoryAuthUser({
      id,
      email,
      name: "Setup Operations",
      password: "password",
      tenantId: "tenant-a",
      roles: ["OPERATIONS_STAFF"],
      membership: {
        id: `membership-${id}`,
        staffRole: "OPERATIONS_STAFF",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 1,
        scopeMode,
        campusIds,
      },
    });
    registerTestLoginIdentity(email, { tenantSlug: "dna-egitim" });
  }
});
