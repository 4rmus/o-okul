import { ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { type RequestContext, runWithRequestContext } from "../context/request-context.js";
import {
  IdempotencyService,
  InMemoryIdempotencyStore,
  PostgresIdempotencyStore,
  createIdempotencyStore,
  hashIdempotencyRequest,
} from "./idempotency.js";

describe("IdempotencyService", () => {
  it("completes the key on the caller's transaction and skips the separate completion", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('INSERT INTO "IdempotencyKey"')) return { rows: [{ requestHash: "x", status: "IN_PROGRESS", responseBody: null }] as T[] };
        return { rows: [] as T[] };
      },
    };
    const store = new PostgresIdempotencyStore(pool);
    const service = new IdempotencyService(store);
    const transaction = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql: `tx:${sql}`, values });
        return { rows: (sql.includes('UPDATE "IdempotencyKey"') ? [{ key: "import-1" }] : []) as T[] };
      },
    };

    const body = await runWithRequestContext(context, () => service.run(
      context,
      { key: "import-1", operation: "student.import.commit", request: { fileSha256: "a" } },
      async (completion) => {
        await completion!.complete(transaction, { importedRows: 1 });
        return { importedRows: 1 };
      },
    ));

    expect(body).toEqual({ importedRows: 1 });
    const transactional = queries.filter((query) => query.sql.startsWith("tx:"));
    expect(transactional.map((query) => query.sql.replace(/\s+/g, " ").slice(0, 60))).toEqual([
      "tx:SELECT set_config('app.bypass_rls', $1, true)",
      "tx:SELECT set_config('app.current_tenant_id', $1, true)",
      expect.stringContaining('tx:UPDATE "IdempotencyKey"'),
    ]);
    expect(transactional[2]?.sql).toContain(`"status" = 'IN_PROGRESS'`);
    expect(transactional[2]?.values?.[4]).toBe(JSON.stringify({ importedRows: 1 }));
    expect(queries.filter((query) => !query.sql.startsWith("tx:") && query.sql.includes('UPDATE "IdempotencyKey"'))).toHaveLength(0);
  });

  it("answers 409 IDEMPOTENCY_KEY_COMPLETION_CONFLICT when the IN_PROGRESS row is gone at in-transaction completion", async () => {
    const store = new PostgresIdempotencyStore({ async query<T>() { return { rows: [] as T[] }; } });
    const transaction = { async query<T>() { return { rows: [] as T[] }; } };

    await expect(store.completeInTransaction(transaction, {
      tenantId: "tenant-a", key: "import-1", operation: "student.import.commit", requestHash: "x", responseBody: {},
    })).rejects.toMatchObject({ status: 409, message: "IDEMPOTENCY_KEY_COMPLETION_CONFLICT" });
  });

  it("replays a completed response for the same key and request body", async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStore());
    let calls = 0;

    const first = await service.run(context, { key: "payment-create-1", operation: "payment.plan.create", request: { amount: 1 } }, async () => {
      calls += 1;
      return { id: "payment-plan-1", amount: 1 };
    });
    const second = await service.run(context, { key: "payment-create-1", operation: "payment.plan.create", request: { amount: 1 } }, async () => {
      calls += 1;
      return { id: "payment-plan-2", amount: 1 };
    });

    expect(first).toEqual({ id: "payment-plan-1", amount: 1 });
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });

  it("rejects a reused key with a different request body", async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStore());
    await service.run(context, { key: "payment-create-2", operation: "payment.plan.create", request: { amount: 1 } }, async () => ({ ok: true }));

    await expect(
      service.run(context, { key: "payment-create-2", operation: "payment.plan.create", request: { amount: 2 } }, async () => ({ ok: false })),
    ).rejects.toThrow(ConflictException);
  });

  it("releases a failed reservation so the same request can be retried", async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStore());
    await expect(
      service.run(context, { key: "payment-create-3", operation: "payment.plan.create", request: { amount: 1 } }, async () => {
        throw new Error("BROKEN");
      }),
    ).rejects.toThrow("BROKEN");

    await expect(
      service.run(context, { key: "payment-create-3", operation: "payment.plan.create", request: { amount: 1 } }, async () => ({ ok: true })),
    ).resolves.toEqual({ ok: true });
  });

  it("hashes request bodies canonically", () => {
    expect(hashIdempotencyRequest("payment.plan.create", { b: 2, a: { d: 4, c: 3 } })).toBe(
      hashIdempotencyRequest("payment.plan.create", { a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("requires a durable store in production", () => {
    expect(createIdempotencyStore({ PERSISTENCE_DRIVER: "postgres" })).toBeInstanceOf(PostgresIdempotencyStore);
    expect(() => createIdempotencyStore({ NODE_ENV: "production", IDEMPOTENCY_STORE: "memory" })).toThrow(
      'IDEMPOTENCY_STORE must be "postgres" in production.',
    );
  });
});

const context: RequestContext = {
  userId: "user-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  bypassRls: false,
};
