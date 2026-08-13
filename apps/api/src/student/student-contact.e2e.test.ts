import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { FeatureRolloutService } from "../feature-rollout/feature-rollout.service.js";
import { testLoginBody } from "../test-auth.js";

describe("StudentContact API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let adminToken: string;
  let teacherToken: string;
  let tenantBToken: string;
  let campusOperationsToken: string;

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    upsertInMemoryAuthUser({
      id: "user-operations-a",
      email: "operations-a@example.test",
      name: "Campus Operations",
      password: "password",
      tenantId: "tenant-a",
      roles: ["OPERATIONS_STAFF"],
      membership: {
        id: "membership-operations-a",
        staffRole: "OPERATIONS_STAFF",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 1,
        scopeMode: "CAMPUSES",
        campusIds: ["campus-main"],
      },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FeatureRolloutService)
      .useValue({
        assertEnabled: vi.fn(async () => undefined),
        resolve: vi.fn(async () => ({ enabledFeatureKeys: ["web.student-registry-v2"] })),
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
    adminToken = await login("admin-a@example.test");
    teacherToken = await login("teacher-a@example.test");
    tenantBToken = await login("admin-b@example.test");
    campusOperationsToken = await login("operations-a@example.test");
  });

  afterAll(async () => {
    await app.close();
    resetInMemoryAuthUsers();
  });

  async function login(email: string): Promise<string> {
    const body = email === "operations-a@example.test"
      ? { loginName: email, password: "password", tenantSlug: "dna-egitim" }
      : testLoginBody(email);
    const response = await request(server).post("/auth/login").send(body).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("iletişim kişisini default-off izinlerle ve yalnız maskeli PII ile yönetir", async () => {
    const invitationsBefore = await request(server)
      .get("/identity-invitations")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const created = await request(server)
      .post("/students/student-a/contacts")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "student-contact-create-default-off-a")
      .send({
        firstName: "Fatma",
        lastName: "İletişim",
        relationType: "MOTHER",
        phone: "5551234567",
        email: "fatma@example.test",
      })
      .expect(201);

    expect(created.body).toMatchObject({
      studentId: "student-a",
      firstName: "Fatma",
      relationType: "MOTHER",
      phoneMasked: "••• ••• ••67",
      emailMasked: "fa••@•••.test",
      canReceiveSms: false,
      canReceiveAnnouncements: false,
      canReceiveFinance: false,
    });
    expect(JSON.stringify(created.body)).not.toContain("5551234567");
    expect(JSON.stringify(created.body)).not.toContain("fatma@example.test");
    expect(JSON.stringify(created.body)).not.toContain("userId");

    await request(server)
      .get("/students/student-a/contacts")
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(403);

    await request(server)
      .get("/students/student-a/contacts")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: created.body.id, phoneMasked: "••• ••• ••67" })]);
      });

    const invitationsAfter = await request(server)
      .get("/identity-invitations")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(invitationsAfter.body).toEqual(invitationsBefore.body);

    await request(server)
      .delete(`/students/student-a/contacts/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(204);
    await request(server)
      .get("/students/student-a/contacts")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200, []);
  });

  it("contact create işlemini Idempotency-Key ile tekilleştirir", async () => {
    const key = "student-contact-create-idempotency-a";
    const body = { firstName: "Tek", lastName: "Kayıt", relationType: "OTHER" };
    const first = await request(server)
      .post("/students/student-a/contacts")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const replay = await request(server)
      .post("/students/student-a/contacts")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    expect(replay.body).toEqual(first.body);

    await request(server)
      .post("/students/student-a/contacts")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", key)
      .send({ ...body, firstName: "Farklı" })
      .expect(409);
  });

  it("izinleri kanıt olmadan, öğretmen yazısını ve çapraz tenant erişimini reddeder", async () => {
    await request(server)
      .post("/students/student-a/contacts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "İzinsiz", lastName: "Kişi", relationType: "OTHER", canReceiveSms: true })
      .expect(400);

    await request(server)
      .post("/students/student-a/contacts")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ firstName: "Yetkisiz", lastName: "Kişi", relationType: "OTHER" })
      .expect(403);

    await request(server)
      .get("/students/student-a/contacts")
      .set("Authorization", `Bearer ${tenantBToken}`)
      .expect(403);
  });

  it("v2 öğrenci 360 özetini tek scope-kontrollü yanıtta ve PII sızdırmadan döndürür", async () => {
    await request(server)
      .patch("/teachers/teacher-a")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ nationalId: "10000001204", phone: "5550000010" })
      .expect(200);

    const adminOverview = await request(server)
      .get("/students/student-a/overview")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(adminOverview.body).toMatchObject({
      profile: { id: "student-a", tenantId: "tenant-a" },
      attendance: { studentId: "student-a" },
      canViewFinance: true,
      openHomeworkCount: expect.any(Number),
      teacherNoteCount: expect.any(Number),
      activity: expect.any(Array),
      teachers: [expect.objectContaining({ id: "teacher-a", phoneMasked: "••• ••• ••10" })],
    });
    const serializedOverview = JSON.stringify(adminOverview.body);
    const serializedTeachers = JSON.stringify(adminOverview.body.teachers);
    expect(serializedOverview).not.toContain("nationalIdEncrypted");
    expect(serializedOverview).not.toContain("nationalIdHash");
    expect(serializedOverview).not.toContain("phoneEncrypted");
    expect(serializedOverview).not.toContain("emailEncrypted");
    expect(serializedTeachers).not.toContain("userId");
    expect(serializedTeachers).not.toContain("5550000010");

    await request(server)
      .get("/students/student-a/overview")
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.canViewFinance).toBe(false);
        expect(body.activity).toEqual([]);
        expect(body.profile.phone).toBeUndefined();
        expect(body.profile.email).toBeUndefined();
        expect(body.contacts).toEqual([]);
      });

    const operationsOverview = await request(server)
      .get("/students/student-a/overview")
      .set("Authorization", `Bearer ${campusOperationsToken}`);
    expect(operationsOverview.status, JSON.stringify(operationsOverview.body)).toBe(200);
    expect(operationsOverview.body.profile.id).toBe("student-a");
    expect(operationsOverview.body.contacts).toEqual([]);
    expect(operationsOverview.body.latestExam).toBeUndefined();

    await request(server)
      .get("/students/student-a/overview")
      .set("Authorization", `Bearer ${tenantBToken}`)
      .expect(403);
  });
});
