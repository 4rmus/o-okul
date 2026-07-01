import { describe, expect, it } from "vitest";
import { hashPassword, InMemoryAuthUserStore, PostgresAuthUserStore, verifyPassword } from "./auth-user-store.js";

describe("auth user store", () => {
  it("demo kullanıcıyı AuthService dışındaki store'dan döner", async () => {
    const store = new InMemoryAuthUserStore();

    await expect(store.findByEmail("admin-a@example.test")).resolves.toMatchObject({
      id: "user-tenant-a",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
    });
    await expect(store.listByTenant("tenant-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "user-tenant-a", tenantId: "tenant-a" }),
    ]));
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

  it("Postgres auth sorgularını açık bypass wrapper içinde çalıştırır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.includes('FROM "User" u')) {
              return {
                rows: [{
                  id: "user-a",
                  email: "admin@example.test",
                  name: "Admin",
                  passwordHash: hashPassword("password"),
                  tenantId: "tenant-a",
                  roles: ["TENANT_ADMIN"],
                }] as T[],
              };
            }
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
    };
    const store = new PostgresAuthUserStore(pool);

    await expect(store.findByEmail("admin@example.test")).resolves.toMatchObject({
      id: "user-a",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
    });

    expect(queries[0]?.sql).toBe("BEGIN");
    expect(queries.some((query) => query.sql.includes("set_config('app.bypass_rls'"))).toBe(true);
    expect(queries.some((query) => query.sql.includes('JOIN "Tenant" t'))).toBe(true);
    expect(queries.some((query) => query.sql.includes(`t."status" = 'ACTIVE'`))).toBe(true);
    expect(queries.some((query) => query.sql.includes(`t."licenseEndsAt"`))).toBe(false);
    expect(queries.some((query) => query.sql === "COMMIT")).toBe(true);
  });
});
