import { resolveLicenseState, type LicenseTermWindow } from "./license-state.js";
import { withTenantDb, type Queryable, type TenantQueryable } from "./tenant-db.js";
import { resetDeleteOrder } from "./tenant-fresh-reset.js";
import { tenantResetCatalog, tenantResetTableNames } from "./tenant-reset-catalog.js";

// DEC-20261005-03: data of an institution whose last license ended 91+ days ago is destroyed
// only after a SYSTEM_ADMIN approves each institution. Nothing here deletes by itself.
export const licenseExpiryPurgePreset = "LICENSE_EXPIRY_PURGE_V1";
export const licenseExpiryPurgeReason = "LICENSE_EXPIRED";

export interface LicenseExpiryPurgeCandidate {
  tenantId: string;
  name: string;
  slug: string;
  status: string;
  lifecycleVersion: number;
  licenseEndsAt: string;
  daysSinceLicenseEnd: number;
  estimatedRowCount: number;
  /** Latest handover export created after the license end, delivered or not; null when none. */
  exportId: string | null;
  /** Delivery date the SYSTEM_ADMIN recorded for that export; null until it is marked delivered. */
  exportDeliveredOn: string | null;
}

type TermRow = { startsAt: Date | string; endsAt: Date | string; cancelledAt: Date | string | null };
const dayMs = 24 * 60 * 60 * 1_000;
const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : String(value);

/** Latest license end when every non-cancelled term is EXPIRED; null otherwise (fail closed on bad data). */
export function licenseExpiryPurgeEndsAt(rows: readonly TermRow[], at = new Date()): string | null {
  const terms: LicenseTermWindow[] = rows.filter((row) => row.cancelledAt == null).map((row) => ({ startsAt: iso(row.startsAt), endsAt: iso(row.endsAt) }));
  try {
    if (!terms.length || terms.some((term) => resolveLicenseState(term, at) !== "EXPIRED")) return null;
  } catch { return null; }
  return terms.map((term) => term.endsAt).sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1)!;
}

// Product owner decision (2026-10-05): before the purge the institution must have received a full
// handover export. The ledger is the append-only AuditLog: one "created" row when the export is generated
// and one "delivered" row when a SYSTEM_ADMIN records the handover. Both rows are purged with the tenant.
export const licenseExpiryPurgeExportEntity = "TenantDataExport";
export const licenseExpiryPurgeExportCreated = "tenant.data-export.created";
export const licenseExpiryPurgeExportDelivered = "tenant.data-export.delivered";
type ExportAuditRow = { entityType?: unknown; entityId?: unknown; action?: unknown; createdAt?: unknown; diff?: unknown };
export interface LicenseExpiryPurgeExportState { exportId: string | null; deliveredOn: string | null }
const auditTime = (value: unknown) => Date.parse(value instanceof Date ? value.toISOString() : String(value));

/** Latest export created after the license end, and its delivery date when marked delivered. */
export function licenseExpiryPurgeExportState(rows: readonly ExportAuditRow[], licenseEndsAt: string): LicenseExpiryPurgeExportState {
  const end = Date.parse(licenseEndsAt);
  const ledger = rows.filter((row) => row.entityType === licenseExpiryPurgeExportEntity && typeof row.entityId === "string" && Number.isFinite(auditTime(row.createdAt)));
  // An export made before (or at) the license end can miss later records; only later ones count.
  const created = ledger.filter((row) => row.action === licenseExpiryPurgeExportCreated && auditTime(row.createdAt) > end)
    .sort((left, right) => auditTime(left.createdAt) - auditTime(right.createdAt));
  const deliveredOn = (exportId: string) => {
    const diff = ledger.find((row) => row.action === licenseExpiryPurgeExportDelivered && row.entityId === exportId)?.diff as { deliveredOn?: unknown } | undefined;
    return typeof diff?.deliveredOn === "string" ? diff.deliveredOn : null;
  };
  const delivered = created.filter((row) => deliveredOn(String(row.entityId))).at(-1);
  const latest = delivered ?? created.at(-1);
  return { exportId: latest ? String(latest.entityId) : null, deliveredOn: latest ? deliveredOn(String(latest.entityId)) : null };
}

export async function readLicenseExpiryPurgeExportState(db: Queryable, tenantId: string, licenseEndsAt: string): Promise<LicenseExpiryPurgeExportState> {
  const rows = await db.query<ExportAuditRow>(`SELECT "entityType", "entityId", "action", "createdAt", "diff" FROM "AuditLog" WHERE "tenantId" = $1 AND "entityType" = '${licenseExpiryPurgeExportEntity}'`, [tenantId]);
  return licenseExpiryPurgeExportState(rows.rows, licenseEndsAt);
}

/** License expired 91+ days ago AND a post-expiry export was delivered. Returns that delivery for the receipt. */
export async function requireLicenseExpiryPurgeClearance(db: Queryable, tenantId: string, at = new Date()): Promise<{ exportId: string; deliveredOn: string }> {
  if (!tenantId || tenantId === "system") throw new Error("RESET_TARGET_INVALID");
  const terms = await db.query<TermRow>('SELECT "startsAt", "endsAt", "cancelledAt" FROM "LicenseTerm" WHERE "tenantId" = $1', [tenantId]);
  const endsAt = licenseExpiryPurgeEndsAt(terms.rows, at);
  if (!endsAt) throw new Error("RESET_LICENSE_NOT_EXPIRED");
  const handover = await readLicenseExpiryPurgeExportState(db, tenantId, endsAt);
  if (!handover.exportId || !handover.deliveredOn) throw new Error("RESET_EXPORT_RECEIPT_REQUIRED");
  return { exportId: handover.exportId, deliveredOn: handover.deliveredOn };
}

/** Clean-reset blockers about kept records do not apply: the purge deletes those records too.
 * FINANCE_RECORDS_PRESENT becomes the export precondition: the delivered handover export carries the
 * institution's own accounting retention; O-Okul keeps no finance record after license end + 91 days. */
const purgeIrrelevantBlockers = new Set(["INSTITUTION_REQUEST_REQUIRED", "NO_ACTIVE_OWNER", "OWNER_PROJECTION_MISMATCH", "FINANCE_RECORDS_PRESENT", "SUPPORT_RECORDS_PRESENT", "CONSENT_RECORDS_PRESENT", "CONSENT_HISTORY_UNVERIFIED"]);
export function licenseExpiryPurgeBlockers(blockers: readonly string[]): string[] {
  return blockers.filter((code) => !purgeIrrelevantBlockers.has(code));
}

/** Tables the purge empties for the tenant: the clean-reset DELETE set plus records clean reset keeps or blocks on. */
// A function, not a constant: tenant-fresh-reset imports this module (circular import).
export function licenseExpiryPurgeTables(): string[] {
  return [...new Set<string>([...resetDeleteOrder, ...tenantResetTableNames.filter((name) => tenantResetCatalog[name] === "BLOCK"), "LicenseUsage", "BackupRestoreJob", "AuditLog"])];
}

/** Receipt count from the verified backup manifest taken right before the purge. */
export function licenseExpiryPurgeRowCount(tables: ReadonlyArray<{ table: string; count: number }>): number {
  const purged = new Set(licenseExpiryPurgeTables());
  return tables.filter((row) => purged.has(row.table)).reduce((sum, row) => sum + row.count, 0);
}

export async function listLicenseExpiryPurgeCandidates(pool: TenantQueryable, at = new Date()): Promise<LicenseExpiryPurgeCandidate[]> {
  return withTenantDb(pool, { tenantId: null, bypassRls: true, readOnly: true }, async (db) => {
    const tenants = await db.query<{ id: string; name: string; slug: string; status: string; lifecycleVersion: number }>(
      `SELECT t."id", t."name", t."slug", t."status", t."lifecycleVersion" FROM "Tenant" t
       WHERE t."id" <> 'system' AND NOT EXISTS (SELECT 1 FROM "TenantFreshResetOperation" o WHERE o."tenantId" = t."id" AND o."preset" = '${licenseExpiryPurgePreset}' AND o."status" = 'COMPLETED')
       ORDER BY t."slug"`);
    const terms = await db.query<TermRow & { tenantId: string }>(`SELECT "tenantId", "startsAt", "endsAt", "cancelledAt" FROM "LicenseTerm" WHERE "tenantId" <> 'system'`);
    const countedTables = licenseExpiryPurgeTables().filter((name) => name !== "ConsumedRefreshToken" && name !== "PasswordResetToken");
    const candidates: LicenseExpiryPurgeCandidate[] = [];
    for (const tenant of tenants.rows) {
      if (tenant.id === "system") continue;
      const endsAt = licenseExpiryPurgeEndsAt(terms.rows.filter((row) => row.tenantId === tenant.id), at);
      if (!endsAt) continue;
      // ponytail: one count per candidate table; candidates are few. Batch if the list grows large.
      const counted = await db.query<{ count: string }>(`SELECT (${countedTables.map((name) => `(SELECT count(*) FROM "${name}" WHERE "tenantId" = $1)`).join(" + ")})::text AS count`, [tenant.id]);
      const handover = await readLicenseExpiryPurgeExportState(db, tenant.id, endsAt);
      candidates.push({ tenantId: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status, lifecycleVersion: tenant.lifecycleVersion, licenseEndsAt: endsAt,
        daysSinceLicenseEnd: Math.floor((at.getTime() - Date.parse(endsAt)) / dayMs), estimatedRowCount: Number(counted.rows[0]?.count ?? 0),
        exportId: handover.exportId, exportDeliveredOn: handover.deliveredOn });
    }
    return candidates;
  });
}
