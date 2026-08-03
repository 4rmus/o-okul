import { describe, expect, it } from "vitest";
import { InMemoryLicenseTermStore, PostgresLicenseTermStore, resolveTenantLicense } from "./license-term-store.js";

const baseTerm = {
  id: "license-a",
  tenantId: "tenant-a",
  planCode: "PRO",
  startsAt: "2026-01-01T00:00:00.000Z",
  endsAt: "2027-01-01T00:00:00.000Z",
  activeStudentLimit: 500,
};

describe("resolveTenantLicense", () => {
  it("aktif dönemi gelecekteki yenilemeye tercih eder", () => {
    expect(resolveTenantLicense([
      baseTerm,
      { ...baseTerm, id: "license-renewal", startsAt: "2027-01-01T00:00:00.000Z", endsAt: "2028-01-01T00:00:00.000Z" },
    ], new Date("2026-08-01T00:00:00.000Z"))).toMatchObject({ state: "ACTIVE", term: { id: "license-a" } });
  });

  it("boşlukta önceki dönemin grace durumunu kullanır", () => {
    expect(resolveTenantLicense([
      baseTerm,
      { ...baseTerm, id: "license-future", startsAt: "2027-03-01T00:00:00.000Z", endsAt: "2028-03-01T00:00:00.000Z" },
    ], new Date("2027-01-10T00:00:00.000Z"))).toMatchObject({ state: "READ_ONLY", term: { id: "license-a" } });
  });

  it("geçmiş dönem yoksa en yakın planlı dönemi seçer", () => {
    expect(resolveTenantLicense([
      baseTerm,
      { ...baseTerm, id: "license-later", startsAt: "2027-01-01T00:00:00.000Z", endsAt: "2028-01-01T00:00:00.000Z" },
    ], new Date("2025-12-01T00:00:00.000Z"))).toMatchObject({ state: "SCHEDULED", term: { id: "license-a" } });
  });

  it("DB kısıtı dışından gelen örtüşmeyi fail-closed reddeder", () => {
    expect(() => resolveTenantLicense([
      baseTerm,
      { ...baseTerm, id: "license-overlap", startsAt: "2026-06-01T00:00:00.000Z", endsAt: "2027-06-01T00:00:00.000Z" },
    ], new Date("2026-08-01T00:00:00.000Z"))).toThrow("LICENSE_TERM_OVERLAP");
  });
});

describe("LicenseTermStore", () => {
  it("tenant dönem geçmişini başlangıca göre yeniden eskiye listeler", async () => {
    const store = new InMemoryLicenseTermStore([
      { ...baseTerm, id: "older", startsAt: "2025-01-01T00:00:00.000Z", endsAt: "2026-01-01T00:00:00.000Z" },
      { ...baseTerm, id: "newer", startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2027-01-01T00:00:00.000Z" },
      { ...baseTerm, id: "other", tenantId: "tenant-b" },
    ]);

    await expect(store.listForTenant("tenant-a")).resolves.toEqual([
      expect.objectContaining({ id: "newer" }),
      expect.objectContaining({ id: "older" }),
    ]);
  });

  it("in-memory tenant için durum çözümler", async () => {
    const store = new InMemoryLicenseTermStore([baseTerm]);
    await expect(store.resolveForTenant("tenant-a", new Date("2026-08-01T00:00:00.000Z")))
      .resolves.toMatchObject({ state: "ACTIVE", term: { id: "license-a" } });
  });

  it("Postgres okumasını explicit tenant RLS transaction ve tenant filtresiyle yapar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>() { return { rows: [] as T[] }; },
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.includes("AS matches")) return { rows: [{ matches: true }] as T[] };
            if (sql.includes('FROM "LicenseTerm"')) return { rows: [baseTerm] as T[] };
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
    };
    const store = new PostgresLicenseTermStore(pool);

    await expect(store.resolveForTenant("tenant-a", new Date("2026-08-01T00:00:00.000Z")))
      .resolves.toMatchObject({ state: "ACTIVE", mirrorParity: true });
    expect(queries[0]?.sql).toBe("BEGIN");
    expect(queries.some((query) => query.sql.includes("set_config('app.bypass_rls'") && query.values?.[0] === "false")).toBe(true);
    expect(queries.some((query) => query.sql.includes("set_config('app.current_tenant_id'") && query.values?.[0] === "tenant-a")).toBe(true);
    expect(queries.find((query) => query.sql.includes('FROM "LicenseTerm"'))?.values).toEqual(["tenant-a"]);
    expect(queries.some((query) => query.sql.includes('term."planCode" = tenant."plan"'))).toBe(true);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("Postgres dönem ekleme ve legacy ayna güncellemesini aynı transactionda yapar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>() { return { rows: [] as T[] }; },
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.includes('INSERT INTO "LicenseTerm"')) {
              return { rows: [{ ...baseTerm, createdByPlatformAccountId: "platform-a", auditReference: "contract-2026" }] as T[] };
            }
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
    };
    const store = new PostgresLicenseTermStore(pool);

    await expect(store.create({
      tenantId: "tenant-a",
      planCode: "PRO",
      startsAt: baseTerm.startsAt,
      endsAt: baseTerm.endsAt,
      activeStudentLimit: 500,
      createdByPlatformAccountId: "platform-a",
      auditReference: "contract-2026",
    })).resolves.toMatchObject({ tenantId: "tenant-a", auditReference: "contract-2026" });

    expect(queries[0]?.sql).toBe("BEGIN");
    expect(queries.some((query) => query.sql.includes('INSERT INTO "LicenseTerm"'))).toBe(true);
    expect(queries.some((query) => query.sql.includes('UPDATE "Tenant"') && query.sql.includes('"seatLimit" = $5'))).toBe(true);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("in-memory store çakışan aktif dönemi reddeder", async () => {
    const store = new InMemoryLicenseTermStore([baseTerm]);
    await expect(store.create({
      tenantId: "tenant-a",
      planCode: "PRO",
      startsAt: "2026-06-01T00:00:00.000Z",
      endsAt: "2027-06-01T00:00:00.000Z",
      activeStudentLimit: 500,
      createdByPlatformAccountId: "platform-a",
      auditReference: "overlap",
    })).rejects.toThrow("LICENSE_TERM_OVERLAP");
  });
});
