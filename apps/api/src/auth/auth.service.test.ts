import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword, type AuthUser, type AuthUserStore } from "./auth-user-store.js";
import { AuthService, hashResetToken } from "./auth.service.js";
import type { IdentityResolver } from "./identity-resolver.js";
import { InMemoryPasswordResetStore } from "./password-reset-store.js";
import { InMemorySessionStore } from "./session-store.js";
import { createTotpCodeForTest } from "./totp-mfa.js";
import { hashTcIdentity } from "../student/tc-identity.js";
import { InMemoryTenantStore } from "../tenant/tenant-store.js";

const previousAdminMfaMode = process.env.ADMIN_MFA_MODE;

describe("AuthService", () => {
  afterEach(() => {
    if (previousAdminMfaMode === undefined) {
      delete process.env.ADMIN_MFA_MODE;
    } else {
      process.env.ADMIN_MFA_MODE = previousAdminMfaMode;
    }
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

  it("kurum kodu veya TC eksikse login olmaz", async () => {
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
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
      auditLogs as never,
      undefined,
      new InMemoryTenantStore(),
    );

    const issued = await auth.requestPasswordReset("db-a@example.test");
    expect(issued.status).toBe("ISSUED");
    expect(issued.resetToken).toBeTruthy();
    expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth.password_reset_requested",
      diff: { emailProvided: true },
    }));
    expect(JSON.stringify(auditLogs.record.mock.calls)).not.toContain("db-a@example.test");

    await auth.confirmPasswordReset(issued.resetToken ?? "", "new-password");

    await expect(auth.login(loginCredentials(nationalId, "password", "system"))).rejects.toThrow("LOGIN_FAILED");
    await expect(auth.confirmPasswordReset(issued.resetToken ?? "", "another-pass")).rejects.toThrow(
      "PASSWORD_RESET_NOT_PENDING",
    );
    await expect(auth.login(loginCredentials(nationalId, "new-password", "system"))).resolves.toMatchObject({
      session: { userId: "user-db-a" },
    });
  });

  it("tenant kullanıcısı için self-servis şifre reset tokenı üretmez ve eski tokenı kabul etmez", async () => {
    const user = {
      id: "tenant-reset-user",
      email: "tenant-reset@example.test",
      name: "Tenant Reset",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    };
    const users = createUserStoreMock({
      findByEmail: vi.fn(async (email) => (email === user.email ? { ...user, roles: [...user.roles] } : undefined)),
      findById: vi.fn(async () => ({ ...user, roles: [...user.roles] })),
      updatePassword: vi.fn(),
    });
    const passwordResets = new InMemoryPasswordResetStore();
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      passwordResets,
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
    );

    const ignored = await auth.requestPasswordReset(user.email);
    expect(ignored).toEqual({ status: "IGNORED" });

    await passwordResets.create({
      userId: user.id,
      tokenHash: hashResetToken("tenant-reset-token"),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(auth.confirmPasswordReset("tenant-reset-token", "new-password")).rejects.toThrow(
      "TENANT_PASSWORD_RESET_FORBIDDEN",
    );
    expect(users.updatePassword).not.toHaveBeenCalled();
    await expect(auth.confirmPasswordReset("tenant-reset-token", "another-pass")).rejects.toThrow(
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
    if (!("status" in challenge)) throw new Error("MFA challenge bekleniyordu.");

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
    if (!("status" in challenge)) throw new Error("MFA challenge bekleniyordu.");

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

function createUserStoreMock(overrides: Partial<AuthUserStore>): AuthUserStore {
  return {
    findByEmail: vi.fn(),
    findByTenantAndNationalIdHash: vi.fn(),
    findById: vi.fn(),
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
    findById: vi.fn(async (id) => (id === user.id ? clone() : undefined)),
    createOrAttachTenantIdentity: vi.fn(),
    updatePassword: vi.fn(async (_id, passwordHash) => {
      user.passwordHash = passwordHash;
      user.membershipVersion += 1;
      return clone();
    }),
    enableTotp: vi.fn(async (input) => {
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
