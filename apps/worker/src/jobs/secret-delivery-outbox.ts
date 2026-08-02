import { createTenantPgPool, decryptSecretDeliveryPayload, type TenantQueryable } from "@o-okul/db";
import { createNotificationAdapterFromEnv, type NotificationAdapter } from "@o-okul/notification-adapter";
import { randomUUID } from "node:crypto";
import { workerLogger } from "../observability/logging.js";

export interface SecretDeliveryOutboxRecord {
  id: string;
  purpose: "IDENTITY_INVITATION" | "PASSWORD_RESET";
  payloadEncrypted: string;
  attempts: number;
  claimToken: string;
}

export interface SecretDeliveryOutboxStore {
  claimNext(now: Date): Promise<SecretDeliveryOutboxRecord | undefined>;
  markDelivered(id: string, claimToken: string, deliveredAt: Date): Promise<void>;
  markFailed(id: string, input: { attempts: number; claimToken: string; errorCode: string; now: Date }): Promise<void>;
}

export class PostgresSecretDeliveryOutboxStore implements SecretDeliveryOutboxStore {
  constructor(private readonly pool: TenantQueryable = createTenantPgPool(resolveSecretDeliveryOutboxDatabaseUrl())) {}

  async claimNext(now: Date): Promise<SecretDeliveryOutboxRecord | undefined> {
    const staleBefore = new Date(now.getTime() - 5 * 60 * 1000);
    const claimToken = randomUUID();
    const result = await this.pool.query<SecretDeliveryOutboxRow>(
      `WITH expired AS (
         UPDATE "SecretDeliveryOutbox"
         SET "status" = 'EXPIRED',
             "payloadEncrypted" = NULL,
             "claimedAt" = NULL,
             "claimToken" = NULL,
             "lastErrorCode" = NULL,
             "updatedAt" = $1
         WHERE "payloadEncrypted" IS NOT NULL
           AND "expiresAt" <= $1
         RETURNING "id"
       ), candidate AS (
         SELECT "id"
         FROM "SecretDeliveryOutbox"
         WHERE "payloadEncrypted" IS NOT NULL
           AND "expiresAt" > $1
           AND (
             ("status" = 'PENDING' AND "availableAt" <= $1)
             OR ("status" = 'PROCESSING' AND "claimedAt" < $2)
           )
         ORDER BY "availableAt" ASC, "createdAt" ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE "SecretDeliveryOutbox" outbox
       SET "status" = 'PROCESSING',
           "attempts" = outbox."attempts" + 1,
           "claimedAt" = $1,
           "claimToken" = $3,
           "updatedAt" = $1
       FROM candidate
       WHERE outbox."id" = candidate."id"
       RETURNING outbox."id", outbox."purpose", outbox."payloadEncrypted", outbox."attempts", outbox."claimToken"`,
      [now, staleBefore, claimToken],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async markDelivered(id: string, claimToken: string, deliveredAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE "SecretDeliveryOutbox"
       SET "status" = 'DELIVERED',
           "payloadEncrypted" = NULL,
           "claimedAt" = NULL,
           "claimToken" = NULL,
           "deliveredAt" = $3,
           "lastErrorCode" = NULL,
           "updatedAt" = $3
       WHERE "id" = $1 AND "status" = 'PROCESSING' AND "claimToken" = $2`,
      [id, claimToken, deliveredAt],
    );
  }

  async markFailed(id: string, input: { attempts: number; claimToken: string; errorCode: string; now: Date }): Promise<void> {
    const terminal = input.attempts >= 5;
    const availableAt = new Date(input.now.getTime() + Math.min(60, 2 ** input.attempts) * 1000);
    await this.pool.query(
      `UPDATE "SecretDeliveryOutbox"
       SET "status" = $2,
           "payloadEncrypted" = CASE WHEN $2 = 'FAILED' THEN NULL ELSE "payloadEncrypted" END,
           "claimedAt" = NULL,
           "claimToken" = NULL,
           "availableAt" = $3,
           "lastErrorCode" = $4,
           "updatedAt" = $5
       WHERE "id" = $1 AND "status" = 'PROCESSING' AND "claimToken" = $6`,
      [id, terminal ? "FAILED" : "PENDING", availableAt, input.errorCode, input.now, input.claimToken],
    );
  }
}

export async function processNextSecretDelivery(
  store: SecretDeliveryOutboxStore,
  adapter: NotificationAdapter,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Promise<boolean> {
  const record = await store.claimNext(now);
  if (!record) return false;

  try {
    const payload = decryptSecretDeliveryPayload(record.payloadEncrypted, env);
    const [result] = await adapter.sendBatch([{ ...payload, idempotencyKey: `secret-delivery:${record.id}` }]);
    if (result?.status !== "sent") {
      await store.markFailed(record.id, {
        attempts: record.attempts,
        claimToken: record.claimToken,
        errorCode: safeProviderErrorCode(result?.errorCode),
        now,
      });
      return true;
    }
    await store.markDelivered(record.id, record.claimToken, now);
  } catch (error) {
    await store.markFailed(record.id, {
      attempts: record.attempts,
      claimToken: record.claimToken,
      errorCode: safeErrorCode(error),
      now,
    });
  }
  return true;
}

export function createSecretDeliveryOutboxRunner(options: {
  store?: SecretDeliveryOutboxStore;
  adapter?: NotificationAdapter;
  env?: NodeJS.ProcessEnv;
  pollIntervalMs?: number;
} = {}): { close(): Promise<void> } {
  const env = options.env ?? process.env;
  const store = options.store ?? new PostgresSecretDeliveryOutboxStore(
    createTenantPgPool(resolveSecretDeliveryOutboxDatabaseUrl(env)),
  );
  const adapter = options.adapter ?? createNotificationAdapterFromEnv(env);
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = Promise.resolve();

  const tick = async () => {
    try {
      for (let processed = 0; processed < 20; processed += 1) {
        if (!await processNextSecretDelivery(store, adapter, env)) break;
      }
    } catch {
      workerLogger.error({ component: "secret-delivery-outbox" }, "secret_delivery_outbox_poll_failed");
    } finally {
      if (!closed) timer = setTimeout(() => { running = tick(); }, pollIntervalMs);
    }
  };
  running = tick();

  return {
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}

export function assertSecretDeliveryOutboxDatabaseConfig(env: NodeJS.ProcessEnv = process.env): void {
  resolveSecretDeliveryOutboxDatabaseUrl(env);
}

interface SecretDeliveryOutboxRow {
  id: string;
  purpose: "IDENTITY_INVITATION" | "PASSWORD_RESET";
  payloadEncrypted: string;
  attempts: number;
  claimToken: string;
}

function toRecord(row: SecretDeliveryOutboxRow): SecretDeliveryOutboxRecord {
  return { ...row };
}

function safeErrorCode(error: unknown): string {
  return error instanceof Error && error.message === "NOTIFICATION_HTTP_RESPONSE_INVALID"
    ? "NOTIFICATION_HTTP_RESPONSE_INVALID"
    : "SECRET_DELIVERY_FAILED";
}

function safeProviderErrorCode(errorCode: string | undefined): string {
  return providerErrorCodes.has(errorCode ?? "") ? errorCode! : "SECRET_DELIVERY_PROVIDER_FAILED";
}

const providerErrorCodes = new Set([
  "DEVICE_TOKEN_INVALID",
  "NOTIFICATION_HTTP_400",
  "NOTIFICATION_HTTP_401",
  "NOTIFICATION_HTTP_403",
  "NOTIFICATION_HTTP_408",
  "NOTIFICATION_HTTP_409",
  "NOTIFICATION_HTTP_429",
  "NOTIFICATION_HTTP_500",
  "NOTIFICATION_HTTP_502",
  "NOTIFICATION_HTTP_503",
  "NOTIFICATION_HTTP_504",
  "NOTIFICATION_PROVIDER_FAILED",
]);

function resolveSecretDeliveryOutboxDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const dedicatedUrl = env.SECRET_DELIVERY_OUTBOX_DATABASE_URL;
  if (env.NODE_ENV !== "production") {
    return dedicatedUrl ?? env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul";
  }
  if (!dedicatedUrl) {
    throw new Error("SECRET_DELIVERY_OUTBOX_DATABASE_URL_REQUIRED");
  }

  let parsed: URL;
  try {
    parsed = new URL(dedicatedUrl);
  } catch {
    throw new Error("SECRET_DELIVERY_OUTBOX_DATABASE_URL_INVALID");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("SECRET_DELIVERY_OUTBOX_DATABASE_URL_INVALID");
  }
  if (env.DATABASE_URL && normalizeDatabaseUrl(env.DATABASE_URL) === normalizeDatabaseUrl(dedicatedUrl)) {
    throw new Error("SECRET_DELIVERY_OUTBOX_DATABASE_URL_MUST_DIFFER");
  }
  if (decodeURIComponent(parsed.username) !== "secret_delivery_worker") {
    throw new Error("SECRET_DELIVERY_OUTBOX_DATABASE_ROLE_REQUIRED");
  }
  return dedicatedUrl;
}

function normalizeDatabaseUrl(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    return value;
  }
}
