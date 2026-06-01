import { describe, expect, it } from "vitest";
import { hashPassword, InMemoryAuthUserStore, verifyPassword } from "./auth-user-store.js";

describe("auth user store", () => {
  it("demo kullanıcıyı AuthService dışındaki store'dan döner", async () => {
    const store = new InMemoryAuthUserStore();

    await expect(store.findByEmail("admin-a@example.test")).resolves.toMatchObject({
      id: "user-tenant-a",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
    });
  });

  it("scrypt password hash doğrulaması yapar", () => {
    const passwordHash = hashPassword("password", "test-salt");

    expect(verifyPassword("password", passwordHash)).toBe(true);
    expect(verifyPassword("wrong", passwordHash)).toBe(false);
    expect(verifyPassword("password", "password")).toBe(false);
  });

  it("PII purge sonrası kullanıcı login dışı kalır ve membership version artar", async () => {
    const store = new InMemoryAuthUserStore();
    const before = await store.findById("user-tenant-a");

    const purged = await store.purgePii("user-tenant-a", {
      email: "purged-user-tenant-a@example.invalid",
      name: "Anonim Kullanici",
      purgedAt: "2026-06-01T00:00:00.000Z",
    });

    expect(purged).toMatchObject({
      email: "purged-user-tenant-a@example.invalid",
      name: "Anonim Kullanici",
      passwordHash: "",
      membershipVersion: (before?.membershipVersion ?? 0) + 1,
    });
  });
});
