import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword, type AuthUser, type AuthUserStore, verifyPasswordAsync } from "./auth-user-store.js";
import { AuthService, createPasswordResetUrl, hashResetToken } from "./auth.service.js";
import type { IdentityResolver } from "./identity-resolver.js";
import { InMemoryPasswordResetStore } from "./password-reset-store.js";
import { InMemorySessionStore } from "./session-store.js";
import { LoginAttemptLimiter } from "./login-attempt-limiter.js";
import { createAdminMfaStepUpProof, createTotpCodeForTest, verifyAdminMfaResetStepUpProof, verifyAdminMfaStepUpProof } from "./totp-mfa.js";
import { hashTcIdentity } from "../student/tc-identity.js";
import { InMemoryTenantStore } from "../tenant/tenant-store.js";
import { InMemoryMfaSecurityNoticeStore } from "./mfa-security-notice.js";
import { apiLogger } from "../observability/logging.js";
import { resetSecuritySideEffectFailureCounts, securitySideEffectFailureCounts } from "../observability/security-side-effect-counters.js";

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
    expect(users.rehashPassword).toHaveBeenCalledWith(user.tenantId, user.id, user.passwordHash, expect.stringMatching(/^scrypt:v2:/), 1);
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
      membershipVersion: user.membershipVersion,
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
      membershipVersion: user.membershipVersion,
      bypassRls: false,
    }, { totpCode: createTotpCodeForTest(enrollment.secret, Date.now() + 30_000) });
    await expect(auth.confirmRequiredTotpEnrollment(
      enrollment.setupToken,
      createTotpCodeForTest(enrollment.secret, Date.now() + 60_000),
    )).rejects.toThrow("MFA_SETUP_TOKEN_INVALID");
  });

  it.each([
    "ASSISTANT_ADMIN",
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
      membershipVersion: user.membershipVersion,
      bypassRls: false,
    })).rejects.toThrow("ADMIN_MFA_ADMIN_ROLE_REQUIRED");
  });

  it.each(["TENANT_OWNER", "TENANT_ADMIN"])("MFA required iken mevcut %s kullanıcısını kilitlemeden ilk girişte enrollment'a alır, sonra challenge eder", async (role) => {
    process.env.ADMIN_MFA_MODE = "required";
    const user: AuthUser = {
      id: `tenant-mfa-${role.toLowerCase()}`,
      email: `mfa-${role.toLowerCase()}@example.test`,
      nationalIdHash: hashTcIdentity("10000000146"),
      name: "Tenant MFA Admin",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      roles: [role],
      membershipVersion: 1,
    };
    const auth = new AuthService(
      createMutableUserStore(user),
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );

    const enrollment = await auth.login(loginCredentials(user.email ?? ""));
    if (!("status" in enrollment) || enrollment.status !== "MFA_ENROLLMENT_REQUIRED") throw new Error("MFA enrollment bekleniyordu.");
    const enrolled = await auth.confirmRequiredTotpEnrollment(enrollment.setupToken, createTotpCodeForTest(enrollment.secret));
    expect(enrolled.session).toMatchObject({ tenantId: "tenant-a", roles: expect.arrayContaining([role]) });

    const challenge = await auth.login(loginCredentials(user.email ?? ""));
    expect(challenge).toMatchObject({ status: "MFA_REQUIRED" });
    if (!("status" in challenge) || challenge.status !== "MFA_REQUIRED") throw new Error("MFA challenge bekleniyordu.");
    await expect(auth.verifyTotpChallenge(challenge.challengeToken, {
      totpCode: createTotpCodeForTest(enrollment.secret, Date.now() + 30_000),
    })).resolves.toMatchObject({ session: { userId: user.id } });

    const tenantContext = {
      userId: user.id, tenantId: user.tenantId, roles: user.roles, membershipVersion: user.membershipVersion,
      sessionId: enrolled.session.id, bypassRls: false,
    };
    await expect(auth.getTotpStatus(tenantContext)).resolves.toMatchObject({ enabled: true, mode: "required" });
    // Step-up stays bound to the system tenant: a tenant OWNER/ADMIN never gets a system step-up proof.
    for (const purpose of ["OWNER_ADMIN_CHANGE", "TENANT_LIFECYCLE_CHANGE"] as const) {
      await expect(auth.createMfaStepUp(tenantContext, purpose, {
        totpCode: createTotpCodeForTest(enrollment.secret, Date.now() + 60_000),
      }, purpose === "TENANT_LIFECYCLE_CHANGE" ? { tenantId: "tenant-a", status: "SUSPENDED", expectedLifecycleVersion: 0 } : undefined))
        .rejects.toThrow("MFA_STEP_UP_CONTEXT_INVALID");
    }
  });

  it("SYSTEM_ADMIN step-up ile kurum OWNER MFA'sını sıfırlar, oturumları kapatır ve audit'e yazar", async () => {
    process.env.ADMIN_MFA_MODE = "required";
    const owner: AuthUser = {
      id: "tenant-owner-mfa-reset",
      email: "owner-reset@example.test",
      name: "Owner Reset",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      roles: ["TENANT_OWNER"],
      membershipVersion: 3,
      totpSecretEncrypted: "encrypted",
      totpEnabledAt: "2026-09-01T00:00:00.000Z",
      totpRecoveryCodeHashes: ["hash"],
    };
    const sessions = new InMemorySessionStore();
    const revoke = vi.spyOn(sessions, "revokeByUser");
    const record = vi.fn(async () => undefined);
    const auth = new AuthService(
      createMutableUserStore(owner),
      sessions,
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      { record } as never,
      undefined,
      new InMemoryTenantStore(),
    );
    const admin = { userId: "system-admin-reset", tenantId: null, roles: ["SYSTEM_ADMIN"], membershipVersion: 1, sessionId: "system-session", bypassRls: true };
    const proof = createAdminMfaStepUpProof({ userId: admin.userId, sessionId: admin.sessionId, membershipVersion: 1, purpose: "OWNER_ADMIN_CHANGE", target: { tenantId: "tenant-a", userId: owner.id, expectedMembershipVersion: 3 } }).stepUpToken;
    const ownerContext = { userId: owner.id, tenantId: owner.tenantId, roles: owner.roles, membershipVersion: 3, sessionId: "owner-session", bypassRls: false };

    await expect(auth.resetTotpBySystemAdmin(admin, { tenantId: "tenant-a", userId: owner.id })).rejects.toThrow("MFA_STEP_UP_REQUIRED");
    await expect(auth.resetTotpBySystemAdmin(ownerContext, { tenantId: "tenant-a", userId: owner.id }, proof)).rejects.toThrow("MFA_STEP_UP_CONTEXT_INVALID");
    // The proof is bound to { tenant-a, owner }: it cannot reset the same id in another tenant or another account.
    await expect(auth.resetTotpBySystemAdmin(admin, { tenantId: "tenant-b", userId: owner.id }, proof)).rejects.toThrow("MFA_STEP_UP_INVALID");
    await expect(auth.resetTotpBySystemAdmin(admin, { tenantId: "tenant-a", userId: "other-owner" }, proof)).rejects.toThrow("MFA_STEP_UP_INVALID");
    const otherTenantProof = createAdminMfaStepUpProof({ userId: admin.userId, sessionId: admin.sessionId, membershipVersion: 1, purpose: "OWNER_ADMIN_CHANGE", target: { tenantId: "tenant-b", userId: owner.id, expectedMembershipVersion: 3 } }).stepUpToken;
    await expect(auth.resetTotpBySystemAdmin(admin, { tenantId: "tenant-b", userId: owner.id }, otherTenantProof)).rejects.toThrow("MFA_RESET_TARGET_NOT_FOUND");
    // A proof without the server-bound target version (the pre-binding shape) is not accepted.
    const unboundProof = createAdminMfaStepUpProof({ userId: admin.userId, sessionId: admin.sessionId, membershipVersion: 1, purpose: "OWNER_ADMIN_CHANGE", target: { tenantId: "tenant-a", userId: owner.id } }).stepUpToken;
    await expect(auth.resetTotpBySystemAdmin(admin, { tenantId: "tenant-a", userId: owner.id }, unboundProof)).rejects.toThrow("MFA_STEP_UP_INVALID");

    const reset = await auth.resetTotpBySystemAdmin(admin, { tenantId: "tenant-a", userId: owner.id }, proof);
    expect(reset).toMatchObject({ resetAt: expect.any(String), reenrollmentCode: expect.stringMatching(/^\d{4}-\d{4}$/), notificationQueued: false });
    // Review P2-2: replaying the same proof inside its 5 minutes is refused and does not replace the code just issued.
    const storedAfterFirst = owner.totpReenrollmentCodeHash;
    await expect(auth.resetTotpBySystemAdmin(admin, { tenantId: "tenant-a", userId: owner.id }, proof)).rejects.toMatchObject({ status: 409, message: "MFA_RESET_TARGET_STALE" });
    expect(owner.totpReenrollmentCodeHash).toBe(storedAfterFirst);
    expect(owner.membershipVersion).toBe(4);
    expect(Date.parse(reset.reenrollmentExpiresAt) - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(owner.totpSecretEncrypted).toBeUndefined();
    // Only a keyed hash bound to the reset version (3 -> 4) is stored, never the code.
    expect(owner.totpReenrollmentCodeHash).toMatch(/^v1:4:[A-Za-z0-9_-]{43}$/);
    expect(owner.totpReenrollmentCodeHash).not.toContain(reset.reenrollmentCode.replace("-", ""));
    expect(owner.totpReenrollmentExpiresAt).toBe(reset.reenrollmentExpiresAt);
    expect(revoke).toHaveBeenCalledWith(owner.id, { tenantId: "tenant-a", membershipVersion: 3 });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-a", actorUserId: admin.userId, entityId: owner.id, action: "auth.totp_reset_by_system_admin",
      diff: expect.objectContaining({ reenrollmentExpiresAt: reset.reenrollmentExpiresAt, reenrollmentCodeIssued: true, sessionsRevoked: true }),
    }));
    expect(JSON.stringify(record.mock.calls)).not.toContain(reset.reenrollmentCode);
    expect(JSON.stringify(record.mock.calls)).not.toContain(owner.totpReenrollmentCodeHash!);
    // DEC-20261021-01: the password alone no longer completes enrollment after a support reset.
    const enrollment = await auth.login(loginCredentials(owner.email ?? ""));
    expect(enrollment).toMatchObject({ status: "MFA_ENROLLMENT_REQUIRED", reenrollmentCodeRequired: true });
  });

  describe("SYSTEM_ADMIN reset re-enrollment code (DEC-20261021-01)", () => {
    function setup(overrides: Partial<AuthUser> = {}) {
      process.env.ADMIN_MFA_MODE = "required";
      const owner: AuthUser = {
        id: "tenant-owner-reenroll",
        email: "owner-reenroll@example.test",
        name: "Owner Reenroll",
        passwordHash: hashPassword("password", "test-salt"),
        tenantId: "tenant-a",
        roles: ["TENANT_OWNER"],
        membershipVersion: 5,
        totpSecretEncrypted: "encrypted",
        totpEnabledAt: "2026-09-01T00:00:00.000Z",
        totpRecoveryCodeHashes: ["hash"],
        ...overrides,
      };
      const users = createMutableUserStore(owner);
      const record = vi.fn(async () => undefined);
      const notices = new InMemoryMfaSecurityNoticeStore();
      const limiter = new LoginAttemptLimiter(5, 60_000);
      const auth = new AuthService(
        users,
        new InMemorySessionStore(),
        new InMemoryPasswordResetStore(),
        { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
        { record } as never,
        limiter,
        new InMemoryTenantStore(),
        undefined,
        notices,
      );
      const admin = { userId: "system-admin-reenroll", tenantId: null, roles: ["SYSTEM_ADMIN"], membershipVersion: 1, sessionId: "system-session", bypassRls: true };
      // A fresh step-up per reset, bound (as createMfaStepUp does) to the target's current version.
      const proofFor = () => createAdminMfaStepUpProof({
        userId: admin.userId, sessionId: admin.sessionId, membershipVersion: 1, purpose: "OWNER_ADMIN_CHANGE",
        target: { tenantId: "tenant-a", userId: owner.id, expectedMembershipVersion: owner.membershipVersion },
      }).stepUpToken;
      const reset = (proof = proofFor()) => auth.resetTotpBySystemAdmin(admin, { tenantId: "tenant-a", userId: owner.id }, proof);
      const loginEnrollment = async () => {
        const result = await auth.login(loginCredentials(owner.email ?? ""));
        if (!("status" in result) || result.status !== "MFA_ENROLLMENT_REQUIRED") throw new Error("MFA enrollment bekleniyordu.");
        return result;
      };
      return { auth, owner, users, record, notices, reset, proofFor, loginEnrollment, admin };
    }

    it("requires the code, rejects a wrong or missing code under the limiter and accepts the right code once", async () => {
      const { auth, owner, record, notices, reset, loginEnrollment } = setup();
      const issued = await reset();
      expect(issued.notificationQueued).toBe(true);
      expect(notices.notices).toEqual([expect.objectContaining({ kind: "MFA_RESET_BY_SUPPORT", to: owner.email })]);
      const enrollment = await loginEnrollment();
      expect(enrollment.reenrollmentCodeRequired).toBe(true);
      const totp = (offset = 0) => createTotpCodeForTest(enrollment.secret, Date.now() + offset);

      await expect(auth.confirmRequiredTotpEnrollment(enrollment.setupToken, totp())).rejects.toThrow("MFA_REENROLLMENT_CODE_REQUIRED");
      const wrong = issued.reenrollmentCode === "0000-0000" ? "1111-1111" : "0000-0000";
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await expect(auth.confirmRequiredTotpEnrollment(enrollment.setupToken, totp(), {}, { reenrollmentCode: wrong })).rejects.toThrow("MFA_REENROLLMENT_CODE_INVALID");
      }
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.totp_reenrollment_code_rejected", entityId: owner.id, diff: { reason: "invalid" } }));
      // Five failures lock the reset-bound attempt key: even the correct code is refused until the lock expires.
      await expect(auth.confirmRequiredTotpEnrollment(enrollment.setupToken, totp(), {}, { reenrollmentCode: issued.reenrollmentCode }))
        .rejects.toMatchObject({ status: 429, message: "MFA_REENROLLMENT_LOCKED" });
      expect(owner.totpEnabledAt).toBeUndefined();
      expect(owner.totpReenrollmentCodeHash).toBeDefined();
      expect(JSON.stringify(record.mock.calls)).not.toContain(issued.reenrollmentCode);
    });

    it("enables TOTP with the right code, clears the code atomically and the code works only once", async () => {
      const { auth, owner, record, notices, reset, loginEnrollment } = setup();
      const issued = await reset();
      const enrollment = await loginEnrollment();
      const session = await auth.confirmRequiredTotpEnrollment(enrollment.setupToken, createTotpCodeForTest(enrollment.secret), {}, {
        reenrollmentCode: issued.reenrollmentCode.replace("-", " "),
      });
      expect(session.session).toMatchObject({ userId: owner.id, tenantId: "tenant-a", roles: ["TENANT_OWNER"] });
      expect(owner.totpEnabledAt).toEqual(expect.any(String));
      expect(owner.totpReenrollmentCodeHash).toBeUndefined();
      expect(owner.totpReenrollmentExpiresAt).toBeUndefined();
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.totp_enrollment_completed", diff: expect.objectContaining({ reenrollmentCodeUsed: true }) }));
      expect(notices.notices.map((notice) => notice.kind)).toEqual(["MFA_RESET_BY_SUPPORT", "MFA_REENROLLED"]);
      // Replaying the same setup token and code cannot enroll a second authenticator.
      await expect(auth.confirmRequiredTotpEnrollment(enrollment.setupToken, createTotpCodeForTest(enrollment.secret, Date.now() + 30_000), {}, {
        reenrollmentCode: issued.reenrollmentCode,
      })).rejects.toThrow("MFA_SETUP_TOKEN_INVALID");
      await expect(auth.login(loginCredentials(owner.email ?? ""))).resolves.toMatchObject({ status: "MFA_REQUIRED" });
    });

    it("a second reset invalidates the first code", async () => {
      const { auth, owner, reset, loginEnrollment } = setup();
      const first = await reset();
      const second = await reset();
      expect(second.reenrollmentCode).toMatch(/^\d{4}-\d{4}$/);
      expect(owner.totpReenrollmentCodeHash).toMatch(/^v1:7:/);
      const enrollment = await loginEnrollment();
      if (first.reenrollmentCode !== second.reenrollmentCode) {
        await expect(auth.confirmRequiredTotpEnrollment(enrollment.setupToken, createTotpCodeForTest(enrollment.secret), {}, { reenrollmentCode: first.reenrollmentCode }))
          .rejects.toThrow("MFA_REENROLLMENT_CODE_INVALID");
      }
      await expect(auth.confirmRequiredTotpEnrollment(enrollment.setupToken, createTotpCodeForTest(enrollment.secret), {}, { reenrollmentCode: second.reenrollmentCode }))
        .resolves.toMatchObject({ session: { userId: owner.id } });
    });

    it("an expired reset rejects login without enrollment material and can be re-issued", async () => {
      const { auth, owner, record, reset } = setup();
      await reset();
      owner.totpReenrollmentExpiresAt = new Date(Date.now() - 1000).toISOString();
      await expect(auth.login(loginCredentials(owner.email ?? ""))).rejects.toMatchObject({ status: 401, message: "MFA_RESET_EXPIRED" });
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.totp_reenrollment_expired", diff: expect.objectContaining({ stage: "login" }) }));
      expect(record).not.toHaveBeenCalledWith(expect.objectContaining({ action: "auth.totp_enrollment_required" }));
      const reissued = await reset();
      expect(Date.parse(reissued.reenrollmentExpiresAt)).toBeGreaterThan(Date.now());
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "auth.totp_reset_by_system_admin", diff: expect.objectContaining({ reissued: true }) }));
      await expect(auth.login(loginCredentials(owner.email ?? ""))).resolves.toMatchObject({ status: "MFA_ENROLLMENT_REQUIRED", reenrollmentCodeRequired: true });
    });

    it("a code that expires between login and confirm is rejected", async () => {
      const { auth, owner, reset, loginEnrollment } = setup();
      const issued = await reset();
      const enrollment = await loginEnrollment();
      owner.totpReenrollmentExpiresAt = new Date(Date.now() - 1000).toISOString();
      await expect(auth.confirmRequiredTotpEnrollment(enrollment.setupToken, createTotpCodeForTest(enrollment.secret), {}, { reenrollmentCode: issued.reenrollmentCode }))
        .rejects.toThrow("MFA_RESET_EXPIRED");
      expect(owner.totpEnabledAt).toBeUndefined();
    });

    it("the reset still succeeds when the notice cannot be queued, and the reset is refused for a never-enrolled account", async () => {
      const { auth, notices, reset } = setup();
      resetSecuritySideEffectFailureCounts();
      vi.spyOn(notices, "enqueue").mockRejectedValueOnce(new Error("connection refused for owner-reenroll@example.test"));
      const warn = vi.spyOn(apiLogger, "warn").mockImplementation(() => undefined);
      await expect(reset()).resolves.toMatchObject({ notificationQueued: false, reenrollmentCode: expect.any(String) });
      // The failure is logged with ids and a fixed code only, never the address or the provider message.
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ kind: "MFA_RESET_BY_SUPPORT", errorCode: "MFA_NOTICE_ENQUEUE_FAILED" }), "mfa_security_notice_not_queued");
      expect(securitySideEffectFailureCounts()).toContainEqual({ event: "mfa_notice_enqueue", count: 1 });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("@");
      warn.mockRestore();
      await expect(auth.login(loginCredentials("owner-reenroll@example.test"))).resolves.toMatchObject({ reenrollmentCodeRequired: true });
      const fresh = setup({ totpSecretEncrypted: undefined, totpEnabledAt: undefined });
      await expect(fresh.reset()).rejects.toThrow("MFA_NOT_ENABLED");
    });

    it("keeps the password-only first enrollment and self-service disable paths unchanged", async () => {
      const fresh = setup({ totpSecretEncrypted: undefined, totpEnabledAt: undefined, totpRecoveryCodeHashes: [] });
      const enrollment = await fresh.loginEnrollment();
      expect(enrollment).not.toHaveProperty("reenrollmentCodeRequired");
      const enrolled = await fresh.auth.confirmRequiredTotpEnrollment(enrollment.setupToken, createTotpCodeForTest(enrollment.secret));
      expect(enrolled.session.userId).toBe(fresh.owner.id);
      await fresh.auth.disableTotp({
        userId: fresh.owner.id, tenantId: fresh.owner.tenantId, roles: fresh.owner.roles, membershipVersion: fresh.owner.membershipVersion, bypassRls: false,
      }, { totpCode: createTotpCodeForTest(enrollment.secret, Date.now() + 30_000) });
      expect(fresh.owner.totpReenrollmentCodeHash).toBeUndefined();
      const again = await fresh.loginEnrollment();
      expect(again).not.toHaveProperty("reenrollmentCodeRequired");
      await expect(fresh.auth.confirmRequiredTotpEnrollment(again.setupToken, createTotpCodeForTest(again.secret)))
        .resolves.toMatchObject({ session: { userId: fresh.owner.id } });
      expect(fresh.notices.notices).toEqual([]);
    });

    it("a setup token obtained before a reissued code is rejected, and the new code still works", async () => {
      const { auth, owner, reset, loginEnrollment } = setup();
      const first = await reset();
      const before = await loginEnrollment();
      const second = await reset();
      // The reissue bumped the version: the earlier setup token is dead even with the new code.
      await expect(auth.confirmRequiredTotpEnrollment(before.setupToken, createTotpCodeForTest(before.secret), {}, { reenrollmentCode: second.reenrollmentCode }))
        .rejects.toThrow("MFA_SETUP_TOKEN_INVALID");
      await expect(auth.confirmRequiredTotpEnrollment(before.setupToken, createTotpCodeForTest(before.secret), {}, { reenrollmentCode: first.reenrollmentCode }))
        .rejects.toThrow("MFA_SETUP_TOKEN_INVALID");
      expect(owner.totpEnabledAt).toBeUndefined();
      const after = await loginEnrollment();
      await expect(auth.confirmRequiredTotpEnrollment(after.setupToken, createTotpCodeForTest(after.secret), {}, { reenrollmentCode: second.reenrollmentCode }))
        .resolves.toMatchObject({ session: { userId: owner.id } });
    });

    it("a replayed step-up proof gets 409 and never replaces the code; concurrent use of one proof resets once", async () => {
      const { auth, owner, reset, proofFor, loginEnrollment } = setup();
      const proof = proofFor();
      const [a, b] = await Promise.allSettled([reset(proof), reset(proof)]);
      const fulfilled = [a, b].filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof reset>>> => result.status === "fulfilled");
      const rejected = [a, b].filter((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({ status: 409, message: "MFA_RESET_TARGET_STALE" });
      const issued = fulfilled[0]!.value;
      const storedHash = owner.totpReenrollmentCodeHash;
      await expect(reset(proof)).rejects.toMatchObject({ status: 409, message: "MFA_RESET_TARGET_STALE" });
      expect(owner.totpReenrollmentCodeHash).toBe(storedHash);
      const enrollment = await loginEnrollment();
      await expect(auth.confirmRequiredTotpEnrollment(enrollment.setupToken, createTotpCodeForTest(enrollment.secret), {}, { reenrollmentCode: issued.reenrollmentCode }))
        .resolves.toMatchObject({ session: { userId: owner.id } });
    });

    it("refuses a reset in optional mode, where the code could never be entered", async () => {
      const { owner, reset } = setup();
      process.env.ADMIN_MFA_MODE = "optional";
      await expect(reset()).rejects.toMatchObject({ status: 409, message: "MFA_RESET_REQUIRES_REQUIRED_MODE" });
      expect(owner.totpEnabledAt).toEqual(expect.any(String));
      expect(owner.totpReenrollmentCodeHash).toBeUndefined();
      expect(owner.membershipVersion).toBe(5);
    });

    it("returns the code when the post-reset audit fails, logging and counting it without PII", async () => {
      const { owner, record, reset } = setup();
      resetSecuritySideEffectFailureCounts();
      record.mockImplementation((async (input: { action?: string }) => {
        if (input.action === "auth.totp_reset_by_system_admin") throw new Error("insert failed for owner-reenroll@example.test");
        return undefined;
      }) as never);
      const error = vi.spyOn(apiLogger, "error").mockImplementation(() => undefined);
      const issued = await reset();
      expect(issued.reenrollmentCode).toMatch(/^\d{4}-\d{4}$/);
      expect(owner.totpReenrollmentCodeHash).toMatch(/^v1:6:/);
      expect(error).toHaveBeenCalledWith({ tenantId: "tenant-a", userId: owner.id, errorCode: "MFA_RESET_AUDIT_FAILED" }, "mfa_reset_audit_not_recorded");
      expect(JSON.stringify(error.mock.calls)).not.toMatch(/@|insert failed/);
      expect(JSON.stringify(error.mock.calls)).not.toContain(issued.reenrollmentCode);
      expect(securitySideEffectFailureCounts()).toContainEqual({ event: "mfa_reset_audit", count: 1 });
      error.mockRestore();
    });

    it("self-service TOTP setup cannot complete a pending support reset", async () => {
      const { auth, owner, reset } = setup();
      await reset();
      const context = { userId: owner.id, tenantId: owner.tenantId, roles: owner.roles, membershipVersion: owner.membershipVersion, sessionId: "owner-session", bypassRls: false };
      const draft = await auth.createTotpSetup(context);
      await expect(auth.confirmTotpSetup(context, draft.setupToken, createTotpCodeForTest(draft.secret))).rejects.toThrow("MFA_REENROLLMENT_CODE_REQUIRED");
      expect(owner.totpEnabledAt).toBeUndefined();
    });
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
      membershipVersion: user.membershipVersion,
      bypassRls: false,
    });
    const setupCode = createTotpCodeForTest(setup.secret);
    await auth.confirmTotpSetup({
      userId: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
      membershipVersion: user.membershipVersion,
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
    const context = { userId: user.id, tenantId: user.tenantId, membershipVersion: user.membershipVersion, roles: user.roles, bypassRls: false };
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
    const users = withResetTarget(createMutableUserStore(user), resetTargetOwner());
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      new LoginAttemptLimiter(5, 60_000),
      new InMemoryTenantStore(),
    );
    const setupContext = { userId: user.id, tenantId: user.tenantId, membershipVersion: user.membershipVersion, roles: user.roles, bypassRls: false };
    const setup = await auth.createTotpSetup(setupContext);
    await auth.confirmTotpSetup(setupContext, setup.setupToken, createTotpCodeForTest(setup.secret));
    const actionContext = { ...setupContext, sessionId: "session-mfa-sensitive-actions", membershipVersion: user.membershipVersion };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(auth.disableTotp(actionContext, { totpCode: "invalid" })).rejects.toThrow("MFA_CODE_INVALID");
    }
    await expect(auth.disableTotp(actionContext, {
      totpCode: createTotpCodeForTest(setup.secret, Date.now() + 30_000),
    })).rejects.toThrow("MFA_SECOND_FACTOR_LOCKED");

    const resetTarget = { tenantId: "tenant-a", userId: "owner-a" };
    await expect(auth.createMfaStepUp(actionContext, "OWNER_ADMIN_CHANGE", { totpCode: "invalid" }, resetTarget)).rejects.toThrow(
      "MFA_CODE_INVALID",
    );
    await expect(auth.createMfaStepUp(actionContext, "OWNER_ADMIN_CHANGE", {
      recoveryCode: setup.recoveryCodes[0],
    }, resetTarget)).resolves.toMatchObject({ purpose: "OWNER_ADMIN_CHANGE" });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(auth.createMfaStepUp(actionContext, "OWNER_ADMIN_CHANGE", { totpCode: "invalid" }, resetTarget)).rejects.toThrow(
        "MFA_CODE_INVALID",
      );
    }
    await expect(auth.createMfaStepUp(actionContext, "OWNER_ADMIN_CHANGE", {
      totpCode: createTotpCodeForTest(setup.secret, Date.now() + 30_000),
    }, resetTarget)).rejects.toThrow("MFA_SECOND_FACTOR_LOCKED");
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
      membershipVersion: user.membershipVersion,
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
    const users = withResetTarget(createMutableUserStore(user), resetTargetOwner());
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );
    const setupContext = { userId: user.id, tenantId: user.tenantId, membershipVersion: user.membershipVersion, roles: user.roles, bypassRls: false };
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
    const resetTarget = { tenantId: "tenant-a", userId: "owner-a" };
    // A reset proof without its target account, or naming the system tenant, is refused before the second factor is spent.
    for (const target of [undefined, { tenantId: "tenant-a" }, { tenantId: "system", userId: "owner-a" }]) {
      await expect(auth.createMfaStepUp(context, "OWNER_ADMIN_CHANGE", { recoveryCode: setup.recoveryCodes[0] }, target as never)).rejects.toThrow("MFA_STEP_UP_TARGET_INVALID");
    }
    const proof = await auth.createMfaStepUp(context, "OWNER_ADMIN_CHANGE", {
      recoveryCode: setup.recoveryCodes[0],
    }, resetTarget);

    expect(proof).toMatchObject({ purpose: "OWNER_ADMIN_CHANGE", stepUpToken: expect.any(String), expiresAt: expect.any(String) });
    expect(proof).not.toHaveProperty("target");
    // The server bound the proof to the target account's current membership version.
    expect(verifyAdminMfaResetStepUpProof(proof.stepUpToken, {
      userId: user.id,
      sessionId: issued.session.id,
      membershipVersion: issued.session.membershipVersion,
      target: resetTarget,
    })).toBe(resetTargetOwner().membershipVersion);
    // An unknown target, another tenant's account or a non-admin account gets no proof.
    for (const target of [{ tenantId: "tenant-a", userId: "missing-owner" }, { tenantId: "tenant-b", userId: "owner-a" }]) {
      await expect(auth.createMfaStepUp(context, "OWNER_ADMIN_CHANGE", { recoveryCode: setup.recoveryCodes[1] }, target)).rejects.toThrow("MFA_RESET_TARGET_NOT_FOUND");
    }
    await expect(auth.createMfaStepUp({ ...context, membershipVersion: context.membershipVersion + 1 }, "OWNER_ADMIN_CHANGE", {
      recoveryCode: setup.recoveryCodes[1],
    }, resetTarget)).rejects.toThrow("MFA_STEP_UP_CONTEXT_INVALID");
    const target = { tenantId: "tenant-a", status: "SUSPENDED" as const, expectedLifecycleVersion: 0 };
    await expect(auth.createMfaStepUp(context, "TENANT_LIFECYCLE_CHANGE", { recoveryCode: "wrong" }, target)).rejects.toThrow("MFA_RECOVERY_CODE_INVALID");
    await expect(auth.createMfaStepUp(context, "TENANT_LIFECYCLE_CHANGE", { recoveryCode: setup.recoveryCodes[1] })).rejects.toThrow("MFA_STEP_UP_TARGET_INVALID");
    await expect(auth.createMfaStepUp({ ...context, sessionId: "missing" }, "TENANT_LIFECYCLE_CHANGE", { recoveryCode: setup.recoveryCodes[1] }, target)).rejects.toThrow("MFA_STEP_UP_CONTEXT_INVALID");
    await expect(auth.createMfaStepUp({ ...context, roles: ["TENANT_OWNER"] }, "TENANT_LIFECYCLE_CHANGE", { recoveryCode: setup.recoveryCodes[1] }, target)).rejects.toThrow("MFA_STEP_UP_CONTEXT_INVALID");
    const lifecycle = await auth.createMfaStepUp(context, "TENANT_LIFECYCLE_CHANGE", { recoveryCode: setup.recoveryCodes[1] }, target);
    expect(() => verifyAdminMfaStepUpProof(lifecycle.stepUpToken, { userId: user.id, sessionId: context.sessionId,
      membershipVersion: context.membershipVersion, purpose: "TENANT_LIFECYCLE_CHANGE", target })).not.toThrow();
    const purgeTarget = { tenantId: "tenant-a", preset: "LICENSE_EXPIRY_PURGE_V1" as const, expectedLifecycleVersion: 0, preflightDigest: "a".repeat(64) };
    await expect(auth.createMfaStepUp(context, "TENANT_CLEAN_RESET", { recoveryCode: setup.recoveryCodes[2] }, { ...purgeTarget, preset: "DROP_ALL" as never })).rejects.toThrow("MFA_STEP_UP_TARGET_INVALID");
    await expect(auth.createMfaStepUp(context, "TENANT_CLEAN_RESET", { recoveryCode: setup.recoveryCodes[2] }, { ...purgeTarget, tenantId: "system" })).rejects.toThrow("MFA_STEP_UP_TARGET_INVALID");
    const purge = await auth.createMfaStepUp(context, "TENANT_CLEAN_RESET", { recoveryCode: setup.recoveryCodes[2] }, purgeTarget);
    const purgeBinding = { userId: user.id, sessionId: context.sessionId, membershipVersion: context.membershipVersion, purpose: "TENANT_CLEAN_RESET" as const };
    expect(() => verifyAdminMfaStepUpProof(purge.stepUpToken, { ...purgeBinding, target: purgeTarget })).not.toThrow();
    expect(() => verifyAdminMfaStepUpProof(purge.stepUpToken, { ...purgeBinding, target: { ...purgeTarget, preset: "CLEAN_SETUP_V1" } })).toThrow("ADMIN_MFA_STEP_UP_CONTEXT_INVALID");
    // Security review 2026-10-06: the purge handover export step-up binds exactly { tenantId }.
    await expect(auth.createMfaStepUp(context, "TENANT_PURGE_EXPORT", { recoveryCode: setup.recoveryCodes[4] })).rejects.toThrow("MFA_STEP_UP_TARGET_INVALID");
    await expect(auth.createMfaStepUp(context, "TENANT_PURGE_EXPORT", { recoveryCode: setup.recoveryCodes[4] }, { tenantId: "system" })).rejects.toThrow("MFA_STEP_UP_TARGET_INVALID");
    await expect(auth.createMfaStepUp(context, "TENANT_PURGE_EXPORT", { recoveryCode: setup.recoveryCodes[4] }, purgeTarget)).rejects.toThrow("MFA_STEP_UP_TARGET_INVALID");
    const exported = await auth.createMfaStepUp(context, "TENANT_PURGE_EXPORT", { recoveryCode: setup.recoveryCodes[4] }, { tenantId: "tenant-a" });
    expect(exported.purpose).toBe("TENANT_PURGE_EXPORT");
    const exportBinding = { userId: user.id, sessionId: context.sessionId, membershipVersion: context.membershipVersion, purpose: "TENANT_PURGE_EXPORT" as const };
    expect(() => verifyAdminMfaStepUpProof(exported.stepUpToken, { ...exportBinding, target: { tenantId: "tenant-a" } })).not.toThrow();
    expect(() => verifyAdminMfaStepUpProof(exported.stepUpToken, { ...exportBinding, target: { tenantId: "tenant-b" } })).toThrow("ADMIN_MFA_STEP_UP_CONTEXT_INVALID");
    expect(() => verifyAdminMfaStepUpProof(exported.stepUpToken, { ...purgeBinding, target: { tenantId: "tenant-a" } as never })).toThrow("ADMIN_MFA_STEP_UP_CONTEXT_INVALID");
    expect(() => verifyAdminMfaStepUpProof(purge.stepUpToken, { ...exportBinding, target: { tenantId: "tenant-a" } })).toThrow("ADMIN_MFA_STEP_UP_CONTEXT_INVALID");
    await auth.logout(issued.refreshToken);
    await expect(auth.createMfaStepUp(context, "TENANT_LIFECYCLE_CHANGE", { recoveryCode: setup.recoveryCodes[3] }, target)).rejects.toThrow("MFA_STEP_UP_CONTEXT_INVALID");

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
      if (input.source.membershipVersion !== user.membershipVersion) return undefined;
      // Mirrors the store: the pending re-enrollment must be the verified one and unexpired; it is consumed here.
      const expected = input.reenrollmentCodeHash ?? null;
      if (expected === null ? user.totpReenrollmentCodeHash !== undefined
        : user.totpReenrollmentCodeHash !== expected || Date.parse(user.totpReenrollmentExpiresAt ?? "") <= Date.now()) return undefined;
      user.totpReenrollmentCodeHash = undefined;
      user.totpReenrollmentExpiresAt = undefined;
      user.totpSecretEncrypted = input.secretEncrypted;
      user.totpEnabledAt = input.enabledAt;
      user.totpRecoveryCodeHashes = [...input.recoveryCodeHashes];
      user.totpLastUsedCounter = input.lastUsedCounter;
      user.membershipVersion += 1;
      return clone();
    }),
    disableTotp: vi.fn(async (_userId, source, reenrollment) => {
      if (source.membershipVersion !== user.membershipVersion) return undefined;
      user.totpReenrollmentCodeHash = reenrollment?.codeHash;
      user.totpReenrollmentExpiresAt = reenrollment?.expiresAt;
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

/** Adds the tenant OWNER an OWNER_ADMIN_CHANGE step-up names, so the server can bind the proof to its version. */
function withResetTarget(store: AuthUserStore, target: AuthUser): AuthUserStore {
  const findById = store.findById;
  return { ...store, findById: vi.fn(async (id: string) => (id === target.id ? { ...target, roles: [...target.roles] } : findById(id))) };
}

function resetTargetOwner(): AuthUser {
  return {
    id: "owner-a", email: "owner-a@example.test", name: "Owner A", passwordHash: "unused", tenantId: "tenant-a",
    roles: ["TENANT_OWNER"], membershipVersion: 4, totpSecretEncrypted: "encrypted", totpEnabledAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("password proof challenge version binding", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(["valid", "password", "membership", "reset", "legacy"])("tenant selection %s proof cannot upgrade to newest credentials", async (mode) => {
    const { createHmac } = await import("node:crypto");
    vi.stubEnv("AUTH_SELECTION_SECRET", "test-selection-proof-secret"); vi.stubEnv("ADMIN_MFA_MODE", "off");
    const user: AuthUser = { id: "proof-user", tenantId: "tenant-a", membershipVersion: 1, passwordHash: hashPassword("password"), roles: ["TENANT_ADMIN"], name: "Proof" };
    let epoch = 0;
    const tenants = { findById: vi.fn(async (id: string) => ({ id, name: id, slug: id, status: "ACTIVE", lifecycleVersion: epoch })) } as unknown as InMemoryTenantStore;
    const users = createUserStoreMock({ findById: vi.fn(async () => user) });
    const sessions = new InMemorySessionStore(); const create = vi.spyOn(sessions, "create");
    const auth = new AuthService(users, sessions, new InMemoryPasswordResetStore(), { resolve: vi.fn(async () => undefined) } as never, undefined, undefined, tenants);
    const issue = auth as unknown as { createTenantSelectionChallenge(users: AuthUser[]): Promise<{ selectionToken: string; tenants: unknown[] }> };
    const challenge = await issue.createTenantSelectionChallenge([user, { ...user, id: "proof-other", tenantId: "tenant-b" }]);
    expect(JSON.stringify(challenge.tenants)).not.toMatch(/membershipVersion|lifecycleVersion/);
    if (mode === "password" || mode === "membership") { user.membershipVersion = 2; if (mode === "password") user.passwordHash = hashPassword("changed"); }
    if (mode === "reset") epoch = 1;
    if (mode === "legacy") {
      const payload = Buffer.from(JSON.stringify({ purpose: "tenant-selection", expiresAt: Date.now() + 60_000, candidates: [{ userId: user.id, tenantId: user.tenantId }] })).toString("base64url");
      challenge.selectionToken = `${payload}.${createHmac("sha256", "test-selection-proof-secret").update(payload).digest("base64url")}`;
    }
    if (mode === "valid") { await expect(auth.selectTenant({ selectionToken: challenge.selectionToken, tenantId: user.tenantId })).resolves.toHaveProperty("accessToken"); expect(create).toHaveBeenCalledTimes(1); }
    else { await expect(auth.selectTenant({ selectionToken: challenge.selectionToken, tenantId: user.tenantId })).rejects.toThrow("LOGIN_FAILED"); expect(create).not.toHaveBeenCalled(); }
  });
  it.each(["stale", "legacy"])("MFA %s password proof is rejected before consuming second factor", async (mode) => {
    const { createHmac } = await import("node:crypto");
    const { createLoginMfaChallenge } = await import("./totp-mfa.js");
    vi.stubEnv("ADMIN_MFA_MODE", "optional"); vi.stubEnv("ADMIN_MFA_CHALLENGE_SECRET", "test-mfa-proof-secret");
    const user: AuthUser = { id: "system-proof", tenantId: "system", membershipVersion: 2, passwordHash: "unused", roles: ["SYSTEM_ADMIN"], name: "Proof", totpSecretEncrypted: "encrypted", totpEnabledAt: new Date().toISOString() };
    const users = createUserStoreMock({ findById: vi.fn(async () => user) });
    const sessions = new InMemorySessionStore(); const create = vi.spyOn(sessions, "create");
    const auth = new AuthService(users, sessions, new InMemoryPasswordResetStore(), { resolve: vi.fn() } as never);
    let token = createLoginMfaChallenge(user.id, 1).challengeToken;
    if (mode === "legacy") {
      const payload = Buffer.from(JSON.stringify({ type: "admin-mfa-login", userId: user.id, challengeId: "old", exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
      token = `${payload}.${createHmac("sha256", "test-mfa-proof-secret").update(payload).digest("base64url")}`;
    }
    await expect(auth.verifyTotpChallenge(token, { recoveryCode: "unused" })).rejects.toThrow("MFA_CHALLENGE_INVALID");
    expect(users.consumeTotpRecoveryCode).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
});
