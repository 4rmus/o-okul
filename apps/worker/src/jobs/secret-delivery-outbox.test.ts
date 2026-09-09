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
    const sendBatch = vi.fn(async () => [{ channel: "EMAIL" as const, to: "user@example.test", status: "sent" as const, providerMessageId: "provider-1" }]);

    await expect(processNextSecretDelivery(store, { sendBatch }, env, new Date("2026-08-01T12:00:00.000Z"))).resolves.toBe(true);
    expect(sendBatch).toHaveBeenCalledWith([expect.objectContaining({ body: "secret-link" })]);
    expect(sendBatch).toHaveBeenCalledWith([expect.objectContaining({ idempotencyKey: "secret-delivery:outbox-1" })]);
    expect(store.markDelivered).toHaveBeenCalledWith("outbox-1", "claim-1", new Date("2026-08-01T12:00:00.000Z"), "provider-1");
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it("sağlayıcı hatasını secret veya e-posta olmadan belirsiz olarak yazar", async () => {
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

  it.each(["TENANT", "SYSTEM"] as const)("claims %s provenance once and persists provider receipt", async (scope) => {
    const f = postgresFixture({ sourceScope: scope, tenantId: scope === "TENANT" ? "tenant-a" : null, tenantLifecycleVersion: scope === "TENANT" ? 2 : null });
    const sendBatch = vi.fn(async () => [{ channel: "EMAIL" as const, to: "user@example.test", status: "sent" as const, providerMessageId: "provider-1" }]);
    await processNextSecretDelivery(f.store, { sendBatch }, env);
    await processNextSecretDelivery(f.store, { sendBatch }, env);
    expect(sendBatch).toHaveBeenCalledTimes(1); expect(f.row.status).toBe("DELIVERED"); expect(f.row.providerMessageId).toBe("provider-1"); expect(f.row.payloadEncrypted).toBeNull();
    expect(f.calls.some((call) => call.sql.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);
  });
  it.each(["failed", "missing-receipt", "wrong-recipient", "reject"])("%s outcome stays uncertain and is never automatically resent", async (mode) => {
    const f = postgresFixture();
    const sendBatch = vi.fn(async () => { if (mode === "reject") throw new Error("TIMEOUT"); return [{ channel: "EMAIL" as const, to: mode === "wrong-recipient" ? "other@example.test" : "user@example.test", status: mode === "failed" ? "failed" as const : "sent" as const, providerMessageId: mode === "missing-receipt" ? undefined : "provider-1" }]; });
    await processNextSecretDelivery(f.store, { sendBatch }, env);
    await processNextSecretDelivery(f.store, { sendBatch }, env, new Date(Date.now() + 24 * 60 * 60 * 1000));
    expect(sendBatch).toHaveBeenCalledTimes(1); expect(f.row.status).toBe("UNCERTAIN");
    expect(f.calls.some((call) => /claimedAt.*</.test(call.sql))).toBe(false);
  });
  it("lost delivery ACK retains the known receipt on uncertainty without resending", async () => {
    const f = postgresFixture(); f.failDeliveryAck();
    const sendBatch = vi.fn(async () => [{ channel: "EMAIL" as const, to: "user@example.test", status: "sent" as const, providerMessageId: "provider-ack" }]);
    await processNextSecretDelivery(f.store, { sendBatch }, env); await processNextSecretDelivery(f.store, { sendBatch }, env);
    expect(f.row.status).toBe("UNCERTAIN"); expect(f.row.providerMessageId).toBe("provider-ack"); expect(sendBatch).toHaveBeenCalledTimes(1);
  });
  it("legacy/attempted pending records are never stamped current and inactive tenant cannot send", async () => {
    for (const override of [{ sourceScope: null, tenantLifecycleVersion: null }, { attempts: 1 }, { sourceScope: "TENANT", tenantLifecycleVersion: 1 }]) {
      const f = postgresFixture(override); const sendBatch = vi.fn(async () => []);
      await processNextSecretDelivery(f.store, { sendBatch }, env); expect(sendBatch).not.toHaveBeenCalled();
      expect(f.calls.some((call) => call.sql.includes('SET "sourceScope"') || call.sql.includes('SET "tenantLifecycleVersion"'))).toBe(false);
    }
    const f = postgresFixture(); f.tenant.status = "SUSPENDED"; const sendBatch = vi.fn(async () => []);
    await processNextSecretDelivery(f.store, { sendBatch }, env); expect(sendBatch).not.toHaveBeenCalled();
  });
  it("expiry can redact attempted ciphertext but cannot turn attempted pending into safe EXPIRED", async () => {
    const f = postgresFixture({ attempts: 1 });
    await f.store.claimNext(new Date(Date.now() + 24 * 60 * 60 * 1000));
    expect(f.row.payloadEncrypted).toBeNull(); expect(f.row.status).toBe("UNCERTAIN");
  });
  it("changed claimed provenance is rejected before provider", async () => {
    const f = postgresFixture(); f.mismatchClaim(); const sendBatch = vi.fn(async () => []);
    await expect(processNextSecretDelivery(f.store, { sendBatch }, env)).rejects.toThrow("SECRET_DELIVERY_PROVENANCE_UNVERIFIED"); expect(sendBatch).not.toHaveBeenCalled();
  });

});

function fakeStore(record: Awaited<ReturnType<SecretDeliveryOutboxStore["claimNext"]>>): SecretDeliveryOutboxStore {
  return {
    claimNext: vi.fn(async () => record ? { tenantId: "tenant-a", sourceScope: "TENANT" as const, tenantLifecycleVersion: 2, ...record, claimToken: "claim-1" } : undefined),
    markDelivered: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
  };
}

function postgresFixture(override: Record<string, unknown> = {}) {
  const row: Record<string, any> = { id: "outbox-a", tenantId: "tenant-a", sourceScope: "TENANT", tenantLifecycleVersion: 2, purpose: "PASSWORD_RESET", attempts: 0, claimToken: null, status: "PENDING", expiresAt: new Date(Date.now() + 60_000), payloadEncrypted: encryptSecretDeliveryPayload({ channel: "EMAIL", to: "user@example.test", subject: "Reset", body: "private" }, env), ...override };
  const tenant = { status: "ACTIVE", lifecycleVersion: 2 }; const calls: Array<{ sql: string; values: unknown[] }> = []; let failAck = false, mismatch = false;
  const db = { async query<T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    calls.push({ sql, values }); const rows = (items: unknown[]) => ({ rows: items as T[] });
    if (sql.includes("pg_try_advisory_xact_lock_shared")) return rows([{ locked: true }]);
    if (sql.includes('FROM "Tenant" WHERE')) return rows([tenant]);
    if (sql.startsWith('SELECT o."id"')) return rows(row.status === "PENDING" && row.attempts === 0 && row.payloadEncrypted && row.expiresAt > (values[0] as Date) && (row.sourceScope === "SYSTEM" || (row.sourceScope === "TENANT" && row.tenantLifecycleVersion === tenant.lifecycleVersion && tenant.status === "ACTIVE")) ? [{ ...row }] : []);
    if (sql.startsWith('SELECT "id"') && sql.includes('"expiresAt" <= $1')) return rows(row.sourceScope && row.payloadEncrypted && row.expiresAt <= (values[0] as Date) ? [{ ...row }] : []);
    if (sql.includes('FROM "SecretDeliveryOutbox"') && sql.includes('"claimToken" = $2')) return rows(row.id === values[0] && row.claimToken === values[1] && ["PROCESSING", "UNCERTAIN"].includes(row.status) ? [{ ...row }] : []);
    if (sql.includes("FOR UPDATE SKIP LOCKED")) return rows(row.status === "PENDING" ? [{ id: row.id }] : []);
    if (sql.startsWith('UPDATE "SecretDeliveryOutbox" SET "status" = \'PROCESSING\'')) { Object.assign(row, { status: "PROCESSING", attempts: 1, claimToken: values[2] }); return rows([{ ...row, ...(mismatch ? { tenantId: "other" } : {}) }]); }
    if (sql.startsWith('UPDATE "SecretDeliveryOutbox" SET "status" = \'DELIVERED\'')) { if (failAck) throw new Error("ACK_LOST"); if (row.claimToken !== values[1] || row.status !== "PROCESSING") return rows([]); Object.assign(row, { status: "DELIVERED", providerMessageId: values[3], payloadEncrypted: null, claimToken: null }); return rows([{ id: row.id }]); }
    if (sql.startsWith('UPDATE "SecretDeliveryOutbox" SET "status" = \'UNCERTAIN\'')) { if (row.claimToken !== values[1]) return rows([]); Object.assign(row, { status: "UNCERTAIN", providerMessageId: values[4] ?? row.providerMessageId }); return rows([{ id: row.id }]); }
    if (sql.startsWith('UPDATE "SecretDeliveryOutbox" SET "payloadEncrypted"')) { row.payloadEncrypted = null; row.status = row.status === "PENDING" && row.attempts === 0 ? "EXPIRED" : ["PENDING", "PROCESSING", "UNCERTAIN"].includes(row.status) ? "UNCERTAIN" : row.status; }
    return rows([]);
  }, release() {} };
  return { row, tenant, calls, store: new PostgresSecretDeliveryOutboxStore({ query: db.query, connect: async () => db }), failDeliveryAck() { failAck = true; }, mismatchClaim() { mismatch = true; } };
}
