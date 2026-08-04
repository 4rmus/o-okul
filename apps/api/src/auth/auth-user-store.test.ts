import { describe, expect, it } from "vitest";
import {
  hashPassword,
  hashPasswordAsync,
  InMemoryAuthUserStore,
  passwordHashNeedsRehash,
  PostgresAuthUserStore,
  verifyPassword,
  verifyPasswordAsync,
} from "./auth-user-store.js";

describe("auth user store", () => {
  it("demo kullanıcıyı AuthService dışındaki store'dan döner", async () => {
    const store = new InMemoryAuthUserStore();

    await expect(store.findByEmail("admin-a@example.test")).resolves.toMatchObject({
      id: "user-tenant-a",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
    });
    await expect(store.findByTenantAndLoginName("tenant-a", "ADMIN-A@EXAMPLE.TEST")).resolves.toMatchObject({
      id: "user-tenant-a",
      tenantId: "tenant-a",
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

  it("TOTP counterını yalnız monotonik olarak ilerletir", async () => {
    const store = new InMemoryAuthUserStore();

    await expect(store.markTotpCounterUsed("user-tenant-a", "101")).resolves.toBe(true);
    await expect(store.markTotpCounterUsed("user-tenant-a", "100")).resolves.toBe(false);
    await expect(store.markTotpCounterUsed("user-tenant-a", "101")).resolves.toBe(false);
    await expect(store.markTotpCounterUsed("user-tenant-a", "102")).resolves.toBe(true);
  });

  it("yeni parolayı rastgele tuzlu sürümlü scrypt ile asenkron hashler", async () => {
    const first = await hashPasswordAsync("secure-password-123");
    const second = await hashPasswordAsync("secure-password-123");

    expect(first).toMatch(/^scrypt:v2:/);
    expect(second).not.toBe(first);
    await expect(verifyPasswordAsync("secure-password-123", first)).resolves.toBe(true);
    await expect(verifyPasswordAsync("wrong-password", first)).resolves.toBe(false);
    expect(passwordHashNeedsRehash(first)).toBe(false);
    expect(passwordHashNeedsRehash(hashPassword("secure-password-123"))).toBe(true);
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
            if (sql.includes('UPDATE "User"')) {
              return { rows: [{ id: "user-a", tenantId: "tenant-a", membershipVersion: 7 }] as T[] };
            }
            if (sql.includes('FROM "User" u')) {
              return {
                rows: [{
                  id: "user-a",
                  email: "admin@example.test",
                  name: "Admin",
                  passwordHash: hashPassword("password"),
                  membershipVersion: 7,
                  tenantId: "tenant-a",
                  roles: ["TENANT_ADMIN"],
                  canonicalMembershipId: "membership-a",
                  canonicalMembershipCount: 1,
                  canonicalStaffRole: "TENANT_OWNER",
                  canonicalHasTeacherPersona: false,
                  canonicalHasStudentPersona: false,
                  canonicalMembershipVersion: 7,
                  canonicalScopeMode: "CAMPUSES",
                  canonicalCampusIds: ["campus-main"],
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
      membershipVersion: 7,
      authorizationSource: "CANONICAL_PARITY",
      membership: {
        id: "membership-a",
        staffRole: "TENANT_OWNER",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 7,
        scopeMode: "CAMPUSES",
        campusIds: ["campus-main"],
      },
    });
    await expect(store.findByTenantAndLoginName("tenant-a", "admin@example.test")).resolves.toMatchObject({
      id: "user-a",
      tenantId: "tenant-a",
    });

    await store.enableTotp({
      userId: "user-a",
      secretEncrypted: "encrypted-secret",
      enabledAt: "2026-07-13T00:00:00.000Z",
      recoveryCodeHashes: ["recovery-hash"],
    });
    await store.disableTotp("user-a");
    await store.markTotpCounterUsed("user-a", "123456");
    await store.updatePassword("user-a", "scrypt:v2:test-salt:test-hash", {
      mustChangePassword: false,
      passwordChangedAt: "2026-08-01T12:00:00.000Z",
    });

    expect(queries[0]?.sql).toBe("BEGIN");
    expect(queries.some((query) => query.sql.includes("set_config('app.bypass_rls'"))).toBe(true);
    expect(queries.some((query) => query.sql.includes('JOIN "Tenant" t'))).toBe(true);
    const loginQuery = queries.find((query) => query.sql.includes('u."loginNameNormalized" = lower(btrim($2))'));
    expect(loginQuery?.sql).toContain('u."emailNormalized" = lower(btrim($2))');
    expect(loginQuery?.sql).toContain('m."status" = \'ACTIVE\'');
    expect(loginQuery?.sql).toContain('count(DISTINCT m."id") FILTER');
    expect(loginQuery?.sql).toContain('LEFT JOIN "MembershipCampusScope" scope');
    expect(loginQuery?.sql).toContain('AS "canonicalScopeMode"');
    expect(loginQuery?.sql).toContain('AS "canonicalCampusIds"');
    expect(loginQuery?.sql).toContain('m."tenantId" = u."tenantId"');
    expect(loginQuery?.sql).toContain('u."accountStatus" IN (\'ACTIVE\', \'PENDING_ACTIVATION\')');
    expect(loginQuery?.sql).not.toContain('t."licenseEndsAt"');
    expect(loginQuery?.values).toEqual(["tenant-a", "admin@example.test"]);
    expect(queries.some((query) => query.sql.includes(`t."status" = 'ACTIVE'`))).toBe(true);
    expect(queries.filter((query) => query.sql.includes('"membershipVersion" = "membershipVersion" + 1'))).toHaveLength(3);
    const passwordUpdate = queries.find((query) => query.sql.includes('SET "passwordHash" = $2'));
    expect(passwordUpdate?.sql).toContain('"passwordHashVersion" = $5');
    expect(passwordUpdate?.sql).toContain("WHEN \"accountStatus\" = 'PENDING_ACTIVATION' THEN 'ACTIVE'");
    expect(passwordUpdate?.values).toEqual([
      "user-a",
      "scrypt:v2:test-salt:test-hash",
      false,
      "2026-08-01T12:00:00.000Z",
      2,
    ]);
    const counterUpdate = queries.find((query) => query.sql.includes('"totpLastUsedCounter" = $2'));
    expect(counterUpdate?.sql).toContain('$2::bigint > "totpLastUsedCounter"::bigint');
    expect(counterUpdate?.sql).not.toContain('IS DISTINCT FROM $2');
    const totpMembershipUpdates = queries.filter((query) => query.sql.includes('UPDATE "TenantMembership"'));
    expect(totpMembershipUpdates).toHaveLength(2);
    expect(totpMembershipUpdates.every((query) => query.sql.includes('"version" = $3'))).toBe(true);
    expect(totpMembershipUpdates.map((query) => query.values)).toEqual([
      ["tenant-a", "user-a", 7],
      ["tenant-a", "user-a", 7],
    ]);
    expect(queries.some((query) => query.sql === "COMMIT")).toBe(true);
  });

  it("canonical membership ile legacy rol sonucu ayrışırsa auth sorgusunu fail-closed durdurur", async () => {
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return {
          async query<T>(sql: string) {
            if (sql.includes('FROM "User" u')) {
              return {
                rows: [{
                  id: "user-drift",
                  tenantId: "tenant-a",
                  email: "drift@example.test",
                  name: "Drift User",
                  passwordHash: hashPassword("password"),
                  membershipVersion: 3,
                  roles: ["ASSISTANT_ADMIN"],
                  canonicalMembershipId: "membership-drift",
                  canonicalMembershipCount: 1,
                  canonicalStaffRole: "TENANT_ADMIN",
                  canonicalHasTeacherPersona: false,
                  canonicalHasStudentPersona: false,
                  canonicalMembershipVersion: 3,
                }] as T[],
              };
            }
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
    };

    await expect(new PostgresAuthUserStore(pool).findByTenantAndLoginName("tenant-a", "drift@example.test"))
      .rejects.toThrow("AUTH_MEMBERSHIP_PARITY_MISMATCH");
  });

  it("tenant identity yazımında legacy rolleri koruyup canonical membership alanlarını tek satıra yazar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.includes('INSERT INTO "User"')) return { rows: [{ id: "user-dual" }] as T[] };
            if (sql.includes('FROM "TenantMembership"') && sql.includes('"version"')) {
              return { rows: [{ role: "ASSISTANT_ADMIN", version: 3 }] as T[] };
            }
            if (sql.includes('UPDATE "User"')) return { rows: [{ id: "user-dual" }] as T[] };
            if (sql.includes('FROM "User" u')) {
              return {
                rows: [{
                  id: "user-dual",
                  tenantId: "tenant-a",
                  email: "dual@example.test",
                  name: "Dual User",
                  passwordHash: "scrypt:v2:test-salt:test-hash",
                  membershipVersion: 2,
                  roles: ["ASSISTANT_ADMIN", "TEACHER"],
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

    await store.createOrAttachTenantIdentity({
      tenantId: "tenant-a",
      email: "DUAL@example.test",
      nationalIdEncrypted: "encrypted-dual",
      nationalIdHash: "hash-dual",
      name: "Dual User",
      passwordHash: "scrypt:v2:test-salt:test-hash",
      roles: ["TEACHER"],
      mustChangePassword: false,
    });

    const userInsert = queries.find((query) => query.sql.includes('INSERT INTO "User"'));
    expect(userInsert?.sql).toContain('"emailNormalized"');
    expect(userInsert?.sql).toContain('"loginNameNormalized"');
    expect(userInsert?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "dual@example.test",
      "encrypted-dual",
      "hash-dual",
      "Dual User",
      "scrypt:v2:test-salt:test-hash",
      2,
      "ACTIVE",
      false,
    ]);
    const memberships = queries.filter((query) => query.sql.includes('INSERT INTO "TenantMembership"'));
    expect(memberships.map((query) => query.values?.slice(3))).toEqual([
      ["ASSISTANT_ADMIN", "OPERATIONS_STAFF", true, false, 4],
      ["TEACHER", null, false, false, 4],
    ]);
    expect(queries.some((query) => query.sql.includes('"membershipVersion" = "membershipVersion" + 1'))).toBe(true);
  });
});
