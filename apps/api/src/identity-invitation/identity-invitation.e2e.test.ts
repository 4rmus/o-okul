import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { loginAsSettled, registerTestLoginIdentity } from "../test-auth.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { hashTcIdentity } from "../student/tc-identity.js";
import { IdentityInvitationService } from "./identity-invitation.service.js";

describe("Identity invitations", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let invitations: IdentityInvitationService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    invitations = moduleRef.get(IdentityInvitationService);
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string, password = "password"): Promise<string> {
    return loginAsSettled(server, email, password);
  }

  async function captureCreateActivationToken(action: () => Promise<request.Response>): Promise<{
    response: request.Response;
    activationToken: string;
  }> {
    const originalCreate = invitations.create.bind(invitations);
    let activationToken: string | undefined;
    const spy = vi.spyOn(invitations, "create").mockImplementation(async (context, body) => {
      const result = await originalCreate(context, body);
      activationToken = result.activationToken;
      return result;
    });
    try {
      const response = await action();
      if (!activationToken) throw new Error("IDENTITY_INVITATION_TEST_TOKEN_MISSING");
      return { response, activationToken };
    } finally {
      spy.mockRestore();
    }
  }

  async function captureResendActivationToken(action: () => Promise<request.Response>): Promise<{
    response: request.Response;
    activationToken: string;
  }> {
    const originalResend = invitations.resend.bind(invitations);
    let activationToken: string | undefined;
    const spy = vi.spyOn(invitations, "resend").mockImplementation(async (context, id) => {
      const result = await originalResend(context, id);
      activationToken = result.activationToken;
      return result;
    });
    try {
      const response = await action();
      if (!activationToken) throw new Error("IDENTITY_INVITATION_TEST_TOKEN_MISSING");
      return { response, activationToken };
    } finally {
      spy.mockRestore();
    }
  }

  it("kurum admin öğrenci daveti oluşturur, kabul edilince subject userId bağlanır", async () => {
    const admin = await login("admin-a@example.test");
    const student = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${admin}`)
      .send({ firstName: "Davet", lastName: "Ogrenci", nationalId: "10000001754" })
      .expect(201);
    const studentId = (student.body as { id: string }).id;

    const { response: invite, activationToken } = await captureCreateActivationToken(() =>
      request(server)
        .post("/identity-invitations")
        .set("Authorization", `Bearer ${admin}`)
        .send({
          subjectType: "STUDENT",
          subjectId: studentId,
          email: "invite-student@example.test",
        })
        .expect(201),
    );

    expect(invite.body).toMatchObject({
      tenantId: "tenant-a",
      subjectType: "STUDENT",
      subjectId: studentId,
      email: "invite-student@example.test",
      role: "STUDENT",
      status: "PENDING",
    });
    expect(invite.body).not.toHaveProperty("activationToken");
    expect(invite.body).not.toHaveProperty("token");
    expect(invite.body).not.toHaveProperty("tokenHash");
    expect(invite.body).not.toHaveProperty("acceptedUserId");

    await request(server)
      .get("/identity-invitations")
      .query({ q: "invite-student", sort: "email", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: invite.body.id, email: "invite-student@example.test" })]);
        expect(body[0]).not.toHaveProperty("activationToken");
        expect(body[0]).not.toHaveProperty("token");
        expect(body[0]).not.toHaveProperty("tokenHash");
        expect(body[0]).not.toHaveProperty("acceptedUserId");
      });

    const accepted = await request(server)
      .post("/identity-invitations/accept")
      .send({ token: activationToken, password: "secure-password-123" })
      .expect(201);

    expect(accepted.body).toMatchObject({
      status: "ACCEPTED",
    });
    expect(accepted.body.acceptedAt).toEqual(expect.any(String));
    expect(accepted.body).not.toHaveProperty("activationToken");
    expect(accepted.body).not.toHaveProperty("email");
    expect(accepted.body).not.toHaveProperty("subjectId");
    expect(accepted.body).not.toHaveProperty("tenantId");
    expect(accepted.body).not.toHaveProperty("tokenHash");
    expect(accepted.body).not.toHaveProperty("password");
    expect(accepted.body).not.toHaveProperty("acceptedUserId");

    await request(server)
      .get("/identity-invitations")
      .query({ q: "invite-student", sort: "email", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            id: invite.body.id,
            status: "ACCEPTED",
            acceptedAt: accepted.body.acceptedAt,
          }),
        ]);
        expect(body[0]).not.toHaveProperty("acceptedUserId");
      });
  });

  it("davet tekrar gönderilince eski token geçersiz olur", async () => {
    const admin = await login("admin-a@example.test");
    const teacher = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${admin}`)
      .send({ firstName: "Davet", lastName: "Ogretmen", branch: "Fen", nationalId: "10000001822" })
      .expect(201);
    const teacherId = (teacher.body as { id: string }).id;
    const { response: invite, activationToken: oldToken } = await captureCreateActivationToken(() =>
      request(server)
        .post("/identity-invitations")
        .set("Authorization", `Bearer ${admin}`)
        .send({
          subjectType: "TEACHER",
          subjectId: teacherId,
          email: "invite-teacher@example.test",
        })
        .expect(201),
    );

    const { response: resent, activationToken: newToken } = await captureResendActivationToken(() =>
      request(server)
        .post(`/identity-invitations/${invite.body.id}/resend`)
        .set("Authorization", `Bearer ${admin}`)
        .expect(201),
    );

    expect(resent.body).toMatchObject({ id: invite.body.id, status: "PENDING" });
    expect(resent.body).not.toHaveProperty("activationToken");
    expect(resent.body).not.toHaveProperty("tokenHash");
    expect(newToken).not.toBe(oldToken);
    await request(server)
      .post("/identity-invitations/accept")
      .send({ token: oldToken, password: "secure-password-123" })
      .expect(404);
    await request(server)
      .post("/identity-invitations/accept")
      .send({ token: newToken, password: "secure-password-123" })
      .expect(201);
  });

  it("koltuk limiti dolu tenantta davet kabulünü engeller", async () => {
    const system = await login("system@example.test");
    await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${system}`)
      .send({
        id: "tenant-seat-invitations",
        name: "Seat Invitations Tenant",
        slug: "seat-invitations-tenant",
        seatLimit: 1,
        firstAdmin: {
          name: "Seat Invitations Admin",
          email: "seat-invitations-admin@example.test",
          nationalId: "10000000450",
        },
      })
      .expect(201);

    const activatedPassword = "seat-invitations-admin-password";
    upsertInMemoryAuthUser({
      id: "seat-invitations-admin-test",
      email: "seat-invitations-admin@example.test",
      name: "Seat Invitations Admin",
      nationalIdHash: hashTcIdentity("10000000450"),
      password: activatedPassword,
      tenantId: "tenant-seat-invitations",
      roles: ["TENANT_ADMIN"],
      mustChangePassword: false,
    });
    registerTestLoginIdentity("seat-invitations-admin@example.test", {
      password: activatedPassword,
      tenantSlug: "seat-invitations-tenant",
    });
    const admin = await login("seat-invitations-admin@example.test", activatedPassword);
    const teacher = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${admin}`)
      .send({ firstName: "Seat", lastName: "Teacher", branch: "Math", nationalId: "10000001990" })
      .expect(201);
    const teacherId = (teacher.body as { id: string }).id;

    const { activationToken } = await captureCreateActivationToken(() =>
      request(server)
        .post("/identity-invitations")
        .set("Authorization", `Bearer ${admin}`)
        .send({
          subjectType: "TEACHER",
          subjectId: teacherId,
          email: "seat-invitations-teacher@example.test",
        })
        .expect(201),
    );

    await request(server)
      .post("/identity-invitations/accept")
      .send({ token: activationToken, password: "secure-password-123" })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain("TENANT_SEAT_LIMIT_EXCEEDED");
      });
  });

  it("davet create ve accept gövdelerini Zod ile doğrular", async () => {
    const admin = await login("admin-a@example.test");
    const invalidCreate = await request(server)
      .post("/identity-invitations")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        subjectType: "PARENT",
        subjectId: " ",
        email: "gecersiz-email",
      })
      .expect(422);

    expect(invalidCreate.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "subjectType" }),
          expect.objectContaining({ path: "subjectId" }),
          expect.objectContaining({ path: "email" }),
        ]),
      },
    });

    const invalidAccept = await request(server)
      .post("/identity-invitations/accept")
      .send({ token: " ", password: "short" })
      .expect(422);

    expect(invalidAccept.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "token" }),
          expect.objectContaining({ path: "password" }),
        ]),
      },
    });
  });

  it("öğretmen davet oluşturamaz ve bağlı subject tekrar davet edilemez", async () => {
    const teacher = await login("teacher-a@example.test");
    await request(server)
      .post("/identity-invitations")
      .set("Authorization", `Bearer ${teacher}`)
      .send({
        subjectType: "STUDENT",
        subjectId: "student-a",
        email: "blocked@example.test",
      })
      .expect(403);

    const admin = await login("admin-a@example.test");
    await request(server)
      .post("/identity-invitations")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        subjectType: "STUDENT",
        subjectId: "student-a",
        email: "already-linked@example.test",
      })
      .expect(400);
  });
});
