import { createHash, randomUUID } from "node:crypto";
import { parseWebPushSubscription, type NotificationDeviceTokenRecord } from "@o-okul/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export interface NotificationDeviceTokenInput {
  tenantId: string;
  userId: string;
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
  provider: string;
  token: string;
  platform?: string;
  lastSeenAt: string;
}

export interface NotificationDeviceTokenStore {
  listByUser(tenantId: string, userId: string): Promise<NotificationDeviceTokenRecord[]>;
  listActiveByUsers(tenantId: string, userIds: string[]): Promise<NotificationDeviceTokenRecord[]>;
  upsert(input: NotificationDeviceTokenInput): Promise<NotificationDeviceTokenRecord>;
  disable(tenantId: string, userId: string, id: string, disabledAt: string): Promise<NotificationDeviceTokenRecord | undefined>;
}

export const notificationDeviceTokenStoreToken = Symbol("NotificationDeviceTokenStore");

const demoDevices: NotificationDeviceTokenRecord[] = [];

export class InMemoryNotificationDeviceTokenStore implements NotificationDeviceTokenStore {
  private readonly devices = demoDevices.map((device) => ({ ...device }));

  async listByUser(tenantId: string, userId: string): Promise<NotificationDeviceTokenRecord[]> {
    return this.devices
      .filter((device) => device.tenantId === tenantId && device.userId === userId)
      .map(cloneDevice);
  }

  async listActiveByUsers(tenantId: string, userIds: string[]): Promise<NotificationDeviceTokenRecord[]> {
    const allowedUserIds = new Set(userIds);
    return this.devices
      .filter((device) => device.tenantId === tenantId && allowedUserIds.has(device.userId) && !device.disabledAt)
      .map(cloneDevice);
  }

  async upsert(input: NotificationDeviceTokenInput): Promise<NotificationDeviceTokenRecord> {
    input = { ...input };
    const webPush = normalizeWebPushInput(input);
    const existing = this.devices.find((device) =>
      device.tenantId === input.tenantId &&
      (webPush ? device.provider === "web-push" && parseWebPushSubscription(device.token)?.endpoint === webPush.endpoint
        : device.userId === input.userId && device.provider === input.provider && device.token === input.token),
    );
    if (existing) {
      if (webPush && (existing.userId !== input.userId || existing.subjectType !== input.subjectType ||
        existing.subjectId !== input.subjectId || existing.token !== input.token || existing.disabledAt)) {
        existing.id = randomUUID();
      }
      existing.userId = input.userId;
      existing.token = input.token;
      existing.subjectType = input.subjectType;
      existing.subjectId = input.subjectId;
      existing.provider = input.provider;
      existing.platform = input.platform;
      existing.lastSeenAt = input.lastSeenAt;
      existing.disabledAt = undefined;
      existing.updatedAt = input.lastSeenAt;
      return cloneDevice(existing);
    }

    const record: NotificationDeviceTokenRecord = {
      id: randomUUID(),
      ...input,
      createdAt: input.lastSeenAt,
      updatedAt: input.lastSeenAt,
    };
    this.devices.push(record);
    return cloneDevice(record);
  }

  async disable(tenantId: string, userId: string, id: string, disabledAt: string): Promise<NotificationDeviceTokenRecord | undefined> {
    const device = this.devices.find((candidate) =>
      candidate.tenantId === tenantId &&
      candidate.userId === userId &&
      candidate.id === id,
    );
    if (!device) return undefined;

    device.disabledAt = disabledAt;
    device.updatedAt = disabledAt;
    return cloneDevice(device);
  }
}

export class PostgresNotificationDeviceTokenStore implements NotificationDeviceTokenStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async listByUser(tenantId: string, userId: string): Promise<NotificationDeviceTokenRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<NotificationDeviceTokenRow>(
        `SELECT * FROM "NotificationDeviceToken"
         WHERE "tenantId" = $1 AND "userId" = $2
         ORDER BY "lastSeenAt" DESC`,
        [tenantId, userId],
      );
      return result.rows.map(toDeviceRecord);
    });
  }

  async listActiveByUsers(tenantId: string, userIds: string[]): Promise<NotificationDeviceTokenRecord[]> {
    if (userIds.length === 0) {
      return [];
    }

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<NotificationDeviceTokenRow>(
        `SELECT * FROM "NotificationDeviceToken"
         WHERE "tenantId" = $1
           AND "userId" = ANY($2::text[])
           AND "disabledAt" IS NULL
         ORDER BY "lastSeenAt" DESC`,
        [tenantId, userIds],
      );
      return result.rows.map(toDeviceRecord);
    });
  }

  async upsert(input: NotificationDeviceTokenInput): Promise<NotificationDeviceTokenRecord> {
    input = { ...input };
    const webPush = normalizeWebPushInput(input);
    return withTenantQuery(this.pool, async (client) => {
      // Disabled pre-migration registrations have no binding hash. Release a possible raw-token unique conflict.
      if (webPush) await client.query(
        `DELETE FROM "NotificationDeviceToken" WHERE "tenantId" = $1 AND "userId" = $2 AND "provider" = 'web-push'
           AND "token" = $3 AND "webPushEndpointHash" IS NULL AND "disabledAt" IS NOT NULL`,
        [input.tenantId, input.userId, input.token],
      );
      const result = await client.query<NotificationDeviceTokenRow>(
        `INSERT INTO "NotificationDeviceToken" (
           "id", "tenantId", "userId", "subjectType", "subjectId", "provider", "token", "platform", "lastSeenAt", "webPushEndpointHash", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT (${webPush ? '"tenantId", "webPushEndpointHash"' : '"tenantId", "userId", "provider", "token"'}) DO UPDATE
         SET "id" = CASE WHEN EXCLUDED."provider" = 'web-push' AND (
               "NotificationDeviceToken"."userId" <> EXCLUDED."userId" OR "NotificationDeviceToken"."disabledAt" IS NOT NULL
               OR "NotificationDeviceToken"."subjectType" IS DISTINCT FROM EXCLUDED."subjectType"
               OR "NotificationDeviceToken"."subjectId" IS DISTINCT FROM EXCLUDED."subjectId"
               OR "NotificationDeviceToken"."token" <> EXCLUDED."token") THEN EXCLUDED."id" ELSE "NotificationDeviceToken"."id" END,
             "userId" = EXCLUDED."userId",
             "token" = EXCLUDED."token",
             "subjectType" = EXCLUDED."subjectType",
             "subjectId" = EXCLUDED."subjectId",
             "provider" = EXCLUDED."provider",
             "platform" = EXCLUDED."platform",
             "lastSeenAt" = EXCLUDED."lastSeenAt",
             "disabledAt" = NULL,
             "updatedAt" = now()
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.userId,
          input.subjectType ?? null,
          input.subjectId ?? null,
          input.provider,
          input.token,
          input.platform ?? null,
          input.lastSeenAt,
          webPush ? createHash("sha256").update(webPush.endpoint).digest("hex") : null,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("NOTIFICATION_DEVICE_UPSERT_FAILED");
      }
      return toDeviceRecord(record);
    });
  }

  async disable(tenantId: string, userId: string, id: string, disabledAt: string): Promise<NotificationDeviceTokenRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<NotificationDeviceTokenRow>(
        `UPDATE "NotificationDeviceToken"
         SET "disabledAt" = $4, "updatedAt" = now()
         WHERE "tenantId" = $1 AND "userId" = $2 AND "id" = $3
         RETURNING *`,
        [tenantId, userId, id, disabledAt],
      );
      return result.rows[0] ? toDeviceRecord(result.rows[0]) : undefined;
    });
  }
}

function normalizeWebPushInput(input: NotificationDeviceTokenInput) {
  if (input.provider !== "web-push") return undefined;
  const subscription = parseWebPushSubscription(input.token);
  if (!subscription) throw new Error("NOTIFICATION_DEVICE_SUBSCRIPTION_INVALID");
  input.token = JSON.stringify(subscription);
  return subscription;
}

export function createNotificationDeviceTokenStore(): NotificationDeviceTokenStore {
  return resolvePersistenceDriver(process.env.NOTIFICATION_DEVICE_TOKEN_STORE) === "postgres"
    ? new PostgresNotificationDeviceTokenStore()
    : new InMemoryNotificationDeviceTokenStore();
}

interface NotificationDeviceTokenRow {
  id: string;
  tenantId: string;
  userId: string;
  subjectType: "STUDENT" | "GUARDIAN" | "TEACHER" | null;
  subjectId: string | null;
  provider: string;
  token: string;
  platform: string | null;
  lastSeenAt: Date | string;
  disabledAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function toDeviceRecord(row: NotificationDeviceTokenRow): NotificationDeviceTokenRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    subjectType: row.subjectType ?? undefined,
    subjectId: row.subjectId ?? undefined,
    provider: row.provider,
    token: row.token,
    platform: row.platform ?? undefined,
    lastSeenAt: toIsoString(row.lastSeenAt),
    disabledAt: row.disabledAt ? toIsoString(row.disabledAt) : undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function cloneDevice(device: NotificationDeviceTokenRecord): NotificationDeviceTokenRecord {
  return { ...device };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
