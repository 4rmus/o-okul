import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { registerTestLoginIdentity, testLoginBody } from "../test-auth.js";

describe("Manual StudentContact → existing guardian link API (KV-3b)", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let adminToken: string;
  let campusAdminToken: string;
  let teacherToken: string;
  let tenantBToken: string;

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    for (const [id, email, scopeMode, campusIds] of [
      ["user-kv3b-admin", "kv3b-admin@example.test", "TENANT", []],
      ["user-kv3b-campus", "kv3b-campus@example.test", "CAMPUSES", ["campus-main"]],
    ] as const) {
      upsertInMemoryAuthUser({
        id,
        email,
        name: "KV-3b Admin",
        password: "password",
        tenantId: "tenant-a",
        roles: ["TENANT_ADMIN"],
        membership: {
          id: `membership-${id}`,
          staffRole: "TENANT_ADMIN",
          hasTeacherPersona: false,
          hasStudentPersona: false,
          version: 2,
          scopeMode,
          campusIds: [...campusIds],
        },
      });
      registerTestLoginIdentity(email, { tenantSlug: "dna-egitim" });
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    server = app.getHttpServer() as Parameters<typeof request>[0];
    adminToken = await login("kv3b-admin@example.test");
    campusAdminToken = await login("kv3b-campus@example.test");
    teacherToken = await login("teacher-a@example.test");
    tenantBToken = await login("admin-b@example.test");
  });

  afterAll(async () => {
    await app.close();
    resetInMemoryAuthUsers();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  async function createStudent(studentNo: string): Promise<string> {
    const response = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "ELLE", lastName: `BAG ${studentNo}`, studentNo, gradeLevelId: "grade-8" })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function createContact(studentId: string, body: Record<string, unknown>): Promise<string> {
    const response = await request(server)
      .post(`/students/${studentId}/contacts`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", `kv3b-contact-${studentId}-${String(body.lastName)}`)
      .send(body)
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function createGuardian(lastName: string, phone: string): Promise<string> {
    const response = await request(server)
      .post("/guardians")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Mevcut", lastName, phone })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  function link(token: string, studentId: string, contactId: string, guardianId: string, key?: string) {
    const call = request(server)
      .put(`/students/${studentId}/contacts/${contactId}/guardian`)
      .set("Authorization", `Bearer ${token}`)
      .send({ guardianId });
    return key ? call.set("Idempotency-Key", key) : call;
  }

  function unlink(token: string, studentId: string, contactId: string, key?: string) {
    const call = request(server)
      .delete(`/students/${studentId}/contacts/${contactId}/guardian`)
      .set("Authorization", `Bearer ${token}`);
    return key ? call.set("Idempotency-Key", key) : call;
  }

  async function guardianLinks(guardianId: string) {
    const response = await request(server).get(`/guardians/${guardianId}/students`).set("Authorization", `Bearer ${adminToken}`).expect(200);
    return response.body as Array<Record<string, unknown>>;
  }

  async function contactGuardianId(studentId: string, contactId: string): Promise<string | undefined> {
    const response = await request(server).get(`/students/${studentId}/contacts`).set("Authorization", `Bearer ${adminToken}`).expect(200);
    return (response.body as Array<{ id: string; guardianId?: string }>).find((row) => row.id === contactId)?.guardianId;
  }

  it("yönetici iletişimi mevcut veliye elle bağlar, bağı idempotent tutar ve kaldırır", async () => {
    const studentId = await createStudent("kv3b-1");
    const siblingId = await createStudent("kv3b-2");
    const contactId = await createContact(studentId, {
      firstName: "Kardes", lastName: "Velisi", relationType: "LEGAL_GUARDIAN", email: "kv3b.veli@example.test", phone: "5551000101",
    });
    const motherId = await createContact(studentId, { firstName: "Anne", lastName: "Iletisim", relationType: "MOTHER" });
    const siblingContactId = await createContact(siblingId, { firstName: "Baska", lastName: "Kisi", relationType: "LEGAL_GUARDIAN" });
    const guardianId = await createGuardian("Kv3bBir", "5551000102");
    const otherGuardianId = await createGuardian("Kv3bIki", "5551000103");

    // Idempotency-Key, RBAC, campus scope and tenant boundaries are checked before any write.
    await link(adminToken, studentId, contactId, guardianId).expect(400);
    await link(teacherToken, studentId, contactId, guardianId, "kv3b-link-teacher").expect(403);
    await link(campusAdminToken, studentId, contactId, guardianId, "kv3b-link-campus").expect(403);
    await link(tenantBToken, studentId, contactId, guardianId, "kv3b-link-tenant-b").expect((response) => {
      expect([403, 404]).toContain(response.status);
    });
    await link(adminToken, studentId, contactId, "guardian-b", "kv3b-link-cross-tenant-guardian").expect(422)
      .expect(({ body }) => expect(JSON.stringify(body)).toContain("STUDENT_CONTACT_GUARDIAN_NOT_FOUND"));
    await link(adminToken, studentId, contactId, "guardian-missing", "kv3b-link-missing-guardian").expect(422);
    await link(adminToken, siblingId, contactId, guardianId, "kv3b-link-wrong-student").expect(404);
    await link(adminToken, studentId, siblingContactId, guardianId, "kv3b-link-wrong-student-2").expect(404);
    await link(adminToken, studentId, motherId, guardianId, "kv3b-link-mother").expect(422);
    expect(await guardianLinks(guardianId)).toEqual([]);
    expect(await contactGuardianId(studentId, contactId)).toBeUndefined();

    const first = await link(adminToken, studentId, contactId, guardianId, "kv3b-link-a").expect(200);
    expect(first.body).toEqual({ studentId, contactId, guardianId, changed: true, guardianStudentCreated: true });
    for (const pii of ["kv3b.veli@example.test", "5551000101", "Velisi", "Kardes"]) expect(JSON.stringify(first.body)).not.toContain(pii);
    expect(await contactGuardianId(studentId, contactId)).toBe(guardianId);
    expect(await guardianLinks(guardianId)).toEqual([expect.objectContaining({
      studentId, canViewFinance: false, canReceiveSms: false, canReceiveAnnouncements: false, canOpenSupportTickets: false,
    })]);

    // Same key replays; a new key to the same guardian is a no-op; another guardian is a conflict.
    await link(adminToken, studentId, contactId, guardianId, "kv3b-link-a").expect(200).expect(({ body }) => expect(body).toEqual(first.body));
    await link(adminToken, studentId, contactId, guardianId, "kv3b-link-b").expect(200)
      .expect(({ body }) => expect(body).toEqual({ studentId, contactId, guardianId, changed: false, guardianStudentCreated: false }));
    await link(adminToken, studentId, contactId, otherGuardianId, "kv3b-link-other").expect(409);
    expect(await guardianLinks(otherGuardianId)).toEqual([]);

    await unlink(adminToken, studentId, contactId).expect(400);
    await unlink(campusAdminToken, studentId, contactId, "kv3b-unlink-campus").expect(403);
    await unlink(adminToken, siblingId, contactId, "kv3b-unlink-wrong-student").expect(404);
    await unlink(adminToken, studentId, contactId, "kv3b-unlink-a").expect(200)
      .expect(({ body }) => expect(body).toEqual({ studentId, contactId, changed: true, guardianStudentCreated: false }));
    await unlink(adminToken, studentId, contactId, "kv3b-unlink-b").expect(200)
      .expect(({ body }) => expect(body).toEqual({ studentId, contactId, changed: false, guardianStudentCreated: false }));
    expect(await contactGuardianId(studentId, contactId)).toBeUndefined();
    // Unlinking leaves the GuardianStudent link and its permissions as they were.
    expect(await guardianLinks(guardianId)).toEqual([expect.objectContaining({ studentId })]);

    // Re-linking to the other guardian is allowed once unlinked; an existing GuardianStudent is reused.
    await link(adminToken, studentId, contactId, otherGuardianId, "kv3b-link-c").expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ guardianId: otherGuardianId, changed: true, guardianStudentCreated: true }));
    await unlink(adminToken, studentId, contactId, "kv3b-unlink-c").expect(200);
    await link(adminToken, studentId, contactId, guardianId, "kv3b-link-d").expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ guardianId, changed: true, guardianStudentCreated: false }));

    await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body: logs }) => {
        const rows = (Array.isArray(logs) ? logs : (logs as { items?: unknown[] }).items ?? []) as Array<{ action: string; entityId: string }>;
        const actions = rows.filter((row) => row.entityId === contactId).map((row) => row.action);
        expect(actions).toEqual(expect.arrayContaining(["student_contact.guardian_linked", "student_contact.guardian_unlinked"]));
        expect(JSON.stringify(rows)).not.toContain("kv3b.veli@example.test");
      });
  });
});
