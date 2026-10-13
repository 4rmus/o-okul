import { withTenantDb, type TenantQueryable } from "./tenant-db.js";

// Product decision 2026-10-13 (docs/idempotency-kapsam-plani.md): a replay record, including the
// cached responseBody that may hold personal data, is kept 24 hours. createdAt is the clock, so rows
// written before this change (expiresAt was never set) expire too.
export const idempotencyKeyRetentionMs = 24 * 60 * 60 * 1_000;

// ponytail: plain DELETE without a createdAt index; the table holds about one day of keys. Add an
// index on "createdAt" if the hourly sweep shows up in slow-query logs.
export async function deleteExpiredIdempotencyKeys(pool: TenantQueryable, at = new Date()): Promise<number> {
  return withTenantDb(pool, { tenantId: null, bypassRls: true }, async (db) => {
    const result = await db.query<{ count: string }>(
      `WITH deleted AS (DELETE FROM "IdempotencyKey" WHERE "createdAt" < $1 RETURNING 1)
       SELECT count(*)::text AS count FROM deleted`,
      [new Date(at.getTime() - idempotencyKeyRetentionMs)],
    );
    return Number(result.rows[0]?.count ?? 0);
  });
}
