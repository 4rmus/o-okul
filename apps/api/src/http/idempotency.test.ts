import { ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import {
  IdempotencyService,
  InMemoryIdempotencyStore,
  PostgresIdempotencyStore,
  createIdempotencyStore,
  hashIdempotencyRequest,
} from "./idempotency.js";

describe("IdempotencyService", () => {
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
