import { getRequestContext } from "../context/request-context.js";

export interface Queryable {
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface TenantQueryable extends Queryable {
  connect?: () => Promise<TenantQueryClient>;
}

interface TenantQueryClient extends Queryable {
  release(): void;
}

export async function withTenantQuery<T>(
  pool: TenantQueryable,
  callback: (client: Queryable) => Promise<T>,
): Promise<T> {
  const context = getRequestContext();
  if (!context.tenantId && !context.bypassRls) {
    throw new Error("TENANT_CONTEXT_MISSING");
  }

  return runInTenantTransaction(pool, context, callback);
}

export async function withExplicitTenantQuery<T>(
  pool: TenantQueryable,
  tenantId: string,
  callback: (client: Queryable) => Promise<T>,
): Promise<T> {
  return runInTenantTransaction(pool, { tenantId, bypassRls: false }, callback);
}

export async function withBypassRlsQuery<T>(
  pool: TenantQueryable,
  callback: (client: Queryable) => Promise<T>,
): Promise<T> {
  return runInTenantTransaction(pool, { tenantId: null, bypassRls: true }, callback);
}

async function runInTenantTransaction<T>(
  pool: TenantQueryable,
  context: { tenantId: string | null; bypassRls: boolean },
  callback: (client: Queryable) => Promise<T>,
): Promise<T> {
  // Acquire a dedicated client when the pool supports it; otherwise treat the
  // provided Queryable as a single connection (or test double). Either way the
  // work runs inside an explicit transaction so the transaction-local
  // set_config() GUCs apply to the callback's queries instead of being
  // discarded by autocommit before they take effect.
  const client = pool.connect ? await pool.connect() : pool;
  const release = pool.connect ? () => (client as TenantQueryClient).release() : undefined;
  try {
    await client.query("BEGIN");
    await applyTenantSettings(client, context);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    release?.();
  }
}

async function applyTenantSettings(
  client: Queryable,
  context: { tenantId: string | null; bypassRls: boolean },
): Promise<void> {
  await client.query("SELECT set_config('app.bypass_rls', $1, true)", [context.bypassRls ? "true" : "false"]);
  if (context.tenantId) {
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [context.tenantId]);
  }
}
