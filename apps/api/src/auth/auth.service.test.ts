import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword, type AuthUser, type AuthUserStore, verifyPasswordAsync } from "./auth-user-store.js";
import { AuthService, createPasswordResetUrl, hashResetToken } from "./auth.service.js";
import type { IdentityResolver } from "./identity-resolver.js";
import { InMemoryPasswordResetStore } from "./password-reset-store.js";
import { InMemorySessionStore } from "./session-store.js";
import { LoginAttemptLimiter } from "./login-attempt-limiter.js";
import { createTotpCodeForTest, verifyAdminMfaStepUpProof } from "./totp-mfa.js";
import { hashTcIdentity } from "../student/tc-identity.js";
import { InMemoryTenantStore } from "../tenant/tenant-store.js";

const previousEnv = {
  ADMIN_MFA_MODE: process.env.ADMIN_MFA_MODE,
  AUTH_SELECTION_SECRET: process.env.AUTH_SELECTION_SECRET,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  NODE_ENV: process.env.NODE_ENV,
};

describe("AuthService", () => {
  afterEach(() => {
    restoreEnv("ADMIN_MFA_MODE", previousEnv.ADMIN_MFA_MODE);
    restoreEnv("AUTH_SELECTION_SECRET", previousEnv.AUTH_SELECTION_SECRET);
    restoreEnv("JWT_ACCESS_SECRET", previousEnv.JWT_ACCESS_SECRET);
    restoreEnv("NODE_ENV", previousEnv.NODE_ENV);
  });

  it("login kullanıcıyı injected store'dan okur ve password hash doğrular", async () => {
    const user: AuthUser = {
      id: "user-db-a",
      email: "db-a@example.test",
      name: "DB User",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      nationalIdHash: hashTcIdentity("10000000146"),
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    };
    const users = createUserStoreMock({
      findByTenantAndLoginName: vi.fn(async (tenantId, loginName) => (
        tenantId === user.tenantId && loginName === user.email ? user : undefined
      )),
    });
    const identities = {
      resolve: vi.fn(async () => undefined),
    } as unknown as IdentityResolver;
    const auth = new AuthService(users, new InMemorySessionStore(), new InMemoryPasswordResetStore(), identities, undefined, undefined, new InMemoryTenantStore());

    const tokenPair = await auth.login(loginCredentials(user.email ?? ""));
    if ("status" in tokenPair) throw new Error("MFA challenge beklenmiyordu.");

    expect(users.findByTenantAndLoginName).toHaveBeenCalledWith("tenant-a", user.email);
    expect(tokenPair.session).toMatchObject({
      userId: "user-db-a",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
    });
    expect(users.rehashPassword).toHaveBeenCalledWith(user.tenantId, user.id, user.passwordHash, expect.stringMatching(/^scrypt:v2:/));
    const rehashed = vi.mocked(users.rehashPassword).mock.calls[0]?.[3] ?? "";
    await expect(verifyPasswordAsync("password", rehashed)).resolves.toBe(true);
  });

  it.each(["SCHEDULED", "FROZEN", "EXPIRED", "CANCELLED"] as const)("%s lisans durumunda login kullanıcı sorgusunu başlatmaz", async (state) => {
    const users = createUserStoreMock({});
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn() } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
      { resolveForTenant: vi.fn(async () => ({
        mirrorParity: true,
        state,
        term: {
          id: "license-a",
          tenantId: "tenant-a",
          planCode: "PRO",
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: "2027-01-01T00:00:00.000Z",
          activeStudentLimit: 100,
        },
      })), create: vi.fn() },
    );

    await expect(auth.login(loginCredentials("admin-a@example.test"))).rejects.toThrow("LOGIN_FAILED");
    expect(users.findByTenantAndLoginName).not.toHaveBeenCalled();
  });

  it("READ_ONLY grace süresinde login açar", async () => {
    const user = {
      id: "user-read-only",
      email: "read-only@example.test",
      name: "Read Only User",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    } satisfies AuthUser;
    const users = createUserStoreMock({ findByTenantAndLoginName: vi.fn(async () => user) });
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn() } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
      { resolveForTenant: vi.fn(async () => ({
        mirrorParity: true,
        state: "READ_ONLY" as const,
        term: {
          id: "license-a",
          tenantId: "tenant-a",
          planCode: "PRO",
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: "2027-01-01T00:00:00.000Z",
          activeStudentLimit: 100,
        },
      })), create: vi.fn() },
    );

    await expect(auth.login(loginCredentials(user.email))).resolves.toMatchObject({ session: { userId: user.id } });
  });

  it("yanlış parola token üretmez", async () => {
    const user: AuthUser = {
      id: "user-db-a",
      email: "db-a@example.test",
      name: "DB User",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      nationalIdHash: hashTcIdentity("10000000146"),
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    };
    const users = createUserStoreMock({
      findByTenantAndLoginName: vi.fn(async (tenantId, loginName) => (
        tenantId === user.tenantId && loginName === user.email ? user : undefined
      )),
    });
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn() } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );

    await expect(auth.login(loginCredentials(user.email ?? "", "wrong"))).rejects.toThrow("LOGIN_FAILED");
  });

  it("kullanıcı adı eksikse login olmaz", async () => {
    const users = createUserStoreMock({});
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn() } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );

    await expect(auth.login({ tenantSlug: "dna-egitim", loginName: "", password: "5551234567" })).rejects.toThrow("LOGIN_IDENTIFIER_REQUIRED");
  });

  it("kurum kodu olmadan tenant hesabı aramaz", async () => {
    const users = createUserStoreMock({});
    const auth = new AuthService(users, new InMemorySessionStore(), new InMemoryPasswordResetStore(),
      { resolve: vi.fn() } as unknown as IdentityResolver, undefined, undefined, new InMemoryTenantStore());

    await expect(auth.login({ tenantSlug: "", loginName: "same@example.test", password: "password" }))
      .rejects.toThrow("TENANT_SLUG_REQUIRED");
    expect(users.findByTenantAndLoginName).not.toHaveBeenCalled();
    expect(users.findByNationalIdHash).not.toHaveBeenCalled();
  });

  it("kurum kodu ve kullanıcı adıyla login olur, ilk giriş şifre değiştirme bilgisini taşır", async () => {
    const nationalId = "10000000146";
    const user: AuthUser = {
      id: "student-login",
      name: "Student Login",
      passwordHash: hashPassword("5551234567", "test-salt"),
      tenantId: "tenant-a",
      nationalIdHash: hashTcIdentity(nationalId),
      roles: ["STUDENT"],
      membershipVersion: 1,
      mustChangePassword: true,
    };
    const users = createUserStoreMock({
      findByTenantAndLoginName: vi.fn(async (tenantId, loginName) => (
        tenantId === user.tenantId && loginName === "student-login" ? user : undefined
      )),
      findById: vi.fn(async (id) => (id === user.id ? user : undefined)),
    });
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => ({ subjectType: "STUDENT", subjectId: "student-a" })) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );

    const tokenPair = await auth.login({ tenantSlug: "dna-egitim", loginName: "student-login", password: "5551234567" }, "127.0.0.1");
    if ("status" in tokenPair) throw new Error("MFA challenge beklenmiyordu.");

    expect(tokenPair.mustChangePassword).toBe(true);
    expect(tokenPair.session).toMatchObject({
      userId: user.id,
      tenantId: "tenant-a",
      roles: ["STUDENT"],
      subjectType: "STUDENT",
      subjectId: "student-a",
    });
    await expect(auth.verifyActiveAccessToken(tokenPair.accessToken)).resolves.toMatchObject({
      mustChangePassword: true,
      sessionId: tokenPair.session.id,
    });
  });

  it("parolayı telefon numarası gibi normalize etmez", async () => {
    const nationalId = "10000000146";
    const user: AuthUser = {
      id: "phone-login",
      name: "Phone Login",
      passwordHash: hashPassword("5551234567", "test-salt"),
      tenantId: "tenant-a",
      nationalIdHash: hashTcIdentity(nationalId),
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    };
    const users = createUserStoreMock({
      findByTenantAndLoginName: vi.fn(async (tenantId, loginName) => (
        tenantId === user.tenantId && loginName === "phone-login" ? user : undefined
      )),
      findById: vi.fn(async (id) => (id === user.id ? user : undefined)),
    });
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );

    await expect(auth.login({ tenantSlug: "dna-egitim", loginName: "phone-login", password: "05551234567" }, "127.0.0.1"))
      .rejects.toThrow("LOGIN_FAILED");
  });

  it("literal portal rolü subject bağı çözülemezse token üretmez", async () => {
    const nationalId = "10000000450";
    const user: AuthUser = {
      id: "teacher-unbound-login",
      name: "Unbound Teacher Login",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      nationalIdHash: hashTcIdentity(nationalId),
      roles: ["TEACHER"],
      membershipVersion: 1,
    };
    const users = createUserStoreMock({
      findByTenantAndLoginName: vi.fn(async (tenantId, loginName) => (
        tenantId === user.tenantId && loginName === "teacher-unbound" ? user : undefined
      )),
      findById: vi.fn(async (id) => (id === user.id ? user : undefined)),
    });
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );

    await expect(auth.login(loginCredentials("teacher-unbound"))).rejects.toThrow("SUBJECT_CONTEXT_MISSING");
  });

  it("staff ve teacher personalarını ayrı session'larda tutar ve switch eski session'ı kapatır", async () => {
    const user: AuthUser = {
      id: "dual-persona-user",
      name: "Dual Persona User",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      roles: ["OPERATIONS_STAFF", "TEACHER"],
      membershipVersion: 4,
      membership: {
        id: "membership-dual",
        staffRole: "OPERATIONS_STAFF",
        hasTeacherPersona: true,
        hasStudentPersona: false,
        version: 4,
      },
    };
    const users = createUserStoreMock({
      findByTenantAndLoginName: vi.fn(async () => user),
      findById: vi.fn(async (id) => (id === user.id ? user : undefined)),
    });
    const sessions = new InMemorySessionStore();
    const identities = {
      resolve: vi.fn(async ({ roles }: { roles: string[] }) => roles.includes("TEACHER")
        ? { subjectType: "TEACHER" as const, subjectId: "teacher-dual" }
        : undefined),
    } as unknown as IdentityResolver;
    const auth = new AuthService(
      users,
      sessions,
      new InMemoryPasswordResetStore(),
      identities,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );

    const login = await auth.login(loginCredentials("dual-persona"));
    if ("status" in login) throw new Error("Token pair bekleniyordu.");
    expect(login.session).toMatchObject({
      membershipId: "membership-dual",
      activePersona: "STAFF",
      roles: ["OPERATIONS_STAFF"],
    });
    expect(login.session.subjectType).toBeUndefined();

    const switched = await auth.switchPersona({
      userId: user.id,
      sessionId: login.session.id,
      tenantId: user.tenantId,
      membershipId: "membership-dual",
      activePersona: "STAFF",
      roles: ["OPERATIONS_STAFF"],
      bypassRls: false,
    }, "TEACHER");
    expect(switched.session).toMatchObject({
      membershipId: "membership-dual",
      activePersona: "TEACHER",
      roles: ["TEACHER"],
      subjectType: "TEACHER",
      subjectId: "teacher-dual",
    });
    await expect(sessions.findById(login.session.id)).resolves.toMatchObject({ status: "REVOKED" });
    await expect(auth.verifyActiveAccessToken(login.accessToken)).rejects.toThrow("ACCESS_SESSION_INACTIVE");
    await expect(auth.verifyActiveAccessToken(switched.accessToken)).resolves.toMatchObject({
      activePersona: "TEACHER",
      roles: ["TEACHER"],
    });
  });

  it("staff session rolünü legacy mirror yerine canonical staffRole'dan üretir", async () => {
    const user: AuthUser = {
      id: "canonical-owner-user",
      name: "Canonical Owner",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membershipVersion: 2,
      membership: {
        id: "membership-owner",
        staffRole: "TENANT_OWNER",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 2,
      },
    };
    const users = createUserStoreMock({ findByTenantAndLoginName: vi.fn(async () => user) });
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );

    const login = await auth.login(loginCredentials("canonical-owner"));
    if ("status" in login) throw new Error("Token pair bekleniyordu.");
    expect(login.session).toMatchObject({ activePersona: "STAFF", roles: ["TENANT_OWNER"] });
  });

  it("üyelikte bulunmayan personaya geçişi reddeder ve mevcut session'ı açık tutar", async () => {
    const user: AuthUser = {
      id: "staff-only-user",
      name: "Staff Only User",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      roles: ["FINANCE_STAFF"],
      membershipVersion: 2,
      membership: {
        id: "membership-staff-only",
        staffRole: "FINANCE_STAFF",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 2,
      },
    };
    const users = createUserStoreMock({
      findByTenantAndLoginName: vi.fn(async () => user),
      findById: vi.fn(async () => user),
    });
    const sessions = new InMemorySessionStore();
    const auth = new AuthService(
      users,
      sessions,
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );
    const login = await auth.login(loginCredentials("staff-only"));
    if ("status" in login) throw new Error("Token pair bekleniyordu.");

    await expect(auth.switchPersona({
      userId: user.id,
      sessionId: login.session.id,
      tenantId: user.tenantId,
      membershipId: "membership-staff-only",
      activePersona: "STAFF",
      roles: ["FINANCE_STAFF"],
      bypassRls: false,
    }, "TEACHER")).rejects.toThrow("PERSONA_NOT_AVAILABLE");
    await expect(sessions.findById(login.session.id)).resolves.toMatchObject({ status: "ACTIVE" });
  });

  it("yalnız kullanıcının tenant içindeki aktif session'larını listeler ve sahiplik sınırında iptal eder", async () => {
    const user: AuthUser = {
      id: "inventory-user",
      name: "Inventory User",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    };
    const users = createUserStoreMock({ findById: vi.fn(async () => user) });
    const sessions = new InMemorySessionStore();
    const current = await sessions.create({
      userId: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
      refreshToken: "inventory-current",
      membershipVersion: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const other = await sessions.create({
      userId: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
      refreshToken: "inventory-other",
      membershipVersion: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const crossTenant = await sessions.create({
      userId: user.id,
      tenantId: "tenant-b",
      roles: user.roles,
      refreshToken: "inventory-cross",
      membershipVersion: 1,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const auth = new AuthService(
      users,
      sessions,
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn() } as unknown as IdentityResolver,
    );
    const context = {
      userId: user.id,
      sessionId: current.id,
      tenantId: user.tenantId,
      roles: user.roles,
      bypassRls: false,
    };

    await expect(auth.listCurrentSessions(context)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: current.id, current: true }),
      expect.objectContaining({ id: other.id, current: false }),
    ]));
    await expect(auth.listCurrentSessions(context)).resolves.toHaveLength(2);
    await expect(auth.revokeCurrentSession(context, crossTenant.id)).rejects.toThrow("SESSION_NOT_FOUND");
    await auth.revokeCurrentSession(context, other.id);
    await expect(sessions.findById(other.id)).resolves.toMatchObject({ status: "REVOKED" });
    await expect(auth.revokeAllCurrentSessions(context)).resolves.toEqual({ revokedCount: 1 });
    await expect(sessions.findById(current.id)).resolves.toMatchObject({ status: "REVOKED" });
    await expect(sessions.findById(crossTenant.id)).resolves.toMatchObject({ status: "ACTIVE" });
  });

  it.each(["TEACHER", "GUARDIAN"] as const)(
    "%s kullanıcı adı login yanlış kurum kodunda global fallback yapmaz",
    async (role) => {
      const nationalId = role === "TEACHER" ? "10000000450" : "10000000764";
      const user: AuthUser = {
        id: `${role.toLowerCase()}-wrong-tenant-login`,
        name: `${role} Wrong Tenant Login`,
        passwordHash: hashPassword("password", "test-salt"),
        tenantId: "tenant-a",
        nationalIdHash: hashTcIdentity(nationalId),
        roles: [role],
        membershipVersion: 1,
      };
      const users = createUserStoreMock({
        findByTenantAndLoginName: vi.fn(async (tenantId, loginName) => (
          tenantId === user.tenantId && loginName === `${role.toLowerCase()}-login` ? user : undefined
        )),
        findById: vi.fn(async (id) => (id === user.id ? user : undefined)),
      });
      const auth = new AuthService(
        users,
        new InMemorySessionStore(),
        new InMemoryPasswordResetStore(),
        { resolve: vi.fn(async () => ({ subjectType: role, subjectId: `${role.toLowerCase()}-a` })) } as unknown as IdentityResolver,
        undefined,
        undefined,
        new InMemoryTenantStore(),
      );

      await expect(auth.login(loginCredentials(`${role.toLowerCase()}-login`, "password", "demo-kurum-b"))).rejects.toThrow("LOGIN_FAILED");
      expect(users.findByTenantAndLoginName).toHaveBeenCalledWith("tenant-b", `${role.toLowerCase()}-login`);
      expect(users.findByNationalIdHash).not.toHaveBeenCalled();
    },
  );

  it("system hesabı system scope ve kullanıcı adıyla login olur", async () => {
    const nationalId = "10000000214";
    const user: AuthUser = {
      id: "user-system",
      name: "System Admin",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "system",
      nationalIdHash: hashTcIdentity(nationalId),
      roles: ["SYSTEM_ADMIN"],
      membershipVersion: 1,
    };
    const users = createUserStoreMock({
      findByTenantAndLoginName: vi.fn(async (tenantId, loginName) => (
        tenantId === user.tenantId && loginName === "system-admin" ? user : undefined
      )),
      findById: vi.fn(async (id) => (id === user.id ? user : undefined)),
    });
    const tenants = new InMemoryTenantStore();
    const findBySlug = vi.spyOn(tenants, "findBySlug");
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      undefined,
      tenants,
    );

    const tokenPair = await auth.login({ tenantSlug: "system", loginName: "system-admin", password: "password" }, "127.0.0.1");
    if ("status" in tokenPair) throw new Error("MFA challenge beklenmiyordu.");

    expect(findBySlug).not.toHaveBeenCalled();
    expect(tokenPair.session).toMatchObject({
      userId: "user-system",
      tenantId: "system",
      roles: ["SYSTEM_ADMIN"],
    });
  });

  it("system hesabı da kurum kodu olmadan aranmaz", async () => {
    const users = createUserStoreMock({});
    const auth = new AuthService(users, new InMemorySessionStore(), new InMemoryPasswordResetStore(),
      { resolve: vi.fn() } as unknown as IdentityResolver, undefined, undefined, new InMemoryTenantStore());

    await expect(auth.login({ tenantSlug: "", loginName: "system-admin", password: "password" }))
      .rejects.toThrow("TENANT_SLUG_REQUIRED");
    expect(users.findByTenantAndLoginName).not.toHaveBeenCalled();
  });

  it("şifre reset tokenı tek kullanımlık çalışır ve eski şifreyi geçersiz kılar", async () => {
    const loginName = "db-a@example.test";
    const user = {
      id: "user-db-a",
      email: "db-a@example.test",
      name: "DB User",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "system",
      roles: ["SYSTEM_ADMIN"],
      membershipVersion: 1,
    };
    const users = createUserStoreMock({
      findByEmail: vi.fn(async (email) => (email === user.email ? { ...user, roles: [...user.roles] } : undefined)),
      findByTenantAndLoginName: vi.fn(async (tenantId, loginName) => (
        tenantId === user.tenantId && loginName === user.email ? { ...user, roles: [...user.roles] } : undefined
      )),
      findById: vi.fn(async () => ({ ...user, roles: [...user.roles] })),
      updatePassword: vi.fn(async (_id, passwordHash) => {
        user.passwordHash = passwordHash;
        user.membershipVersion += 1;
        return { ...user, roles: [...user.roles] };
      }),
    });
    const auditLogs = { record: vi.fn(async () => undefined) };
    const passwordResets = new InMemoryPasswordResetStore();
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      passwordResets,
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      auditLogs as never,
      undefined,
      new InMemoryTenantStore(),
    );

    const issued = await auth.requestPasswordReset({ tenantSlug: "system", loginName });
    expect(issued).toEqual({ status: "ISSUED" });
    expect(users.findByTenantAndLoginName).toHaveBeenCalledWith("system", loginName);
    const pendingReset = await passwordResets.findPendingForUser(user.id);
    expect(Date.parse(pendingReset?.expiresAt ?? "") - Date.now()).toBeGreaterThan(29 * 60 * 1000);
    expect(Date.parse(pendingReset?.expiresAt ?? "") - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
    expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth.password_reset_requested",
      diff: { deliveryChannel: "EMAIL" },
    }));
    expect(JSON.stringify(auditLogs.record.mock.calls)).not.toContain("db-a@example.test");

    await expect(auth.requestPasswordReset({ tenantSlug: "system", loginName })).resolves.toEqual({
      status: "IGNORED",
    });
    const resetToken = "known-reset-token";
    const seededExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await passwordResets.issue({
      userId: user.id,
      tokenHash: hashResetToken(resetToken),
      expiresAt: seededExpiry,
      delivery: testDelivery(seededExpiry),
      resendNotBefore: new Date().toISOString(),
    });

    const concurrentConfirms = await Promise.allSettled([
      auth.confirmPasswordReset(resetToken, "New-secure-password"),
      auth.confirmPasswordReset(resetToken, "New-secure-password"),
    ]);
    expect(concurrentConfirms.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrentConfirms.filter((result) => result.status === "rejected")).toHaveLength(1);

    await expect(auth.login(loginCredentials(user.email, "password", "system"))).rejects.toThrow("LOGIN_FAILED");
    await expect(auth.confirmPasswordReset(resetToken, "Another-secure-pass")).rejects.toThrow(
      "PASSWORD_RESET_NOT_PENDING",
    );
    await expect(auth.login(loginCredentials(user.email, "New-secure-password", "system"))).resolves.toMatchObject({
      session: { userId: "user-db-a" },
    });
  });

  it("şifre reset bağlantısında tokenı yalnız URL fragmentinde taşır", () => {
    const url = new URL(createPasswordResetUrl("reset-token"));

    expect(url.searchParams.has("token")).toBe(false);
    expect(url.hash).toBe("#token=reset-token");
  });

  it("yalnız telefonu olan tenant kullanıcısı için reset tokenı üretmez", async () => {
    const loginName = "tenant-reset-user";
    const user = {
      id: "tenant-reset-user",
      phone: "5551234567",
      name: "Tenant Reset",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    };
    const users = createUserStoreMock({
      findByTenantAndLoginName: vi.fn(async (tenantId, candidateLoginName) => (
        tenantId === user.tenantId && candidateLoginName === loginName ? { ...user, roles: [...user.roles] } : undefined
      )),
      findById: vi.fn(async () => ({ ...user, roles: [...user.roles] })),
      updatePassword: vi.fn(async (_id, passwordHash) => {
        user.passwordHash = passwordHash;
        user.membershipVersion += 1;
        return { ...user, roles: [...user.roles] };
      }),
    });
    const passwordResets = new InMemoryPasswordResetStore();
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      passwordResets,
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );

    const issued = await auth.requestPasswordReset({ tenantSlug: "dna-egitim", loginName });
    expect(issued).toEqual({ status: "IGNORED" });
  });

  it("access token session iptalinden sonra aktif kabul edilmez", async () => {
    const sessions = new InMemorySessionStore();
    const nationalId = "10000000146";
    const user = {
      id: "user-db-a",
      email: "db-a@example.test",
      name: "DB User",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      nationalIdHash: hashTcIdentity(nationalId),
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    };
    const users = createUserStoreMock({
      findByTenantAndLoginName: vi.fn(async (tenantId, loginName) => (
        tenantId === user.tenantId && loginName === user.email ? { ...user, roles: [...user.roles] } : undefined
      )),
      findByTenantAndNationalIdHash: vi.fn(async (tenantId, nationalIdHash) => (
        tenantId === user.tenantId && nationalIdHash === user.nationalIdHash ? { ...user, roles: [...user.roles] } : undefined
      )),
      findById: vi.fn(async () => ({ ...user, roles: [...user.roles] })),
    });
    const auth = new AuthService(
      users,
      sessions,
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );
    const issued = await auth.login(loginCredentials(user.email));
    if ("status" in issued) throw new Error("MFA challenge beklenmiyordu.");

    await expect(auth.verifyActiveAccessToken(issued.accessToken)).resolves.toMatchObject({
      roles: ["TENANT_ADMIN"],
      sessionId: issued.session.id,
    });
    await sessions.revoke(issued.session.id);

    await expect(auth.verifyActiveAccessToken(issued.accessToken)).rejects.toThrow("ACCESS_SESSION_INACTIVE");
  });

  it("membership sürümü veya rolü değişince eski access ve refresh tokenını reddeder", async () => {
    const user: AuthUser = {
      id: "membership-change-user",
      email: "membership-change@example.test",
      name: "Membership Change",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    };
    const sessions = new InMemorySessionStore();
    const auth = new AuthService(
      createMutableUserStore(user),
      sessions,
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );
    const issued = await auth.login(loginCredentials(user.email ?? ""));
    if ("status" in issued) throw new Error("MFA challenge beklenmiyordu.");

    user.membershipVersion += 1;
    user.roles = ["ASSISTANT_ADMIN"];

    await expect(auth.verifyActiveAccessToken(issued.accessToken)).rejects.toThrow("ACCESS_MEMBERSHIP_CHANGED");
    await expect(auth.refresh(issued.refreshToken)).rejects.toThrow("REFRESH_MEMBERSHIP_CHANGED");
    await expect(sessions.findById(issued.session.id)).resolves.toMatchObject({ status: "REVOKED" });
  });

  it("production'da JWT access secret yoksa başlamaz", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_ACCESS_SECRET;

    expect(() => new AuthService(
      createUserStoreMock({}),
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn() } as unknown as IdentityResolver,
    )).toThrow("JWT_ACCESS_SECRET_REQUIRED");
  });

  it("MFA required iken TOTP kaydı olmayan sistem adminini tek kullanımlık enrollment ile içeri alır", async () => {
    process.env.ADMIN_MFA_MODE = "required";
    const user: AuthUser = {
      id: "admin-mfa-required",
      email: "admin-required@example.test",
      nationalIdHash: hashTcIdentity("10000000146"),
      name: "Required MFA Admin",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "system",
      roles: ["SYSTEM_ADMIN"],
      membershipVersion: 1,
    };
    const users = createMutableUserStore(user);
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );

    const enrollment = await auth.login(loginCredentials(user.email ?? "", "password", "system"));
    expect(enrollment).toMatchObject({ status: "MFA_ENROLLMENT_REQUIRED", recoveryCodes: expect.any(Array) });
    if (!("status" in enrollment) || enrollment.status !== "MFA_ENROLLMENT_REQUIRED") {
      throw new Error("MFA enrollment bekleniyordu.");
    }
    const issued = await auth.confirmRequiredTotpEnrollment(
      enrollment.setupToken,
      createTotpCodeForTest(enrollment.secret),
    );
    expect(issued.session.roles).toContain("SYSTEM_ADMIN");
    await expect(auth.confirmRequiredTotpEnrollment(
      enrollment.setupToken,
      createTotpCodeForTest(enrollment.secret),
    )).rejects.toThrow("MFA_SETUP_TOKEN_INVALID");

    await auth.disableTotp({
      userId: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
      bypassRls: false,
    }, { totpCode: createTotpCodeForTest(enrollment.secret, Date.now() + 30_000) });
    await expect(auth.confirmRequiredTotpEnrollment(
      enrollment.setupToken,
      createTotpCodeForTest(enrollment.secret, Date.now() + 60_000),
    )).rejects.toThrow("MFA_SETUP_TOKEN_INVALID");
  });

  it.each([
    "TENANT_OWNER",
    "TENANT_ADMIN",
    "OPERATIONS_STAFF",
    "FINANCE_STAFF",
    "TEACHER",
    "STUDENT",
    "GUARDIAN",
  ])("MFA required iken %s rolünü enrollment veya challenge'a zorlamaz", async (role) => {
    process.env.ADMIN_MFA_MODE = "required";
    const user: AuthUser = {
      id: `tenant-mfa-exempt-${role.toLowerCase()}`,
      email: `${role.toLowerCase()}@example.test`,
      nationalIdHash: hashTcIdentity("10000000146"),
      name: "Tenant MFA Exempt",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      roles: [role],
      membershipVersion: 1,
      totpEnabledAt: "2026-08-01T00:00:00.000Z",
      totpSecretEncrypted: "legacy-tenant-secret",
    };
    const auth = new AuthService(
      createMutableUserStore(user),
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => (
        role === "TEACHER" || role === "STUDENT" || role === "GUARDIAN"
          ? { subjectType: role, subjectId: `${role.toLowerCase()}-a` }
          : undefined
      )) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );

    const issued = await auth.login(loginCredentials(user.email ?? ""));
    expect(issued).not.toHaveProperty("status");
    if ("status" in issued) throw new Error("Kurum rolü için MFA beklenmiyordu.");
    expect(issued.session.roles).toContain(role);
    await expect(auth.createTotpSetup({
      userId: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
      bypassRls: false,
    })).rejects.toThrow("ADMIN_MFA_ADMIN_ROLE_REQUIRED");
  });

  it("sistem admini TOTP etkinleştikten sonra login'i MFA challenge'a böler ve TOTP reuse'u reddeder", async () => {
    process.env.ADMIN_MFA_MODE = "optional";
    const user: AuthUser = {
      id: "admin-mfa",
      email: "admin-mfa@example.test",
      nationalIdHash: hashTcIdentity("10000000146"),
      name: "MFA Admin",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "system",
      roles: ["SYSTEM_ADMIN"],
      membershipVersion: 1,
      totpRecoveryCodeHashes: [],
    };
    const users = createMutableUserStore(user);
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );

    const setup = await auth.createTotpSetup({
      userId: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
      bypassRls: false,
    });
    const setupCode = createTotpCodeForTest(setup.secret);
    await auth.confirmTotpSetup({
      userId: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
      bypassRls: false,
    }, setup.setupToken, setupCode);

    const challenge = await auth.login(loginCredentials(user.email ?? "", "password", "system"));
    expect(challenge).toMatchObject({ status: "MFA_REQUIRED", methods: ["totp", "recovery_code"] });
    if (!("status" in challenge) || challenge.status !== "MFA_REQUIRED") throw new Error("MFA challenge bekleniyordu.");

    const loginCode = createTotpCodeForTest(setup.secret, Date.now() + 30_000);
    await expect(auth.verifyTotpChallenge(challenge.challengeToken, { totpCode: loginCode })).resolves.toMatchObject({
      session: { userId: user.id },
    });
    await expect(auth.verifyTotpChallenge(challenge.challengeToken, { totpCode: loginCode })).rejects.toThrow(
      "MFA_CODE_REUSED",
    );
  });

  it("beş yanlış MFA challenge denemesinden sonra doğru kodu da kilitler", async () => {
    process.env.ADMIN_MFA_MODE = "optional";
    const user: AuthUser = {
      id: "admin-mfa-limiter",
      email: "admin-mfa-limiter@example.test",
      nationalIdHash: hashTcIdentity("10000000972"),
      name: "MFA Limiter Admin",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "system",
      roles: ["SYSTEM_ADMIN"],
      membershipVersion: 1,
      totpRecoveryCodeHashes: [],
    };
    const users = createMutableUserStore(user);
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      new LoginAttemptLimiter(5, 60_000),
      new InMemoryTenantStore(),
    );
    const context = { userId: user.id, tenantId: user.tenantId, roles: user.roles, bypassRls: false };
    const setup = await auth.createTotpSetup(context);
    await auth.confirmTotpSetup(context, setup.setupToken, createTotpCodeForTest(setup.secret));
    const challenge = await auth.login(loginCredentials(user.email ?? "", "password", "system"));
    if (!("status" in challenge) || challenge.status !== "MFA_REQUIRED") throw new Error("MFA challenge bekleniyordu.");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(auth.verifyTotpChallenge(challenge.challengeToken, { totpCode: "invalid" })).rejects.toThrow("MFA_CODE_INVALID");
    }

    const renewedChallenge = await auth.login(loginCredentials(user.email ?? "", "password", "system"));
    if (!("status" in renewedChallenge) || renewedChallenge.status !== "MFA_REQUIRED") {
      throw new Error("Yenilenen MFA challenge bekleniyordu.");
    }
    await expect(auth.verifyTotpChallenge(renewedChallenge.challengeToken, {
      totpCode: createTotpCodeForTest(setup.secret, Date.now() + 30_000),
    })).rejects.toThrow("MFA_CHALLENGE_LOCKED");

    await expect(auth.verifyTotpChallenge(challenge.challengeToken, {
      totpCode: createTotpCodeForTest(setup.secret, Date.now() + 30_000),
    })).rejects.toThrow("MFA_CHALLENGE_LOCKED");
  });

  it("MFA kapatma ve step-up yanlış ikinci faktör denemelerini ayrı kilitler", async () => {
    process.env.ADMIN_MFA_MODE = "optional";
    const user: AuthUser = {
      id: "admin-mfa-sensitive-actions",
      email: "admin-mfa-sensitive-actions@example.test",
      nationalIdHash: hashTcIdentity("10000000570"),
      name: "Sensitive MFA Admin",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "system",
      roles: ["SYSTEM_ADMIN"],
      membershipVersion: 1,
      totpRecoveryCodeHashes: [],
    };
    const users = createMutableUserStore(user);
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      new LoginAttemptLimiter(5, 60_000),
      new InMemoryTenantStore(),
    );
    const setupContext = { userId: user.id, tenantId: user.tenantId, roles: user.roles, bypassRls: false };
    const setup = await auth.createTotpSetup(setupContext);
    await auth.confirmTotpSetup(setupContext, setup.setupToken, createTotpCodeForTest(setup.secret));
    const actionContext = { ...setupContext, sessionId: "session-mfa-sensitive-actions", membershipVersion: user.membershipVersion };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(auth.disableTotp(actionContext, { totpCode: "invalid" })).rejects.toThrow("MFA_CODE_INVALID");
    }
    await expect(auth.disableTotp(actionContext, {
      totpCode: createTotpCodeForTest(setup.secret, Date.now() + 30_000),
    })).rejects.toThrow("MFA_SECOND_FACTOR_LOCKED");

    await expect(auth.createMfaStepUp(actionContext, "OWNER_ADMIN_CHANGE", { totpCode: "invalid" })).rejects.toThrow(
      "MFA_CODE_INVALID",
    );
    await expect(auth.createMfaStepUp(actionContext, "OWNER_ADMIN_CHANGE", {
      recoveryCode: setup.recoveryCodes[0],
    })).resolves.toMatchObject({ purpose: "OWNER_ADMIN_CHANGE" });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(auth.createMfaStepUp(actionContext, "OWNER_ADMIN_CHANGE", { totpCode: "invalid" })).rejects.toThrow(
        "MFA_CODE_INVALID",
      );
    }
    await expect(auth.createMfaStepUp(actionContext, "OWNER_ADMIN_CHANGE", {
      totpCode: createTotpCodeForTest(setup.secret, Date.now() + 30_000),
    })).rejects.toThrow("MFA_SECOND_FACTOR_LOCKED");
  });

  it("admin recovery code'u tek kullanımlık tüketir", async () => {
    process.env.ADMIN_MFA_MODE = "optional";
    const user: AuthUser = {
      id: "admin-recovery",
      email: "admin-recovery@example.test",
      nationalIdHash: hashTcIdentity("10000000382"),
      name: "Recovery Admin",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "system",
      roles: ["SYSTEM_ADMIN"],
      membershipVersion: 1,
      totpRecoveryCodeHashes: [],
    };
    const users = createMutableUserStore(user);
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );
    const context = {
      userId: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
      bypassRls: false,
    };
    const setup = await auth.createTotpSetup(context);
    await auth.confirmTotpSetup(context, setup.setupToken, createTotpCodeForTest(setup.secret));
    const challenge = await auth.login(loginCredentials(user.email ?? "", "password", "system"));
    if (!("status" in challenge) || challenge.status !== "MFA_REQUIRED") throw new Error("MFA challenge bekleniyordu.");

    await expect(auth.verifyTotpChallenge(challenge.challengeToken, { recoveryCode: setup.recoveryCodes[0] })).resolves.toMatchObject({
      session: { userId: user.id },
    });
    await expect(auth.verifyTotpChallenge(challenge.challengeToken, { recoveryCode: setup.recoveryCodes[0] })).rejects.toThrow(
      "MFA_RECOVERY_CODE_INVALID",
    );
  });

  it("step-up MFA kanıtını aktif oturum ve güncel üyelik sürümü için üretir", async () => {
    process.env.ADMIN_MFA_MODE = "optional";
    const user: AuthUser = {
      id: "admin-step-up",
      email: "admin-step-up@example.test",
      nationalIdHash: hashTcIdentity("10000000146"),
      name: "Step-up Admin",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "system",
      roles: ["SYSTEM_ADMIN"],
      membershipVersion: 1,
      totpRecoveryCodeHashes: [],
    };
    const users = createMutableUserStore(user);
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );
    const setupContext = { userId: user.id, tenantId: user.tenantId, roles: user.roles, bypassRls: false };
    const setup = await auth.createTotpSetup(setupContext);
    await auth.confirmTotpSetup(setupContext, setup.setupToken, createTotpCodeForTest(setup.secret));
    const challenge = await auth.login(loginCredentials(user.email ?? "", "password", "system"));
    if (!("status" in challenge) || challenge.status !== "MFA_REQUIRED") throw new Error("MFA challenge bekleniyordu.");
    const issued = await auth.verifyTotpChallenge(challenge.challengeToken, {
      totpCode: createTotpCodeForTest(setup.secret, Date.now() + 30_000),
    });
    const context = {
      userId: user.id,
      sessionId: issued.session.id,
      tenantId: user.tenantId,
      membershipVersion: issued.session.membershipVersion,
      roles: user.roles,
      bypassRls: false,
    };
    const proof = await auth.createMfaStepUp(context, "OWNER_ADMIN_CHANGE", {
      recoveryCode: setup.recoveryCodes[0],
    });

    expect(proof).toMatchObject({ purpose: "OWNER_ADMIN_CHANGE", stepUpToken: expect.any(String), expiresAt: expect.any(String) });
    expect(() => verifyAdminMfaStepUpProof(proof.stepUpToken, {
      userId: user.id,
      sessionId: issued.session.id,
      membershipVersion: issued.session.membershipVersion,
      purpose: "OWNER_ADMIN_CHANGE",
    })).not.toThrow();
    await expect(auth.createMfaStepUp({ ...context, membershipVersion: context.membershipVersion + 1 }, "OWNER_ADMIN_CHANGE", {
      recoveryCode: setup.recoveryCodes[1],
    })).rejects.toThrow("MFA_STEP_UP_CONTEXT_INVALID");
  });
});

function loginCredentials(loginName: string, password = "password", tenantSlug = "dna-egitim") {
  return { tenantSlug, loginName, password };
}

function testDelivery(expiresAt: string) {
  return {
    purpose: "PASSWORD_RESET" as const,
    payloadEncrypted: "test-encrypted-payload",
    expiresAt,
  };
}

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function createUserStoreMock(overrides: Partial<AuthUserStore>): AuthUserStore {
  return {
    findByEmail: vi.fn(),
    findByTenantAndLoginName: vi.fn(),
    findByTenantAndNationalIdHash: vi.fn(),
    findByNationalIdHash: vi.fn(async () => []),
    findById: vi.fn(),
    listByTenant: vi.fn(async () => []),
    createOrAttachTenantIdentity: vi.fn(),
    updatePassword: vi.fn(),
    updatePasswordForReset: vi.fn(async (id, passwordHash, input, transaction) => {
      if (transaction.kind !== "memory" || !overrides.updatePassword) return false;
      transaction.stage(() => { void overrides.updatePassword!(id, passwordHash, input); });
      return true;
    }),
    rehashPassword: vi.fn(async () => true),
    enableTotp: vi.fn(),
    disableTotp: vi.fn(),
    markTotpCounterUsed: vi.fn(),
    consumeTotpRecoveryCode: vi.fn(),
    purgePii: vi.fn(),
    ...overrides,
  };
}

function createMutableUserStore(user: AuthUser): AuthUserStore {
  const clone = () => ({ ...user, roles: [...user.roles], totpRecoveryCodeHashes: [...(user.totpRecoveryCodeHashes ?? [])] });
  return {
    findByEmail: vi.fn(async (email) => (email === user.email ? clone() : undefined)),
    findByTenantAndLoginName: vi.fn(async (tenantId, loginName) => (
      tenantId === user.tenantId && loginName === user.email ? clone() : undefined
    )),
    findByTenantAndNationalIdHash: vi.fn(async (tenantId, nationalIdHash) => (
      tenantId === user.tenantId && nationalIdHash === user.nationalIdHash ? clone() : undefined
    )),
    findByNationalIdHash: vi.fn(async (nationalIdHash) => (
      nationalIdHash === user.nationalIdHash && user.tenantId !== "system" ? [clone()] : []
    )),
    findById: vi.fn(async (id) => (id === user.id ? clone() : undefined)),
    listByTenant: vi.fn(async (tenantId) => (tenantId === user.tenantId ? [clone()] : [])),
    createOrAttachTenantIdentity: vi.fn(),
    updatePassword: vi.fn(async (_id, passwordHash) => {
      user.passwordHash = passwordHash;
      user.membershipVersion += 1;
      return clone();
    }),
    updatePasswordForReset: vi.fn(async (_id, passwordHash, input, transaction) => {
      if (transaction.kind !== "memory") return false;
      transaction.stage(() => {
        user.passwordHash = passwordHash;
        user.mustChangePassword = input.mustChangePassword ?? user.mustChangePassword;
        user.passwordChangedAt = input.passwordChangedAt ?? user.passwordChangedAt;
        user.membershipVersion += 1;
      });
      return true;
    }),
    rehashPassword: vi.fn(async (tenantId, _id, currentPasswordHash, passwordHash) => {
      if (tenantId !== user.tenantId) return false;
      if (user.passwordHash !== currentPasswordHash) return false;
      user.passwordHash = passwordHash;
      return true;
    }),
    enableTotp: vi.fn(async (input) => {
      if (user.totpSecretEncrypted || user.totpEnabledAt) return undefined;
      user.totpSecretEncrypted = input.secretEncrypted;
      user.totpEnabledAt = input.enabledAt;
      user.totpRecoveryCodeHashes = [...input.recoveryCodeHashes];
      user.totpLastUsedCounter = input.lastUsedCounter;
      user.membershipVersion += 1;
      return clone();
    }),
    disableTotp: vi.fn(async () => {
      user.totpSecretEncrypted = undefined;
      user.totpEnabledAt = undefined;
      user.totpRecoveryCodeHashes = [];
      user.totpLastUsedCounter = undefined;
      user.membershipVersion += 1;
      return clone();
    }),
    markTotpCounterUsed: vi.fn(async (_userId, counter) => {
      if (!/^\d+$/.test(counter) || (user.totpLastUsedCounter && BigInt(counter) <= BigInt(user.totpLastUsedCounter))) return false;
      user.totpLastUsedCounter = counter;
      return true;
    }),
    consumeTotpRecoveryCode: vi.fn(async (_userId, codeHash) => {
      if (!user.totpRecoveryCodeHashes?.includes(codeHash)) return false;
      user.totpRecoveryCodeHashes = user.totpRecoveryCodeHashes.filter((hash) => hash !== codeHash);
      return true;
    }),
    purgePii: vi.fn(),
  };
}
