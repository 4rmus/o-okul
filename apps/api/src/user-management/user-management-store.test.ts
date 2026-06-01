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
      password: "password1",
      roles: ["TEACHER"],
    });
    await store.setTenantRoles("tenant-a", "user-created", ["STUDENT"]);

    expect(queries.some((query) => query.sql.includes("set_config('app.current_tenant_id'"))).toBe(true);
    const insertUser = queries.find((query) => query.sql.includes('INSERT INTO "User"'));
    expect(insertUser?.values).toEqual([
      expect.any(String),
      "created@example.test",
      "Created User",
      expect.stringMatching(/^scrypt:/),
    ]);
    const tenantMembershipDeletes = queries.filter((query) => query.sql.includes('DELETE FROM "TenantMembership"'));
    expect(tenantMembershipDeletes[0]?.values).toEqual(["tenant-a", "user-created"]);
    const tenantMembershipInserts = queries.filter((query) => query.sql.includes('INSERT INTO "TenantMembership"'));
    expect(tenantMembershipInserts[0]?.values).toEqual([expect.any(String), "tenant-a", "user-created", "TEACHER"]);
    expect(tenantMembershipInserts[1]?.values).toEqual([expect.any(String), "tenant-a", "user-created", "STUDENT"]);
  });
});
