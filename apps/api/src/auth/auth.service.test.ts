import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword, type AuthUser, type AuthUserStore } from "./auth-user-store.js";
import { AuthService } from "./auth.service.js";
import type { IdentityResolver } from "./identity-resolver.js";
import { InMemoryPasswordResetStore } from "./password-reset-store.js";
import { InMemorySessionStore } from "./session-store.js";
import { createTotpCodeForTest } from "./totp-mfa.js";

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
    const users = createUserStoreMock({
      findByEmail: vi.fn(async () => ({
        id: "user-db-a",
        email: "db-a@example.test",
        name: "DB User",
        passwordHash: hashPassword("password", "test-salt"),
        tenantId: "tenant-a",
        roles: ["TENANT_ADMIN"],
        membershipVersion: 1,
      })),
    });
    const identities = {
      resolve: vi.fn(async () => undefined),
    } as unknown as IdentityResolver;
    const auth = new AuthService(users, new InMemorySessionStore(), new InMemoryPasswordResetStore(), identities);

    const tokenPair = await auth.login("db-a@example.test", "password");
    if ("status" in tokenPair) throw new Error("MFA challenge beklenmiyordu.");

    expect(users.findByEmail).toHaveBeenCalledWith("db-a@example.test");
    expect(tokenPair.session).toMatchObject({
      userId: "user-db-a",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
    });
  });

  it("yanlış parola token üretmez", async () => {
    const users = createUserStoreMock({
      findByEmail: vi.fn(async () => ({
        id: "user-db-a",
        email: "db-a@example.test",
        name: "DB User",
        passwordHash: hashPassword("password", "test-salt"),
        tenantId: "tenant-a",
        roles: ["TENANT_ADMIN"],
        membershipVersion: 1,
      })),
    });
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn() } as unknown as IdentityResolver,
    );

    await expect(auth.login("db-a@example.test", "wrong")).rejects.toThrow("LOGIN_FAILED");
  });

  it("şifre reset tokenı tek kullanımlık çalışır ve eski şifreyi geçersiz kılar", async () => {
    const user = {
      id: "user-db-a",
      email: "db-a@example.test",
      name: "DB User",
      passwordHash: hashPassword("password", "test-salt"),
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    };
    const users = createUserStoreMock({
      findByEmail: vi.fn(async (email) => (email === user.email ? { ...user, roles: [...user.roles] } : undefined)),
      findById: vi.fn(async () => ({ ...user, roles: [...user.roles] })),
      updatePassword: vi.fn(async (_id, passwordHash) => {
        user.passwordHash = passwordHash;
        user.membershipVersion += 1;
        return { ...user, roles: [...user.roles] };
      }),
    });
    const auth = new AuthService(
      users,
      new InMemorySessionStore(),
      new InMemoryPasswordResetStore(),
      { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
    );

    const issued = await auth.requestPasswordReset("db-a@example.test");
    expect(issued.status).toBe("ISSUED");
    expect(issued.resetToken).toBeTruthy();

    await auth.confirmPasswordReset(issued.resetToken ?? "", "new-password");

    await expect(auth.login("db-a@example.test", "password")).rejects.toThrow("LOGIN_FAILED");
    await expect(auth.confirmPasswordReset(issued.resetToken ?? "", "another-pass")).rejects.toThrow(
      "PASSWORD_RESET_NOT_PENDING",
    );
    await expect(auth.login("db-a@example.test", "new-password")).resolves.toMatchObject({
      session: { userId: "user-db-a" },
    });
  });

  it("admin TOTP etkinleştikten sonra login'i MFA challenge'a böler ve TOTP reuse'u reddeder", async () => {
    process.env.ADMIN_MFA_MODE = "optional";
    const user: AuthUser = {
      id: "admin-mfa",
      email: "admin-mfa@example.test",
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

    const challenge = await auth.login(user.email, "password");
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
    );
    const context = {
      userId: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
      bypassRls: false,
    };
    const setup = await auth.createTotpSetup(context);
    await auth.confirmTotpSetup(context, setup.setupToken, createTotpCodeForTest(setup.secret));
    const challenge = await auth.login(user.email, "password");
    if (!("status" in challenge)) throw new Error("MFA challenge bekleniyordu.");

    await expect(auth.verifyTotpChallenge(challenge.challengeToken, { recoveryCode: setup.recoveryCodes[0] })).resolves.toMatchObject({
      session: { userId: user.id },
    });
    await expect(auth.verifyTotpChallenge(challenge.challengeToken, { recoveryCode: setup.recoveryCodes[0] })).rejects.toThrow(
      "MFA_RECOVERY_CODE_INVALID",
    );
  });
});

function createUserStoreMock(overrides: Partial<AuthUserStore>): AuthUserStore {
  return {
    findByEmail: vi.fn(),
    findById: vi.fn(),
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
    findById: vi.fn(async (id) => (id === user.id ? clone() : undefined)),
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
