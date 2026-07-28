import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword, type AuthUser, type AuthUserStore } from "./auth-user-store.js";
import { AuthService, hashResetToken } from "./auth.service.js";
import type { IdentityResolver } from "./identity-resolver.js";
import { InMemoryPasswordResetStore } from "./password-reset-store.js";
import { InMemorySessionStore } from "./session-store.js";
import { createTotpCodeForTest } from "./totp-mfa.js";
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
    const nationalId = "10000000146";
    const user: AuthUser = {
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
      findByTenantAndNationalIdHash: vi.fn(async (tenantId, nationalIdHash) => (
        tenantId === user.tenantId && nationalIdHash === user.nationalIdHash ? user : undefined
      )),
    });
    const identities = {
      resolve: vi.fn(async () => undefined),
    } as unknown as IdentityResolver;
    const auth = new AuthService(users, new InMemorySessionStore(), new InMemoryPasswordResetStore(), identities, undefined, undefined, new InMemoryTenantStore());

    const tokenPair = await auth.login(loginCredentials(nationalId));
    if ("status" in tokenPair) throw new Error("MFA challenge beklenmiyordu.");

    expect(users.findByTenantAndNationalIdHash).toHaveBeenCalledWith("tenant-a", user.nationalIdHash);
    expect(tokenPair.session).toMatchObject({
      userId: "user-db-a",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
    });
  });

  it("yanlış parola token üretmez", async () => {
    const nationalId = "10000000146";
    const user: AuthUser = {
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
      findByTenantAndNationalIdHash: vi.fn(async (tenantId, nationalIdHash) => (
        tenantId === user.tenantId && nationalIdHash === user.nationalIdHash ? user : undefined
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

    await expect(auth.login(loginCredentials(nationalId, "wrong"))).rejects.toThrow("LOGIN_FAILED");
  });

  it("TC eksikse login olmaz", async () => {
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

    await expect(auth.login({ tenantSlug: "dna-egitim", nationalId: "", password: "5551234567" })).rejects.toThrow("LOGIN_IDENTIFIER_REQUIRED");
  });

  it("kurum kodu olmadan tek eşleşmede login olur", async () => {
    const nationalId = "10000000146";
    const user: AuthUser = {
      id: "tenantless-login",
      name: "Tenantless Login",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      nationalIdHash: hashTcIdentity(nationalId),
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    };
    const users = createUserStoreMock({
      findByNationalIdHash: vi.fn(async (nationalIdHash) => (nationalIdHash === user.nationalIdHash ? [user] : [])),
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

    const tokenPair = await auth.login({ nationalId, password: "password" }, "127.0.0.1");
    if ("status" in tokenPair) throw new Error("Token bekleniyordu.");

    expect(users.findByNationalIdHash).toHaveBeenCalledWith(user.nationalIdHash);
    expect(tokenPair.session).toMatchObject({
      userId: user.id,
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
    });
  });

  it("kurum kodu olmadan birden çok eşleşmede seçim ister ve seçimden sonra session üretir", async () => {
    const nationalId = "10000000146";
    const nationalIdHash = hashTcIdentity(nationalId);
    const usersList: AuthUser[] = [
      {
        id: "multi-tenant-a",
        name: "Multi Tenant A",
        passwordHash: hashPassword("password", "test-salt"),
        tenantId: "tenant-a",
        nationalIdHash,
        roles: ["TENANT_ADMIN"],
        membershipVersion: 1,
      },
      {
        id: "multi-tenant-b",
        name: "Multi Tenant B",
        passwordHash: hashPassword("password", "test-salt"),
        tenantId: "tenant-b",
        nationalIdHash,
        roles: ["STUDENT"],
        membershipVersion: 1,
      },
    ];
    const users = createUserStoreMock({
      findByNationalIdHash: vi.fn(async (hash) => (hash === nationalIdHash ? usersList : [])),
      findById: vi.fn(async (id) => usersList.find((user) => user.id === id)),
    });
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async (input) => (
        input.userId === "multi-tenant-b" ? { subjectType: "STUDENT", subjectId: "student-b" } : undefined
      )) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
    );

    const challenge = await auth.login({ nationalId, password: "password" }, "127.0.0.1");
    expect(challenge).toMatchObject({
      status: "TENANT_SELECTION_REQUIRED",
      tenants: [
        expect.objectContaining({ tenantId: "tenant-a", slug: "dna-egitim" }),
        expect.objectContaining({ tenantId: "tenant-b", slug: "demo-kurum-b" }),
      ],
    });
    if (!("status" in challenge) || challenge.status !== "TENANT_SELECTION_REQUIRED") throw new Error("Tenant seçimi bekleniyordu.");
    expect(challenge).not.toHaveProperty("accessToken");

    await expect(auth.selectTenant({ selectionToken: challenge.selectionToken, tenantId: "tenant-expired" })).rejects.toThrow("LOGIN_FAILED");
    await expect(auth.selectTenant({ selectionToken: challenge.selectionToken, tenantId: "tenant-b" })).resolves.toMatchObject({
      session: {
        userId: "multi-tenant-b",
        tenantId: "tenant-b",
        roles: ["STUDENT"],
        subjectType: "STUDENT",
        subjectId: "student-b",
      },
    });
  });

  it("kurum kodu ve TC ile login olur, ilk giriş şifre değiştirme bilgisini taşır", async () => {
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
      findByTenantAndNationalIdHash: vi.fn(async (tenantId, nationalIdHash) => (
        tenantId === user.tenantId && nationalIdHash === user.nationalIdHash ? user : undefined
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

    const tokenPair = await auth.login({ tenantSlug: "dna-egitim", nationalId, password: "5551234567" }, "127.0.0.1");
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

  it("telefon parolasını başında sıfırla girilse de kabul eder", async () => {
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
      findByTenantAndNationalIdHash: vi.fn(async (tenantId, nationalIdHash) => (
        tenantId === user.tenantId && nationalIdHash === user.nationalIdHash ? user : undefined
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

    const tokenPair = await auth.login({ tenantSlug: "dna-egitim", nationalId, password: "05551234567" }, "127.0.0.1");
    if ("status" in tokenPair) throw new Error("MFA challenge beklenmiyordu.");

    expect(tokenPair.session).toMatchObject({
      userId: user.id,
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
    });
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
      findByTenantAndNationalIdHash: vi.fn(async (tenantId, nationalIdHash) => (
        tenantId === user.tenantId && nationalIdHash === user.nationalIdHash ? user : undefined
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

    await expect(auth.login(loginCredentials(nationalId))).rejects.toThrow("SUBJECT_CONTEXT_MISSING");
  });

  it.each(["TEACHER", "GUARDIAN"] as const)(
    "%s TC login yanlış kurum kodunda global fallback yapmaz",
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
        findByTenantAndNationalIdHash: vi.fn(async (tenantId, nationalIdHash) => (
          tenantId === user.tenantId && nationalIdHash === user.nationalIdHash ? user : undefined
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

      await expect(auth.login(loginCredentials(nationalId, "password", "demo-kurum-b"))).rejects.toThrow("LOGIN_FAILED");
      expect(users.findByTenantAndNationalIdHash).toHaveBeenCalledWith("tenant-b", user.nationalIdHash);
      expect(users.findByNationalIdHash).not.toHaveBeenCalled();
    },
  );

  it("system hesabı system scope ve TC ile login olur", async () => {
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
      findByTenantAndNationalIdHash: vi.fn(async (tenantId, nationalIdHash) => (
        tenantId === user.tenantId && nationalIdHash === user.nationalIdHash ? user : undefined
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

    const tokenPair = await auth.login({ tenantSlug: "system", nationalId, password: "password" }, "127.0.0.1");
    if ("status" in tokenPair) throw new Error("MFA challenge beklenmiyordu.");

    expect(findBySlug).not.toHaveBeenCalled();
    expect(tokenPair.session).toMatchObject({
      userId: "user-system",
      tenantId: "system",
      roles: ["SYSTEM_ADMIN"],
    });
  });

  it("system hesabı kurum kodu olmadan TC ile login olur", async () => {
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
      findByTenantAndNationalIdHash: vi.fn(async (tenantId, nationalIdHash) => (
        tenantId === "system" && nationalIdHash === user.nationalIdHash ? user : undefined
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

    const tokenPair = await auth.login({ nationalId, password: "password" }, "127.0.0.1");
    if ("status" in tokenPair) throw new Error("MFA challenge beklenmiyordu.");

    expect(users.findByNationalIdHash).toHaveBeenCalledWith(user.nationalIdHash);
    expect(tokenPair.session).toMatchObject({
      userId: "user-system",
      tenantId: "system",
      roles: ["SYSTEM_ADMIN"],
    });
  });

  it("şifre reset tokenı tek kullanımlık çalışır ve eski şifreyi geçersiz kılar", async () => {
    const nationalId = "10000000214";
    const user = {
      id: "user-db-a",
      email: "db-a@example.test",
      name: "DB User",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "system",
      nationalIdHash: hashTcIdentity(nationalId),
      roles: ["SYSTEM_ADMIN"],
      membershipVersion: 1,
    };
    const users = createUserStoreMock({
      findByEmail: vi.fn(async (email) => (email === user.email ? { ...user, roles: [...user.roles] } : undefined)),
      findByTenantAndNationalIdHash: vi.fn(async (tenantId, nationalIdHash) => (
        tenantId === user.tenantId && nationalIdHash === user.nationalIdHash ? { ...user, roles: [...user.roles] } : undefined
      )),
      findById: vi.fn(async () => ({ ...user, roles: [...user.roles] })),
      updatePassword: vi.fn(async (_id, passwordHash) => {
        user.passwordHash = passwordHash;
        user.membershipVersion += 1;
        return { ...user, roles: [...user.roles] };
      }),
    });
    const auditLogs = { record: vi.fn(async () => undefined) };
    const delivery = { send: vi.fn(async () => true) };
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      auditLogs as never,
      undefined,
      new InMemoryTenantStore(),
      delivery,
    );

    const issued = await auth.requestPasswordReset({ tenantSlug: "system", nationalId });
    expect(issued.status).toBe("ISSUED");
    expect(issued.resetToken).toBeTruthy();
    expect(delivery.send).toHaveBeenCalledWith(expect.objectContaining({
      email: user.email,
      resetUrl: expect.stringContaining("/parola-sifirla?token="),
    }));
    expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth.password_reset_requested",
      diff: { deliveryChannel: "EMAIL" },
    }));
    expect(JSON.stringify(auditLogs.record.mock.calls)).not.toContain("db-a@example.test");

    await expect(auth.requestPasswordReset({ tenantSlug: "system", nationalId })).resolves.toEqual({
      status: "IGNORED",
    });
    expect(delivery.send).toHaveBeenCalledTimes(1);

    const concurrentConfirms = await Promise.allSettled([
      auth.confirmPasswordReset(issued.resetToken ?? "", "new-password"),
      auth.confirmPasswordReset(issued.resetToken ?? "", "new-password"),
    ]);
    expect(concurrentConfirms.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrentConfirms.filter((result) => result.status === "rejected")).toHaveLength(1);

    await expect(auth.login(loginCredentials(nationalId, "password", "system"))).rejects.toThrow("LOGIN_FAILED");
    await expect(auth.confirmPasswordReset(issued.resetToken ?? "", "another-pass")).rejects.toThrow(
      "PASSWORD_RESET_NOT_PENDING",
    );
    await expect(auth.login(loginCredentials(nationalId, "new-password", "system"))).resolves.toMatchObject({
      session: { userId: "user-db-a" },
    });
  });

  it("tenant kullanıcısının telefon kanalından tek kullanımlık şifre resetini tamamlar", async () => {
    const nationalId = "10000000146";
    const user = {
      id: "tenant-reset-user",
      phone: "5551234567",
      name: "Tenant Reset",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      nationalIdHash: hashTcIdentity(nationalId),
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    };
    const users = createUserStoreMock({
      findByTenantAndNationalIdHash: vi.fn(async (tenantId, nationalIdHash) => (
        tenantId === user.tenantId && nationalIdHash === user.nationalIdHash ? { ...user, roles: [...user.roles] } : undefined
      )),
      findById: vi.fn(async () => ({ ...user, roles: [...user.roles] })),
      updatePassword: vi.fn(async (_id, passwordHash) => {
        user.passwordHash = passwordHash;
        user.membershipVersion += 1;
        return { ...user, roles: [...user.roles] };
      }),
    });
    const passwordResets = new InMemoryPasswordResetStore();
    const delivery = { send: vi.fn(async () => true) };
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      passwordResets,
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      undefined,
      undefined,
      new InMemoryTenantStore(),
      delivery,
    );

    const issued = await auth.requestPasswordReset({ tenantSlug: "dna-egitim", nationalId });
    expect(issued.status).toBe("ISSUED");
    expect(delivery.send).toHaveBeenCalledWith(expect.objectContaining({
      phone: user.phone,
      resetUrl: expect.stringContaining("/parola-sifirla?token="),
    }));
    await auth.confirmPasswordReset(issued.resetToken ?? "", "new-password");
    await expect(auth.login({
      tenantSlug: "dna-egitim",
      nationalId,
      password: "new-password",
    })).resolves.toMatchObject({
      session: { userId: user.id },
    });
    await expect(auth.confirmPasswordReset(issued.resetToken ?? "", "another-pass")).rejects.toThrow(
      "PASSWORD_RESET_NOT_PENDING",
    );
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
    const issued = await auth.login(loginCredentials(nationalId));
    if ("status" in issued) throw new Error("MFA challenge beklenmiyordu.");

    await expect(auth.verifyActiveAccessToken(issued.accessToken)).resolves.toMatchObject({
      roles: ["TENANT_ADMIN"],
      sessionId: issued.session.id,
    });
    await sessions.revoke(issued.session.id);

    await expect(auth.verifyActiveAccessToken(issued.accessToken)).rejects.toThrow("ACCESS_SESSION_INACTIVE");
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

  it("admin MFA required iken TOTP kaydı olmayan admini tek kullanımlık enrollment ile içeri alır", async () => {
    process.env.ADMIN_MFA_MODE = "required";
    const user: AuthUser = {
      id: "admin-mfa-required",
      email: "admin-required@example.test",
      nationalIdHash: hashTcIdentity("10000000146"),
      name: "Required MFA Admin",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
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

    const enrollment = await auth.login(loginCredentials("10000000146"));
    expect(enrollment).toMatchObject({ status: "MFA_ENROLLMENT_REQUIRED", recoveryCodes: expect.any(Array) });
    if (!("status" in enrollment) || enrollment.status !== "MFA_ENROLLMENT_REQUIRED") {
      throw new Error("MFA enrollment bekleniyordu.");
    }
    const issued = await auth.confirmRequiredTotpEnrollment(
      enrollment.setupToken,
      createTotpCodeForTest(enrollment.secret),
    );
    expect(issued.session.roles).toContain("TENANT_ADMIN");
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

  it("admin TOTP etkinleştikten sonra login'i MFA challenge'a böler ve TOTP reuse'u reddeder", async () => {
    process.env.ADMIN_MFA_MODE = "optional";
    const user: AuthUser = {
      id: "admin-mfa",
      email: "admin-mfa@example.test",
      nationalIdHash: hashTcIdentity("10000000146"),
      name: "MFA Admin",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
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

    const challenge = await auth.login(loginCredentials("10000000146"));
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

  it("admin recovery code'u tek kullanımlık tüketir", async () => {
    process.env.ADMIN_MFA_MODE = "optional";
    const user: AuthUser = {
      id: "admin-recovery",
      email: "admin-recovery@example.test",
      nationalIdHash: hashTcIdentity("10000000382"),
      name: "Recovery Admin",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
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
    const challenge = await auth.login(loginCredentials("10000000382"));
    if (!("status" in challenge) || challenge.status !== "MFA_REQUIRED") throw new Error("MFA challenge bekleniyordu.");

    await expect(auth.verifyTotpChallenge(challenge.challengeToken, { recoveryCode: setup.recoveryCodes[0] })).resolves.toMatchObject({
      session: { userId: user.id },
    });
    await expect(auth.verifyTotpChallenge(challenge.challengeToken, { recoveryCode: setup.recoveryCodes[0] })).rejects.toThrow(
      "MFA_RECOVERY_CODE_INVALID",
    );
  });
});

function loginCredentials(nationalId: string, password = "password", tenantSlug = "dna-egitim") {
  return { tenantSlug, nationalId, password };
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
    findByTenantAndNationalIdHash: vi.fn(),
    findByNationalIdHash: vi.fn(async () => []),
    findById: vi.fn(),
    listByTenant: vi.fn(async () => []),
    createOrAttachTenantIdentity: vi.fn(),
    updatePassword: vi.fn(),
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
      if (user.totpLastUsedCounter === counter) return false;
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
