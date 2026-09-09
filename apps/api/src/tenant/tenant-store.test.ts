import { describe, expect, it } from "vitest";
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

    await expect(store.findById("tenant-expired")).resolves.toMatchObject({ id: "tenant-expired" });
    await expect(store.findForAdmin("tenant-expired")).resolves.toMatchObject({
      id: "tenant-expired",
      status: "ACTIVE", lifecycleVersion: 0,
    });
  });

  it("inactive tenant normal tenant çözümlemesinde görünmez", async () => {
    const store = new InMemoryTenantStore(undefined, [{
      id: "tenant-suspended",
      name: "Suspended Tenant",
      slug: "tenant-suspended",
      plan: "TRIAL",
      status: "SUSPENDED", lifecycleVersion: 0,
    }]);

    await expect(store.findById("tenant-suspended")).resolves.toBeUndefined();
  });

  it("planlı tenantı lisans store'una bırakır", async () => {
    const store = new InMemoryTenantStore(undefined, [{
      id: "tenant-not-started",
      name: "Not Started Tenant",
      slug: "tenant-not-started",
      plan: "TRIAL",
      licenseStartsAt: "2099-01-01T00:00:00.000Z",
      status: "ACTIVE", lifecycleVersion: 0,
    }]);

    await expect(store.findById("tenant-not-started")).resolves.toMatchObject({ id: "tenant-not-started" });
    await expect(store.findBySlug("tenant-not-started")).resolves.toMatchObject({ id: "tenant-not-started" });
    await expect(store.findForAdmin("tenant-not-started")).resolves.toMatchObject({ id: "tenant-not-started" });
  });

  it("system tenant doğrudan store üzerinden güncellenemez", async () => {
    const store = new InMemoryTenantStore(undefined, [{ id: "system", name: "System", slug: "system", plan: "SYSTEM", status: "ACTIVE", lifecycleVersion: 0 }]);

    await expect(store.update("system", { name: "Updated System" })).resolves.toBeUndefined();
    await expect(store.findForAdmin("system")).resolves.toMatchObject({ status: "ACTIVE", lifecycleVersion: 0 });
  });

  it.each(["TRIAL", "DELETED", "UNKNOWN"])("%s durumunu erişime açmaz", async (status) => {
    const store = new InMemoryTenantStore(undefined, [{
      id: "tenant-legacy", name: "Legacy", slug: "legacy", plan: "TRIAL", status: status as never, lifecycleVersion: 0,
    }]);

    await expect(store.findById("tenant-legacy")).resolves.toBeUndefined();
    await expect(store.findBySlug("legacy")).resolves.toBeUndefined();
    await expect(store.transitionStatus("tenant-legacy", { ...transitionInput, actorUserId: "system-admin", status: "ACTIVE" }))
      .rejects.toThrow("TENANT_STATUS_UNSUPPORTED");
    await expect(store.findForAdmin("tenant-legacy")).resolves.toMatchObject({ status });
  });
});

describe("PostgresTenantStore", () => {
  it("canonical onboarding bileşenlerini tek idempotent transaction içinde oluşturur", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    let failAuditOnce = true;
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
            if (sql.includes('INSERT INTO "AuditLog"') && failAuditOnce) {
              failAuditOnce = false;
              throw new Error("AUDIT_WRITE_FAILED");
            }
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
    };
    const store = new PostgresTenantStore(pool);
    const tenant = { id: "tenant-owner", name: "Owner Tenant", slug: "owner-tenant" };
    const onboarding = {
      idempotencyKey: "owner-create-1",
      requestHash: "request-hash",
      campuses: [{ name: "Merkez", code: "MRK", unitType: "SCHOOL" as const }],
      firstOwner: { name: "First Owner", email: "owner@example.test", nationalId: "10000000450" },
      licenseTerm: {
        planCode: "PRO",
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: "2027-08-01T00:00:00.000Z",
        activeStudentLimit: 100,
        auditReference: "contract-1",
        createdByPlatformAccountId: "platform-1",
      },
    };

    await expect(store.createOnboarding(tenant, onboarding)).rejects.toThrow("AUDIT_WRITE_FAILED");
    const result = await store.createOnboarding(tenant, onboarding);

    expect(result).toMatchObject({
      auditedAtomically: true,
      replayed: false,
      result: {
        tenant: { id: "tenant-owner", plan: "PRO", seatLimit: 100 },
        owner: { tenantId: "tenant-owner", roles: ["TENANT_OWNER"] },
        campuses: [{ tenantId: "tenant-owner", unitType: "SCHOOL" }],
        licenseTerm: { tenantId: "tenant-owner", planCode: "PRO" },
      },
    });
    for (const table of ["PlatformIdempotencyKey", "Tenant", "LicenseTerm", "Campus", "User", "Employee", "TenantMembership", "PasswordResetToken", "SecretDeliveryOutbox", "AuditLog"]) {
      expect(queries.some((query) => query.sql.includes(`INSERT INTO "${table}"`))).toBe(true);
    }
    const membership = queries.find((query) => query.sql.includes('INSERT INTO "TenantMembership"'));
    expect(membership?.values?.slice(3, 5)).toEqual(["TENANT_OWNER", "TENANT_OWNER"]);
    expect(queries.some((query) => query.sql.includes("o_okul_refresh_license_usage"))).toBe(true);
    const auditIndex = queries.findIndex((query) => query.sql.includes('INSERT INTO "AuditLog"'));
    const completedIndex = queries.findIndex((query) => query.sql.includes('UPDATE "PlatformIdempotencyKey"'));
    expect(queries[auditIndex]?.sql).toContain("tenant.first_owner_invited");
    expect(JSON.stringify(queries[auditIndex]?.values)).not.toMatch(/Owner Tenant|owner-tenant|owner@example\.test|10000000450/);
    expect(auditIndex).toBeLessThan(completedIndex);
    expect(queries.filter((query) => query.sql.includes('INSERT INTO "AuditLog"'))).toHaveLength(2);
    expect(queries.filter((query) => query.sql.includes('UPDATE "PlatformIdempotencyKey"'))).toHaveLength(1);
    expect(queries.some((query) => query.sql === "ROLLBACK")).toBe(true);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("Postgres update sorgusu system tenantı dışlar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.startsWith('SELECT "id"')) {
              return {
                rows: [
                  {
                    id: "tenant-update",
                    name: "Update Tenant",
                    slug: "update-tenant",
                    plan: "TRIAL",
                    licenseStartsAt: null,
                    licenseEndsAt: null,
                    institutionType: null,
                    contactEmail: null,
                    logoUrl: null,
                    seatLimit: null,
                    activeSeatCount: 0,
                    status: "ACTIVE", lifecycleVersion: 0,
                  },
                ] as T[],
              };
            }
            if (sql.includes('UPDATE "Tenant"')) {
              return {
                rows: [{
                  id: "tenant-update",
                  name: "Updated Tenant",
                  slug: "update-tenant",
                  plan: "TRIAL",
                  licenseStartsAt: null,
                  licenseEndsAt: null,
                  institutionType: null,
                  contactEmail: null,
                  logoUrl: null,
                  seatLimit: null,
                  activeSeatCount: 0,
                  status: "ACTIVE", lifecycleVersion: 0,
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

    await expect(store.update("tenant-update", { name: "Updated Tenant" })).resolves.toMatchObject({
      id: "tenant-update",
      name: "Updated Tenant",
    });

    expect(queries.filter((query) => query.sql.includes('"id" <> \'system\'')).length).toBe(2);
    const update = queries.find((query) => query.sql.includes('UPDATE "Tenant"'))!;
    const updatedFields = update.sql.split("RETURNING")[0];
    expect(updatedFields).not.toMatch(/"(?:slug|status|plan|licenseStartsAt|licenseEndsAt|seatLimit)"\s*=/);
    expect(update.values).toEqual(["tenant-update", "Updated Tenant", null, null, null]);
    expect(queries.some((query) => query.sql.includes('DELETE FROM "Tenant"'))).toBe(false);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("durum, session iptali ve audit kaydını tek transaction'da yazar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresTenantStore(lifecyclePool(queries));

    await expect(store.transitionStatus("tenant-a", {
      ...transitionInput,
      actorUserId: "user-system",
      status: "SUSPENDED",
    })).resolves.toEqual({
      tenant: expect.objectContaining({ id: "tenant-a", status: "SUSPENDED" }),
      sessionsRevoked: 2,
    });

    expect(queries.some((query) => query.sql.includes('UPDATE "Tenant"'))).toBe(true);
    expect(queries.some((query) => query.sql.includes('UPDATE "AuthSession"'))).toBe(true);
    expect(queries.some((query) => query.sql.includes('INSERT INTO "AuditLog"'))).toBe(true);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it.each(["session", "audit", "idempotency"] as const)("%s yazımı başarısızsa durum transaction'ını geri alır", async (failureAt) => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresTenantStore(lifecyclePool(queries, failureAt));

    await expect(store.transitionStatus("tenant-a", {
      ...transitionInput,
      actorUserId: "user-system",
      status: "SUSPENDED",
    })).rejects.toThrow(`${failureAt.toUpperCase()}_WRITE_FAILED`);

    expect(queries.at(-1)?.sql).toBe("ROLLBACK");
    expect(queries.some((query) => query.sql === "COMMIT")).toBe(false);
  });

  it("Postgres replay sürüm sorgusundan önce döner ve farklı hash fail-closed çakışır", async () => {
    const response = { tenant: { id: "tenant-a", status: "SUSPENDED", lifecycleVersion: 1 }, sessionsRevoked: 2 };
    for (const mismatch of [false, true]) {
      const queries: Array<{ sql: string; values?: unknown[] }> = [];
      const store = new PostgresTenantStore(lifecyclePool(queries, undefined, "ACTIVE", { previous: { requestHash: mismatch ? "different" : "hash-a", status: "COMPLETED", responseBody: response } }));
      if (mismatch) await expect(store.transitionStatus("tenant-a", transitionInput)).rejects.toThrow("IDEMPOTENCY_KEY_BODY_MISMATCH");
      else await expect(store.transitionStatus("tenant-a", transitionInput)).resolves.toEqual(response);
      expect(queries.some((query) => query.sql.includes("FOR UPDATE OF t"))).toBe(false);
      expect(queries.some((query) => query.sql.includes('UPDATE "AuthSession"') || query.sql.includes('INSERT INTO "AuditLog"'))).toBe(false);
    }
  });

  it("geçersiz admin oturumu hiçbir işlem kaydı oluşturmaz", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresTenantStore(lifecyclePool(queries, undefined, "ACTIVE", { invalidActor: true }));
    await expect(store.transitionStatus("tenant-a", transitionInput)).rejects.toThrow("MFA_STEP_UP_CONTEXT_INVALID");
    expect(queries.some((query) => /^(UPDATE|INSERT)/.test(query.sql))).toBe(false);
    expect(queries.at(-1)?.sql).toBe("ROLLBACK");
  });

  it.each(["version", "confirmation", "noop"])("%s durumu tenant/session/audit değişikliği üretmez", async (variant) => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresTenantStore(lifecyclePool(queries));
    const input = { ...transitionInput, ...(variant === "version" ? { expectedLifecycleVersion: 1 } : variant === "confirmation" ? { confirmationText: " TENANT-A " } : { status: "ACTIVE" as const }) };
    if (variant === "noop") await expect(store.transitionStatus("tenant-a", input)).resolves.toMatchObject({ sessionsRevoked: 0, tenant: { lifecycleVersion: 0 } });
    else await expect(store.transitionStatus("tenant-a", input)).rejects.toThrow(variant === "version" ? "TENANT_LIFECYCLE_VERSION_CONFLICT" : "TENANT_CONFIRMATION_MISMATCH");
    expect(queries.some((query) => query.sql.includes('UPDATE "Tenant"') || query.sql.includes('UPDATE "AuthSession"') || query.sql.includes('INSERT INTO "AuditLog"'))).toBe(false);
  });

  it.each(["TRIAL", "DELETED", "UNKNOWN"])("%s durumunda hiçbir lifecycle yazımı yapmaz", async (status) => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresTenantStore(lifecyclePool(queries, undefined, status));

    await expect(store.transitionStatus("tenant-a", { ...transitionInput, actorUserId: "system-admin", status: "ACTIVE" }))
      .rejects.toThrow("TENANT_STATUS_UNSUPPORTED");
    expect(queries.some((query) => query.sql.includes('UPDATE "Tenant"') || query.sql.includes('UPDATE "AuthSession"') || query.sql.includes('INSERT INTO "AuditLog"'))).toBe(false);
    expect(queries.at(-1)?.sql).toBe("ROLLBACK");
  });
});

function lifecyclePool(queries: Array<{ sql: string; values?: unknown[] }>, failureAt?: "session" | "audit" | "idempotency", status = "ACTIVE", options: { invalidActor?: boolean; previous?: unknown } = {}) {
  return {
    async query<T>() {
      return { rows: [] as T[] };
    },
    async connect() {
      return {
        async query<T>(sql: string, values?: unknown[]) {
          queries.push({ sql, values });
          if (sql.includes('FROM "AuthSession"') && sql.includes('FOR SHARE')) return { rows: (options.invalidActor ? [] : [{ id: "system-session" }]) as T[] };
          if (sql.includes('INSERT INTO "PlatformIdempotencyKey"')) return { rows: (options.previous ? [] : [{ id: "idem" }]) as T[] };
          if (sql.includes('FROM "PlatformIdempotencyKey"')) return { rows: [options.previous] as T[] };
          if (sql.includes('UPDATE "PlatformIdempotencyKey"')) {
            if (failureAt === "idempotency") throw new Error("IDEMPOTENCY_WRITE_FAILED");
            return { rows: [{ id: "idem" }] as T[] };
          }
          if (sql.includes("FOR UPDATE OF t")) {
            return { rows: [{
              id: "tenant-a",
              name: "Tenant A",
              slug: "tenant-a",
              plan: "PRO",
              licenseStartsAt: null,
              licenseEndsAt: null,
              institutionType: null,
              contactEmail: null,
              logoUrl: null,
              seatLimit: 100,
              activeSeatCount: 4,
              status, lifecycleVersion: 0, suspendedAt: null, suspendedReason: null,
            }] as T[] };
          }
          if (sql.includes('UPDATE "Tenant"')) return { rows: [{ id: "tenant-a" }] as T[] };
          if (sql.includes('UPDATE "AuthSession"')) {
            if (failureAt === "session") throw new Error("SESSION_WRITE_FAILED");
            return { rows: [{ id: "session-1" }, { id: "session-2" }] as T[], rowCount: 2 };
          }
          if (sql.includes('INSERT INTO "AuditLog"') && failureAt === "audit") throw new Error("AUDIT_WRITE_FAILED");
          return { rows: [] as T[] };
        },
        release() {},
      };
    },
  };
}

const transitionInput = {
  actorUserId: "user-system", sessionId: "system-session", membershipVersion: 1,
  status: "SUSPENDED" as const, expectedLifecycleVersion: 0, reason: "SECURITY_REVIEW" as const,
  confirmationText: "tenant-a", idempotencyKey: "lifecycle-a", requestHash: "hash-a",
};
