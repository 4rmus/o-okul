import { describe, expect, it } from "vitest";
import { InMemoryAuthUserStore, verifyPasswordAsync } from "../auth/auth-user-store.js";
import { InMemoryTenantStore, PostgresTenantStore, createFirstAdminActivationUrl } from "./tenant-store.js";

describe("InMemoryTenantStore", () => {
  it("ilk sahip aktivasyon tokenını URL fragmentinde taşır", () => {
    const url = createFirstAdminActivationUrl("owner-tenant", "owner-token");

    expect(url.searchParams.get("tenant")).toBe("owner-tenant");
    expect(url.searchParams.has("token")).toBe(false);
    expect(url.hash).toBe("#token=owner-token");
  });

  it("tenant store lisans yaşam döngüsünü filtrelemez", async () => {
    const store = new InMemoryTenantStore();
    await store.create({
      id: "tenant-expired",
      name: "Expired Tenant",
      slug: "tenant-expired",
      licenseEndsAt: "2020-01-01T00:00:00.000Z",
    });

    await expect(store.findById("tenant-expired")).resolves.toMatchObject({ id: "tenant-expired" });
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

  it("planlı tenantı lisans store'una bırakır", async () => {
    const store = new InMemoryTenantStore();
    await store.create({
      id: "tenant-not-started",
      name: "Not Started Tenant",
      slug: "tenant-not-started",
      licenseStartsAt: "2099-01-01T00:00:00.000Z",
    });

    await expect(store.findById("tenant-not-started")).resolves.toMatchObject({ id: "tenant-not-started" });
    await expect(store.findBySlug("tenant-not-started")).resolves.toMatchObject({ id: "tenant-not-started" });
    await expect(store.findForAdmin("tenant-not-started")).resolves.toMatchObject({ id: "tenant-not-started" });
  });

  it("ilk admin oluşturulunca koltuk sayısını listeye yansıtır", async () => {
    const store = new InMemoryTenantStore();

    await store.createWithFirstAdmin(
      { id: "tenant-first-admin", name: "First Admin Tenant", slug: "first-admin-tenant", seatLimit: 3 },
      { name: "First Admin", email: "first.admin@example.test", nationalId: "10000000450" },
    );

    await expect(store.list()).resolves.toContainEqual(
      expect.objectContaining({
        id: "tenant-first-admin",
        activeSeatCount: 1,
        seatLimit: 3,
      }),
    );
  });

  it("ilk admin oluşturulunca telefonla tahmin edilemeyen pending kullanıcı oluşturur", async () => {
    const store = new InMemoryTenantStore();

    await store.createWithFirstAdmin(
      { id: "tenant-login-admin", name: "Login Admin Tenant", slug: "login-admin-tenant" },
      { name: "Login Admin", email: "LOGIN.ADMIN@example.test", nationalId: "10000000450" },
    );

    const authUser = await new InMemoryAuthUserStore().findByEmail("login.admin@example.test");

    expect(authUser).toMatchObject({
      email: "login.admin@example.test",
      tenantId: "tenant-login-admin",
      roles: ["TENANT_ADMIN"],
      mustChangePassword: true,
    });
    await expect(verifyPasswordAsync("5551234567", authUser?.passwordHash ?? "")).resolves.toBe(false);
  });

  it("tenant silinince listeden ve admin görünümünden fiziksel olarak kalkar", async () => {
    const store = new InMemoryTenantStore();
    await store.createWithFirstAdmin(
      { id: "tenant-delete", name: "Delete Tenant", slug: "delete-tenant" },
      { name: "Delete Admin", email: "delete.admin@example.test", nationalId: "10000000450" },
    );

    await expect(store.delete("tenant-delete")).resolves.toMatchObject({
      id: "tenant-delete",
      status: "DELETED",
    });
    await expect(store.findForAdmin("tenant-delete")).resolves.toBeUndefined();
    await expect(store.list()).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "tenant-delete" })]));
  });
});

describe("PostgresTenantStore", () => {
  it("canonical onboarding bileşenlerini tek idempotent transaction içinde oluşturur", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.includes('INSERT INTO "PlatformIdempotencyKey"')) return { rows: [{ id: "idem-1" }] as T[] };
            if (sql.includes('INSERT INTO "Tenant"')) {
              return { rows: [{
                id: values?.[0], name: values?.[1], slug: values?.[2], plan: values?.[3],
                licenseStartsAt: values?.[4], licenseEndsAt: values?.[5], institutionType: values?.[6],
                contactEmail: values?.[7], logoUrl: values?.[8], seatLimit: values?.[9], status: values?.[10],
              }] as T[] };
            }
            if (sql.includes('INSERT INTO "LicenseTerm"')) {
              return { rows: [{
                id: values?.[0], tenantId: values?.[1], planCode: values?.[2], startsAt: values?.[3],
                endsAt: values?.[4], activeStudentLimit: values?.[5], cancelledAt: null,
                createdByPlatformAccountId: values?.[6], auditReference: values?.[7],
              }] as T[] };
            }
            if (sql.includes('INSERT INTO "Campus"')) {
              return { rows: [{ id: values?.[0], tenantId: values?.[1], name: values?.[2], code: values?.[3], unitType: values?.[4] }] as T[] };
            }
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
    };
    const store = new PostgresTenantStore(pool);

    const result = await store.createOnboarding(
      { id: "tenant-owner", name: "Owner Tenant", slug: "owner-tenant" },
      {
        idempotencyKey: "owner-create-1",
        requestHash: "request-hash",
        campuses: [{ name: "Merkez", code: "MRK", unitType: "SCHOOL" }],
        firstOwner: { name: "First Owner", email: "owner@example.test" },
        licenseTerm: {
          planCode: "PRO",
          startsAt: "2026-08-01T00:00:00.000Z",
          endsAt: "2027-08-01T00:00:00.000Z",
          activeStudentLimit: 100,
          auditReference: "contract-1",
          createdByPlatformAccountId: "platform-1",
        },
      },
    );

    expect(result).toMatchObject({
      replayed: false,
      result: {
        tenant: { id: "tenant-owner", plan: "PRO", seatLimit: 100 },
        owner: { tenantId: "tenant-owner", roles: ["TENANT_OWNER"] },
        campuses: [{ tenantId: "tenant-owner", unitType: "SCHOOL" }],
        licenseTerm: { tenantId: "tenant-owner", planCode: "PRO" },
      },
    });
    for (const table of ["PlatformIdempotencyKey", "Tenant", "LicenseTerm", "Campus", "User", "Employee", "TenantMembership", "PasswordResetToken", "SecretDeliveryOutbox"]) {
      expect(queries.some((query) => query.sql.includes(`INSERT INTO "${table}"`))).toBe(true);
    }
    const membership = queries.find((query) => query.sql.includes('INSERT INTO "TenantMembership"'));
    expect(membership?.values?.slice(3, 5)).toEqual(["TENANT_OWNER", "TENANT_OWNER"]);
    expect(queries.some((query) => query.sql.includes("o_okul_refresh_license_usage"))).toBe(true);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

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
      { name: "First Admin", email: "FIRST.ADMIN@example.test", nationalId: "10000000450" },
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
    expect(insertUser?.sql).toContain('"mustChangePassword"');
    expect(insertUser?.sql).toContain('"emailNormalized"');
    expect(insertUser?.sql).toContain('"loginNameNormalized"');
    expect(insertUser?.sql).toContain("'PENDING_ACTIVATION'");
    expect(insertUser?.sql).not.toContain('ON CONFLICT ("email")');
    expect(insertUser?.values).toHaveLength(7);
    expect(queries.some((query) => query.sql.includes('SELECT "id" FROM "User" WHERE lower("email")'))).toBe(false);
    const membershipInsert = queries.find((query) => query.sql.includes('INSERT INTO "TenantMembership"'));
    expect(membershipInsert?.values?.slice(3)).toEqual(["TENANT_ADMIN", "TENANT_ADMIN", false, false]);
    expect(queries.some((query) => query.sql.includes('INSERT INTO "PasswordResetToken"'))).toBe(true);
    const outboxInsert = queries.find((query) => query.sql.includes('INSERT INTO "SecretDeliveryOutbox"'));
    expect(outboxInsert?.sql).toContain("'PASSWORD_RESET'");
    expect(outboxInsert?.values?.[3]).toEqual(expect.stringMatching(/^v1:/));
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("ilk admin e-postası başka tenant'ta kullanılmış olsa da global sorgu yapmaz", async () => {
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
            if (sql.includes('INSERT INTO "Tenant"')) {
              return {
                rows: [{
                  id: values?.[0],
                  name: values?.[1],
                  slug: values?.[2],
                  plan: values?.[3],
                  licenseStartsAt: values?.[4],
                  licenseEndsAt: values?.[5],
                  institutionType: values?.[6],
                  contactEmail: values?.[7],
                  logoUrl: values?.[8],
                  seatLimit: values?.[9],
                  activeSeatCount: 0,
                  status: values?.[10],
                }] as T[],
              };
            }
            if (sql.includes('INSERT INTO "User"')) {
              return { rows: [{ id: "user-duplicate-email-new-tenant" }] as T[] };
            }
            if (sql.includes('JOIN "User" u') && sql.includes('GROUP BY')) {
              return {
                rows: [{
                  id: "user-duplicate-email-new-tenant",
                  email: "existing.admin@example.test",
                  name: "Existing Admin",
                  tenantId: values?.[0],
                  roles: ["TENANT_ADMIN"],
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
    const store = new PostgresTenantStore(pool);

    await expect(store.createWithFirstAdmin(
      { id: "tenant-duplicate-admin", name: "Duplicate Admin Tenant", slug: "duplicate-admin-tenant" },
      { name: "Existing Admin", email: "existing.admin@example.test", nationalId: "10000000450" },
    )).resolves.toMatchObject({
      tenant: { id: "tenant-duplicate-admin" },
      admin: { email: "existing.admin@example.test", tenantId: "tenant-duplicate-admin" },
    });

    expect(queries.some((query) => query.sql.includes('SELECT "id" FROM "User" WHERE lower("email")'))).toBe(false);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("tenant silerken soft-delete yerine Tenant satırını siler", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.includes('FROM "Tenant" t') && sql.includes('WHERE t."id" = $1')) {
              return {
                rows: [
                  {
                    id: "tenant-delete",
                    name: "Delete Tenant",
                    slug: "delete-tenant",
                    plan: "TRIAL",
                    licenseStartsAt: null,
                    licenseEndsAt: null,
                    institutionType: null,
                    contactEmail: null,
                    logoUrl: null,
                    seatLimit: null,
                    activeSeatCount: 3,
                    status: "ACTIVE",
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

    await expect(store.delete("tenant-delete")).resolves.toMatchObject({
      id: "tenant-delete",
      status: "DELETED",
      activeSeatCount: 3,
    });

    expect(queries.some((query) => query.sql.includes('DELETE FROM "Tenant"'))).toBe(true);
    expect(queries.some((query) => query.sql.includes('UPDATE "Tenant"'))).toBe(false);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });
});
