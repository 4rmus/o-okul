import { describe, expect, it } from "vitest";
import { InMemoryAuthUserStore, verifyPassword } from "../auth/auth-user-store.js";
import { InMemoryTenantStore, PostgresTenantStore } from "./tenant-store.js";

describe("InMemoryTenantStore", () => {
  it("expired tenant normal tenant çözümlemesinde görünmez ama admin görünümünde görünür", async () => {
    const store = new InMemoryTenantStore();
    await store.create({
      id: "tenant-expired",
      name: "Expired Tenant",
      slug: "tenant-expired",
      licenseEndsAt: "2020-01-01T00:00:00.000Z",
    });

    await expect(store.findById("tenant-expired")).resolves.toBeUndefined();
    await expect(store.findForAdmin("tenant-expired")).resolves.toMatchObject({
      id: "tenant-expired",
      status: "ACTIVE",
    });
  });

  it("inactive tenant normal tenant çözümlemesinde görünmez", async () => {
    const store = new InMemoryTenantStore();
    await store.create({
      id: "tenant-suspended",
      name: "Suspended Tenant",
      slug: "tenant-suspended",
      status: "SUSPENDED",
    });

    await expect(store.findById("tenant-suspended")).resolves.toBeUndefined();
  });

  it("ilk admin oluşturulunca koltuk sayısını listeye yansıtır", async () => {
    const store = new InMemoryTenantStore();

    await store.createWithFirstAdmin(
      { id: "tenant-first-admin", name: "First Admin Tenant", slug: "first-admin-tenant", seatLimit: 3 },
      { name: "First Admin", email: "first.admin@example.test", nationalId: "10000000450", phone: "5551234567" },
    );

    await expect(store.list()).resolves.toContainEqual(
      expect.objectContaining({
        id: "tenant-first-admin",
        activeSeatCount: 1,
        seatLimit: 3,
      }),
    );
  });

  it("ilk admin oluşturulunca memory auth store ile login'e uygun kullanıcı oluşturur", async () => {
    const store = new InMemoryTenantStore();

    await store.createWithFirstAdmin(
      { id: "tenant-login-admin", name: "Login Admin Tenant", slug: "login-admin-tenant" },
      { name: "Login Admin", email: "LOGIN.ADMIN@example.test", nationalId: "10000000450", phone: "5551234567" },
    );

    const authUser = await new InMemoryAuthUserStore().findByEmail("login.admin@example.test");

    expect(authUser).toMatchObject({
      email: "login.admin@example.test",
      tenantId: "tenant-login-admin",
      roles: ["TENANT_ADMIN"],
    });
    expect(verifyPassword("5551234567", authUser?.passwordHash ?? "")).toBe(true);
  });
});

describe("PostgresTenantStore", () => {
  it("tenant ve ilk admin üyeliğini aynı transaction içinde oluşturur", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const now = new Date("2026-06-04T09:00:00.000Z");
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.includes('SELECT "id" FROM "User" WHERE lower("email")')) {
              return { rows: [] as T[] };
            }
            if (sql.includes('INSERT INTO "Tenant"')) {
              return {
                rows: [
                  {
                    id: values?.[0],
                    name: values?.[1],
                    slug: values?.[2],
                    plan: values?.[3],
                    licenseStartsAt: values?.[4],
                    licenseEndsAt: values?.[5],
                    seatLimit: values?.[6],
                    status: values?.[7],
                  },
                ] as T[],
              };
            }
            if (sql.includes('INSERT INTO "User"')) {
              return { rows: [{ id: "user-first-admin" }] as T[] };
            }
            if (sql.includes('JOIN "User" u') && sql.includes('GROUP BY')) {
              return {
                rows: [
                  {
                    id: "user-first-admin",
                    email: "first.admin@example.test",
                    name: "First Admin",
                    tenantId: values?.[0],
                    roles: ["TENANT_ADMIN"],
                    createdAt: now,
                    updatedAt: now,
                  },
                ] as T[],
              };
            }
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
    };
    const store = new PostgresTenantStore(pool);

    const result = await store.createWithFirstAdmin(
      { id: "tenant-first-admin", name: "First Admin Tenant", slug: "first-admin-tenant" },
      { name: "First Admin", email: "FIRST.ADMIN@example.test", nationalId: "10000000450", phone: "5551234567" },
    );

    expect(result).toEqual({
      tenant: expect.objectContaining({ id: "tenant-first-admin" }),
      admin: expect.objectContaining({
        email: "first.admin@example.test",
        roles: ["TENANT_ADMIN"],
        tenantId: "tenant-first-admin",
      }),
    });
    expect(queries[0]?.sql).toBe("BEGIN");
    expect(queries.some((query) => query.sql.includes("set_config('app.bypass_rls'") && query.values?.[0] === "true")).toBe(true);
    expect(queries.some((query) => query.sql.includes('INSERT INTO "Tenant"'))).toBe(true);
    const insertUser = queries.find((query) => query.sql.includes('INSERT INTO "User"'));
    expect(insertUser?.sql).toContain('ON CONFLICT ("email") DO NOTHING');
    expect(insertUser?.values).toHaveLength(7);
    expect(queries.some((query) => query.sql.includes('INSERT INTO "TenantMembership"'))).toBe(true);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("ilk admin e-postası başka kullanıcıda varsa tenant oluşturmadan reddeder", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.includes('SELECT "id" FROM "User" WHERE lower("email")')) {
              return { rows: [{ id: "user-existing" }] as T[] };
            }
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
    };
    const store = new PostgresTenantStore(pool);

    await expect(store.createWithFirstAdmin(
      { id: "tenant-duplicate-admin", name: "Duplicate Admin Tenant", slug: "duplicate-admin-tenant" },
      { name: "Existing Admin", email: "existing.admin@example.test", nationalId: "10000000450", phone: "5551234567" },
    )).rejects.toThrow("TENANT_FIRST_ADMIN_EMAIL_ALREADY_EXISTS");

    expect(queries.some((query) => query.sql.includes('INSERT INTO "Tenant"'))).toBe(false);
    expect(queries.at(-1)?.sql).toBe("ROLLBACK");
  });
});
