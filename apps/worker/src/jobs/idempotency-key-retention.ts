import { createTenantPgPool, deleteExpiredIdempotencyKeys, type TenantQueryable } from "@o-okul/db";
import { workerLogger } from "../observability/logging.js";

const hourMs = 60 * 60 * 1_000;
type Logger = Pick<typeof workerLogger, "info" | "error">;

export async function sweepExpiredIdempotencyKeys(pool: TenantQueryable, logger: Logger = workerLogger, at = new Date()): Promise<number> {
  const deleted = await deleteExpiredIdempotencyKeys(pool, at);
  logger.info({ component: "idempotency-key-retention", deleted }, "idempotency_keys_expired");
  return deleted;
}

// Hourly, so a record lives at most about 25 hours.
export function createIdempotencyKeyRetentionSweeper(options: { pool?: TenantQueryable & { end?(): Promise<void> }; logger?: Logger; intervalMs?: number; env?: NodeJS.ProcessEnv } = {}): { close(): Promise<void> } | undefined {
  const env = options.env ?? process.env;
  if (!options.pool && !env.DATABASE_URL) return undefined;
  const pool = options.pool ?? createTenantPgPool(env.DATABASE_URL);
  const logger = options.logger ?? workerLogger;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  const tick = async () => {
    try { await sweepExpiredIdempotencyKeys(pool, logger); }
    catch { logger.error({ component: "idempotency-key-retention" }, "idempotency_key_retention_failed"); }
    finally { if (!closed) { timer = setTimeout(() => { running = tick(); }, options.intervalMs ?? hourMs); timer.unref?.(); } }
  };
  running = tick();
  return {
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      await running;
      if (!options.pool) await pool.end?.();
    },
  };
}
