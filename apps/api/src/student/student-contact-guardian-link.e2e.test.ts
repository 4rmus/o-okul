import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { maskContactPhone } from "../privacy/contact-mask.js";
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
      .expect(({ body }) => expect(body).toEqual({ studentId, contactId, changed: true, guardianStudentCreated: false, guardianStudentRemoved: true }));
    await unlink(adminToken, studentId, contactId, "kv3b-unlink-b").expect(200)
      .expect(({ body }) => expect(body).toEqual({ studentId, contactId, changed: false, guardianStudentCreated: false, guardianStudentRemoved: false }));
    expect(await contactGuardianId(studentId, contactId)).toBeUndefined();
    // Product owner decision (2026-10-05): unlinking also cuts access, the GuardianStudent link is gone.
    expect(await guardianLinks(guardianId)).toEqual([]);

    // Re-linking to the other guardian is allowed once unlinked; the access link is opened again with permissions off.
    await link(adminToken, studentId, contactId, otherGuardianId, "kv3b-link-c").expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ guardianId: otherGuardianId, changed: true, guardianStudentCreated: true }));
    await unlink(adminToken, studentId, contactId, "kv3b-unlink-c").expect(200);
    await link(adminToken, studentId, contactId, guardianId, "kv3b-link-d").expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ guardianId, changed: true, guardianStudentCreated: true }));

    await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body: logs }) => {
        const rows = (Array.isArray(logs) ? logs : (logs as { items?: unknown[] }).items ?? []) as Array<{ action: string; entityId: string }>;
        const actions = rows.filter((row) => row.entityId === contactId).map((row) => row.action);
        expect(actions).toEqual(expect.arrayContaining(["student_contact.guardian_linked", "student_contact.guardian_unlinked"]));
        expect(rows.filter((row) => row.entityId === `${guardianId}:${studentId}`).map((row) => row.action)).toContain("guardian_student.unlinked");
        expect(JSON.stringify(rows)).not.toContain("kv3b.veli@example.test");
      });
  });

  it("bağ kaldırma, öğrencinin başka bir iletişim kaydı aynı veliye bağlıyken erişim bağını korur", async () => {
    const studentId = await createStudent("kv3b-3");
    const firstContactId = await createContact(studentId, { firstName: "Birinci", lastName: "TemsilciBir", relationType: "LEGAL_GUARDIAN" });
    const secondContactId = await createContact(studentId, { firstName: "Ikinci", lastName: "TemsilciIki", relationType: "LEGAL_GUARDIAN" });
    const guardianId = await createGuardian("Kv3bUc", "5551000104");

    await link(adminToken, studentId, firstContactId, guardianId, "kv3b-shared-link-1").expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ guardianStudentCreated: true }));
    await link(adminToken, studentId, secondContactId, guardianId, "kv3b-shared-link-2").expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ guardianStudentCreated: false }));

    await unlink(adminToken, studentId, firstContactId, "kv3b-shared-unlink-1").expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ changed: true, guardianStudentRemoved: false }));
    expect(await guardianLinks(guardianId)).toEqual([expect.objectContaining({ studentId })]);
    expect(await contactGuardianId(studentId, secondContactId)).toBe(guardianId);

    await unlink(adminToken, studentId, secondContactId, "kv3b-shared-unlink-2").expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ changed: true, guardianStudentRemoved: true }));
    expect(await guardianLinks(guardianId)).toEqual([]);
  });

  it("KV-3c: bağ kaldırma, guardian API'siyle önceden açılmış bağı ve izinlerini korur; veli öğrenciyi görmeye devam eder", async () => {
    const studentId = await createStudent("kv3c-1");
    const contactId = await createContact(studentId, { firstName: "Onceki", lastName: "BagVelisi", relationType: "LEGAL_GUARDIAN" });
    await request(server)
      .post("/guardians/guardian-a/students")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "kv3c-preexisting-link")
      .send({ studentId, canViewFinance: true, canReceiveAnnouncements: true })
      .expect(201);

    await link(adminToken, studentId, contactId, "guardian-a", "kv3c-link-preexisting").expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ changed: true, guardianStudentCreated: false }));
    await unlink(adminToken, studentId, contactId, "kv3c-unlink-preexisting").expect(200)
      .expect(({ body }) => expect(body).toEqual({ studentId, contactId, changed: true, guardianStudentCreated: false, guardianStudentRemoved: false }));
    expect(await contactGuardianId(studentId, contactId)).toBeUndefined();
    expect((await guardianLinks("guardian-a")).find((row) => row.studentId === studentId))
      .toMatchObject({ canViewFinance: true, canReceiveAnnouncements: true });

    const guardianToken = await login("guardian-a@example.test");
    const wards = await request(server).get("/me/guardian/students").set("Authorization", `Bearer ${guardianToken}`).expect(200);
    expect((wards.body as Array<{ id: string }>).map((ward) => ward.id)).toContain(studentId);
    await request(server).get(`/me/guardian/students/${studentId}/overview`).set("Authorization", `Bearer ${guardianToken}`).expect(200);
  });

  it("KV-3c R1: akışın açtığı bağ guardian API'siyle yeniden oluşturulur veya izni güncellenirse iletişim bağı kaldırma bağı ve izinleri korur", async () => {
    for (const adopt of ["create", "update"] as const) {
      const studentId = await createStudent(`kv3c-r1-${adopt}`);
      const contactId = await createContact(studentId, { firstName: "Akis", lastName: `Benimseme${adopt}`, relationType: "LEGAL_GUARDIAN" });
      await link(adminToken, studentId, contactId, "guardian-a", `kv3c-r1-link-${adopt}`).expect(200)
        .expect(({ body }) => expect(body).toMatchObject({ guardianStudentCreated: true }));
      if (adopt === "create") {
        await request(server)
          .post("/guardians/guardian-a/students")
          .set("Authorization", `Bearer ${adminToken}`)
          .set("Idempotency-Key", `kv3c-r1-api-${adopt}`)
          .send({ studentId })
          .expect(201);
      } else {
        await request(server)
          .patch(`/guardians/guardian-a/students/${studentId}`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ canViewFinance: true })
          .expect(200);
      }
      await unlink(adminToken, studentId, contactId, `kv3c-r1-unlink-${adopt}`).expect(200)
        .expect(({ body }) => expect(body).toMatchObject({ changed: true, guardianStudentRemoved: false }));
      expect((await guardianLinks("guardian-a")).find((row) => row.studentId === studentId))
        .toMatchObject({ canViewFinance: adopt === "update" });
    }
  });

  it("KV-3c R4: bağlı iletişim silinince akışın açtığı bağ kalkar ve veli öğrenciyi görmez; önceden var olan bağ korunur", async () => {
    const studentId = await createStudent("kv3c-r4-1");
    const contactId = await createContact(studentId, { firstName: "Silinen", lastName: "BagliIletisim", relationType: "LEGAL_GUARDIAN" });
    await link(adminToken, studentId, contactId, "guardian-a", "kv3c-r4-link").expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ guardianStudentCreated: true }));
    const guardianToken = await login("guardian-a@example.test");
    await request(server).get(`/me/guardian/students/${studentId}/overview`).set("Authorization", `Bearer ${guardianToken}`).expect(200);

    await request(server).delete(`/students/${studentId}/contacts/${contactId}`).set("Authorization", `Bearer ${adminToken}`).expect(204);
    expect((await guardianLinks("guardian-a")).some((row) => row.studentId === studentId)).toBe(false);
    const wards = await request(server).get("/me/guardian/students").set("Authorization", `Bearer ${guardianToken}`).expect(200);
    expect((wards.body as Array<{ id: string }>).map((ward) => ward.id)).not.toContain(studentId);
    await request(server).get(`/me/guardian/students/${studentId}/overview`).set("Authorization", `Bearer ${guardianToken}`).expect(403);

    const keptStudentId = await createStudent("kv3c-r4-2");
    const keptContactId = await createContact(keptStudentId, { firstName: "Silinen", lastName: "OncekiBag", relationType: "LEGAL_GUARDIAN" });
    await request(server)
      .post("/guardians/guardian-a/students")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "kv3c-r4-preexisting")
      .send({ studentId: keptStudentId, canViewFinance: true })
      .expect(201);
    await link(adminToken, keptStudentId, keptContactId, "guardian-a", "kv3c-r4-link-pre").expect(200);
    await request(server).delete(`/students/${keptStudentId}/contacts/${keptContactId}`).set("Authorization", `Bearer ${adminToken}`).expect(204);
    expect((await guardianLinks("guardian-a")).find((row) => row.studentId === keptStudentId)).toMatchObject({ canViewFinance: true });
    await request(server).get(`/me/guardian/students/${keptStudentId}/overview`).set("Authorization", `Bearer ${guardianToken}`).expect(200);

    await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body: logs }) => {
        const rows = (Array.isArray(logs) ? logs : (logs as { items?: unknown[] }).items ?? []) as Array<{ action: string; entityId: string }>;
        expect(rows.some((row) => row.entityId === `guardian-a:${studentId}` && row.action === "guardian_student.unlinked")).toBe(true);
        expect(rows.some((row) => row.entityId === `guardian-a:${keptStudentId}` && row.action === "guardian_student.unlinked")).toBe(false);
      });
  });

  it("KV-3c: personel üyeliği sona eren personel+veli kullanıcısı veli olarak girer, personel erişimi kesilir", async () => {
    upsertInMemoryAuthUser({
      id: "user-operations-a",
      email: "kv3c-staff-parent@example.test",
      name: "Biten Personel Veli",
      password: "password",
      tenantId: "tenant-a",
      roles: ["OPERATIONS_STAFF"],
      membership: {
        id: "membership-operations-a",
        staffRole: "OPERATIONS_STAFF",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 1,
        scopeMode: "TENANT",
        campusIds: [],
      },
    });
    registerTestLoginIdentity("kv3c-staff-parent@example.test", { tenantSlug: "dna-egitim" });
    const studentId = await createStudent("kv3c-2");
    const contactId = await createContact(studentId, { firstName: "Biten", lastName: "PersonelVeli", relationType: "LEGAL_GUARDIAN" });
    const linked = await request(server)
      .put(`/students/${studentId}/contacts/${contactId}/guardian`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "kv3c-staff-parent-link")
      .send({ userId: "user-operations-a" })
      .expect(200);
    expect(linked.body).toMatchObject({ guardianRoleAdded: true });
    const guardianId = (linked.body as { guardianId: string }).guardianId;
    const staffToken = await login("kv3c-staff-parent@example.test");
    await request(server).get("/me/profile").set("Authorization", `Bearer ${staffToken}`).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ activePersona: "STAFF", availablePersonas: ["STAFF", "GUARDIAN"] }));

    const ended = await request(server)
      .patch("/tenant-memberships/membership-operations-a")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        campusIds: [], endedReason: "İşten ayrıldı", expectedVersion: 1, hasTeacherPersona: false,
        scopeMode: "TENANT", staffRole: "OPERATIONS_STAFF", status: "ENDED",
      })
      .expect(200);
    // The account stays open for the guardian persona; only the staff membership ends.
    expect(ended.body).toMatchObject({ employee: { accountStatus: "ACTIVE", access: { status: "ENDED" } } });

    // The open staff session is gone; the next login is a guardian-only session.
    await request(server).get("/me/profile").set("Authorization", `Bearer ${staffToken}`).expect(401);
    const guardianToken = await login("kv3c-staff-parent@example.test");
    const profile = await request(server).get("/me/profile").set("Authorization", `Bearer ${guardianToken}`).expect(200);
    expect(profile.body).toMatchObject({ roles: ["GUARDIAN"], subjectType: "GUARDIAN", subjectId: guardianId });
    expect((profile.body as { availablePersonas?: string[] }).availablePersonas ?? []).not.toContain("STAFF");
    const wards = await request(server).get("/me/guardian/students").set("Authorization", `Bearer ${guardianToken}`).expect(200);
    expect((wards.body as Array<{ id: string }>).map((ward) => ward.id)).toEqual([studentId]);
    await request(server).get(`/students/${studentId}/contacts`).set("Authorization", `Bearer ${guardianToken}`).expect(403);
    await request(server).get("/employees").set("Authorization", `Bearer ${guardianToken}`).expect(403);
    await request(server)
      .post("/auth/persona/switch")
      .set("Authorization", `Bearer ${guardianToken}`)
      .set("Cookie", ["csrfToken=kv3c-csrf"])
      .set("X-CSRF-Token", "kv3c-csrf")
      .send({ activePersona: "STAFF" })
      .expect(401)
      .expect(({ body }) => expect(JSON.stringify(body)).toContain("PERSONA_SWITCH_UNAVAILABLE"));
    // The rejected switch leaves the guardian session usable.
    await request(server).get("/me/guardian/students").set("Authorization", `Bearer ${guardianToken}`).expect(200);
  });

  it("öğretmen/personel olan veli için ayrı hesap açılmaz; mevcut kullanıcıya GUARDIAN rolü eklenir ve bağ kaldırma erişimi keser", async () => {
    upsertInMemoryAuthUser({
      id: "user-kv3b-staff-parent",
      email: "kv3b-staff-parent@example.test",
      name: "Personel Veli",
      password: "password",
      tenantId: "tenant-a",
      roles: ["OPERATIONS_STAFF"],
      membership: {
        id: "membership-kv3b-staff-parent",
        staffRole: "OPERATIONS_STAFF",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 1,
        scopeMode: "TENANT",
        campusIds: [],
      },
    });
    registerTestLoginIdentity("kv3b-staff-parent@example.test", { tenantSlug: "dna-egitim" });
    const staffParentId = "user-kv3b-staff-parent";
    const studentId = await createStudent("kv3b-4");
    const siblingId = await createStudent("kv3b-5");
    const contactId = await createContact(studentId, {
      firstName: "Personel", lastName: "Veli", relationType: "LEGAL_GUARDIAN", email: "kv3b.personel@example.test", phone: "5551000105",
    });
    const siblingContactId = await createContact(siblingId, { firstName: "Personel", lastName: "Veli", relationType: "LEGAL_GUARDIAN", phone: "5551000106" });
    const mother = await createContact(studentId, { firstName: "Anne", lastName: "Kayit", relationType: "MOTHER" });
    const staleStaffToken = await login("kv3b-staff-parent@example.test");

    const linkUser = (cId: string, sId: string, userId: string, key: string) => request(server)
      .put(`/students/${sId}/contacts/${cId}/guardian`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", key)
      .send({ userId });

    // Explicit pick only; other-tenant, platform and student accounts are refused without revealing which one exists.
    await request(server).put(`/students/${studentId}/contacts/${contactId}/guardian`).set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "kv3b-user-both").send({ guardianId: "guardian-x", userId: staffParentId }).expect(422);
    for (const [userId, code] of [
      ["user-tenant-b", "STUDENT_CONTACT_USER_NOT_FOUND"],
      ["user-system", "STUDENT_CONTACT_USER_NOT_FOUND"],
      ["user-missing", "STUDENT_CONTACT_USER_NOT_FOUND"],
      ["student-tenant-a", "STUDENT_CONTACT_USER_NOT_ELIGIBLE"],
    ] as const) {
      await linkUser(contactId, studentId, userId, `kv3b-user-refused-${userId}`).expect(422)
        .expect(({ body }) => expect(JSON.stringify(body)).toContain(code));
    }
    await linkUser(mother, studentId, staffParentId, "kv3b-user-mother").expect(422);
    await request(server).put(`/students/${studentId}/contacts/${contactId}/guardian`).set("Authorization", `Bearer ${teacherToken}`)
      .set("Idempotency-Key", "kv3b-user-teacher").send({ userId: staffParentId }).expect(403);

    const first = await linkUser(contactId, studentId, staffParentId, "kv3b-user-link-a").expect(200);
    const guardianId = (first.body as { guardianId: string }).guardianId;
    expect(first.body).toEqual({
      studentId, contactId, guardianId: expect.any(String), changed: true,
      guardianStudentCreated: true, guardianCreated: true, guardianRoleAdded: true,
    });
    for (const pii of ["kv3b.personel@example.test", "5551000105", "Personel Veli"]) expect(JSON.stringify(first.body)).not.toContain(pii);
    expect(await guardianLinks(guardianId)).toEqual([expect.objectContaining({ studentId, canViewFinance: false, canReceiveSms: false })]);
    // Product owner decision (2026-10-05, ek): the empty Guardian.phone gets the contact phone (contact field only).
    const guardianPhoneMasked = async () => ((await request(server).get(`/guardians/${guardianId}`).set("Authorization", `Bearer ${adminToken}`)
      .expect(200)).body as { phoneMasked?: string }).phoneMasked;
    expect(await guardianPhoneMasked()).toBe(maskContactPhone("5551000105"));
    // Same user again is a no-op; a second child reuses the guardian profile and the role.
    await linkUser(contactId, studentId, staffParentId, "kv3b-user-link-b").expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ guardianId, changed: false, guardianCreated: false, guardianRoleAdded: false }));
    await linkUser(siblingContactId, siblingId, staffParentId, "kv3b-user-link-sibling").expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ guardianId, changed: true, guardianCreated: false, guardianRoleAdded: false }));
    // A phone already on the guardian is never overwritten by another contact's phone.
    expect(await guardianPhoneMasked()).toBe(maskContactPhone("5551000105"));

    // The membership change closes the open session; the next login keeps the staff workspace and offers GUARDIAN.
    await request(server).get("/me/profile").set("Authorization", `Bearer ${staleStaffToken}`).expect(401);
    const staffToken = await login("kv3b-staff-parent@example.test");
    const profile = await request(server).get("/me/profile").set("Authorization", `Bearer ${staffToken}`).expect(200);
    expect(profile.body).toMatchObject({ activePersona: "STAFF", roles: ["OPERATIONS_STAFF"], availablePersonas: ["STAFF", "GUARDIAN"] });
    expect(profile.body).not.toHaveProperty("subjectType");
    await request(server).get("/me/guardian/students").set("Authorization", `Bearer ${staffToken}`).expect(403);

    const switched = await request(server)
      .post("/auth/persona/switch")
      .set("Authorization", `Bearer ${staffToken}`)
      .set("Cookie", ["csrfToken=kv3b-csrf"])
      .set("X-CSRF-Token", "kv3b-csrf")
      .send({ activePersona: "GUARDIAN" })
      .expect(200);
    const guardianToken = (switched.body as { accessToken: string }).accessToken;
    const guardianProfile = await request(server).get("/me/profile").set("Authorization", `Bearer ${guardianToken}`).expect(200);
    expect(guardianProfile.body).toMatchObject({ activePersona: "GUARDIAN", roles: ["GUARDIAN"], subjectType: "GUARDIAN", subjectId: guardianId });
    // Capabilities never merge: the guardian persona cannot use staff endpoints.
    await request(server).get(`/students/${studentId}/contacts`).set("Authorization", `Bearer ${guardianToken}`).expect(403);
    const wards = await request(server).get("/me/guardian/students").set("Authorization", `Bearer ${guardianToken}`).expect(200);
    expect((wards.body as Array<{ id: string }>).map((ward) => ward.id).sort()).toEqual([siblingId, studentId].sort());
    await request(server).get(`/me/guardian/students/${studentId}/overview`).set("Authorization", `Bearer ${guardianToken}`).expect(200);

    // Unlinking cuts access: the student leaves the guardian portal list and its overview is 403.
    await unlink(adminToken, studentId, contactId, "kv3b-user-unlink").expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ changed: true, guardianStudentRemoved: true }));
    const afterUnlink = await request(server).get("/me/guardian/students").set("Authorization", `Bearer ${guardianToken}`).expect(200);
    expect((afterUnlink.body as Array<{ id: string }>).map((ward) => ward.id)).toEqual([siblingId]);
    await request(server).get(`/me/guardian/students/${studentId}/overview`).set("Authorization", `Bearer ${guardianToken}`).expect(403);

    // The existing staff role is untouched: switching back opens the staff workspace again.
    const staffAgain = await request(server)
      .post("/auth/persona/switch")
      .set("Authorization", `Bearer ${guardianToken}`)
      .set("Cookie", ["csrfToken=kv3b-csrf"])
      .set("X-CSRF-Token", "kv3b-csrf")
      .send({ activePersona: "STAFF" })
      .expect(200)
      .expect(({ body }) => expect((body as { session: { roles: string[] } }).session.roles).toEqual(["OPERATIONS_STAFF"]));
    const staffAgainToken = (staffAgain.body as { accessToken: string }).accessToken;

    // KV-3c (product owner decision 2026-10-05, ek): the last link goes, so the GUARDIAN membership ends; staff stays.
    await unlink(adminToken, siblingId, siblingContactId, "kv3c-user-unlink-last").expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ changed: true, guardianStudentRemoved: true }));
    expect(await guardianLinks(guardianId)).toEqual([]);
    await request(server).get("/me/profile").set("Authorization", `Bearer ${staffAgainToken}`).expect(401);
    const staffOnlyToken = await login("kv3b-staff-parent@example.test");
    const staffOnly = await request(server).get("/me/profile").set("Authorization", `Bearer ${staffOnlyToken}`).expect(200);
    expect(staffOnly.body).toMatchObject({ activePersona: "STAFF", roles: ["OPERATIONS_STAFF"] });
    expect((staffOnly.body as { availablePersonas?: string[] }).availablePersonas ?? []).not.toContain("GUARDIAN");
    await request(server)
      .post("/auth/persona/switch")
      .set("Authorization", `Bearer ${staffOnlyToken}`)
      .set("Cookie", ["csrfToken=kv3c-csrf"])
      .set("X-CSRF-Token", "kv3c-csrf")
      .send({ activePersona: "GUARDIAN" })
      .expect(400)
      .expect(({ body }) => expect(JSON.stringify(body)).toContain("PERSONA_NOT_AVAILABLE"));
    await request(server).get("/me/profile").set("Authorization", `Bearer ${staffOnlyToken}`).expect(200);

    // KV-3c security review (R2): relinking through the guardian API reopens the GUARDIAN role the last-link rule
    // ended (version bump, open sessions closed); the response is the plain link record.
    await request(server)
      .post(`/guardians/${guardianId}/students`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "kv3c-r2-relink")
      .send({ studentId })
      .expect(201)
      .expect(({ body }) => expect(Object.keys(body as object)).not.toContain("guardianRoleRestoredUserId"));
    await request(server).get("/me/profile").set("Authorization", `Bearer ${staffOnlyToken}`).expect(401);
    const relinkedToken = await login("kv3b-staff-parent@example.test");
    await request(server).get("/me/profile").set("Authorization", `Bearer ${relinkedToken}`).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ activePersona: "STAFF", availablePersonas: ["STAFF", "GUARDIAN"] }));

    await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body: logs }) => {
        const rows = (Array.isArray(logs) ? logs : (logs as { items?: unknown[] }).items ?? []) as Array<{ action: string; entityId: string }>;
        expect(rows.filter((row) => row.entityId === guardianId).map((row) => row.action)).toContain("guardian.created");
        expect(rows.filter((row) => row.entityId === staffParentId).map((row) => row.action))
          .toEqual(expect.arrayContaining(["user.guardian_role_added", "user.guardian_role_removed"]));
        // KV-3b add + KV-3c R2 restore.
        expect(rows.filter((row) => row.entityId === staffParentId && row.action === "user.guardian_role_added")).toHaveLength(2);
        expect(rows.filter((row) => row.entityId === `${guardianId}:${studentId}`).map((row) => row.action)).toContain("guardian_student.unlinked");
        expect(JSON.stringify(rows)).not.toContain("kv3b.personel@example.test");
        expect(JSON.stringify(rows)).not.toContain("5551000105");
        expect(JSON.stringify(rows)).not.toContain("5551000106");
      });
  });

  it("KV-3c: yalnız-veli hesabı guardian API'siyle son bağı kalksa da rolünü ve Guardian kaydını korur", async () => {
    for (const row of await guardianLinks("guardian-a")) {
      await request(server).delete(`/guardians/guardian-a/students/${String(row.studentId)}`).set("Authorization", `Bearer ${adminToken}`).expect(204);
    }
    expect(await guardianLinks("guardian-a")).toEqual([]);
    await request(server).get("/guardians/guardian-a").set("Authorization", `Bearer ${adminToken}`).expect(200);
    const guardianToken = await login("guardian-a@example.test");
    const profile = await request(server).get("/me/profile").set("Authorization", `Bearer ${guardianToken}`).expect(200);
    expect(profile.body).toMatchObject({ roles: ["GUARDIAN"], subjectType: "GUARDIAN", subjectId: "guardian-a" });
    await request(server).get("/me/guardian/students").set("Authorization", `Bearer ${guardianToken}`).expect(200)
      .expect(({ body }) => expect(body).toEqual([]));
  });

  it("kurum sahibine veli rolü eklemek owner:manage ister; yetkisiz yönetici hiçbir şey yazmaz ve oturum kapatmaz", async () => {
    for (const [id, email] of [["user-kv3b-owner-parent", "kv3b-owner-parent@example.test"], ["user-kv3b-owner-actor", "kv3b-owner-actor@example.test"]] as const) {
      upsertInMemoryAuthUser({
        id, email, name: "Kurum Sahibi", password: "password", tenantId: "tenant-a", roles: ["TENANT_OWNER"],
        membership: { id: `membership-${id}`, staffRole: "TENANT_OWNER", hasTeacherPersona: false, hasStudentPersona: false, version: 1, scopeMode: "TENANT", campusIds: [] },
      });
      registerTestLoginIdentity(email, { tenantSlug: "dna-egitim" });
    }
    const ownerParentToken = await login("kv3b-owner-parent@example.test");
    const ownerActorToken = await login("kv3b-owner-actor@example.test");
    const studentId = await createStudent("kv3b-6");
    const contactId = await createContact(studentId, { firstName: "Sahip", lastName: "Veli", relationType: "LEGAL_GUARDIAN" });
    const linkOwner = (token: string, key: string) => request(server)
      .put(`/students/${studentId}/contacts/${contactId}/guardian`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send({ userId: "user-kv3b-owner-parent" });

    await linkOwner(adminToken, "kv3b-owner-by-admin").expect(403)
      .expect(({ body }) => expect(JSON.stringify(body)).toContain("TENANT_OWNER_MANAGE_REQUIRED"));
    expect(await contactGuardianId(studentId, contactId)).toBeUndefined();
    // No role was added, so the owner's session is still open and offers no guardian persona.
    await request(server).get("/me/profile").set("Authorization", `Bearer ${ownerParentToken}`).expect(200)
      .expect(({ body }) => expect((body as { availablePersonas?: string[] }).availablePersonas ?? []).not.toContain("GUARDIAN"));

    await linkOwner(ownerActorToken, "kv3b-owner-by-owner").expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ changed: true, guardianCreated: true, guardianRoleAdded: true }));
    await request(server).get("/me/profile").set("Authorization", `Bearer ${ownerParentToken}`).expect(401);
  });
});

