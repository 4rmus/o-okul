import { assertInstitutionResetRequest } from "./tenant-reset-request.js";
import type { Queryable, TenantQueryable } from "./tenant-db.js";
import { assertResetCatalog, assertResetColumns, resetDigest, resetOwnerIds, resetOwnerMemberships, tenantResetCatalog, tenantResetTableNames, type ResetTables, type TenantResetTable } from "./tenant-reset-catalog.js";

export interface TenantResetSnapshot { tenantId: string; lifecycleVersion: number; capturedAt: string; schemaDigest: string; tables: ResetTables; rawTables: Record<TenantResetTable, string[]>; migrationRows: string[]; objectOwners: { tenantIds: string[]; students: Array<{ id: string; tenantId: string }> }; dataDigest: string; }

const predicates: Partial<Record<TenantResetTable, string>> = {
  Tenant: 't."id" = $1',
  PlatformSession: "false",
  PasswordResetToken: 't."userId" IN (SELECT "id" FROM "User" WHERE "tenantId" = $1)',
  ConsumedRefreshToken: 't."tokenFamilyId" IN (SELECT "tokenFamilyId" FROM "AuthSession" WHERE "tenantId" = $1)',
  PlatformIdempotencyKey: `t."responseBody" #>> '{tenant,id}' = $1`,
  PlatformAccount: `t."id" IN (SELECT "createdByPlatformAccountId" FROM "LicenseTerm" WHERE "tenantId" = $1 UNION SELECT "platformAccountId" FROM "PlatformIdempotencyKey" WHERE "responseBody" #>> '{tenant,id}' = $1)`,
  SecretDeliveryOutbox: `t."tenantId" = $1 OR (t."purpose" = 'PASSWORD_RESET' AND t."sourceId" IN (SELECT p."id" FROM "PasswordResetToken" p JOIN "User" u ON u."id" = p."userId" WHERE u."tenantId" = $1)) OR (t."purpose" = 'IDENTITY_INVITATION' AND t."sourceId" IN (SELECT "id" FROM "IdentityInvitation" WHERE "tenantId" = $1))`,
};

export function tenantResetOwnershipPredicate(table: TenantResetTable): string {
  return predicates[table] ?? 't."tenantId" = $1';
}

export async function withResetSnapshot<T>(pool: TenantQueryable, tenantId: string, run: (snapshot: TenantResetSnapshot, client: Queryable) => Promise<T>, operationId?: string): Promise<T> {
  if (!tenantId.trim() || tenantId === "system") throw new Error("RESET_TARGET_INVALID");
  if (!pool.connect) throw new Error("RESET_TRANSACTION_REQUIRED");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    const snapshot = await readResetSnapshot(client, tenantId, operationId);
    const result = await run(snapshot, client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export function resetSnapshotBlockers(snapshot: TenantResetSnapshot): string[] {
  const { tables } = snapshot;
  const blockers: string[] = ["WRITE_QUIESCENCE_UNVERIFIED"];
  if (tables.TenantMutationActivity.length) blockers.push("MUTATION_ACTIVITY_PRESENT");
  try { const tenant = tables.Tenant[0]; const request = tenant?.resetRequest as { operationId?: string } | null;
    const operation = request?.operationId ? tables.TenantFreshResetOperation.find((row) => row.id === request.operationId) : undefined;
    assertInstitutionResetRequest(tenant?.resetRequest, { id: snapshot.tenantId, status: String(tenant?.status), lifecycleVersion: snapshot.lifecycleVersion }, operation ? { id: String(operation.id), institutionRequestId: String(operation.institutionRequestId) } : undefined);
  } catch { blockers.push("INSTITUTION_REQUEST_REQUIRED"); }
  const owners = resetOwnerIds(tables, new Date(snapshot.capturedAt));
  if (!owners.size) blockers.push("NO_ACTIVE_OWNER");
  if (resetOwnerMemberships(tables, new Date(snapshot.capturedAt)).some((row) => !owners.has(String(row.userId)))) blockers.push("OWNER_PROJECTION_MISMATCH");
  for (const table of tenantResetTableNames) if (tenantResetCatalog[table] === "BLOCK" && tables[table].length) {
    blockers.push(table.startsWith("Payment") ? "FINANCE_RECORDS_PRESENT" : table.startsWith("Support") ? "SUPPORT_RECORDS_PRESENT" : "CONSENT_RECORDS_PRESENT");
  }
  if (tables.StudentContact.length) blockers.push("CONSENT_HISTORY_UNVERIFIED");
  if (tables.StudentContact.some((row) => row.consentRecordedAt != null || row.consentSource != null || row.canReceiveSms || row.canReceiveAnnouncements || row.canReceiveFinance) ||
      tables.GuardianStudent.some((row) => row.canReceiveSms || row.canReceiveAnnouncements)) blockers.push("CONSENT_RECORDS_PRESENT");
  if (tables.Tenant[0]?.status !== "ACTIVE" && tables.Tenant[0]?.status !== "SUSPENDED") blockers.push("TENANT_STATUS_UNSUPPORTED");
  if (tables.RawImport.some((row) => /queued|running|processing/i.test(String((row.metadata as Record<string, unknown> | null)?.status ?? "")))) blockers.push("IMPORT_WORK_PRESENT");
  if (tables.SecretDeliveryOutbox.some((row) => (["PENDING", "PROCESSING", "UNCERTAIN"].includes(String(row.status)) || (row.sourceScope == null && Number(row.attempts ?? 0) > 0 && row.status !== "DELIVERED")))) blockers.push("DELIVERY_WORK_PRESENT");
  if (tables.BackupRestoreJob.some((row) => /queued|running/i.test(String(row.status)))) blockers.push("BACKUP_WORK_PRESENT");
  return [...new Set(blockers)].sort();
}

export async function assertTenantBackupCatalog(client: Queryable): Promise<void> {
  const actual = await client.query<{ name: string }>(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','f','m') AND NOT c.relispartition AND c.relname <> '_prisma_migrations' ORDER BY c.relname`);
  assertResetCatalog(actual.rows.map((row) => row.name));
  const columns = await client.query<{ name: string; columns: string[] }>(`SELECT c.relname AS name, array_agg(a.attname::text ORDER BY a.attname COLLATE "C") AS columns FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition AND c.relname <> '_prisma_migrations' GROUP BY c.relname`);
  assertResetColumns(Object.fromEntries(columns.rows.map((row) => [row.name, row.columns])));
  const partitions = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND p.relkind IN ('r','p') AND p.relname <> 'AuditLog'`);
  if (partitions.rows[0]?.count !== "0") throw new Error("RESET_CATALOG_UNCLASSIFIED_TABLE");
}

/** Schema metadata is readable by the tenant app role; migration-control rows are not required. */
export async function readTenantBackupSchema(client: Queryable): Promise<string> {
  await assertTenantBackupCatalog(client);
  const columns = await client.query(`SELECT c.relname::text AS table_name, a.attname::text AS column_name, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS required, coalesce(pg_get_expr(d.adbin,d.adrelid),'') AS default_value FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition AND c.relname<>'_prisma_migrations' ORDER BY c.relname COLLATE "C",a.attname COLLATE "C"`);
  const constraints = await client.query<{ validated: boolean }>(`SELECT r.relname::text AS table_name,c.conname::text AS name,pg_get_constraintdef(c.oid) AS definition,c.convalidated AS validated FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND NOT r.relispartition AND r.relname<>'_prisma_migrations' ORDER BY r.relname COLLATE "C",c.conname COLLATE "C"`);
  if (constraints.rows.some(row => !row.validated)) throw new Error("DEVICE_BACKUP_SCHEMA_UNVERIFIED");
  return resetDigest({ columns: columns.rows, constraints: constraints.rows });
}

export async function readResetSnapshot(client: Queryable, tenantId: string, operationId?: string): Promise<TenantResetSnapshot> {
  // Identical raw timestamptz JSON for backup and direct worker transactions.
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  await assertTenantBackupCatalog(client);
  const migrations = await client.query<{ row: string }>('SELECT to_jsonb(t)::text AS row FROM "_prisma_migrations" t ORDER BY migration_name COLLATE "C", id COLLATE "C"');
  const migrationRows = migrations.rows.map((row) => row.row).sort();
  if (!migrationRows.length || migrationRows.some((raw) => { const row = JSON.parse(raw); return row.finished_at == null && row.rolled_back_at == null; })) throw new Error("RESET_SCHEMA_UNVERIFIED");
  const tables = {} as ResetTables;
  const rawTables = {} as Record<TenantResetTable, string[]>;
  for (const name of tenantResetTableNames) {
    const predicate = tenantResetOwnershipPredicate(name);
    const rows = await client.query<{ row: string }>(`SELECT (${name === "PlatformAccount" ? `jsonb_build_object('id', t."id", 'loginName', 'restore-dependency-' || md5(t."id"), 'loginNameNormalized', 'restore-dependency-' || md5(t."id"), 'email', NULL, 'emailNormalized', NULL, 'name', 'Restore dependency', 'passwordHash', '!NON_AUTHENTICATING_RESTORE_DEPENDENCY!', 'passwordHashVersion', 2, 'status', 'SUSPENDED', 'totpSecretEncrypted', NULL, 'totpEnabledAt', NULL, 'createdAt', '1970-01-01T00:00:00+00:00'::timestamptz, 'updatedAt', '1970-01-01T00:00:00+00:00'::timestamptz)` : "to_jsonb(t)"})::text AS row FROM "${name}" t WHERE ${predicate} ORDER BY ${name === "PlatformAccount" ? 't."id"' : 'to_jsonb(t)::text'} COLLATE "C"`, name === "PlatformSession" ? [] : [tenantId]);
    rawTables[name] = rows.rows.map((row) => row.row).sort();
    tables[name] = rawTables[name].map((row) => JSON.parse(row));
  }
  for (const row of tables.SecretDeliveryOutbox) {
    const owned = row.purpose === "PASSWORD_RESET" ? tables.PasswordResetToken.some((token) => token.id === row.sourceId) :
    row.purpose === "IDENTITY_INVITATION" ? tables.IdentityInvitation.some((invitation) => invitation.id === row.sourceId) : false;
    if (!owned || (row.tenantId != null && row.tenantId !== tenantId)) throw new Error("RESET_INDIRECT_OWNERSHIP_UNVERIFIED");
  }
  const tenant = tables.Tenant[0];
  if (!tenant || tables.Tenant.length !== 1) throw new Error("RESET_TENANT_NOT_FOUND");
  if (!Number.isSafeInteger(tenant.lifecycleVersion) || Number(tenant.lifecycleVersion) < 0) throw new Error("RESET_LIFECYCLE_UNVERIFIED");
  const objectOwnerTenants = await client.query<{ id: string }>('SELECT "id" FROM "Tenant"');
  const objectOwnerStudents = await client.query<{ id: string; tenantId: string }>('SELECT "id", "tenantId" FROM "Student"');
  const objectOwners = { tenantIds: objectOwnerTenants.rows.map((row) => row.id), students: objectOwnerStudents.rows };
  const capturedAt = new Date().toISOString();
  const schemaDigest = resetDigest(migrationRows);
  const snapshot = { tenantId, lifecycleVersion: Number(tenant.lifecycleVersion), capturedAt, schemaDigest, tables, rawTables, migrationRows, objectOwners, dataDigest: resetDataDigest(schemaDigest, rawTables, operationId) };
  return snapshot;
}

// Archives retain complete rows; drift comparison excludes only current reset bookkeeping.
export function resetDataDigest(schemaDigest: string, rawTables: Record<TenantResetTable, string[]>, operationId?: string): string {
  const projected = { ...rawTables };
  // Canonical JSON avoids changing raw backup rows or losing unrelated Tenant drift.
  projected.Tenant = rawTables.Tenant.map((raw) => {
    const row = JSON.parse(raw);
    if (row.resetRequest == null) return raw;
    if (operationId && row.resetRequest?.operationId === operationId && row.resetRequest.status === "ACCEPTED") row.resetRequest = { ...row.resetRequest, status: "PENDING", operationId: null };
    return JSON.stringify(row);
  });
  if (!operationId) return resetDigest({ schemaDigest, rawTables: projected });
  projected.TenantFreshResetOperation = rawTables.TenantFreshResetOperation.filter((raw) => JSON.parse(raw).id !== operationId);
  projected.AuditLog = rawTables.AuditLog.filter((raw) => {
    const row = JSON.parse(raw);
    return !(row.entityType === "TenantFreshResetOperation" && row.entityId === operationId &&
      ["tenant.reset.queued", "tenant.reset.phase", "tenant.reset.completed"].includes(row.action));
  });
  return resetDigest({ schemaDigest, rawTables: projected });
}
