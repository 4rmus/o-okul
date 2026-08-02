import { describe, expect, it, vi } from "vitest";
import { encryptSecretDeliveryPayload } from "@o-okul/db";
import {
  assertSecretDeliveryOutboxDatabaseConfig,
  PostgresSecretDeliveryOutboxStore,
  processNextSecretDelivery,
  type SecretDeliveryOutboxStore,
} from "./secret-delivery-outbox.js";

const env = { NODE_ENV: "production", SECRET_DELIVERY_ENCRYPTION_KEY: "secret-delivery-key-32-characters-minimum" } as NodeJS.ProcessEnv;

describe("secret delivery outbox", () => {
  it("production'da ayrı worker DSN'i yoksa fail-closed davranır", () => {
    expect(() => assertSecretDeliveryOutboxDatabaseConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://app:real-password@postgres:5432/o_okul",
    } as NodeJS.ProcessEnv)).toThrow("SECRET_DELIVERY_OUTBOX_DATABASE_URL_REQUIRED");
  });

  it("production'da app rolünü ayrı DSN gibi kabul etmez", () => {
    expect(() => assertSecretDeliveryOutboxDatabaseConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://app:real-password@postgres:5432/o_okul",
      SECRET_DELIVERY_OUTBOX_DATABASE_URL: "postgresql://app:another-password@postgres:5432/o_okul",
    } as NodeJS.ProcessEnv)).toThrow("SECRET_DELIVERY_OUTBOX_DATABASE_ROLE_REQUIRED");
  });

  it("production'da ana DSN ile aynı worker DSN'ini reddeder", () => {
    const databaseUrl = "postgresql://secret_delivery_worker:worker-password@postgres:5432/o_okul";
    expect(() => assertSecretDeliveryOutboxDatabaseConfig({
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl,
      SECRET_DELIVERY_OUTBOX_DATABASE_URL: databaseUrl,
    } as NodeJS.ProcessEnv)).toThrow("SECRET_DELIVERY_OUTBOX_DATABASE_URL_MUST_DIFFER");
  });

  it("production'da secret_delivery_worker rolüne ait ayrı DSN'i kabul eder", () => {
    expect(() => assertSecretDeliveryOutboxDatabaseConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://app:real-password@postgres:5432/o_okul",
      SECRET_DELIVERY_OUTBOX_DATABASE_URL: "postgresql://secret_delivery_worker:worker-password@postgres:5432/o_okul",
    } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it("şifreli payload'u sağlayıcıya gönderip terminal durumda secret'ı temizletir", async () => {
    const payloadEncrypted = encryptSecretDeliveryPayload({
      channel: "EMAIL",
      to: "user@example.test",
      subject: "Aktivasyon",
      body: "secret-link",
    }, env);
    const store = fakeStore({ id: "outbox-1", purpose: "IDENTITY_INVITATION", payloadEncrypted, attempts: 1, claimToken: "unused" });
    const sendBatch = vi.fn(async () => [{ channel: "EMAIL" as const, to: "user@example.test", status: "sent" as const }]);

    await expect(processNextSecretDelivery(store, { sendBatch }, env, new Date("2026-08-01T12:00:00.000Z"))).resolves.toBe(true);
    expect(sendBatch).toHaveBeenCalledWith([expect.objectContaining({ body: "secret-link" })]);
    expect(sendBatch).toHaveBeenCalledWith([expect.objectContaining({ idempotencyKey: "secret-delivery:outbox-1" })]);
    expect(store.markDelivered).toHaveBeenCalledWith("outbox-1", "claim-1", new Date("2026-08-01T12:00:00.000Z"));
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it("sağlayıcı hatasını secret veya e-posta olmadan retry durumuna yazar", async () => {
    const payloadEncrypted = encryptSecretDeliveryPayload({
      channel: "EMAIL",
      to: "user@example.test",
      subject: "Reset",
      body: "secret-reset-link",
    }, env);
    const store = fakeStore({ id: "outbox-2", purpose: "PASSWORD_RESET", payloadEncrypted, attempts: 2, claimToken: "unused" });
    const adapter = { sendBatch: vi.fn(async () => [{ channel: "EMAIL" as const, to: "user@example.test", status: "failed" as const, errorCode: "HTTP_503" }]) };

    await processNextSecretDelivery(store, adapter, env, new Date("2026-08-01T12:00:00.000Z"));
    expect(store.markFailed).toHaveBeenCalledWith("outbox-2", expect.objectContaining({ attempts: 2, claimToken: "claim-1", errorCode: "SECRET_DELIVERY_PROVIDER_FAILED" }));
    expect(JSON.stringify(vi.mocked(store.markFailed).mock.calls)).not.toContain("user@example.test");
    expect(JSON.stringify(vi.mocked(store.markFailed).mock.calls)).not.toContain("secret-reset-link");
  });

  it("claim sorgusunda expiry purge ve SKIP LOCKED kullanır", async () => {
    const queries: string[] = [];
    const pool = {
      async query<T>(sql: string) {
        queries.push(sql);
        return { rows: [] as T[] };
      },
    };
    const store = new PostgresSecretDeliveryOutboxStore(pool);

    await expect(store.claimNext(new Date("2026-08-01T12:00:00.000Z"))).resolves.toBeUndefined();
    expect(queries[0]).toContain("FOR UPDATE SKIP LOCKED");
    expect(queries[0]).toContain(`"status" = 'EXPIRED'`);
    expect(queries[0]).toContain(`"payloadEncrypted" = NULL`);
  });

  it("completion sorgusunu yalnız claim sahibine sınırlar", async () => {
    const queries: Array<{ sql: string; values: unknown[] | undefined }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return { rows: [] as T[] };
      },
    };
    const store = new PostgresSecretDeliveryOutboxStore(pool);

    await store.markDelivered("outbox-3", "claim-current", new Date("2026-08-01T12:00:00.000Z"));
    await store.markFailed("outbox-3", { attempts: 1, claimToken: "claim-current", errorCode: "NOTIFICATION_HTTP_503", now: new Date("2026-08-01T12:00:00.000Z") });

    expect(queries[0]?.sql).toContain(`"claimToken" = $2`);
    expect(queries[0]?.values).toEqual(["outbox-3", "claim-current", expect.any(Date)]);
    expect(queries[1]?.sql).toContain(`"claimToken" = $6`);
    expect(queries[1]?.values).toEqual(["outbox-3", "PENDING", expect.any(Date), "NOTIFICATION_HTTP_503", expect.any(Date), "claim-current"]);
  });
});

function fakeStore(record: Awaited<ReturnType<SecretDeliveryOutboxStore["claimNext"]>>): SecretDeliveryOutboxStore {
  return {
    claimNext: vi.fn(async () => record ? { ...record, claimToken: "claim-1" } : undefined),
    markDelivered: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
  };
}
