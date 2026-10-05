import { describe, expect, it, vi } from "vitest";
import { createLicenseExpiryPurgeCandidateReporter, reportLicenseExpiryPurgeCandidates } from "./license-expiry-purge-candidates.js";

const day = 86_400_000;
const now = new Date("2026-10-05T12:00:00.000Z");
function fakePool() {
  const calls: string[] = [];
  const db = { async query<T>(sql: string): Promise<{ rows: T[] }> {
    calls.push(sql.trim());
    const rows = (value: unknown[]) => ({ rows: value as T[] });
    if (sql.includes('FROM "Tenant" t')) return rows([{ id: "tenant-old", name: "Eski Kurum", slug: "eski-kurum", status: "SUSPENDED", lifecycleVersion: 1 }, { id: "tenant-live", name: "Canli", slug: "canli", status: "ACTIVE", lifecycleVersion: 0 }]);
    if (sql.includes('FROM "LicenseTerm"')) return rows([{ tenantId: "tenant-old", startsAt: new Date(now.getTime() - 500 * day), endsAt: new Date(now.getTime() - 92 * day), cancelledAt: null }, { tenantId: "tenant-live", startsAt: new Date(now.getTime() - 10 * day), endsAt: new Date(now.getTime() + 300 * day), cancelledAt: null }]);
    if (sql.includes("AS count")) return rows([{ count: "7" }]);
    return rows([]);
  }, release() {} };
  return { calls, pool: { query: db.query, connect: async () => db } };
}

describe("daily license-expiry purge candidate job (DEC-20261005-03)", () => {
  it("only computes and logs candidates: read-only transaction, no write statement, no names in logs", async () => {
    const { calls, pool } = fakePool(); const logger = { info: vi.fn(), error: vi.fn() };
    expect(await reportLicenseExpiryPurgeCandidates(pool, logger as never, now)).toBe(1);
    expect(calls[0]).toBe("BEGIN READ ONLY");
    expect(calls.filter((sql) => /^(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql) || /o_okul_license_expiry_purge|clean-reset|TenantFreshResetOperation" \(/.test(sql))).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith({ component: "license-expiry-purge", candidateCount: 1, candidates: [{ tenantId: "tenant-old", daysSinceLicenseEnd: 92 }] }, "license_expiry_purge_candidates");
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/Eski Kurum|eski-kurum/);
  });
  it("is disabled without a database and keeps running after a failed day", async () => {
    expect(createLicenseExpiryPurgeCandidateReporter({ env: {} })).toBeUndefined();
    const logger = { info: vi.fn(), error: vi.fn() };
    const reporter = createLicenseExpiryPurgeCandidateReporter({ pool: { query: async () => { throw new Error("db down"); } }, logger: logger as never, intervalMs: 60_000 })!;
    await reporter.close();
    expect(logger.error).toHaveBeenCalledWith({ component: "license-expiry-purge" }, "license_expiry_purge_candidates_failed");
  });
});
