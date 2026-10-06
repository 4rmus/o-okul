import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PostgresFreshResetStore, purgeResetDatabase, requireResetLegalClearance, type FreshResetOperation, type FreshResetRequest } from "./tenant-fresh-reset.js";
import { cleanupPurgeBackup, deleteResetBackupPackage, deleteResetDrillTargets, purgeBackupCleanupDue, runFreshReset, type FreshResetServices } from "./tenant-fresh-reset-runner.js";
import { readResetSnapshot } from "./tenant-reset-snapshot.js";
import { tenantResetColumns, tenantResetTableNames, type ResetTables } from "./tenant-reset-catalog.js";
import { licenseExpiryPurgeBlockers, licenseExpiryPurgeEndsAt, licenseExpiryPurgeExportState, listLicenseExpiryPurgeCandidates, requireLicenseExpiryPurgeClearance } from "./tenant-expiry-purge.js";
import type { TenantResetPackage } from "./tenant-reset-backup.js";

const day = 24 * 60 * 60 * 1_000;
const now = new Date("2026-10-05T12:00:00.000Z");
const endedDaysAgo = (days: number) => new Date(now.getTime() - days * day).toISOString();
const term = (days: number, extra: Record<string, unknown> = {}) => ({ startsAt: endedDaysAgo(days + 365), endsAt: endedDaysAgo(days), cancelledAt: null, ...extra });
// Clearance reads the wall clock; pin it so the day-90/91 boundaries never drift.
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"], now }); });
afterEach(() => { vi.useRealTimers(); });
// Handover export ledger rows (AuditLog): created after the license end, then marked delivered by a SYSTEM_ADMIN.
const exportId = "e".repeat(32);
const exportLedger = (tenantId: string, createdDaysAgo = 10, delivered = true) => [
  { id: `export-created-${tenantId}`, tenantId, entityType: "TenantDataExport", entityId: exportId, action: "tenant.data-export.created", createdAt: endedDaysAgo(createdDaysAgo), diff: { tableCount: 31 } },
  ...(delivered ? [{ id: `export-delivered-${tenantId}`, tenantId, entityType: "TenantDataExport", entityId: exportId, action: "tenant.data-export.delivered", createdAt: endedDaysAgo(createdDaysAgo - 1), diff: { deliveredOn: endedDaysAgo(createdDaysAgo - 1).slice(0, 10), channel: "SECURE_DOWNLOAD" } }] : []),
];
const blockOrUsageTables = ["PaymentTransaction", "PaymentInstallment", "PaymentPlan", "SupportTicketComment", "SupportTicketAttachment", "SupportTicket", "WhatsAppConsentEvent", "WhatsAppConsent", "LicenseUsage", "BackupRestoreJob"] as const;

describe("license-expiry purge candidate selection (DEC-20261005-03)", () => {
  it("day 90 is not a candidate, day 91/92 are; the latest non-cancelled term decides", () => {
    expect(licenseExpiryPurgeEndsAt([term(90)], now)).toBeNull();
    expect(licenseExpiryPurgeEndsAt([term(91)], now)).toBe(endedDaysAgo(91));
    expect(licenseExpiryPurgeEndsAt([term(92)], now)).toBe(endedDaysAgo(92));
    expect(licenseExpiryPurgeEndsAt([term(400), term(92)], now)).toBe(endedDaysAgo(92));
    expect(licenseExpiryPurgeEndsAt([term(400), term(30)], now)).toBeNull();
  });
  it("a renewed, active or future-starting term means no purge; cancelled-only or invalid data fails closed", () => {
    const future = { startsAt: new Date(now.getTime() + 10 * day).toISOString(), endsAt: new Date(now.getTime() + 375 * day).toISOString(), cancelledAt: null };
    expect(licenseExpiryPurgeEndsAt([term(200), future], now)).toBeNull();
    expect(licenseExpiryPurgeEndsAt([term(200), term(-30)], now)).toBeNull();
    expect(licenseExpiryPurgeEndsAt([term(200), { ...future, cancelledAt: now.toISOString() }], now)).toBe(endedDaysAgo(200));
    expect(licenseExpiryPurgeEndsAt([term(200, { cancelledAt: now.toISOString() })], now)).toBeNull();
    expect(licenseExpiryPurgeEndsAt([], now)).toBeNull();
    expect(licenseExpiryPurgeEndsAt([{ startsAt: "bad", endsAt: endedDaysAgo(200), cancelledAt: null }], now)).toBeNull();
  });
  it("lists only expired non-system tenants with counts and no PII columns; never the system tenant", async () => {
    const calls: string[] = [];
    const db = { async query<T>(sql: string): Promise<{ rows: T[] }> {
      calls.push(sql);
      const rows = (value: unknown[]) => ({ rows: value as T[] });
      if (sql.includes('FROM "Tenant" t')) return rows([{ id: "system", name: "System", slug: "system", status: "ACTIVE", lifecycleVersion: 0 }, { id: "t-old", name: "Eski Kurum", slug: "eski", status: "SUSPENDED", lifecycleVersion: 4 }, { id: "t-new", name: "Yeni", slug: "yeni", status: "ACTIVE", lifecycleVersion: 0 }, { id: "t-90", name: "Sinir", slug: "sinir", status: "ACTIVE", lifecycleVersion: 0 }]);
      if (sql.includes('FROM "LicenseTerm"')) return rows([{ tenantId: "system", ...term(500) }, { tenantId: "t-old", ...term(92) }, { tenantId: "t-new", ...term(-100) }, { tenantId: "t-90", ...term(90) }]);
      if (sql.includes("AS count")) return rows([{ count: "1234" }]);
      if (sql.includes('FROM "AuditLog"')) return rows(exportLedger("t-old", 10, false));
      return rows([]);
    }, release() {} };
    const result = await listLicenseExpiryPurgeCandidates({ query: db.query, connect: async () => db }, now);
    expect(result).toEqual([{ tenantId: "t-old", name: "Eski Kurum", slug: "eski", status: "SUSPENDED", lifecycleVersion: 4, licenseEndsAt: endedDaysAgo(92), daysSinceLicenseEnd: 92, estimatedRowCount: 1234, exportId, exportDeliveredOn: null }]);
    expect(calls).toContain("BEGIN READ ONLY");
    expect(calls.find((sql) => sql.includes('FROM "Tenant" t'))).toContain(`t."id" <> 'system'`);
    expect(calls.filter((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql.trim()))).toEqual([]);
    await expect(requireLicenseExpiryPurgeClearance(db, "system", now)).rejects.toThrow("RESET_TARGET_INVALID");
  });
  it("purge ignores only blockers about records it deletes; work-in-flight blockers stay", () => {
    expect(licenseExpiryPurgeBlockers(["CONSENT_RECORDS_PRESENT", "FINANCE_RECORDS_PRESENT", "INSTITUTION_REQUEST_REQUIRED", "NO_ACTIVE_OWNER", "MUTATION_ACTIVITY_PRESENT", "QUEUE_WORK_PRESENT", "WRITE_QUIESCENCE_UNVERIFIED"])).toEqual(["MUTATION_ACTIVITY_PRESENT", "QUEUE_WORK_PRESENT", "WRITE_QUIESCENCE_UNVERIFIED"]);
  });
});

// Injected SQL: mirrors o_okul_license_expiry_purge so the runner orchestration is tested without PostgreSQL.
function fixture(terms: Array<Record<string, unknown>> = [{ id: "license", tenantId: "tenant-a", ...term(120) }], exports = true) {
  const tables = Object.fromEntries(tenantResetTableNames.map((name) => [name, []])) as unknown as ResetTables;
  tables.Tenant = [{ id: "tenant-a", slug: "alpha", name: "Alfa Koleji", contactEmail: "alfa@example.com", status: "SUSPENDED", lifecycleVersion: 3 }, { id: "tenant-b", slug: "beta", name: "Beta", status: "ACTIVE", lifecycleVersion: 0 }];
  for (const tenantId of ["tenant-a", "tenant-b"]) {
    const p = tenantId === "tenant-a" ? "a" : "b";
    tables.User.push({ id: `owner-${p}`, tenantId, accountStatus: "ACTIVE", membershipVersion: 1 });
    tables.Employee.push({ id: `employee-${p}`, tenantId, userId: `owner-${p}`, status: "ACTIVE", deletedAt: null });
    tables.TenantMembership.push({ id: `member-${p}`, tenantId, userId: `owner-${p}`, role: "TENANT_OWNER", staffRole: "TENANT_OWNER", status: "ACTIVE", startsAt: "2020-01-01", version: 1 });
    tables.AuthSession.push({ id: `session-${p}`, tenantId, tokenFamilyId: `family-${p}` });
    tables.ConsumedRefreshToken.push({ tokenFamilyId: `family-${p}` });
    tables.Student.push({ id: `student-${p}`, tenantId, firstName: "Ayse", nationalIdHash: "10000000146" });
    tables.Guardian.push({ id: `guardian-${p}`, tenantId, phone: "5550000000" });
    for (const name of blockOrUsageTables) tables[name].push({ id: `${name}-${p}`, tenantId });
    tables.AuditLog.push({ id: `audit-${p}`, tenantId, action: "student.created", diff: { firstName: "Ayse" } });
    if (exports) tables.AuditLog.push(...exportLedger(tenantId));
  }
  tables.PlatformIdempotencyKey.push({ id: "tenant-create", responseBody: { tenant: { id: "tenant-a", contactEmail: "alfa@example.com" } } });
  tables.LicenseTerm.push(...terms);
  const op: FreshResetOperation = { id: "c".repeat(32), institutionRequestId: null, tenantId: "tenant-a", actorUserId: "platform-admin", idempotencyKey: "purge-key", requestHash: "hash", preset: "LICENSE_EXPIRY_PURGE_V1", expectedLifecycleVersion: 3, preflightDigest: "digest", reason: "LICENSE_EXPIRED", status: "QUEUED", phase: "PREFLIGHT", errorCode: null, backupReceipt: null, result: null };
  tables.TenantFreshResetOperation.push(op as unknown as Record<string, unknown>);
  let state = structuredClone(tables); let tx: ResetTables | undefined;
  const calls: string[] = [];
  const owned = (name: keyof ResetTables) => {
    const families = state.AuthSession.filter((row) => row.tenantId === "tenant-a").map((row) => row.tokenFamilyId);
    const users = state.User.filter((row) => row.tenantId === "tenant-a").map((row) => row.id);
    return state[name].filter((row) => name === "Tenant" ? row.id === "tenant-a" : name === "ConsumedRefreshToken" ? families.includes(row.tokenFamilyId) : name === "PasswordResetToken" ? users.includes(row.userId) : name === "PlatformIdempotencyKey" ? (row.responseBody as { tenant?: { id?: string } }).tenant?.id === "tenant-a" : row.tenantId === "tenant-a");
  };
  const db = { async query<T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    calls.push(sql);
    const rows = (value: unknown[]) => ({ rows: value as T[] });
    if (sql.includes("pg_try_advisory_xact_lock_shared")) return rows([{ locked: true }]);
    if (sql.startsWith("BEGIN")) { tx = structuredClone(state); return rows([]); }
    if (sql === "ROLLBACK") { if (tx) state = tx; tx = undefined; return rows([]); }
    if (sql === "COMMIT") { tx = undefined; return rows([]); }
    if (sql.includes("pg_roles")) return rows([{ valid: true }]);
    if (sql.includes("pg_try_advisory_lock")) return rows([{ locked: true }]);
    if (sql.includes("array_agg(a.attname")) return rows(Object.entries(tenantResetColumns).map(([name, columns]) => ({ name, columns })));
    if (sql.includes("SELECT c.relname AS name")) return rows(tenantResetTableNames.map((name) => ({ name })));
    if (sql.includes("FROM pg_inherits")) return rows([{ count: "0" }]);
    if (sql.includes('FROM "_prisma_migrations"')) return rows([{ row: '{"migration_name":"fixture","finished_at":"2026-01-01"}' }]);
    if (sql.includes('SELECT "id" FROM "TenantMutationActivity"')) return rows(owned("TenantMutationActivity"));
    if (sql.includes('SELECT "id" FROM "Tenant"')) return rows(state.Tenant.map((row) => ({ id: row.id })));
    if (sql.includes('SELECT "id", "tenantId" FROM "Student"')) return rows(state.Student);
    if (sql.includes('SELECT "startsAt", "endsAt", "cancelledAt" FROM "LicenseTerm"')) return rows(state.LicenseTerm.filter((row) => row.tenantId === values[0]));
    if (sql.includes(`FROM "AuditLog" WHERE "tenantId" = $1 AND "entityType" = 'TenantDataExport'`)) return rows(state.AuditLog.filter((row) => row.tenantId === values[0] && row.entityType === "TenantDataExport"));
    if (sql.includes("AS row FROM")) { const name = sql.match(/AS row FROM "(\w+)"/)![1] as keyof ResetTables; return rows(owned(name).map((row) => ({ row: JSON.stringify(row) })).sort((a, b) => a.row.localeCompare(b.row))); }
    if (sql.includes('SELECT "status", "lifecycleVersion" FROM "Tenant"')) return rows(owned("Tenant"));
    if (sql.includes('SELECT * FROM "TenantFreshResetOperation"')) return rows(state.TenantFreshResetOperation.filter((row) => row.id === values[0]));
    if (sql.startsWith("SELECT o_okul_license_expiry_purge")) {
      const [tenantId, operationId] = values as [string, string]; const final = sql.includes(", true)");
      const current = state.TenantFreshResetOperation.find((row) => row.id === operationId)!;
      const flags = current.result as { backupPackageDeleted?: boolean; drillTargetsDeleted?: boolean };
      if (final ? current.status !== "COMPLETED" || flags.backupPackageDeleted !== true || flags.drillTargetsDeleted !== true : current.status !== "RUNNING" || current.phase !== "DATABASE") throw new Error("RESET_OPERATION_CHANGED");
      if (!final) {
        const live = state.LicenseTerm.filter((row) => row.tenantId === tenantId && row.cancelledAt == null);
        if (!live.length || live.some((row) => Date.parse(String(row.endsAt)) + 91 * day > Date.now())) throw new Error("RESET_LICENSE_NOT_EXPIRED");
        for (const name of blockOrUsageTables) state[name] = state[name].filter((row) => row.tenantId !== tenantId);
        state.PlatformIdempotencyKey = state.PlatformIdempotencyKey.filter((row) => !owned("PlatformIdempotencyKey").includes(row));
      }
      state.AuditLog = state.AuditLog.filter((row) => row.tenantId !== tenantId);
      if (final) {
        const tenant = state.Tenant.find((row) => row.id === tenantId)!;
        const { deletedRowCount, exportId: handoverId, exportDeliveredOn, backupPackageDeleted, drillTargetsDeleted } = current.result as Record<string, unknown>;
        state.AuditLog.push({ id: "receipt", tenantId: null, actorUserId: current.actorUserId, entityType: "TenantLicenseExpiryPurge", entityId: operationId, action: "tenant.license-expiry-purge.completed", diff: { tenantId, slugSha256: "sha256-of-slug", deletedRowCount, exportId: handoverId, exportDeliveredOn, backupPackageDeleted, drillTargetsDeleted } });
        Object.assign(tenant, { name: "İmha edildi", slug: "imha-0123456789abcdef", contactEmail: null });
      }
      return rows([{ o_okul_license_expiry_purge: 0 }]);
    }
    if (sql.startsWith('UPDATE "TenantFreshResetOperation"')) {
      const row = state.TenantFreshResetOperation[0]!;
      if (sql.includes('"status" = $3')) { if (["COMPLETED", "CANCELLED"].includes(String(row.status))) return rows([]); Object.assign(row, { status: values[2], phase: values[3], errorCode: values[4] }); }
      else if (sql.includes('"backupReceipt" =')) row.backupReceipt = JSON.parse(String(values[2]));
      else if (sql.includes('"result" = coalesce("result"')) row.result = { ...(row.result as object | null), ...JSON.parse(String(values[2])) };
      else if (sql.includes('"result" =')) row.result = JSON.parse(String(values[2]));
      return rows([{ id: row.id }]);
    }
    if (sql.startsWith('INSERT INTO "AuditLog"')) { state.AuditLog.push({ id: values[0], tenantId: values[1], entityType: "TenantFreshResetOperation", entityId: values[3], action: values[4] }); return rows([]); }
    if (sql.startsWith("DELETE")) {
      const name = sql.match(/DELETE FROM "(\w+)"/)![1] as keyof ResetTables;
      const targets = owned(name);
      state[name] = state[name].filter((row) => !targets.includes(row) || (values[1] as string[] | undefined)?.includes(String(row.id)));
      return rows([]);
    }
    if (sql.includes('SELECT count(*)::int AS count FROM "ConsumedRefreshToken"')) return rows([{ count: state.ConsumedRefreshToken.filter((row) => (values[0] as string[]).includes(String(row.tokenFamilyId))).length }]);
    if (sql.startsWith("UPDATE") && !sql.startsWith('UPDATE "Exam" SET "linkedTytExamId" = NULL')) throw new Error(`unexpected write: ${sql}`);
    return rows([]);
  }, release() {} };
  return { db, pool: { query: db.query, connect: async () => db }, calls, state: () => state, op };
}
async function runnerFixture(terms?: Array<Record<string, unknown>>, exports = true) {
  const f = fixture(terms, exports);
  const snapshot = await readResetSnapshot(f.db, "tenant-a", f.op.id);
  const pkg = { manifest: { tenantId: "tenant-a", lifecycleVersion: 3, dataDigest: snapshot.dataDigest, objects: [{ key: "student-photo", size: 1, sha256: "hash" }], tables: tenantResetTableNames.map((table) => ({ table, count: snapshot.tables[table].length })) } } as unknown as TenantResetPackage;
  const services: FreshResetServices = { clearance: requireResetLegalClearance, quiescence: vi.fn(async () => {}), preflight: vi.fn(async () => {}), backup: vi.fn(async () => ({ verified: "fixture-only" })), package: vi.fn(async () => pkg), deleteObjects: vi.fn(async () => {}), verifyObjects: vi.fn(async () => {}), deleteBackup: vi.fn(async () => ({ backupPackageDeleted: true, drillTargetsDeleted: true })) };
  return { ...f, services };
}
const rowsOf = (state: ResetTables, tenantId: string) => Object.fromEntries(tenantResetTableNames.map((name) => [name, state[name].filter((row) => row.tenantId === tenantId).length]).filter(([, count]) => count)) as Record<string, number>;
const tenantA = (state: ResetTables) => rowsOf(state, "tenant-a");

describe("license-expiry purge through the reset engine (injected SQL)", () => {
  it("deletes all institution data, its AuditLog rows and objects; leaves one PII-free system receipt and a suspended tombstone", async () => {
    const f = await runnerFixture();
    const result = await runFreshReset(f.pool, "tenant-a", f.op.id, f.services);
    expect(result).toMatchObject({ status: "COMPLETED", phase: "DONE", result: { preservedOwnerCount: 0, deletedObjectCount: 1 } });
    const state = f.state();
    // Only the operation ledger, license contract, and tombstone remain under the tenant id.
    expect(tenantA(state)).toEqual({ LicenseTerm: 1, TenantFreshResetOperation: 1 });
    expect(state.Tenant[0]).toMatchObject({ id: "tenant-a", status: "SUSPENDED", name: "İmha edildi", contactEmail: null });
    expect(state.PlatformIdempotencyKey).toEqual([]);
    const receipts = state.AuditLog.filter((row) => row.tenantId !== "tenant-b");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ tenantId: null, action: "tenant.license-expiry-purge.completed", entityId: f.op.id });
    expect(JSON.stringify(receipts[0])).not.toMatch(/alpha|Alfa|alfa@example|Ayse|10000000146|555/);
    // 18 institution rows + 2 handover-ledger rows, all purged.
    expect(receipts[0]!.diff).toMatchObject({ deletedRowCount: 20, exportId, exportDeliveredOn: endedDaysAgo(9).slice(0, 10), backupPackageDeleted: true, drillTargetsDeleted: true });
    // VERIFY (objects gone + postconditions) strictly precedes the single backup deletion.
    expect(f.services.deleteBackup).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.services.deleteBackup).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(f.services.verifyObjects).mock.invocationCallOrder[0]!);
    // Other tenant untouched, including its AuditLog and finance rows.
    expect(rowsOf(state, "tenant-b")).toMatchObject({ User: 1, Student: 1, AuditLog: 3, PaymentPlan: 1, LicenseUsage: 1, WhatsAppConsent: 1 });
    expect(f.services.deleteObjects).toHaveBeenCalledTimes(1);
    expect(f.calls).not.toContain('UPDATE "Tenant" SET "status" = \'ACTIVE\'');
    expect(f.calls.filter((sql) => sql.startsWith("SELECT o_okul_license_expiry_purge"))).toHaveLength(2);
  });
  it("a license renewed before the database phase cancels the purge without deleting anything", async () => {
    const f = await runnerFixture();
    vi.mocked(f.services.backup).mockImplementationOnce(async () => { f.state().LicenseTerm.push({ id: "renewal", tenantId: "tenant-a", ...term(-300) }); return { verified: "fixture-only" }; });
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_LICENSE_NOT_EXPIRED");
    expect(f.state().TenantFreshResetOperation[0]).toMatchObject({ status: "CANCELLED", errorCode: "RESET_LICENSE_NOT_EXPIRED", result: { backupPackageDeleted: true, drillTargetsDeleted: true } });
    // Security review 2026-10-06: the cancelled purge keeps no backup package or drill copy.
    expect(f.services.deleteBackup).toHaveBeenCalledTimes(1);
    expect(f.calls.some((sql) => sql.startsWith("DELETE") || sql.startsWith("SELECT o_okul_license_expiry_purge"))).toBe(false);
    expect(tenantA(f.state()).Student).toBe(1); expect(tenantA(f.state()).PaymentPlan).toBe(1);
    expect(f.services.deleteObjects).not.toHaveBeenCalled();
    // A cancelled operation is finished; replay never purges.
    await runFreshReset(f.pool, "tenant-a", f.op.id, f.services);
    expect(f.calls.some((sql) => sql.startsWith("DELETE"))).toBe(false);
  });
  it("a renewal committed between the worker check and the locked SQL re-check rolls the purge back", async () => {
    const f = await runnerFixture([{ id: "license", tenantId: "tenant-a", ...term(120) }, { id: "renewal", tenantId: "tenant-a", ...term(-300) }]);
    // The worker-side clearance is bypassed here; the SECURITY DEFINER function re-checks under the Tenant lock.
    f.services.clearance = vi.fn(async () => {});
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_LICENSE_NOT_EXPIRED");
    expect(f.state().TenantFreshResetOperation[0]).toMatchObject({ status: "CANCELLED", phase: "DATABASE" });
    expect(tenantA(f.state())).toMatchObject({ Student: 1, User: 1, AuditLog: expect.any(Number), PaymentPlan: 1 });
    expect(f.services.deleteObjects).not.toHaveBeenCalled();
  });
  it("purge clearance is the license state, not an institution request; after the database phase objects still go", async () => {
    const f = fixture();
    await expect(purgeResetDatabase(f.db, { ...f.op, status: "RUNNING", phase: "DATABASE" }, "digest", requireResetLegalClearance, async () => {})).rejects.toThrow("RESET_SOURCE_CHANGED");
    const expired = fixture([{ id: "license", tenantId: "tenant-a", ...term(80) }]);
    await expect(requireResetLegalClearance("tenant-a", expired.db, { ...expired.op, phase: "BACKUP" })).rejects.toThrow("RESET_LICENSE_NOT_EXPIRED");
    await expect(requireResetLegalClearance("tenant-a", expired.db, { ...expired.op, phase: "OBJECTS" })).resolves.toBeUndefined();
  });
  it("write quiescence gate still applies to the purge exactly as to clean reset", async () => {
    const f = await runnerFixture();
    f.services.quiescence = vi.fn(async () => { throw new Error("RESET_WRITE_QUIESCENCE_UNVERIFIED"); });
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_WRITE_QUIESCENCE_UNVERIFIED");
    expect(f.state().TenantFreshResetOperation[0]?.status).toBe("BLOCKED");
    expect(f.calls.some((sql) => sql.startsWith("DELETE"))).toBe(false);
  });
});

describe("purge operation creation", () => {
  function storeFixture(options: { terms?: Array<Record<string, unknown>>; status?: string; purged?: boolean; exports?: Array<Record<string, unknown>> } = {}) {
    const tenant = { slug: "alpha", status: options.status ?? "SUSPENDED", lifecycleVersion: 3, resetRequest: { id: "untouched" } };
    const inserted: unknown[][] = []; const calls: string[] = [];
    const db = { async query<T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
      calls.push(sql); const rows = (value: unknown[]) => ({ rows: value as T[] });
      if (sql.includes("pg_try_advisory_xact_lock_shared")) return rows([{ locked: true }]);
      if (sql.includes('FROM "AuthSession"')) return rows([{ id: "system-session" }]);
      if (sql.startsWith('SELECT * FROM "TenantFreshResetOperation"')) return rows([]);
      if (sql.includes('FROM "Tenant" WHERE "id" = $1 FOR UPDATE')) return rows([tenant]);
      if (sql.startsWith('SELECT "status" FROM "TenantFreshResetOperation"')) return rows(options.purged ? [{ status: "COMPLETED" }] : []);
      if (sql.includes('FROM "LicenseTerm"')) return rows(options.terms ?? [term(100)]);
      if (sql.includes('FROM "AuditLog"')) return rows(options.exports ?? exportLedger("tenant-a"));
      if (sql.startsWith('INSERT INTO "TenantFreshResetOperation"')) { inserted.push(values); return rows([{ id: values[0] }]); }
      return rows([]);
    }, release() {} };
    return { store: new PostgresFreshResetStore({ query: db.query, connect: async () => db }), inserted, calls, tenant };
  }
  const body: FreshResetRequest = { preset: "LICENSE_EXPIRY_PURGE_V1", expectedLifecycleVersion: 3, preflightDigest: "d".repeat(64), confirmationText: "alpha", reason: "LICENSE_EXPIRED" };
  const actor = { userId: "platform-admin", sessionId: "system-session", membershipVersion: 1, key: "purge-key", requestHash: "hash" };
  it("accepts an expired, suspended tenant with exact slug confirmation without consuming an institution request", async () => {
    const f = storeFixture(); const validate = vi.fn(async () => {});
    await f.store.create("tenant-a", body, actor, validate);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(f.inserted[0]?.[5]).toBe("LICENSE_EXPIRY_PURGE_V1"); expect(f.inserted[0]?.[9]).toBeNull();
    expect(f.calls.some((sql) => sql.startsWith('UPDATE "Tenant"'))).toBe(false);
  });
  it.each([
    ["wrong slug", { body: { ...body, confirmationText: "ALPHA" } }, "RESET_CONFIRMATION_MISMATCH"],
    ["license not expired (day 90)", { terms: [term(90)] }, "RESET_LICENSE_NOT_EXPIRED"],
    ["renewed license", { terms: [term(200), term(-100)] }, "RESET_LICENSE_NOT_EXPIRED"],
    ["tenant not suspended", { status: "ACTIVE" }, "RESET_REQUIRES_SUSPENDED"],
    ["already purged", { purged: true }, "RESET_TARGET_INVALID"],
    // Product owner decision (2026-10-05): a delivered handover export created after the license end.
    ["no handover export", { exports: [] }, "RESET_EXPORT_RECEIPT_REQUIRED"],
    ["export created before the license end", { exports: exportLedger("tenant-a", 101) }, "RESET_EXPORT_RECEIPT_REQUIRED"],
    ["export not marked delivered", { exports: exportLedger("tenant-a", 10, false) }, "RESET_EXPORT_RECEIPT_REQUIRED"],
    ["purge preset with another reason", { body: { ...body, reason: "OPERATIONS_REVIEW" as const } }, "RESET_TARGET_INVALID"],
  ])("rejects %s before any write", async (_name, options, code) => {
    const f = storeFixture(options as never); const validate = vi.fn(async () => {});
    await expect(f.store.create("tenant-a", (options as { body?: FreshResetRequest }).body ?? body, actor, validate)).rejects.toThrow(code);
    expect(f.inserted).toEqual([]); expect(validate).not.toHaveBeenCalled();
  });
  it("never targets the system tenant", async () => {
    await expect(storeFixture().store.create("system", body, actor, async () => {})).rejects.toThrow("RESET_TARGET_INVALID");
  });
});

describe("purge database boundary (static migration contract; live PostgreSQL run is EXTERNAL_NOT_RUN)", () => {
  const sql = readFileSync("prisma/migrations/20261009120000_license_expiry_purge/migration.sql", "utf8");
  it("only the reset worker can call the purge function, and only for its own running purge", () => {
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    expect(sql).toContain("session_user <> 'o_okul_reset_worker'");
    expect(sql).toContain("p_tenant_id IS DISTINCT FROM current_setting('app.current_tenant_id', true)");
    expect(sql).toContain(`"preset" = 'LICENSE_EXPIRY_PURGE_V1' FOR UPDATE`);
    expect(sql).toContain(`"endsAt" + interval '91 days' > now()`);
    expect(sql).toContain("REVOKE ALL ON FUNCTION o_okul_license_expiry_purge(TEXT, TEXT, BOOLEAN) FROM PUBLIC;");
    expect(sql.match(/GRANT EXECUTE ON FUNCTION o_okul_license_expiry_purge[^;]*;/g)).toEqual(["GRANT EXECUTE ON FUNCTION o_okul_license_expiry_purge(TEXT, TEXT, BOOLEAN) TO o_okul_reset_worker;"]);
    expect(sql).not.toMatch(/GRANT [^;]*(DELETE|TRUNCATE)[^;]*ON "AuditLog"/);
    expect(sql).toContain(`DELETE FROM "AuditLog" WHERE "tenantId" = p_tenant_id`);
  });
  it("receipt is system-scope and carries only tenant id, slug hash, time and counts", () => {
    const receipt = sql.slice(sql.indexOf('INSERT INTO "AuditLog"'), sql.indexOf('UPDATE "Tenant"'));
    const fields = receipt.slice(receipt.indexOf("jsonb_build_object("));
    expect(receipt).toContain("NULL, op_row.\"actorUserId\"");
    expect([...new Set(fields.match(/'(\w+)', /g)?.map((key) => key.slice(1, -3)))]).toEqual(["tenantId", "slugSha256", "purgedAt", "deletedRowCount", "deletedObjectCount", "exportId", "exportDeliveredOn", "backupPackageDeleted", "drillTargetsDeleted"]);
    expect(receipt).not.toMatch(/"name"|contactEmail/);
    // The receipt is refused unless the worker recorded each proven deletion separately.
    expect(sql).toContain(`op_row."result" ->> 'backupPackageDeleted' IS DISTINCT FROM 'true'`);
    expect(sql).toContain(`op_row."result" ->> 'drillTargetsDeleted' IS DISTINCT FROM 'true'`);
    expect(sql).not.toContain("'backupDeleted'");
  });
  it("a purged tenant is never reactivated and a cancelled purge does not hold the tenant", () => {
    expect(sql).toContain("RAISE EXCEPTION USING MESSAGE = 'TENANT_PURGED'");
    expect(sql).toContain(`WHERE "status" NOT IN ('COMPLETED', 'CANCELLED')`);
  });
});

describe("handover export precondition and backup deletion (product owner decision 2026-10-05)", () => {
  it("only a delivered export created after the license end counts", () => {
    const end = endedDaysAgo(120);
    expect(licenseExpiryPurgeExportState(exportLedger("t"), end)).toEqual({ exportId, deliveredOn: endedDaysAgo(9).slice(0, 10) });
    expect(licenseExpiryPurgeExportState(exportLedger("t", 10, false), end)).toEqual({ exportId, deliveredOn: null });
    expect(licenseExpiryPurgeExportState(exportLedger("t", 121), end)).toEqual({ exportId: null, deliveredOn: null });
    expect(licenseExpiryPurgeExportState([], end)).toEqual({ exportId: null, deliveredOn: null });
    // A delivery row for an export id that was never created after the end proves nothing.
    expect(licenseExpiryPurgeExportState(exportLedger("t").filter((row) => row.action !== "tenant.data-export.created"), end)).toEqual({ exportId: null, deliveredOn: null });
  });
  it("the worker re-checks the delivered export: without it the purge is blocked and nothing is deleted", async () => {
    const f = await runnerFixture(undefined, false);
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_EXPORT_RECEIPT_REQUIRED");
    expect(f.state().TenantFreshResetOperation[0]).toMatchObject({ status: "BLOCKED", errorCode: "RESET_EXPORT_RECEIPT_REQUIRED" });
    expect(f.calls.some((sql) => sql.startsWith("DELETE") || sql.startsWith("SELECT o_okul_license_expiry_purge"))).toBe(false);
    expect(f.services.backup).not.toHaveBeenCalled(); expect(f.services.deleteBackup).not.toHaveBeenCalled();
  });
  it.each([
    ["objects still present", (f: Awaited<ReturnType<typeof runnerFixture>>) => { f.services.verifyObjects = vi.fn(async () => { throw new Error("RESET_OBJECT_STILL_PRESENT"); }); }],
    ["database postcondition fails", (f: Awaited<ReturnType<typeof runnerFixture>>) => { f.services.deleteObjects = vi.fn(async () => { f.state().Student.push({ id: "late", tenantId: "tenant-a" }); }); }],
  ])("VERIFY failure (%s) keeps the backup package and leaves the operation failed", async (_name, breakVerify) => {
    const f = await runnerFixture(); breakVerify(f);
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow();
    expect(f.services.deleteBackup).not.toHaveBeenCalled();
    expect(f.state().TenantFreshResetOperation[0]).toMatchObject({ status: "FAILED", phase: "OBJECTS" });
    expect(f.state().AuditLog.some((row) => row.action === "tenant.license-expiry-purge.completed")).toBe(false);
  });
  it("a failed backup deletion is not completed; the retry from VERIFY deletes again without reading the package", async () => {
    const f = await runnerFixture();
    vi.mocked(f.services.deleteBackup).mockRejectedValueOnce(new Error("RESET_BACKUP_DELETE_UNVERIFIED"));
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_BACKUP_DELETE_UNVERIFIED");
    expect(f.state().TenantFreshResetOperation[0]).toMatchObject({ status: "BLOCKED", phase: "VERIFY" });
    expect(f.state().AuditLog.some((row) => row.action === "tenant.license-expiry-purge.completed")).toBe(false);
    vi.mocked(f.services.package).mockClear();
    expect(await runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).toMatchObject({ status: "COMPLETED" });
    expect(f.services.package).not.toHaveBeenCalled();
    expect(f.services.deleteBackup).toHaveBeenCalledTimes(2);
    expect(f.state().AuditLog.find((row) => row.action === "tenant.license-expiry-purge.completed")?.diff).toMatchObject({ backupPackageDeleted: true, drillTargetsDeleted: true });
  });
  it("backup deletion removes package and attestation, then proves both are gone", async () => {
    const present = new Set([`tenant-reset-backups/${"c".repeat(32)}.bin`, `tenant-reset-backups/${"c".repeat(32)}.restore-verified.json`]);
    const sent: string[] = [];
    const s3 = (options: { versioned?: boolean; stuck?: boolean } = {}) => ({ async send(command: unknown) {
      const name = (command as object).constructor.name; const input = (command as { input: { Key?: string } }).input; sent.push(`${name}:${input.Key ?? ""}`);
      if (name === "GetBucketVersioningCommand") return options.versioned ? { Status: "Suspended" } : {};
      if (name === "DeleteObjectCommand") { if (!options.stuck) present.delete(input.Key!); return {}; }
      if (name === "HeadObjectCommand") { if (present.has(input.Key!)) return { ETag: "x" }; throw Object.assign(new Error("NotFound"), { $metadata: { httpStatusCode: 404 } }); }
      throw new Error(`unexpected ${name}`);
    } });
    await expect(deleteResetBackupPackage(s3({ versioned: true }), "backup", "c".repeat(32))).rejects.toThrow("RESET_VERSIONED_BACKUP_UNVERIFIED");
    expect(sent.filter((entry) => entry.startsWith("DeleteObject"))).toEqual([]);
    await expect(deleteResetBackupPackage(s3({ stuck: true }), "backup", "c".repeat(32))).rejects.toThrow("RESET_BACKUP_DELETE_UNVERIFIED");
    sent.length = 0;
    await deleteResetBackupPackage(s3(), "backup", "c".repeat(32));
    expect(present.size).toBe(0);
    expect(sent.filter((entry) => !entry.startsWith("GetBucket"))).toEqual([
      `DeleteObjectCommand:tenant-reset-backups/${"c".repeat(32)}.bin`, `HeadObjectCommand:tenant-reset-backups/${"c".repeat(32)}.bin`,
      `DeleteObjectCommand:tenant-reset-backups/${"c".repeat(32)}.restore-verified.json`, `HeadObjectCommand:tenant-reset-backups/${"c".repeat(32)}.restore-verified.json`,
    ]);
    await expect(deleteResetBackupPackage(s3(), "backup", "../other")).rejects.toThrow("RESET_TARGET_INVALID");
  });
});

describe("backup package and drill copies are deleted with the purge (security review 2026-10-06)", () => {
  it.each([
    ["package", { backupPackageDeleted: false, drillTargetsDeleted: true }],
    ["drill copies", { backupPackageDeleted: true, drillTargetsDeleted: false }],
  ])("an unproven %s deletion is recorded separately and never completes the purge", async (_name, deleted) => {
    const f = await runnerFixture();
    vi.mocked(f.services.deleteBackup).mockResolvedValueOnce(deleted);
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_BACKUP_DELETE_UNVERIFIED");
    expect(f.state().TenantFreshResetOperation[0]).toMatchObject({ status: "BLOCKED", phase: "VERIFY", result: deleted });
    expect(f.state().AuditLog.some((row) => row.action === "tenant.license-expiry-purge.completed")).toBe(false);
    expect(await runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).toMatchObject({ status: "COMPLETED" });
    expect(f.state().TenantFreshResetOperation[0]!.result).toMatchObject({ backupPackageDeleted: true, drillTargetsDeleted: true });
  });
  it("a cancelled purge whose cleanup fails stays CANCELLED, records false flags and is due for the cleanup job", async () => {
    const f = await runnerFixture();
    vi.mocked(f.services.backup).mockImplementationOnce(async () => { f.state().LicenseTerm.push({ id: "renewal", tenantId: "tenant-a", ...term(-300) }); return { verified: "fixture-only" }; });
    vi.mocked(f.services.deleteBackup).mockRejectedValueOnce(new Error("RESET_OPERATIONS_PREREQUISITE_REQUIRED"));
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_LICENSE_NOT_EXPIRED");
    const op = f.state().TenantFreshResetOperation[0] as unknown as FreshResetOperation;
    expect(op).toMatchObject({ status: "CANCELLED", result: { backupPackageDeleted: false, drillTargetsDeleted: false } });
    expect(purgeBackupCleanupDue(op)).toBe(true);
    expect(await cleanupPurgeBackup(f.pool, "tenant-a", f.op.id, f.services)).toEqual({ backupPackageDeleted: true, drillTargetsDeleted: true });
    expect(f.state().TenantFreshResetOperation[0]).toMatchObject({ status: "CANCELLED", result: { backupPackageDeleted: true, drillTargetsDeleted: true } });
    expect(purgeBackupCleanupDue(f.state().TenantFreshResetOperation[0] as unknown as FreshResetOperation)).toBe(false);
    expect(f.calls.some((sql) => sql.startsWith("DELETE") || sql.startsWith("SELECT o_okul_license_expiry_purge"))).toBe(false);
  });
  it("a purge blocked before its database phase is cleaned up and then never resumes", async () => {
    const f = await runnerFixture();
    f.services.quiescence = vi.fn(async () => { throw new Error("RESET_WRITE_QUIESCENCE_UNVERIFIED"); });
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_WRITE_QUIESCENCE_UNVERIFIED");
    expect(f.state().TenantFreshResetOperation[0]).toMatchObject({ status: "BLOCKED", phase: "PREFLIGHT" });
    // The run itself never deletes the backup of a blocked purge; the cleanup job does, after retries are over.
    expect(f.services.deleteBackup).not.toHaveBeenCalled();
    expect(await cleanupPurgeBackup(f.pool, "tenant-a", f.op.id, f.services)).toEqual({ backupPackageDeleted: true, drillTargetsDeleted: true });
    f.services.quiescence = vi.fn(async () => {});
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow("RESET_BACKUP_DELETED");
    expect(f.state().TenantFreshResetOperation[0]).toMatchObject({ status: "FAILED", errorCode: "RESET_BACKUP_DELETED" });
    expect(f.services.backup).not.toHaveBeenCalled();
    expect(f.calls.some((sql) => sql.startsWith("DELETE") || sql.startsWith("SELECT o_okul_license_expiry_purge"))).toBe(false);
  });
  it("a purge that failed after its database phase committed keeps its backup package (the only way back)", async () => {
    const f = await runnerFixture();
    f.services.verifyObjects = vi.fn(async () => { throw new Error("RESET_OBJECT_STILL_PRESENT"); });
    await expect(runFreshReset(f.pool, "tenant-a", f.op.id, f.services)).rejects.toThrow();
    const op = f.state().TenantFreshResetOperation[0] as unknown as FreshResetOperation;
    expect(op).toMatchObject({ status: "FAILED", phase: "OBJECTS" });
    expect(purgeBackupCleanupDue(op)).toBe(false);
    expect(await cleanupPurgeBackup(f.pool, "tenant-a", f.op.id, f.services)).toBeUndefined();
    expect(f.services.deleteBackup).not.toHaveBeenCalled();
  });
  it("cleanup is due only for purges that ended before the database phase and are not auto-retried", () => {
    const base = { ...fixture().op, result: null } as FreshResetOperation;
    const due = (patch: Partial<FreshResetOperation>) => purgeBackupCleanupDue({ ...base, ...patch });
    expect(due({ status: "CANCELLED", phase: "DATABASE" })).toBe(true);
    expect(due({ status: "BLOCKED", phase: "PREFLIGHT" })).toBe(true);
    expect(due({ status: "FAILED", phase: "BACKUP", errorCode: "RESET_SOURCE_CHANGED" })).toBe(true);
    expect(due({ status: "FAILED", phase: "BACKUP", errorCode: "RESET_EXECUTION_FAILED" })).toBe(false);
    for (const phase of ["OBJECTS", "VERIFY", "DONE"] as const) expect(due({ status: "FAILED", phase, errorCode: "RESET_OBJECT_STILL_PRESENT" })).toBe(false);
    expect(due({ status: "RUNNING", phase: "BACKUP" })).toBe(false);
    expect(due({ status: "CANCELLED", phase: "BACKUP", preset: "CLEAN_SETUP_V1" })).toBe(false);
    expect(due({ status: "CANCELLED", phase: "BACKUP", result: { backupPackageDeleted: true, drillTargetsDeleted: false } })).toBe(true);
    expect(due({ status: "CANCELLED", phase: "BACKUP", result: { backupPackageDeleted: true, drillTargetsDeleted: true } })).toBe(false);
  });
  it("the dispatcher query mirrors the predicate and waits out job retries", async () => {
    const sql: string[] = [];
    const db = { async query(text: string) { sql.push(text); return { rows: [] }; }, release() {} };
    await new PostgresFreshResetStore({ query: db.query, connect: async () => db }).backupCleanupDue();
    const query = sql.find((text) => text.includes('FROM "TenantFreshResetOperation"'))!;
    for (const part of [`"preset" = 'LICENSE_EXPIRY_PURGE_V1'`, `"phase" IN ('PREFLIGHT', 'BACKUP', 'DATABASE')`, `"status" IN ('CANCELLED', 'BLOCKED')`, `"errorCode" IS DISTINCT FROM 'RESET_EXECUTION_FAILED'`, `"updatedAt" < now() - interval '1 hour'`, "backupPackageDeleted", "drillTargetsDeleted"]) expect(query).toContain(part);
  });
  it("drill deletion drops the per-operation database and every object version, then proves both absent", async () => {
    const op = "c".repeat(32);
    let databases = [`o_okul_reset_drill_${op}`];
    const adminSql: string[] = [];
    const admin = { async query<T>(text: string, values: unknown[] = []) { adminSql.push(text); if (text.startsWith("DROP DATABASE")) databases = []; return { rows: (text.includes("pg_database") ? databases.filter((name) => name === values[0]).map(() => ({ "?column?": 1 })) : []) as T[] }; } };
    const objects = new Map([["a", ["v1", "v2"]], ["b", ["null"]]]);
    const deletes: Array<{ Bucket: string; Key: string; VersionId?: string }> = [];
    const s3 = (options: { missingBucket?: boolean; stuck?: boolean } = {}) => ({ async send(command: unknown) {
      const name = (command as object).constructor.name; const input = (command as { input: { Bucket: string; Key: string; VersionId?: string } }).input;
      if (input.Bucket !== `o-okul-reset-drill-${op}`) throw new Error("wrong bucket");
      if (options.missingBucket) throw Object.assign(new Error("NoSuchBucket"), { name: "NoSuchBucket", $metadata: { httpStatusCode: 404 } });
      if (name === "ListObjectVersionsCommand") return { Versions: [...objects].flatMap(([Key, versions]) => versions.map((VersionId) => ({ Key, VersionId }))) };
      if (name === "ListObjectsV2Command") return { Contents: [...objects.keys()].map((Key) => ({ Key })) };
      if (name === "DeleteObjectCommand") { deletes.push(input); if (!options.stuck) { const left = (objects.get(input.Key) ?? []).filter((v) => input.VersionId ? v !== input.VersionId : v !== "null"); if (left.length) objects.set(input.Key, left); else objects.delete(input.Key); } return {}; }
      throw new Error(`unexpected ${name}`);
    } });
    await deleteResetDrillTargets(admin, s3(), op);
    expect(adminSql[0]).toBe(`DROP DATABASE IF EXISTS "o_okul_reset_drill_${op}" WITH (FORCE)`);
    expect(objects.size).toBe(0);
    expect(deletes).toEqual(expect.arrayContaining([expect.objectContaining({ Key: "a", VersionId: "v1" }), expect.objectContaining({ Key: "a", VersionId: "v2" }), { Bucket: `o-okul-reset-drill-${op}`, Key: "b" }]));
    // Idempotent: a missing bucket and an already dropped database are absent, not an error.
    await deleteResetDrillTargets(admin, s3({ missingBucket: true }), op);
    objects.set("c", ["v9"]);
    await expect(deleteResetDrillTargets(admin, s3({ stuck: true }), op)).rejects.toThrow("RESET_DRILL_DELETE_UNVERIFIED");
    const stubborn = { async query<T>(text: string) { return { rows: (text.includes("pg_database") ? [{ "?column?": 1 }] : []) as T[] }; } };
    await expect(deleteResetDrillTargets(stubborn, s3(), op)).rejects.toThrow("RESET_DRILL_DELETE_UNVERIFIED");
    await expect(deleteResetDrillTargets(admin, s3(), "../other")).rejects.toThrow("RESET_TARGET_INVALID");
  });
});
