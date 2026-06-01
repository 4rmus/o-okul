import { describe, expect, it, vi } from "vitest";
import { hashPassword, type AuthUserStore } from "./auth-user-store.js";
import { AuthService } from "./auth.service.js";
import type { IdentityResolver } from "./identity-resolver.js";
import { InMemoryPasswordResetStore } from "./password-reset-store.js";
import { InMemorySessionStore } from "./session-store.js";

describe("AuthService", () => {
  it("login kullanıcıyı injected store'dan okur ve password hash doğrular", async () => {
    const users: AuthUserStore = {
      findByEmail: vi.fn(async () => ({
        id: "user-db-a",
        email: "db-a@example.test",
        name: "DB User",
        passwordHash: hashPassword("password", "test-salt"),
        tenantId: "tenant-a",
        roles: ["TENANT_ADMIN"],
        membershipVersion: 1,
      })),
      findById: vi.fn(),
      updatePassword: vi.fn(),
      purgePii: vi.fn(),
    };
    const identities = {
      resolve: vi.fn(async () => undefined),
    } as unknown as IdentityResolver;
    const auth = new AuthService(users, new InMemorySessionStore(), new InMemoryPasswordResetStore(), identities);

    const tokenPair = await auth.login("db-a@example.test", "password");

    expect(users.findByEmail).toHaveBeenCalledWith("db-a@example.test");
    expect(tokenPair.session).toMatchObject({
      userId: "user-db-a",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
    });
  });

  it("yanlış parola token üretmez", async () => {
    const users: AuthUserStore = {
      findByEmail: vi.fn(async () => ({
        id: "user-db-a",
        email: "db-a@example.test",
        name: "DB User",
        passwordHash: hashPassword("password", "test-salt"),
        tenantId: "tenant-a",
        roles: ["TENANT_ADMIN"],
        membershipVersion: 1,
      })),
      findById: vi.fn(),
      updatePassword: vi.fn(),
      purgePii: vi.fn(),
    };
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
    const users: AuthUserStore = {
      findByEmail: vi.fn(async (email) => (email === user.email ? { ...user, roles: [...user.roles] } : undefined)),
      findById: vi.fn(async () => ({ ...user, roles: [...user.roles] })),
      updatePassword: vi.fn(async (_id, passwordHash) => {
        user.passwordHash = passwordHash;
        user.membershipVersion += 1;
        return { ...user, roles: [...user.roles] };
      }),
      purgePii: vi.fn(),
    };
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
});
