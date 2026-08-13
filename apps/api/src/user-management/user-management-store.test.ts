import { describe, expect, it } from "vitest";
import { InMemoryUserManagementStore, PostgresUserManagementStore } from "./user-management-store.js";

describe("PostgresUserManagementStore", () => {
  it("çalışan erişim projeksiyonunu tenant RLS ile okur", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.includes('FROM "Employee" e')) {
              return {
                rows: [{
                  id: "employee-a",
                  tenantId: "tenant-a",
                  employeeNo: "A-001",
                  firstName: "Ada",
                  lastName: "Yılmaz",
                  workEmail: "ada@example.test",
                  status: "ACTIVE",
                  employmentStartsAt: new Date("2026-08-01T00:00:00.000Z"),
                  employmentEndsAt: null,
                  userId: "user-a",
                  accountStatus: "ACTIVE",
                  membershipId: "membership-a",
                  staffRole: "OPERATIONS_STAFF",
                  hasTeacherPersona: true,
                  membershipStatus: "ACTIVE",
                  version: 4,
                  scopeMode: "CAMPUSES",
                  campusIds: ["campus-a"],
                }] as T[],
              };
            }
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
    };
    const store = new PostgresUserManagementStore(pool);

    await expect(store.listEmployees("tenant-a")).resolves.toEqual([
      expect.objectContaining({
        id: "employee-a",
        tenantId: "tenant-a",
        employmentStartsAt: "2026-08-01T00:00:00.000Z",
        access: expect.objectContaining({ staffRole: "OPERATIONS_STAFF", campusIds: ["campus-a"] }),
      }),
    ]);
    const employeeQuery = queries.find((query) => query.sql.includes('FROM "Employee" e'));
    expect(employeeQuery?.values).toEqual(["tenant-a"]);
    expect(employeeQuery?.sql).toContain('u."tenantId" = e."tenantId"');
    expect(queries.some((query) => query.sql.includes("set_config('app.current_tenant_id'"))).toBe(true);
  });

  it("çalışan cursor listesini SQL arama, limit ve sabit sıralamayla okur", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.includes('ORDER BY lower(e."lastName") ASC, e."id" ASC')) {
              return {
                rows: [{
                  id: "employee-a",
                  tenantId: "tenant-a",
                  employeeNo: "A-001",
                  firstName: "Ada",
                  lastName: "Yılmaz",
                  workEmail: "ada@example.test",
                  status: "ACTIVE",
                  employmentStartsAt: null,
                  employmentEndsAt: null,
                  userId: null,
                  accountStatus: null,
                  membershipId: null,
                  staffRole: null,
                  hasTeacherPersona: null,
                  membershipStatus: null,
                  version: null,
                  scopeMode: null,
                  campusIds: null,
                  cursorKey: "yılmaz",
                }] as T[],
              };
            }
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
    };
    const store = new PostgresUserManagementStore(pool);

    await expect(store.listEmployeeAccessPage("tenant-a", {
      direction: "next",
      limit: 50,
      q: "Ada",
      sort: "lastName",
    })).resolves.toMatchObject({
      records: [expect.objectContaining({ id: "employee-a" })],
      meta: { limit: 50 },
    });

    const employeeQuery = queries.find((query) => query.sql.includes('ORDER BY lower(e."lastName") ASC, e."id" ASC'));
    expect(employeeQuery?.values).toEqual(["tenant-a", "%ada%", 51]);
    expect(employeeQuery?.sql).toContain('LIKE $2 ESCAPE');
    expect(employeeQuery?.sql).toContain('LIMIT $3');
  });

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
            if (sql.includes('FROM "TenantMembership"') && sql.includes('"version"')) {
              return { rows: [{ id: "membership-a", version: 4 }] as T[] };
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
      1,
    ]);
    const tenantMembershipDeletes = queries.filter((query) => query.sql.includes('DELETE FROM "TenantMembership"'));
    expect(tenantMembershipDeletes[0]?.values).toEqual(["tenant-a", "user-created"]);
    const tenantMembershipInserts = queries.filter((query) => query.sql.includes('INSERT INTO "TenantMembership"'));
    expect(tenantMembershipInserts[0]?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "user-created",
      "TEACHER",
      null,
      true,
      false,
      5,
    ]);
    expect(tenantMembershipInserts[1]?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "user-created",
      "STUDENT",
      null,
      false,
      true,
      5,
    ]);
    expect(queries.some((query) => query.sql.includes('"membershipVersion" = "membershipVersion" + 1'))).toBe(true);
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
            if (sql.includes('coalesce("emailNormalized", lower(btrim("email")))')) {
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
    const normalizationUpdate = queries.find(
      (query) => query.sql.includes('UPDATE "User"') && query.sql.includes('"emailNormalized" = $3'),
    );
    expect(normalizationUpdate?.values).toEqual(["tenant-a", "user-existing", "existing@example.test"]);
    expect(normalizationUpdate?.sql).not.toContain('"passwordHash"');
    expect(normalizationUpdate?.sql).not.toContain('"name" =');
    expect(queries.some((query) => query.sql.includes('coalesce("emailNormalized", lower(btrim("email")))'))).toBe(true);
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

    expect(queries.some((query) => query.sql.includes('SELECT "seatLimit" FROM "Tenant"') && query.sql.includes("FOR NO KEY UPDATE"))).toBe(
      true,
    );
    expect(queries.some((query) => query.sql.includes('DELETE FROM "TenantMembership"'))).toBe(false);
    expect(queries.some((query) => query.sql.includes('INSERT INTO "TenantMembership"'))).toBe(false);
    expect(queries.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("canonical rol satırı kaldırılınca kalan teacher satırına persona alanlarını yeniden yazar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const now = new Date("2026-08-01T12:00:00.000Z");
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.includes('SELECT "role"::text AS role')) {
              return { rows: [{ role: "TENANT_ADMIN" }, { role: "TEACHER" }] as T[] };
            }
            if (sql.includes('FROM "TenantMembership"') && sql.includes('"version"')) {
              return { rows: [{ id: "membership-admin", version: 2 }, { id: "membership-teacher", version: 2 }] as T[] };
            }
            if (sql.includes('JOIN "User" u') && sql.includes('GROUP BY')) {
              return {
                rows: [{
                  id: "user-dual",
                  email: "dual@example.test",
                  name: "Dual User",
                  tenantId: "tenant-a",
                  roles: ["TEACHER"],
                  createdAt: now,
                  updatedAt: now,
                }] as T[],
              };
            }
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
    };
    const store = new PostgresUserManagementStore(pool);

    await expect(store.removeTenantRole("tenant-a", "user-dual", "TENANT_ADMIN")).resolves.toMatchObject({
      roles: ["TEACHER"],
    });

    const insert = queries.find((query) => query.sql.includes('INSERT INTO "TenantMembership"'));
    expect(insert?.values?.slice(3)).toEqual(["TEACHER", null, true, false, 3]);
    expect(queries.some((query) => query.sql.includes('"membershipVersion" = "membershipVersion" + 1'))).toBe(true);
  });

  it("çalışan üyeliğini canonical satırı koruyarak günceller ve session'ları aynı transaction'da kapatır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = membershipLifecyclePool(queries);
    const store = new PostgresUserManagementStore(pool);

    await expect(store.updateTenantMembership("tenant-a", "membership-a", {
      actorCanManageOwners: false,
      campusIds: ["campus-main"],
      expectedVersion: 4,
      hasTeacherPersona: true,
      scopeMode: "CAMPUSES",
      staffRole: "OPERATIONS_STAFF",
      status: "ACTIVE",
    })).resolves.toEqual({
      employee: expect.objectContaining({
        id: "employee-a",
        accountStatus: "ACTIVE",
        access: expect.objectContaining({
          membershipId: "membership-a",
          staffRole: "OPERATIONS_STAFF",
          hasTeacherPersona: true,
          version: 5,
          campusIds: ["campus-main"],
        }),
      }),
      sessionsRevoked: 2,
    });

    expect(queries.some((query) => query.sql.includes('DELETE FROM "TenantMembership"') && query.sql.includes('"id" <> $3'))).toBe(true);
    expect(queries.some((query) => query.sql.includes('UPDATE "TenantMembership"') && query.sql.includes('"version" = $8'))).toBe(true);
    expect(queries.some((query) => query.sql.includes('INSERT INTO "TenantMembership"') && query.sql.includes("'TEACHER'"))).toBe(true);
    expect(queries.some((query) => query.sql.includes('UPDATE "AuthSession"') && query.sql.includes("RETURNING \"id\""))).toBe(true);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("session iptali başarısız olursa üyelik transaction'ını geri alır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresUserManagementStore(membershipLifecyclePool(queries, true));

    await expect(store.updateTenantMembership("tenant-a", "membership-a", {
      actorCanManageOwners: false,
      campusIds: [],
      expectedVersion: 4,
      hasTeacherPersona: false,
      scopeMode: "TENANT",
      staffRole: "OPERATIONS_STAFF",
      status: "SUSPENDED",
    })).rejects.toThrow("SESSION_REVOKE_FAILED");

    expect(queries.at(-1)?.sql).toBe("ROLLBACK");
    expect(queries.some((query) => query.sql === "COMMIT")).toBe(false);
  });

  it("son aktif kurum sahibinin rolünü düşürmez", async () => {
    const store = new InMemoryUserManagementStore();
    const promoted = await store.updateTenantMembership("tenant-a", "membership-admin-a", {
      actorCanManageOwners: true,
      campusIds: [],
      expectedVersion: 1,
      hasTeacherPersona: false,
      scopeMode: "TENANT",
      staffRole: "TENANT_OWNER",
      status: "ACTIVE",
    });
    expect(promoted?.employee.access?.version).toBe(2);

    await expect(store.updateTenantMembership("tenant-a", "membership-admin-a", {
      actorCanManageOwners: true,
      campusIds: [],
      expectedVersion: 2,
      hasTeacherPersona: false,
      scopeMode: "TENANT",
      staffRole: "TENANT_ADMIN",
      status: "ACTIVE",
    })).rejects.toThrow("LAST_ACTIVE_TENANT_OWNER_REQUIRED");
  });

  it("owner/admin rol değişikliklerini MFA istemeden uygular ve owner capability sınırını korur", async () => {
    const store = new InMemoryUserManagementStore();

    await expect(store.updateTenantMembership("tenant-a", "membership-operations-a", {
      actorCanManageOwners: false,
      campusIds: [],
      expectedVersion: 1,
      hasTeacherPersona: false,
      scopeMode: "TENANT",
      staffRole: "TENANT_ADMIN",
      status: "ACTIVE",
    })).resolves.toMatchObject({ employee: { access: { staffRole: "TENANT_ADMIN" } } });

    await expect(store.updateTenantMembership("tenant-a", "membership-admin-a", {
      actorCanManageOwners: false,
      campusIds: [],
      expectedVersion: 1,
      hasTeacherPersona: false,
      scopeMode: "TENANT",
      staffRole: "TENANT_OWNER",
      status: "ACTIVE",
    })).rejects.toThrow("TENANT_OWNER_MANAGE_REQUIRED");
  });

  it("çalışan üyeliğini askıya alır, açar ve sonlandırdıktan sonra yeniden değiştirmez", async () => {
    const store = new InMemoryUserManagementStore();
    const suspended = await store.updateTenantMembership("tenant-a", "membership-operations-a", {
      actorCanManageOwners: false,
      campusIds: [],
      expectedVersion: 1,
      hasTeacherPersona: false,
      scopeMode: "TENANT",
      staffRole: "OPERATIONS_STAFF",
      status: "SUSPENDED",
    });
    expect(suspended).toMatchObject({ employee: { accountStatus: "DISABLED", access: { status: "SUSPENDED", version: 2 } } });

    const activated = await store.updateTenantMembership("tenant-a", "membership-operations-a", {
      actorCanManageOwners: false,
      campusIds: [],
      expectedVersion: 2,
      hasTeacherPersona: false,
      scopeMode: "TENANT",
      staffRole: "OPERATIONS_STAFF",
      status: "ACTIVE",
    });
    expect(activated).toMatchObject({ employee: { accountStatus: "ACTIVE", access: { status: "ACTIVE", version: 3 } } });

    const ended = await store.updateTenantMembership("tenant-a", "membership-operations-a", {
      actorCanManageOwners: false,
      campusIds: [],
      endedReason: "İşten ayrıldı",
      expectedVersion: 3,
      hasTeacherPersona: false,
      scopeMode: "TENANT",
      staffRole: "OPERATIONS_STAFF",
      status: "ENDED",
    });
    expect(ended).toMatchObject({ employee: { accountStatus: "DISABLED", access: { status: "ENDED", version: 4 } } });
    await expect(store.updateTenantMembership("tenant-a", "membership-operations-a", {
      actorCanManageOwners: false,
      campusIds: [],
      expectedVersion: 4,
      hasTeacherPersona: false,
      scopeMode: "TENANT",
      staffRole: "OPERATIONS_STAFF",
      status: "ACTIVE",
    })).rejects.toThrow("TENANT_MEMBERSHIP_ENDED");
  });

  it("aktif üyelik rolü değişirken güvenlik kilitli hesabı açmaz", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresUserManagementStore(membershipLifecyclePool(queries, false, "LOCKED"));

    await store.updateTenantMembership("tenant-a", "membership-a", {
      actorCanManageOwners: false,
      campusIds: ["campus-main"],
      expectedVersion: 4,
      hasTeacherPersona: true,
      scopeMode: "CAMPUSES",
      staffRole: "OPERATIONS_STAFF",
      status: "ACTIVE",
    });

    const accountUpdate = queries.find((query) => query.sql.includes('UPDATE "User"') && query.sql.includes('"accountStatus" = $3'));
    expect(accountUpdate?.values?.[2]).toBe("LOCKED");
  });
});

describe("InMemoryUserManagementStore çalışan cursor listesi", () => {
  const query = { direction: "next" as const, limit: 1, sort: "lastName" as const };

  it("ileri/geri sayfayı, arama bağlamını ve tenant bağını korur", async () => {
    const store = new InMemoryUserManagementStore();
    const first = await store.listEmployeeAccessPage("tenant-a", query);
    const nextCursor = first.meta.nextCursor;

    expect(first.records.map((record) => record.id)).toEqual(["employee-admin-a"]);
    expect(nextCursor).toEqual(expect.any(String));

    const second = await store.listEmployeeAccessPage("tenant-a", { ...query, cursor: nextCursor });
    expect(second.records.map((record) => record.id)).toEqual(["employee-operations-a"]);
    expect(second.meta.previousCursor).toEqual(expect.any(String));

    const previous = await store.listEmployeeAccessPage("tenant-a", {
      ...query,
      cursor: second.meta.previousCursor,
      direction: "previous",
    });
    expect(previous.records.map((record) => record.id)).toEqual(["employee-admin-a"]);

    await expect(store.listEmployeeAccessPage("tenant-b", { ...query, cursor: nextCursor })).rejects.toThrow("EMPLOYEE_CURSOR_INVALID");
    await expect(store.listEmployeeAccessPage("tenant-a", { ...query, q: "ada", cursor: nextCursor })).rejects.toThrow("EMPLOYEE_CURSOR_INVALID");
  });

  it("ad, sicil no ve iş e-postasında büyük/küçük harfe duyarsız arar", async () => {
    const store = new InMemoryUserManagementStore();

    await expect(store.listEmployeeAccessPage("tenant-a", { ...query, q: "A-002" })).resolves.toMatchObject({
      records: [expect.objectContaining({ id: "employee-operations-a" })],
    });
    await expect(store.listEmployeeAccessPage("tenant-a", { ...query, q: "ADMIN-A@EXAMPLE.TEST" })).resolves.toMatchObject({
      records: [expect.objectContaining({ id: "employee-admin-a" })],
    });
  });
});

function membershipLifecyclePool(
  queries: Array<{ sql: string; values?: unknown[] }>,
  failSessionRevoke = false,
  accountStatus = "ACTIVE",
) {
  return {
    async query<T>() {
      return { rows: [] as T[] };
    },
    async connect() {
      return {
        async query<T>(sql: string, values?: unknown[]) {
          queries.push({ sql, values });
          if (sql.includes('FOR UPDATE OF m, u, e')) {
            return { rows: [{
              membershipId: "membership-a",
              userId: "user-a",
              staffRole: "TENANT_ADMIN",
              hasTeacherPersona: false,
              membershipStatus: "ACTIVE",
              version: 4,
              scopeMode: "TENANT",
              accountStatus,
              employeeId: "employee-a",
              employeeStatus: "ACTIVE",
              campusIds: [],
            }] as T[] };
          }
          if (sql.includes('"staffRole" = \'TENANT_OWNER\'')) return { rows: [] as T[] };
          if (sql.includes('FROM "Campus"')) return { rows: [{ id: "campus-main" }] as T[] };
          if (sql.includes('UPDATE "TenantMembership"')) return { rows: [{ id: "membership-a" }] as T[] };
          if (sql.includes('UPDATE "AuthSession"')) {
            if (failSessionRevoke) throw new Error("SESSION_REVOKE_FAILED");
            return { rows: [{ id: "session-1" }, { id: "session-2" }] as T[] };
          }
          if (sql.includes('FROM "TenantMembership" m') && sql.includes('LIMIT 1')) {
            return { rows: [{
              id: "employee-a",
              tenantId: "tenant-a",
              employeeNo: "A-002",
              firstName: "Ada",
              lastName: "Yılmaz",
              workEmail: "ada@example.test",
              status: "ACTIVE",
              employmentStartsAt: null,
              employmentEndsAt: null,
              userId: "user-a",
              accountStatus: "ACTIVE",
              membershipId: "membership-a",
              staffRole: "OPERATIONS_STAFF",
              hasTeacherPersona: true,
              membershipStatus: "ACTIVE",
              version: 5,
              scopeMode: "CAMPUSES",
              campusIds: ["campus-main"],
            }] as T[] };
          }
          return { rows: [] as T[] };
        },
        release() {},
      };
    },
  };
}
