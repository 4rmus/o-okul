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
    await app.listen(0, "127.0.0.1");
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
    // The public resend returns only the invitation; the token is issued by the private resendOnce.
    const issuer = invitations as unknown as {
      resendOnce(context: unknown, id: string): Promise<{ activationToken: string }>;
    };
    const originalResend = issuer.resendOnce.bind(invitations);
    let activationToken: string | undefined;
    const spy = vi.spyOn(issuer, "resendOnce").mockImplementation(async (context, id) => {
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
      .send({ firstName: "Davet", lastName: "Ogrenci", gradeLevelId: "grade-8", nationalId: "10000001754" })
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
      .query({ q: "invite-student", limit: "1" })
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: invite.body.id, email: "invite-student@example.test" })]);
        expect(body[0]).not.toHaveProperty("activationToken");
        expect(body[0]).not.toHaveProperty("token");
        expect(body[0]).not.toHaveProperty("tokenHash");
        expect(body[0]).not.toHaveProperty("acceptedUserId");
      });
    // Cursor list like GET /employees: the retired page parameter is refused, filters are exact.
    await request(server)
      .get("/identity-invitations")
      .query({ q: "invite-student", page: "1", limit: "1" })
      .set("Authorization", `Bearer ${admin}`)
      .expect(422);
    await request(server)
      .get("/identity-invitations")
      .query({ subjectType: "STUDENT", status: "PENDING", subjectId: invite.body.subjectId })
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.map((record: { id: string }) => record.id)).toEqual([invite.body.id]);
      });
    await request(server)
      .get("/identity-invitations")
      .query({ cursor: "Zm9yZWlnbg", limit: "1" })
      .set("Authorization", `Bearer ${admin}`)
      .expect(400);

    const accepted = await request(server)
      .post("/identity-invitations/accept")
      .send({ token: activationToken, password: "Secure-password-123" })
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
      .query({ q: "invite-student", limit: "1" })
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
      .send({ token: oldToken, password: "Secure-password-123" })
      .expect(404);
    await request(server)
      .post("/identity-invitations/accept")
      .send({ token: newToken, password: "Secure-password-123" })
      .expect(201);
  });

  it("eski koltuk limitini aşan tenantta da davet kabulüne izin verir (UAT F-06)", async () => {
    const system = await login("system@example.test");
    const created = await request(server)
      .post("/tenants")
      .set("Authorization", `Bearer ${system}`)
      .set("Idempotency-Key", "tenant-seat-invitations-1")
      .send({
        name: "Seat Invitations Tenant",
        slug: "seat-invitations-tenant",
        campuses: [{ name: "Main Campus", code: "MAIN", unitType: "SCHOOL" }],
        firstOwner: {
          name: "Seat Invitations Admin",
          email: "seat-invitations-admin@example.test",
          nationalId: "10000000450",
        },
        licenseTerm: {
          planCode: "PRO",
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: "2027-01-01T00:00:00.000Z",
          activeStudentLimit: 1,
        },
      })
      .expect(201);
    const tenantId = created.body.tenant.id as string;

    const activatedPassword = "Seat-invitations-admin-password";
    upsertInMemoryAuthUser({
      id: "seat-invitations-admin-test",
      email: "seat-invitations-admin@example.test",
      name: "Seat Invitations Admin",
      nationalIdHash: hashTcIdentity("10000000450"),
      password: activatedPassword,
      tenantId,
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
      .send({ token: activationToken, password: "Secure-password-123" })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({ status: "ACCEPTED" });
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

  it("davet yeniden göndermeyi Idempotency-Key ile tekilleştirir ve yeni token üretmez", async () => {
    const admin = await login("admin-a@example.test");
    const teacher = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${admin}`)
      .send({ firstName: "Tekil", lastName: "Davet", branch: "Fen", nationalId: "10000002810" })
      .expect(201);
    const invite = await request(server)
      .post("/identity-invitations")
      .set("Authorization", `Bearer ${admin}`)
      .send({ subjectType: "TEACHER", subjectId: (teacher.body as { id: string }).id, email: "tekil-davet@example.test" })
      .expect(201);
    const resend = () => request(server)
      .post(`/identity-invitations/${invite.body.id}/resend`)
      .set("Authorization", `Bearer ${admin}`)
      .set("Idempotency-Key", "identity-invitation-resend-idempotency-a");

    const { response: first } = await captureResendActivationToken(() => resend().expect(201));
    const issuer = invitations as unknown as { resendOnce(context: unknown, id: string): Promise<unknown> };
    const spy = vi.spyOn(issuer, "resendOnce");
    try {
      const second = await resend().expect(201);
      expect(second.body).toEqual(first.body);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("öğretmene tek bekleyen e-posta daveti açılır; tekrar reddedilir, güncelleme yeni davet açmaz, yeni adres eskisinin yerine geçer", async () => {
    const admin = await login("admin-a@example.test");
    const teacher = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${admin}`)
      .send({ firstName: "Tekil", lastName: "Bekleyen", branch: "Fen", nationalId: "10000003734" })
      .expect(201);
    const teacherId = (teacher.body as { id: string }).id;
    const invite = (email: string) => request(server)
      .post("/identity-invitations")
      .set("Authorization", `Bearer ${admin}`)
      .send({ subjectType: "TEACHER", subjectId: teacherId, email });
    const pendingForTeacher = async () => ((await request(server)
      .get("/identity-invitations")
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)).body as Array<{ subjectId: string; status: string; email: string }>)
      .filter((invitation) => invitation.subjectId === teacherId && invitation.status === "PENDING");

    await invite("tekil.bekleyen@example.test").expect(201);
    await invite("tekil.bekleyen@example.test")
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("IDENTITY_INVITATION_ALREADY_PENDING"));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(server)
        .patch(`/teachers/${teacherId}`)
        .set("Authorization", `Bearer ${admin}`)
        .send({ email: "tekil.bekleyen@example.test" })
        .expect(200);
    }
    expect(await pendingForTeacher()).toHaveLength(1);

    await invite("yeni.adres@example.test").expect(201);
    expect((await pendingForTeacher()).map((invitation) => invitation.email)).toEqual(["yeni.adres@example.test"]);
  });

  it("bekleyen davet iptal edilince bağlantı ölür, tekrar iptal ve yeniden gönderme reddedilir, yeni davet açılabilir (UAT F-03)", async () => {
    const admin = await login("admin-a@example.test");
    const teacher = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${admin}`)
      .send({ firstName: "Iptal", lastName: "Ogretmen", branch: "Fen", nationalId: "10000001823" })
      .expect(201);
    const teacherId = (teacher.body as { id: string }).id;
    const { response: invite, activationToken } = await captureCreateActivationToken(() =>
      request(server)
        .post("/identity-invitations")
        .set("Authorization", `Bearer ${admin}`)
        .send({ subjectType: "TEACHER", subjectId: teacherId, email: "iptal.ogretmen@example.test" })
        .expect(201),
    );
    const invitationId = (invite.body as { id: string }).id;

    const revoked = await request(server)
      .post(`/identity-invitations/${invitationId}/revoke`)
      .set("Authorization", `Bearer ${admin}`)
      .expect(201);
    expect(revoked.body).toMatchObject({ id: invitationId, status: "REVOKED", subjectId: teacherId });
    expect(revoked.body).not.toHaveProperty("activationToken");
    expect(revoked.body).not.toHaveProperty("tokenHash");
    expect(revoked.body).not.toHaveProperty("acceptedUserId");

    // UAT F-20: the withdrawn link says so instead of reading as already used.
    await request(server)
      .post("/identity-invitations/accept")
      .send({ token: activationToken, password: "Secure-password-123" })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("IDENTITY_INVITATION_REVOKED"));
    await request(server)
      .post(`/identity-invitations/${invitationId}/revoke`)
      .set("Authorization", `Bearer ${admin}`)
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("IDENTITY_INVITATION_NOT_PENDING"));
    await request(server)
      .post(`/identity-invitations/${invitationId}/resend`)
      .set("Authorization", `Bearer ${admin}`)
      .expect(400);
    await request(server)
      .post("/identity-invitations/missing-invitation/revoke")
      .set("Authorization", `Bearer ${admin}`)
      .expect(404);

    // The teacher can be invited again right away, with a new address, instead of waiting for the expiry.
    const again = await request(server)
      .post("/identity-invitations")
      .set("Authorization", `Bearer ${admin}`)
      .send({ subjectType: "TEACHER", subjectId: teacherId, email: "iptal.ogretmen.yeni@example.test" })
      .expect(201);
    expect(again.body).toMatchObject({ status: "PENDING", subjectId: teacherId });
    expect(again.body.id).not.toBe(invitationId);
  });

  it("öğretmen rolü daveti iptal edemez", async () => {
    const admin = await login("admin-a@example.test");
    const teacher = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${admin}`)
      .send({ firstName: "Yetkisiz", lastName: "Iptal", branch: "Fen", nationalId: "10000001824" })
      .expect(201);
    const invite = await request(server)
      .post("/identity-invitations")
      .set("Authorization", `Bearer ${admin}`)
      .send({ subjectType: "TEACHER", subjectId: (teacher.body as { id: string }).id, email: "yetkisiz.iptal@example.test" })
      .expect(201);
    const teacherSession = await login("teacher-a@example.test");
    await request(server)
      .post(`/identity-invitations/${(invite.body as { id: string }).id}/revoke`)
      .set("Authorization", `Bearer ${teacherSession}`)
      .expect(403);
  });

  it("çalışan daveti iptal edilince aynı çalışana yeni rolle davet açılır (UAT F-03)", async () => {
    const admin = await login("admin-a@example.test");
    const employee = await request(server)
      .post("/employees")
      .set("Authorization", `Bearer ${admin}`)
      .send({ employeeNo: "A-F03-1", firstName: "Yanlis", lastName: "Rol", workEmail: "yanlis.rol@example.test", status: "ACTIVE" })
      .expect(201);
    const employeeId = (employee.body as { id: string }).id;
    const first = await request(server)
      .post(`/employees/${employeeId}/account-invitations`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ email: "yanlis.rol@example.test", role: "OPERATIONS_STAFF" })
      .expect(201);
    await request(server)
      .post(`/employees/${employeeId}/account-invitations`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ email: "yanlis.rol@example.test", role: "TENANT_ADMIN" })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("EMPLOYEE_INVITATION_ALREADY_PENDING"));

    await request(server)
      .post(`/identity-invitations/${(first.body as { id: string }).id}/revoke`)
      .set("Authorization", `Bearer ${admin}`)
      .expect(201)
      .expect(({ body }) => expect(body).toMatchObject({ status: "REVOKED", subjectType: "EMPLOYEE", subjectId: employeeId }));

    const second = await request(server)
      .post(`/employees/${employeeId}/account-invitations`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ email: "yanlis.rol@example.test", role: "TENANT_ADMIN" })
      .expect(201);
    expect(second.body).toMatchObject({ role: "TENANT_ADMIN", status: "PENDING", subjectId: employeeId });
    expect(second.body.id).not.toBe(first.body.id);
  });

  it("kurum sahibi davetini yalnız kurum sahibi iptal eder (UAT F-03)", async () => {
    registerTestLoginIdentity("owner-f03@example.test", { tenantSlug: "dna-egitim" });
    upsertInMemoryAuthUser({
      id: "user-owner-f03",
      email: "owner-f03@example.test",
      name: "Tenant Owner",
      password: "password",
      tenantId: "tenant-a",
      roles: ["TENANT_OWNER"],
      membership: {
        id: "membership-owner-f03",
        staffRole: "TENANT_OWNER",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 1,
        scopeMode: "TENANT",
        campusIds: [],
      },
    });
    const owner = await login("owner-f03@example.test");
    const admin = await login("admin-a@example.test");
    const employee = await request(server)
      .post("/employees")
      .set("Authorization", `Bearer ${owner}`)
      .send({ employeeNo: "A-F03-2", firstName: "Ikinci", lastName: "Sahip", workEmail: "ikinci.sahip@example.test", status: "ACTIVE" })
      .expect(201);
    const invite = await request(server)
      .post(`/employees/${(employee.body as { id: string }).id}/account-invitations`)
      .set("Authorization", `Bearer ${owner}`)
      .send({ email: "ikinci.sahip@example.test", role: "TENANT_OWNER" })
      .expect(201);
    const invitationId = (invite.body as { id: string }).id;

    await request(server)
      .post(`/identity-invitations/${invitationId}/revoke`)
      .set("Authorization", `Bearer ${admin}`)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe("TENANT_OWNER_MANAGE_REQUIRED"));
    await request(server)
      .post(`/identity-invitations/${invitationId}/revoke`)
      .set("Authorization", `Bearer ${owner}`)
      .expect(201)
      .expect(({ body }) => expect(body).toMatchObject({ id: invitationId, status: "REVOKED", role: "TENANT_OWNER" }));
  });

  it("çalışan davetini bağlı veya uyumsuz hesabın e-postasına oluşturmaz, bağsız hesaba açar (UAT F-20)", async () => {
    const admin = await login("admin-a@example.test");
    const employee = await request(server)
      .post("/employees")
      .set("Authorization", `Bearer ${admin}`)
      .send({ employeeNo: "A-F20-1", firstName: "Uat", lastName: "Muhasebe", status: "ACTIVE" })
      .expect(201);
    const employeeId = (employee.body as { id: string }).id;

    for (const { email, code } of [
      // admin-a's account belongs to the employee-admin-a profile.
      { email: "admin-a@example.test", code: "EMPLOYEE_EMAIL_ACCOUNT_ALREADY_BOUND" },
      { email: "student-a@example.test", code: "EMPLOYEE_EMAIL_ACCOUNT_INCOMPATIBLE" },
      { email: "guardian-a@example.test", code: "EMPLOYEE_EMAIL_ACCOUNT_INCOMPATIBLE" },
    ]) {
      await request(server)
        .post(`/employees/${employeeId}/account-invitations`)
        .set("Authorization", `Bearer ${admin}`)
        .send({ email, role: "FINANCE_STAFF" })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe(code));
    }
    await request(server)
      .get("/identity-invitations")
      .query({ subjectType: "EMPLOYEE", subjectId: employeeId })
      .set("Authorization", `Bearer ${admin}`)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual([]));

    // Without user:manage the check is never reached (no account enumeration).
    const teacherSession = await login("teacher-a@example.test");
    await request(server)
      .post(`/employees/${employeeId}/account-invitations`)
      .set("Authorization", `Bearer ${teacherSession}`)
      .send({ email: "admin-a@example.test", role: "FINANCE_STAFF" })
      .expect(403);

    // A teacher account that is not tied to another employee can take the staff role.
    await request(server)
      .post(`/employees/${employeeId}/account-invitations`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ email: "teacher-a@example.test", role: "FINANCE_STAFF" })
      .expect(201)
      .expect(({ body }) => expect(body).toMatchObject({ status: "PENDING", subjectId: employeeId, role: "FINANCE_STAFF" }));
  });

  it("kullanılmış daveti NOT_PENDING, iptal edilen çalışan davetini REVOKED ile reddeder (UAT F-20)", async () => {
    const admin = await login("admin-a@example.test");
    const employee = await request(server)
      .post("/employees")
      .set("Authorization", `Bearer ${admin}`)
      .send({ employeeNo: "A-F20-2", firstName: "Iptal", lastName: "Calisan", status: "ACTIVE" })
      .expect(201);
    const employeeId = (employee.body as { id: string }).id;
    const issuer = invitations as unknown as {
      createEmployeeInvitation(...args: unknown[]): Promise<{ activationToken: string }>;
    };
    const original = issuer.createEmployeeInvitation.bind(invitations);
    const tokens: string[] = [];
    const spy = vi.spyOn(issuer, "createEmployeeInvitation").mockImplementation(async (...args: unknown[]) => {
      const result = await original(...args);
      tokens.push(result.activationToken);
      return result;
    });
    try {
      const first = await request(server)
        .post(`/employees/${employeeId}/account-invitations`)
        .set("Authorization", `Bearer ${admin}`)
        .send({ email: "iptal.calisan.f20@example.test", role: "OPERATIONS_STAFF" })
        .expect(201);
      await request(server)
        .post(`/identity-invitations/${(first.body as { id: string }).id}/revoke`)
        .set("Authorization", `Bearer ${admin}`)
        .expect(201);
      await request(server)
        .post(`/employees/${employeeId}/account-invitations`)
        .set("Authorization", `Bearer ${admin}`)
        .send({ email: "iptal.calisan.f20@example.test", role: "OPERATIONS_STAFF" })
        .expect(201);
    } finally {
      spy.mockRestore();
    }
    const [revokedToken, liveToken] = tokens;

    await request(server)
      .post("/identity-invitations/accept")
      .send({ token: revokedToken, password: "Secure-password-123" })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("IDENTITY_INVITATION_REVOKED"));
    await request(server)
      .post("/identity-invitations/accept")
      .send({ token: liveToken, password: "Secure-password-123" })
      .expect(201);
    await request(server)
      .post("/identity-invitations/accept")
      .send({ token: liveToken, password: "Secure-password-123" })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("IDENTITY_INVITATION_NOT_PENDING"));
  });
});
