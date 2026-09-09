import { describe, expect, it } from "vitest";
import { assertResetCatalog, resetDigest, resetTableCounts, resetOwnerIds, tenantResetTableNames, tenantResetColumns, type ResetTables } from "./tenant-reset-catalog.js";
import { resetSnapshotBlockers, withResetSnapshot, type TenantResetSnapshot } from "./tenant-reset-snapshot.js";

export function snapshotFixture(): TenantResetSnapshot {
  const tables = Object.fromEntries(tenantResetTableNames.map((table) => [table, []])) as unknown as ResetTables;
  tables.Tenant = [{ id: "tenant-a", status: "SUSPENDED", lifecycleVersion: 2 }];
  tables.User = [{ id: "owner", accountStatus: "ACTIVE", membershipVersion: 1 }];
  tables.Employee = [{ userId: "owner", status: "ACTIVE", deletedAt: null }];
  tables.TenantMembership = [{ id: "owner-membership", userId: "owner", staffRole: "TENANT_OWNER", role: "TENANT_ADMIN", status: "ACTIVE", startsAt: "2026-01-01T00:00:00Z", version: 1 }];
  return { tenantId: "tenant-a", lifecycleVersion: 2, capturedAt: "2026-09-06T00:00:00Z", objectOwners: { tenantIds: ["tenant-a"], students: [] }, schemaDigest: "schema", migrationRows: [], tables,
    rawTables: Object.fromEntries(tenantResetTableNames.map((table) => [table, tables[table].map((row) => JSON.stringify(row))])) as TenantResetSnapshot["rawTables"], dataDigest: "digest" };
}

describe("CLEAN_SETUP_V1 catalog", () => {
  it("unknown or missing direct/indirect table fails closed", () => {
    expect(() => assertResetCatalog(tenantResetTableNames)).not.toThrow();
    expect(() => assertResetCatalog([...tenantResetTableNames, "NewFileTable"])).toThrow("RESET_CATALOG_UNCLASSIFIED_TABLE");
    expect(() => assertResetCatalog(tenantResetTableNames.filter((name) => name !== "ConsumedRefreshToken"))).toThrow();
  });
  it("keeps all owners and only canonical memberships; auxiliary teacher row is deleted", () => {
    const snapshot = snapshotFixture();
    snapshot.tables.TenantMembership[0]!.hasTeacherPersona = true;
    snapshot.tables.TenantMembership.push({ id: "teacher", userId: "owner", role: "TEACHER", staffRole: null, status: "ACTIVE" });
    expect(resetTableCounts(snapshot.tables, new Date(snapshot.capturedAt)).find((row) => row.category === "TenantMembership")).toEqual({ category: "TenantMembership", preserved: 1, deleted: 1, blocked: 0 });
    expect(resetSnapshotBlockers(snapshot)).toEqual(["INSTITUTION_REQUEST_REQUIRED", "WRITE_QUIESCENCE_UNVERIFIED"]);
  });
  it("preserves two valid owners, counts invalid candidates separately and rejects unsupported role projections", () => {
    const snapshot = snapshotFixture();
    snapshot.tables.User.push({ ...snapshot.tables.User[0], id: "second" });
    snapshot.tables.Employee.push({ ...snapshot.tables.Employee[0], userId: "second" });
    snapshot.tables.TenantMembership.push({ ...snapshot.tables.TenantMembership[0], id: "second-membership", userId: "second" });
    snapshot.tables.TenantMembership.push({ ...snapshot.tables.TenantMembership[0], id: "invalid-membership", userId: "missing-user" });
    expect([...resetOwnerIds(snapshot.tables, new Date(snapshot.capturedAt))].sort()).toEqual(["owner", "second"]);
    expect(resetSnapshotBlockers(snapshot)).toContain("OWNER_PROJECTION_MISMATCH");
    expect(resetTableCounts(snapshot.tables, new Date(snapshot.capturedAt)).find((row) => row.category === "TenantMembership")).toMatchObject({ preserved: 2, deleted: 0, blocked: 1 });
    snapshot.tables.TenantMembership.push({ userId: "owner", role: "GUARDIAN", staffRole: null, status: "ACTIVE" });
    expect([...resetOwnerIds(snapshot.tables, new Date(snapshot.capturedAt))]).toEqual(["second"]);
  });
  it("blocks deleted finance/support/real consent and cleared contact history", () => {
    const snapshot = snapshotFixture();
    snapshot.tables.PaymentTransaction.push({ deletedAt: "2026-01-01" });
    snapshot.tables.SupportTicket.push({ deletedAt: "2026-01-01" });
    snapshot.tables.WhatsAppConsentEvent.push({ eventType: "WITHDRAWN" });
    snapshot.tables.StudentContact.push({ consentSource: null, canReceiveSms: false });
    expect(resetTableCounts(snapshot.tables, new Date(snapshot.capturedAt)).find((row) => row.category === "StudentContact")).toMatchObject({ deleted: 0, blocked: 1 });
    expect(resetSnapshotBlockers(snapshot)).toEqual(expect.arrayContaining(["FINANCE_RECORDS_PRESENT", "SUPPORT_RECORDS_PRESENT", "CONSENT_RECORDS_PRESENT", "CONSENT_HISTORY_UNVERIFIED", "INSTITUTION_REQUEST_REQUIRED"]));
  });
  it("blocks zero owners and inconsistent projections", () => {
    const snapshot = snapshotFixture();
    snapshot.tables.Employee = [];
    expect(resetSnapshotBlockers(snapshot)).toContain("OWNER_PROJECTION_MISMATCH");
    snapshot.tables.TenantMembership = [];
    expect(resetSnapshotBlockers(snapshot)).toContain("NO_ACTIVE_OWNER");
  });
  it("reads more than 5000 rows and retains numeric text in a read-only consistent snapshot", async () => {
    const source = snapshotFixture();
    source.rawTables.PaymentTransaction = Array.from({ length: 5001 }, (_, id) => `{"amount": 9007199254740993123.1234, "id": "${id}"}`);
    const queries: string[] = [];
    const db = { async query<T>() { return { rows: [] as T[] }; }, async connect() { return {
      async query<T>(sql: string) {
        queries.push(sql);
        if (sql.includes("array_agg")) return { rows: Object.entries(tenantResetColumns).map(([name, columns]) => ({ name, columns })) as T[] };
        if (sql.includes("pg_inherits")) return { rows: [{ count: "0" }] as T[] };
        if (sql.includes("c.relname AS name")) return { rows: tenantResetTableNames.map((name) => ({ name })) as T[] };
        if (sql.includes('FROM "_prisma_migrations"')) return { rows: [{ row: '{"migration_name":"migration","checksum":"hash","finished_at":"2026-01-01"}' }] as T[] };
        const table = sql.match(/FROM "(\w+)" t/)?.[1] as keyof ResetTables;
        if (table) return { rows: source.rawTables[table].map((row) => ({ row })) as T[] };
        return { rows: [] as T[] };
      }, release() {},
    }; } };
    const snapshot = await withResetSnapshot(db, "tenant-a", async (value) => value);
    expect(snapshot.rawTables.PaymentTransaction).toHaveLength(5001);
    expect(snapshot.rawTables.PaymentTransaction[0]).toContain("9007199254740993123.1234");
    expect(snapshot.dataDigest).toBe(resetDigest({ schemaDigest: snapshot.schemaDigest, rawTables: snapshot.rawTables }));
    expect(queries[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(queries.join("\n")).not.toMatch(/LIMIT 5000|deletedAt.*IS NULL|^(INSERT|UPDATE|DELETE)/m);
    expect(queries.at(-1)).toBe("COMMIT");
  });
});

it.each(["FAILED", "EXPIRED"])("attempted legacy %s delivery stays unverified; no terminal shortcut", (status) => {
  const snapshot = snapshotFixture(); snapshot.tables.SecretDeliveryOutbox.push({ id: "legacy", status, attempts: 1, sourceScope: null });
  expect(resetSnapshotBlockers(snapshot)).toContain("DELIVERY_WORK_PRESENT");
});
