import { createTenantPgPool, decryptSecretDeliveryPayload, withTenantDb, type Queryable, type TenantQueryable } from "@o-okul/db";
import { createNotificationAdapterFromEnv, type NotificationAdapter } from "@o-okul/notification-adapter";
import { randomUUID } from "node:crypto";
import { workerLogger } from "../observability/logging.js";

export interface SecretDeliveryOutboxRecord {
  id: string;
  purpose: "IDENTITY_INVITATION" | "PASSWORD_RESET";
  payloadEncrypted: string;
  attempts: number;
  claimToken: string;
  tenantId?: string | null;
  sourceScope?: "TENANT" | "SYSTEM" | null;
  tenantLifecycleVersion?: number | null;
}

export interface SecretDeliveryOutboxStore {
  claimNext(now: Date): Promise<SecretDeliveryOutboxRecord | undefined>;
  markDelivered(id: string, claimToken: string, deliveredAt: Date, providerMessageId: string): Promise<void>;
  markFailed(id: string, input: { attempts: number; claimToken: string; errorCode: string; now: Date; providerMessageId?: string }): Promise<void>;
}

export class PostgresSecretDeliveryOutboxStore implements SecretDeliveryOutboxStore {
  constructor(private readonly pool: TenantQueryable = createTenantPgPool(resolveSecretDeliveryOutboxDatabaseUrl())) {}

  async claimNext(now: Date): Promise<SecretDeliveryOutboxRecord | undefined> {
    try { await this.expireOne(now); } catch (error) { if (!(error instanceof Error) || error.message !== "TENANT_DATABASE_BUSY") throw error; }
    // Availability filtering keeps a suspended/legacy tenant from starving other tenants.
    const candidates = await this.pool.query<SecretDeliveryOutboxRecord>(`SELECT o."id", o."tenantId", o."sourceScope", o."tenantLifecycleVersion" FROM "SecretDeliveryOutbox" o LEFT JOIN "Tenant" t ON t."id" = o."tenantId"
      WHERE o."status" = 'PENDING' AND o."attempts" = 0 AND o."claimToken" IS NULL AND o."payloadEncrypted" IS NOT NULL AND o."expiresAt" > $1 AND o."availableAt" <= $1
      AND ((o."sourceScope" = 'SYSTEM' AND o."tenantId" IS NULL AND o."tenantLifecycleVersion" IS NULL) OR (o."sourceScope" = 'TENANT' AND t."status" = 'ACTIVE' AND t."lifecycleVersion" = o."tenantLifecycleVersion"))
      ORDER BY o."availableAt", o."createdAt" LIMIT 20`, [now]);
    for (const candidate of candidates.rows) {
      let claimed: SecretDeliveryOutboxRecord | undefined;
      try { claimed = await this.transaction(candidate, async (db) => {
        if (candidate.sourceScope === "TENANT") {
          const tenant = (await db.query<{ status: string; lifecycleVersion: number }>('SELECT "status", "lifecycleVersion" FROM "Tenant" WHERE "id" = $1', [candidate.tenantId])).rows[0];
          if (tenant?.status !== "ACTIVE" || tenant.lifecycleVersion !== candidate.tenantLifecycleVersion) return undefined;
        }
        const available = await db.query<{ id: string }>('SELECT "id" FROM "SecretDeliveryOutbox" WHERE "id" = $1 AND "status" = \'PENDING\' FOR UPDATE SKIP LOCKED', [candidate.id]);
        if (!available.rows.length) return undefined;
        const result = await db.query<SecretDeliveryOutboxRecord>(`UPDATE "SecretDeliveryOutbox" SET "status" = 'PROCESSING', "attempts" = "attempts" + 1, "claimedAt" = $2, "claimToken" = $3, "updatedAt" = $2
          WHERE "id" = $1 AND "status" = 'PENDING' AND "attempts" = 0 AND "claimToken" IS NULL AND "payloadEncrypted" IS NOT NULL AND "expiresAt" > $2 AND "availableAt" <= $2
          RETURNING "id", "tenantId", "sourceScope", "tenantLifecycleVersion", "purpose", "payloadEncrypted", "attempts", "claimToken"`, [candidate.id, now, randomUUID()]);
        const row = result.rows[0];
        if (row && (row.id !== candidate.id || row.tenantId !== candidate.tenantId || row.sourceScope !== candidate.sourceScope || row.tenantLifecycleVersion !== candidate.tenantLifecycleVersion)) throw new Error("SECRET_DELIVERY_PROVENANCE_UNVERIFIED");
        return row;
      }); } catch (error) { if (error instanceof Error && error.message === "TENANT_DATABASE_BUSY") continue; throw error; }
      if (claimed) return claimed;
    }
    return undefined;
  }
  private async expireOne(now: Date): Promise<void> {
    const rows = await this.pool.query<SecretDeliveryOutboxRecord>(`SELECT "id", "tenantId", "sourceScope", "tenantLifecycleVersion" FROM "SecretDeliveryOutbox" WHERE "expiresAt" <= $1 AND "payloadEncrypted" IS NOT NULL AND "sourceScope" IS NOT NULL ORDER BY "expiresAt" LIMIT 1`, [now]);
    const row = rows.rows[0]; if (!row) return;
    await this.transaction(row, async (db) => {
      // Redaction is independent of dispatch certainty. Attempted rows never become safe EXPIRED.
      await db.query(`UPDATE "SecretDeliveryOutbox" SET "payloadEncrypted" = NULL,
        "status" = CASE WHEN "status" = 'PENDING' AND "attempts" = 0 AND "claimToken" IS NULL THEN 'EXPIRED' WHEN "status" IN ('PENDING','PROCESSING','UNCERTAIN') THEN 'UNCERTAIN' ELSE "status" END,
        "updatedAt" = $2 WHERE "id" = $1 AND "expiresAt" <= $2`, [row.id, now]);
    });
  }
  async markDelivered(id: string, claimToken: string, deliveredAt: Date, providerMessageId: string): Promise<void> {
    if (!providerMessageId?.trim() || providerMessageId.length > 512) throw new Error("SECRET_DELIVERY_RECEIPT_UNVERIFIED");
    const row = await this.claimRecord(id, claimToken);
    await this.transaction(row, async (db) => {
      const updated = await db.query<{ id: string }>(`UPDATE "SecretDeliveryOutbox" SET "status" = 'DELIVERED', "payloadEncrypted" = NULL, "providerMessageId" = $4, "claimedAt" = NULL, "claimToken" = NULL, "deliveredAt" = $3, "lastErrorCode" = NULL, "updatedAt" = $3 WHERE "id" = $1 AND "status" = 'PROCESSING' AND "claimToken" = $2 RETURNING "id"`, [id, claimToken, deliveredAt, providerMessageId]);
      if (updated.rows[0]?.id !== id) throw new Error("SECRET_DELIVERY_CLAIM_CHANGED");
    });
  }
  async markFailed(id: string, input: { attempts: number; claimToken: string; errorCode: string; now: Date; providerMessageId?: string }): Promise<void> {
    const row = await this.claimRecord(id, input.claimToken);
    await this.transaction(row, async (db) => {
      const updated = await db.query<{ id: string }>(`UPDATE "SecretDeliveryOutbox" SET "status" = 'UNCERTAIN', "lastErrorCode" = $3, "updatedAt" = $4, "providerMessageId" = COALESCE($5, "providerMessageId") WHERE "id" = $1 AND "status" IN ('PROCESSING','UNCERTAIN') AND "claimToken" = $2 RETURNING "id"`, [id, input.claimToken, input.errorCode, input.now, input.providerMessageId ?? null]);
      if (updated.rows[0]?.id !== id) throw new Error("SECRET_DELIVERY_CLAIM_CHANGED");
    });
  }
  private async claimRecord(id: string, claimToken: string): Promise<SecretDeliveryOutboxRecord> {
    const row = (await this.pool.query<SecretDeliveryOutboxRecord>(`SELECT "id", "tenantId", "sourceScope", "tenantLifecycleVersion" FROM "SecretDeliveryOutbox" WHERE "id" = $1 AND "claimToken" = $2 AND "status" IN ('PROCESSING','UNCERTAIN')`, [id, claimToken])).rows[0];
    if (!row) throw new Error("SECRET_DELIVERY_CLAIM_CHANGED"); return row;
  }
  private transaction<T>(row: SecretDeliveryOutboxRecord, run: (db: Queryable) => Promise<T>): Promise<T> {
    if (!this.pool.connect || !(row.sourceScope === "SYSTEM" ? row.tenantId == null && row.tenantLifecycleVersion == null : row.sourceScope === "TENANT" && !!row.tenantId && Number.isInteger(row.tenantLifecycleVersion) && row.tenantLifecycleVersion! >= 0)) throw new Error("SECRET_DELIVERY_PROVENANCE_UNVERIFIED");
    return withTenantDb(this.pool, { tenantId: row.tenantId ?? null, bypassRls: row.sourceScope === "SYSTEM" }, run);
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

  let providerMessageId: string | undefined;
  try {
    const payload = decryptSecretDeliveryPayload(record.payloadEncrypted, env);
    if (!(record.sourceScope === "SYSTEM" ? record.tenantId == null && record.tenantLifecycleVersion == null : record.sourceScope === "TENANT" && !!record.tenantId && Number.isInteger(record.tenantLifecycleVersion))) throw new Error("SECRET_DELIVERY_PROVENANCE_UNVERIFIED");
    const results = await adapter.sendBatch([{ ...payload, idempotencyKey: `secret-delivery:${record.id}` }]);
    const result = results[0];
    if (results.length !== 1 || result?.status !== "sent" || result.channel !== payload.channel || result.to !== payload.to || !result.providerMessageId?.trim() || result.providerMessageId.length > 512 || result.errorCode) {
      await store.markFailed(record.id, {
        attempts: record.attempts,
        claimToken: record.claimToken,
        errorCode: safeProviderErrorCode(result?.errorCode),
        now,
      });
      return true;
    }
    providerMessageId = result.providerMessageId;
    await store.markDelivered(record.id, record.claimToken, now, providerMessageId!);
  } catch (error) {
    await store.markFailed(record.id, {
      attempts: record.attempts,
      claimToken: record.claimToken,
      errorCode: safeErrorCode(error),
      providerMessageId,
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
