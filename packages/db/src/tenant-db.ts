export interface Queryable {
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export interface TenantQueryable extends Queryable {
  connect?: () => Promise<TenantQueryClient>;
}

interface TenantQueryClient extends Queryable {
  release(destroy?: boolean): void;
}

export interface TenantDbContext {
  tenantId: string | null;
  bypassRls?: boolean;
  /** Enforced by PostgreSQL; reserved for polling reset metadata during the exclusive lock. */
  readOnly?: boolean;
}

export async function withTenantDb<T>(
  pool: TenantQueryable,
  context: TenantDbContext,
  callback: (client: Queryable) => Promise<T>,
): Promise<T> {
  assertTenantDbContext(context);

  if (!pool.connect) {
    // Legacy adapters are not covered by the connection-bound advisory fence.
    if (context.readOnly) throw new Error("TENANT_DB_TRANSACTION_REQUIRED");
    await applyTenantSettings(pool, context);
    return callback(pool);
  }

  const client = await pool.connect();
  let discard = false;
  try {
    await client.query(context.readOnly ? "BEGIN READ ONLY" : "BEGIN");
    if (context.tenantId && !context.readOnly) await acquireTenantDatabaseSharedLock(client, context.tenantId);
    await applyTenantSettings(client, context);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { discard = true; }
    throw error;
  } finally {
    client.release(discard || undefined);
  }
}

async function applyTenantSettings(client: Queryable, context: TenantDbContext): Promise<void> {
  await client.query("SELECT set_config('app.bypass_rls', $1, true)", [context.bypassRls ? "true" : "false"]);
  if (context.tenantId) {
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [context.tenantId]);
  }
}

export function assertTenantDbContext(context: TenantDbContext): void {
  if (context.bypassRls !== undefined && typeof context.bypassRls !== "boolean") throw new Error("TENANT_CONTEXT_INVALID");
  if (context.readOnly !== undefined && typeof context.readOnly !== "boolean") throw new Error("TENANT_CONTEXT_INVALID");
  if (context.tenantId === null && context.bypassRls === true) return;
  tenantDatabaseLockKey(context.tenantId as string);
}
export function tenantDatabaseLockKey(tenantId: string): string {
  if (typeof tenantId !== "string" || !tenantId || tenantId.trim() !== tenantId) throw new Error("TENANT_CONTEXT_MISSING");
  return `tenant-database:${tenantId}`;
}
/** Call only after BEGIN on a dedicated connection; COMMIT/ROLLBACK releases the shared lock. */
export async function acquireTenantDatabaseSharedLock(db: Queryable, tenantId: string): Promise<void> {
  const result = await db.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock_shared(hashtextextended($1, 0)) AS locked", [tenantDatabaseLockKey(tenantId)]);
  if (result.rows[0]?.locked !== true) throw new Error("TENANT_DATABASE_BUSY");
}
