import { describe, expect, it, vi } from "vitest";
import { createIdempotencyKeyRetentionSweeper, sweepExpiredIdempotencyKeys } from "./idempotency-key-retention.js";

const now = new Date("2026-10-13T12:00:00.000Z");
function fakePool() {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const db = { async query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
    calls.push({ sql: sql.trim(), values });
    return { rows: (sql.includes('DELETE FROM "IdempotencyKey"') ? [{ count: "3" }] : []) as T[] };
  }, release() {} };
  return { calls, pool: { query: db.query, connect: async () => db } };
}

describe("idempotency key retention", () => {
  it("deletes records created more than 24 hours ago across tenants", async () => {
    const { calls, pool } = fakePool();
    const logger = { info: vi.fn(), error: vi.fn() };
    expect(await sweepExpiredIdempotencyKeys(pool, logger as never, now)).toBe(3);
    const deleteCall = calls.find((call) => call.sql.includes('DELETE FROM "IdempotencyKey"'))!;
    expect(deleteCall.sql).toContain('"createdAt" < $1');
    expect(deleteCall.values).toEqual([new Date("2026-10-12T12:00:00.000Z")]);
    expect(calls.some((call) => /app\.bypass_rls/.test(call.sql) || (call.values ?? []).includes("true"))).toBe(true);
    expect(logger.info).toHaveBeenCalledWith({ component: "idempotency-key-retention", deleted: 3 }, "idempotency_keys_expired");
  });

  it("is disabled without a database and keeps running after a failed sweep", async () => {
    expect(createIdempotencyKeyRetentionSweeper({ env: {} })).toBeUndefined();
    const logger = { info: vi.fn(), error: vi.fn() };
    const sweeper = createIdempotencyKeyRetentionSweeper({ pool: { query: async () => { throw new Error("db down"); } }, logger: logger as never, intervalMs: 60_000 })!;
    await sweeper.close();
    expect(logger.error).toHaveBeenCalledWith({ component: "idempotency-key-retention" }, "idempotency_key_retention_failed");
  });
});
