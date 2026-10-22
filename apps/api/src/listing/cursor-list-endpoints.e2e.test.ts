import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers } from "../auth/auth-user-store.js";
import { apiPrefix, configureApiApp } from "../http/configure-api-app.js";
import { type IdentityInvitationStore, identityInvitationStoreToken } from "../identity-invitation/identity-invitation-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import { testLoginBody } from "../test-auth.js";

// GET /identity-invitations, /tenant-users and /students (cursor mode) follow the GET /employees cursor contract:
// `data` + `meta.nextCursor/previousCursor`, a cursor bound to tenant + filters + sort, and 422 for the retired `page`.
describe("Cursor list endpoints", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAToken: string;
  let tenantBToken: string;

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApiApp(app);
    await app.listen(0, "127.0.0.1");
    server = app.getHttpServer() as Parameters<typeof request>[0];

    const invitations = app.get<IdentityInvitationStore>(identityInvitationStoreToken);
    const invitationBase = { role: "TEACHER" as const, tokenHash: "hash", expiresAt: "2099-01-01T00:00:00.000Z" };
    for (const index of [1, 2, 3]) {
      await invitations.create({
        ...invitationBase,
        id: `cursor-invitation-${index}`,
        tenantId: "tenant-a",
        subjectType: "TEACHER",
        subjectId: `cursor-teacher-${index}`,
        name: `Cursor Öğretmen ${index}`,
        email: `cursor-teacher-${index}@example.test`,
      });
    }
    await invitations.create({
      ...invitationBase,
      id: "cursor-invitation-b",
      tenantId: "tenant-b",
      subjectType: "TEACHER",
      subjectId: "cursor-teacher-b",
      name: "Cursor B",
    });

    const students = app.get<StudentStore>(studentStoreToken);
    for (const [firstName, lastName] of [["CEM", "CURSOR"], ["DENİZ", "DURUM"], ["ECE", "EKİN"]] as const) {
      await students.create({ tenantId: "tenant-a", firstName, lastName, status: "ACTIVE" });
    }

    tenantAToken = await login("admin-a@example.test");
    tenantBToken = await login("admin-b@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  const endpoints = [
    { path: "identity-invitations", query: { subjectType: "TEACHER", sort: "createdAt" }, changedFilter: { status: "PENDING" } },
    { path: "tenant-users", query: { sort: "email" }, changedFilter: { q: "admin" } },
    { path: "students", query: { sort: "lastName" }, changedFilter: { status: "ACTIVE" } },
  ] as const;

  for (const endpoint of endpoints) {
    it(`${endpoint.path}: ileri/geri cursor, tenant ve filtre bağı, legacy page reddi`, async () => {
      const all = await list(endpoint.path, { ...endpoint.query, limit: 100 }, tenantAToken).expect(200);
      const allIds = (all.body.data as Array<{ id: string }>).map((record) => record.id);
      expect(allIds.length).toBeGreaterThanOrEqual(3);
      expect(all.body.meta).toMatchObject({ limit: 100 });
      expect(all.body.meta.nextCursor).toBeUndefined();

      const pagedIds: string[] = [];
      const pageCursors: Array<string | undefined> = [];
      let cursor: string | undefined;
      do {
        const page = await list(endpoint.path, { ...endpoint.query, limit: 1, ...(cursor ? { cursor } : {}) }, tenantAToken).expect(200);
        expect(page.body.data).toHaveLength(1);
        pagedIds.push(page.body.data[0].id);
        pageCursors.push(page.body.meta.previousCursor);
        cursor = page.body.meta.nextCursor;
      } while (cursor);
      expect(pagedIds).toEqual(allIds);

      const lastPreviousCursor = pageCursors.at(-1);
      expect(lastPreviousCursor).toEqual(expect.any(String));
      const back = await list(
        endpoint.path,
        { ...endpoint.query, limit: 1, cursor: lastPreviousCursor, direction: "previous" },
        tenantAToken,
      ).expect(200);
      expect(back.body.data.map((record: { id: string }) => record.id)).toEqual([allIds.at(-2)]);

      const first = await list(endpoint.path, { ...endpoint.query, limit: 1 }, tenantAToken).expect(200);
      const firstCursor = first.body.meta.nextCursor as string;
      const foreignTenant = await list(endpoint.path, { ...endpoint.query, limit: 1, cursor: firstCursor }, tenantBToken).expect(400);
      // The web recognises *_CURSOR_INVALID, drops the cursor and reloads the first page.
      expect(foreignTenant.body.error.code).toMatch(/_CURSOR_INVALID$/u);
      const tampered = Buffer.from(firstCursor, "base64url");
      tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0x01;
      const tamperedResponse = await list(endpoint.path, { ...endpoint.query, limit: 1, cursor: tampered.toString("base64url") }, tenantAToken)
        .expect(400);
      expect(tamperedResponse.body.error.code).toMatch(/_CURSOR_INVALID$/u);
      // The sealed cursor does not expose the boundary row (ADR-0009: no personal values in URLs).
      const boundaryId = first.body.data[0].id as string;
      expect(Buffer.from(firstCursor, "base64url").toString("latin1")).not.toContain(boundaryId);
      await list(endpoint.path, { ...endpoint.query, ...endpoint.changedFilter, limit: 1, cursor: firstCursor }, tenantAToken).expect(400);
      await list(endpoint.path, { ...endpoint.query, limit: 1, direction: "previous" }, tenantAToken).expect(422);
      await list(endpoint.path, { ...endpoint.query, page: 1, limit: 1 }, tenantAToken).expect(422);
      expect(JSON.stringify(all.body)).not.toContain("tenant-b");
    });
  }

  it("students: SQL registry araması ve toplam sayım cursor meta içinde döner", async () => {
    await list("students", { q: "deni", limit: 10 }, tenantAToken)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual([expect.objectContaining({ firstName: "DENİZ", tenantId: "tenant-a" })]);
        expect(body.meta).toEqual({ limit: 10, total: 1 });
      });
  });

  function list(path: string, query: Record<string, string | number | undefined>, token: string) {
    return request(server)
      .get(`/${apiPrefix}/${path}`)
      .query(query)
      .set("Authorization", `Bearer ${token}`);
  }

  async function login(email: string): Promise<string> {
    const response = await request(server)
      .post(`/${apiPrefix}/auth/login`)
      .send(testLoginBody(email))
      .expect(200);
    return response.body.data.accessToken as string;
  }
});
