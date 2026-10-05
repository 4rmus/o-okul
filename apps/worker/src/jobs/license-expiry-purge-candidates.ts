import { createTenantPgPool, listLicenseExpiryPurgeCandidates, type TenantQueryable } from "@o-okul/db";
import { workerLogger } from "../observability/logging.js";

const dayMs = 24 * 60 * 60 * 1_000;
type Logger = Pick<typeof workerLogger, "info" | "error">;

// DEC-20261005-03: the daily job only reports candidates. It never deletes; each purge needs a
// separate SYSTEM_ADMIN approval (step-up + slug confirmation) on the system management screen.
export async function reportLicenseExpiryPurgeCandidates(pool: TenantQueryable, logger: Logger = workerLogger, at = new Date()): Promise<number> {
  const candidates = await listLicenseExpiryPurgeCandidates(pool, at);
  // Tenant ids and counts only; names and slugs stay on the SYSTEM_ADMIN screen.
  logger.info({ component: "license-expiry-purge", candidateCount: candidates.length, candidates: candidates.map((row) => ({ tenantId: row.tenantId, daysSinceLicenseEnd: row.daysSinceLicenseEnd })) }, "license_expiry_purge_candidates");
  return candidates.length;
}

export function createLicenseExpiryPurgeCandidateReporter(options: { pool?: TenantQueryable & { end?(): Promise<void> }; logger?: Logger; intervalMs?: number; env?: NodeJS.ProcessEnv } = {}): { close(): Promise<void> } | undefined {
  const env = options.env ?? process.env;
  if (!options.pool && !env.DATABASE_URL) return undefined;
  const pool = options.pool ?? createTenantPgPool(env.DATABASE_URL);
  const logger = options.logger ?? workerLogger;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  const tick = async () => {
    try { await reportLicenseExpiryPurgeCandidates(pool, logger); }
    catch { logger.error({ component: "license-expiry-purge" }, "license_expiry_purge_candidates_failed"); }
    finally { if (!closed) { timer = setTimeout(() => { running = tick(); }, options.intervalMs ?? dayMs); timer.unref?.(); } }
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
