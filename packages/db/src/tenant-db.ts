export interface Queryable {
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export interface TenantQueryable extends Queryable {
  connect?: () => Promise<TenantQueryClient>;
}

interface TenantQueryClient extends Queryable {
  release(): void;
}

export interface TenantDbContext {
  tenantId: string | null;
  bypassRls?: boolean;
}

export async function withTenantDb<T>(
  pool: TenantQueryable,
  context: TenantDbContext,
  callback: (client: Queryable) => Promise<T>,
): Promise<T> {
  if (!context.tenantId && !context.bypassRls) {
    throw new Error("TENANT_CONTEXT_MISSING");
  }

  if (!pool.connect) {
    await applyTenantSettings(pool, context);
    return callback(pool);
  }

  const client = await pool.connect();
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
    client.release();
  }
}

async function applyTenantSettings(client: Queryable, context: TenantDbContext): Promise<void> {
  await client.query("SELECT set_config('app.bypass_rls', $1, true)", [context.bypassRls ? "true" : "false"]);
  if (context.tenantId) {
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [context.tenantId]);
  }
}
