import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { registerTestLoginIdentity, testLoginBody } from "../test-auth.js";

// DEC-20261102-04: GET /classes/:classId/overview is academic:manage only; tenant and campus scope answer 404.
describe("GET /classes/:classId/overview", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    for (const [id, scopeMode, campusIds] of [
      ["ops-tenant", "TENANT", []],
      ["ops-main", "CAMPUSES", ["campus-main"]],
      ["ops-other", "CAMPUSES", ["campus-other"]],
    ] as const) {
      upsertInMemoryAuthUser({
        id: `user-class-overview-${id}`, email: `class-overview-${id}@example.test`, name: "Class Overview Probe", password: "password",
        tenantId: "tenant-a", roles: ["OPERATIONS_STAFF"],
        membership: {
          id: `membership-class-overview-${id}`, staffRole: "OPERATIONS_STAFF", hasTeacherPersona: false, hasStudentPersona: false,
          version: 1, scopeMode, campusIds: [...campusIds],
        },
      });
      registerTestLoginIdentity(`class-overview-${id}@example.test`, { tenantSlug: "dna-egitim" });
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    server = app.getHttpServer() as Parameters<typeof request>[0];
    const logins: Record<string, string> = {
      admin: "admin-a@example.test",
      adminB: "admin-b@example.test",
      assistant: "assistant-a@example.test",
      teacher: "teacher-a@example.test",
      student: "student-a@example.test",
      guardian: "guardian-a@example.test",
      opsTenant: "class-overview-ops-tenant@example.test",
      opsMain: "class-overview-ops-main@example.test",
      opsOther: "class-overview-ops-other@example.test",
    };
    for (const [probe, email] of Object.entries(logins)) {
      const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
      tokens[probe] = (response.body as { accessToken: string }).accessToken;
    }
  });

  afterAll(async () => {
    await app?.close();
    resetInMemoryAuthUsers();
  });

  const get = (probe: string, classId: string) =>
    request(server).get(`/classes/${classId}/overview`).set("Authorization", `Bearer ${tokens[probe]}`);

  it("returns counts to academic:manage roles", async () => {
    for (const probe of ["admin", "assistant", "opsTenant", "opsMain"]) {
      const response = await get(probe, "class-a").expect(200);
      // The bare test app has no response envelope interceptor (configureApiApp adds it in production).
      const body = response.body as Record<string, unknown>;
      expect(body).toMatchObject({
        classId: "class-a",
        rosterCount: 0,
        homework: { openCount: 0, waitingSubmissionCount: 0 },
        gradeEntry: { assessmentCount: 0, missingEntryAssessmentCount: 0, unpublishedDraftAssessmentCount: 0 },
        teacherAssignments: [],
      });
      expect(body).not.toHaveProperty("rollCall");
    }
  });

  it("rejects roles without academic:manage at the capability guard", async () => {
    for (const probe of ["teacher", "student", "guardian"]) {
      const response = await get(probe, "class-a").expect(403);
      expect((response.body as { error?: { code?: string } }).error?.code).toBe("FORBIDDEN");
    }
  });

  it("answers 404 for another tenant's class, an unknown id and a class outside the campus scope", async () => {
    await get("admin", "class-b").expect(404);
    await get("admin", "class-missing").expect(404);
    await get("adminB", "class-a").expect(404);
    await get("adminB", "class-b").expect(200);
    await get("opsOther", "class-a").expect(404);
  });
});
