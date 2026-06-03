export type PersistenceDriver = "postgres" | "memory";

/**
 * Single source of truth for choosing between Postgres-backed and in-memory stores.
 *
 * - Production always resolves to "postgres"; per-store and global dev overrides are
 *   ignored so a stray flag can never silently degrade a production deployment to
 *   non-durable, RLS-bypassing in-memory storage.
 * - Outside production the global `PERSISTENCE_DRIVER` (or an optional per-store
 *   override flag) selects the driver, defaulting to "memory" for a frictionless
 *   local/test setup.
 */
export function resolvePersistenceDriver(storeOverride?: string, env = process.env): PersistenceDriver {
  if (env.NODE_ENV === "production") {
    return "postgres";
  }

  const explicit = storeOverride ?? env.PERSISTENCE_DRIVER;
  return explicit === "postgres" ? "postgres" : "memory";
}

/**
 * Boot-time fail-fast guard. Production must be explicitly (or by default) on Postgres
 * and must have a database URL; a contradictory `PERSISTENCE_DRIVER` is rejected up front
 * instead of failing later with data loss or inconsistent reads across replicas.
 */
export function assertPersistenceConfig(env = process.env): void {
  if (env.NODE_ENV !== "production") {
    return;
  }

  if (env.PERSISTENCE_DRIVER !== undefined && env.PERSISTENCE_DRIVER !== "postgres") {
    throw new Error(`PERSISTENCE_DRIVER must be "postgres" in production (got "${env.PERSISTENCE_DRIVER}").`);
  }

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production for durable persistence.");
  }
}
