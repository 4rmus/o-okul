import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { testLoginBody } from "../test-auth.js";

describe("Bulk guardian invitation API (KV-3)", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let adminToken: string;
  let teacherToken: string;
  let tenantBToken: string;

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    upsertInMemoryAuthUser({
      id: "user-tenant-a",
      email: "admin-a@example.test",
      name: "Tenant A Admin",
      password: "password",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membership: {
        id: "membership-tenant-a-admin",
        staffRole: "TENANT_ADMIN",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 2,
        scopeMode: "TENANT",
        campusIds: [],
      },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    server = app.getHttpServer() as Parameters<typeof request>[0];
    adminToken = await login("admin-a@example.test");
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
      .send({ firstName: "TOPLU", lastName: `DAVET ${studentNo}`, studentNo, gradeLevelId: "grade-8" })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function createContact(studentId: string, body: Record<string, unknown>): Promise<string> {
    const response = await request(server)
      .post(`/students/${studentId}/contacts`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", `kv3-contact-${studentId}-${String(body.lastName)}`)
      .send(body)
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function guardianInvitations(): Promise<Array<{ subjectType: string; subjectId: string }>> {
    const response = await request(server).get("/identity-invitations").set("Authorization", `Bearer ${adminToken}`).expect(200);
    return (response.body as Array<{ subjectType: string; subjectId: string }>).filter((row) => row.subjectType === "GUARDIAN");
  }

  it("LEGAL_GUARDIAN iletişiminden tek veli hesabı ve davet üretir, tekrar gönderimde ikinci davet açmaz", async () => {
    const withEmail = await createStudent("kv3-1");
    const noEmail = await createStudent("kv3-2");
    const sibling = await createStudent("kv3-3");
    const noGuardian = await createStudent("kv3-4");
    const legalContactId = await createContact(withEmail, {
      firstName: "Veli", lastName: "Yasal", relationType: "LEGAL_GUARDIAN", email: "kv3.veli@example.test", phone: "5551000001",
    });
    await createContact(withEmail, { firstName: "Anne", lastName: "Iletisim", relationType: "MOTHER", email: "kv3.anne@example.test" });
    await createContact(noEmail, { firstName: "Telefon", lastName: "Yalniz", relationType: "LEGAL_GUARDIAN", phone: "5551000002" });
    await createContact(sibling, { firstName: "Veli", lastName: "Kardes", relationType: "LEGAL_GUARDIAN", email: "kv3.veli@example.test" });
    await createContact(noGuardian, { firstName: "Baba", lastName: "Iletisim", relationType: "FATHER", email: "kv3.baba@example.test" });
    const invitationsBefore = await guardianInvitations();
    const body = { studentIds: [withEmail, noEmail, sibling, noGuardian] };

    await request(server)
      .post("/students/guardian-invitations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(body)
      .expect(400);
    await request(server)
      .post("/students/guardian-invitations")
      .set("Authorization", `Bearer ${teacherToken}`)
      .set("Idempotency-Key", "kv3-guardian-invite-teacher")
      .send(body)
      .expect(403);
    await request(server)
      .post("/students/guardian-invitations")
      .set("Authorization", `Bearer ${tenantBToken}`)
      .set("Idempotency-Key", "kv3-guardian-invite-tenant-b")
      .send(body)
      .expect(403);
    expect(await guardianInvitations()).toHaveLength(invitationsBefore.length);

    const first = await request(server)
      .post("/students/guardian-invitations")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "kv3-guardian-invite-a")
      .send(body)
      .expect(201);
    expect(first.body).toMatchObject({ createdCount: 1, alreadyExistsCount: 0, skippedCount: 3 });
    const results = first.body.results as Array<{ studentId: string; status: string; reason?: string; guardianId?: string; invitationId?: string }>;
    expect(results).toEqual([
      { studentId: withEmail, contactId: legalContactId, status: "CREATED", guardianId: expect.any(String), invitationId: expect.any(String) },
      { studentId: noEmail, contactId: expect.any(String), status: "SKIPPED", reason: "EMAIL_MISSING" },
      { studentId: sibling, contactId: expect.any(String), status: "SKIPPED", reason: "EMAIL_IN_USE" },
      { studentId: noGuardian, status: "SKIPPED", reason: "NO_LEGAL_GUARDIAN_CONTACT" },
    ]);
    const serialized = JSON.stringify(first.body);
    for (const pii of ["kv3.veli@example.test", "5551000001", "Yasal", "Veli"]) expect(serialized).not.toContain(pii);

    const guardianId = results[0]!.guardianId!;
    const invitationsAfterFirst = await guardianInvitations();
    expect(invitationsAfterFirst.length).toBe(invitationsBefore.length + 1);
    expect(invitationsAfterFirst.filter((row) => row.subjectId === guardianId)).toHaveLength(1);

    await request(server)
      .get(`/students/${withEmail}/contacts`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body: contacts }) => {
        expect(contacts).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: legalContactId, guardianId, canReceiveSms: false, canReceiveAnnouncements: false, canReceiveFinance: false }),
        ]));
      });
    await request(server)
      .get(`/guardians/${guardianId}/students`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body: links }) => {
        expect(links).toEqual([expect.objectContaining({
          studentId: withEmail, canViewFinance: false, canReceiveSms: false, canReceiveAnnouncements: false, canOpenSupportTickets: false,
        })]);
      });

    const replay = await request(server)
      .post("/students/guardian-invitations")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "kv3-guardian-invite-a")
      .send(body)
      .expect(201);
    expect(replay.body).toEqual(first.body);

    const again = await request(server)
      .post("/students/guardian-invitations")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "kv3-guardian-invite-b")
      .send({ studentIds: [withEmail] })
      .expect(201);
    expect(again.body).toEqual({
      createdCount: 0,
      alreadyExistsCount: 1,
      skippedCount: 0,
      results: [{ studentId: withEmail, contactId: legalContactId, status: "ALREADY_EXISTS", guardianId }],
    });
    expect(await guardianInvitations()).toHaveLength(invitationsAfterFirst.length);

    await request(server)
      .get("/audit-logs")
      .query({ action: "student_contact.guardian_invited" })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body: logs }) => {
        const rows = (Array.isArray(logs) ? logs : (logs as { items?: unknown[] }).items ?? []) as Array<{ action: string; entityId: string }>;
        expect(rows.some((row) => row.action === "student_contact.guardian_invited" && row.entityId === legalContactId)).toBe(true);
        expect(JSON.stringify(rows)).not.toContain("kv3.veli@example.test");
      });
  });
});
