import { describe, expect, it } from "vitest";
import { PostgresUserManagementStore } from "./user-management-store.js";

describe("PostgresUserManagementStore", () => {
  it("tenant kullanıcı listeleme, oluşturma ve rol güncelleme SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const now = new Date("2026-06-01T12:00:00.000Z");
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.includes('INSERT INTO "User"')) {
              return { rows: [{ id: "user-created" }] as T[] };
            }
            if (sql.includes('SELECT "id" FROM "TenantMembership"')) {
              return { rows: [{ id: "membership-a" }] as T[] };
            }
            if (sql.includes('JOIN "User" u') && sql.includes('GROUP BY')) {
              return {
                rows: [
                  {
                    id: values?.[1] ?? "user-created",
                    email: "created@example.test",
                    name: "Created User",
                    tenantId: values?.[0],
                    roles: ["TEACHER"],
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
    const store = new PostgresUserManagementStore(pool);

    await store.listTenantUsers("tenant-a");
    await store.createOrAttachTenantUser({
      tenantId: "tenant-a",
      email: "CREATED@example.test",
      name: "Created User",
      nationalIdEncrypted: "encrypted-created",
      nationalIdHash: "hash-created",
      password: "password1",
      roles: ["TEACHER"],
    });
    await store.setTenantRoles("tenant-a", "user-created", ["STUDENT"]);

    expect(queries.some((query) => query.sql.includes("set_config('app.current_tenant_id'"))).toBe(true);
    const insertUser = queries.find((query) => query.sql.includes('INSERT INTO "User"'));
    expect(insertUser?.sql).toContain('ON CONFLICT ("tenantId", "nationalIdHash") DO UPDATE');
    expect(insertUser?.sql).toContain('"passwordHash" = EXCLUDED."passwordHash"');
    expect(insertUser?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "created@example.test",
      "encrypted-created",
      "hash-created",
      "Created User",
      expect.stringMatching(/^scrypt:/),
    ]);
    const tenantMembershipDeletes = queries.filter((query) => query.sql.includes('DELETE FROM "TenantMembership"'));
    expect(tenantMembershipDeletes[0]?.values).toEqual(["tenant-a", "user-created"]);
    const tenantMembershipInserts = queries.filter((query) => query.sql.includes('INSERT INTO "TenantMembership"'));
    expect(tenantMembershipInserts[0]?.values).toEqual([expect.any(String), "tenant-a", "user-created", "TEACHER"]);
    expect(tenantMembershipInserts[1]?.values).toEqual([expect.any(String), "tenant-a", "user-created", "STUDENT"]);
  });

  it("mevcut global e-postayı tenant'a eklerken parolayı güncellemez", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const now = new Date("2026-06-01T12:00:00.000Z");
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.includes('INSERT INTO "User"')) {
              return { rows: [] as T[] };
            }
            if (sql.includes('SELECT "id" FROM "User" WHERE lower("email")')) {
              return { rows: [{ id: "user-existing" }] as T[] };
            }
            if (sql.includes('SELECT "id" FROM "TenantMembership"')) {
              return { rows: [] as T[] };
            }
            if (sql.includes('JOIN "User" u') && sql.includes('GROUP BY')) {
              return {
                rows: [
                  {
                    id: values?.[1] ?? "user-existing",
                    email: "existing@example.test",
                    name: "Existing User",
                    tenantId: values?.[0],
                    roles: ["TEACHER"],
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
    const store = new PostgresUserManagementStore(pool);

    const record = await store.createOrAttachTenantUser({
      tenantId: "tenant-a",
      email: "EXISTING@example.test",
      name: "Attacker Supplied Name",
      nationalIdEncrypted: "encrypted-existing",
      nationalIdHash: "hash-existing",
      password: "attacker-password",
      roles: ["TEACHER"],
    });

    const insertUser = queries.find((query) => query.sql.includes('INSERT INTO "User"'));
    expect(insertUser).toBeUndefined();
    expect(queries.some((query) => query.sql.includes('UPDATE "User"'))).toBe(false);
    expect(queries.some((query) => query.sql.includes('SELECT "id" FROM "User" WHERE lower("email")'))).toBe(true);
    expect(record).toMatchObject({ id: "user-existing", tenantId: "tenant-a", roles: ["TEACHER"] });
  });

  it("yeni üyelik eklerken koltuk limiti doluysa transaction'ı geri alır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.includes('INSERT INTO "User"')) {
              return { rows: [{ id: "user-new-seat" }] as T[] };
            }
            if (sql.includes('SELECT "id" FROM "TenantMembership"')) {
              return { rows: [] as T[] };
            }
            if (sql.includes('SELECT "seatLimit" FROM "Tenant"')) {
              return { rows: [{ seatLimit: 1 }] as T[] };
            }
            if (sql.includes('COUNT(DISTINCT "userId")')) {
              return { rows: [{ activeSeatCount: 1 }] as T[] };
            }
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
    };
    const store = new PostgresUserManagementStore(pool);

    await expect(
      store.createOrAttachTenantUser({
        tenantId: "tenant-full",
        email: "new-seat@example.test",
        name: "New Seat",
        nationalIdEncrypted: "encrypted-new-seat",
        nationalIdHash: "hash-new-seat",
        password: "password1",
        roles: ["TEACHER"],
      }),
    ).rejects.toThrow("TENANT_SEAT_LIMIT_EXCEEDED");

    expect(queries.some((query) => query.sql.includes('SELECT "seatLimit" FROM "Tenant"') && query.sql.includes("FOR UPDATE"))).toBe(
      true,
    );
    expect(queries.some((query) => query.sql.includes('DELETE FROM "TenantMembership"'))).toBe(false);
    expect(queries.some((query) => query.sql.includes('INSERT INTO "TenantMembership"'))).toBe(false);
    expect(queries.at(-1)?.sql).toBe("ROLLBACK");
  });
});
