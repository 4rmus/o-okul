import "reflect-metadata";
import { readFileSync } from "node:fs";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { registerTestLoginIdentity, testLoginBody } from "../test-auth.js";

// Legacy-role cutover for /me: every route carries one capability, and each persona portal (portal:student,
// portal:guardian, portal:teacher) admits only its own persona. The route list is read from the controller so a new
// /me route without a known capability fails here.
type Probe = "admin" | "assistant" | "ops" | "finance" | "teacher" | "student" | "guardian" | "system";
const allowed: Record<string, Probe[]> = {
  "account:self": ["admin", "assistant", "ops", "finance", "teacher", "student", "guardian", "system"],
  "setup:read": ["admin", "assistant", "ops"],
  "setup:manage": ["admin", "assistant", "ops"],
  "notification:device": ["admin", "assistant", "ops", "teacher", "student", "guardian"],
  "portal:student": ["student"],
  "portal:guardian": ["guardian"],
  "ward:read": ["guardian"],
  "portal:teacher": ["teacher"],
};

const routes: Array<{ method: "get" | "post" | "patch" | "delete"; path: string; capability: string }> = [];
const source = readFileSync("src/me/me.controller.ts", "utf8");
for (const match of source.matchAll(/@(Get|Post|Patch|Delete)\("([^"]*)"\)((?:\s*@[^\n]*\n)*?)\s*@RequireCapability\("([^"]+)"\)/g)) {
  routes.push({ method: match[1]!.toLowerCase() as "get", path: match[2]!, capability: match[4]! });
}
const unsafe = (route: { method: string; path: string }) => route.path === "password" || (route.method === "delete" && route.path.startsWith("sessions"));
const fill = (path: string) => "/me/" + path.replace(/:studentId/g, "student-a").replace(/:examId/g, "exam-a").replace(/:[a-zA-Z]+/g, "x");

describe("/me persona erişimi", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  const tokens = {} as Record<Probe, string>;

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    for (const [id, role] of [["ops", "OPERATIONS_STAFF"], ["finance", "FINANCE_STAFF"]] as const) {
      upsertInMemoryAuthUser({
        id: `user-me-${id}`, email: `me-${id}@example.test`, name: "Me Probe", password: "password", tenantId: "tenant-a", roles: [role],
        membership: { id: `membership-me-${id}`, staffRole: role, hasTeacherPersona: false, hasStudentPersona: false, version: 1, scopeMode: "TENANT", campusIds: [] },
      });
      registerTestLoginIdentity(`me-${id}@example.test`, { tenantSlug: "dna-egitim" });
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    server = app.getHttpServer() as Parameters<typeof request>[0];
    const logins: Record<Probe, string> = {
      admin: "admin-a@example.test", assistant: "assistant-a@example.test", ops: "me-ops@example.test", finance: "me-finance@example.test",
      teacher: "teacher-a@example.test", student: "student-a@example.test", guardian: "guardian-a@example.test", system: "system@example.test",
    };
    for (const [probe, email] of Object.entries(logins) as Array<[Probe, string]>) {
      const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
      tokens[probe] = (response.body as { accessToken: string }).accessToken;
    }
  });

  afterAll(async () => {
    await app?.close();
    resetInMemoryAuthUsers();
  });

  it("controller'daki her /me ucu bilinen tek bir capability taşır", () => {
    const decorated = [...source.matchAll(/@(Get|Post|Patch|Delete)\("/g)].length;
    expect(routes).toHaveLength(decorated);
    expect(routes.filter((route) => !(route.capability in allowed))).toEqual([]);
  });

  it("capability dışındaki her rol 403 alır, yetkili rol guard'a takılmaz", async () => {
    const mismatches: string[] = [];
    for (const route of routes.filter((candidate) => !unsafe(candidate))) {
      for (const probe of Object.keys(tokens) as Probe[]) {
        const call = request(server)[route.method](fill(route.path)).set("Authorization", `Bearer ${tokens[probe]}`);
        const response = route.method === "get" ? await call : await call.send({});
        // The capability guard answers 403 with error.code FORBIDDEN; service scope checks use their own codes.
        const guardRejected = response.status === 403 && (response.body as { error?: { code?: string } }).error?.code === "FORBIDDEN";
        const expectAllowed = allowed[route.capability]!.includes(probe);
        if (!expectAllowed && !guardRejected) mismatches.push(`${route.method} ${route.path} ${probe}: ${response.status} (guard 403 bekleniyordu)`);
        if (expectAllowed && guardRejected) mismatches.push(`${route.method} ${route.path} ${probe}: yetkili rol guard 403 aldı`);
      }
    }
    expect(mismatches).toEqual([]);
  }, 120000);
});
