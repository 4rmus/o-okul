import { randomUUID } from "node:crypto";
import type { NotificationDeviceTokenRecord } from "@uzman-hocam/shared-types";
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
    const existing = this.devices.find((device) =>
      device.tenantId === input.tenantId &&
      device.userId === input.userId &&
      device.token === input.token,
    );
    if (existing) {
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
      id: `notification-device-${this.devices.length + 1}`,
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
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<NotificationDeviceTokenRow>(
        `INSERT INTO "NotificationDeviceToken" (
           "id", "tenantId", "userId", "subjectType", "subjectId", "provider", "token", "platform", "lastSeenAt", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT ("tenantId", "userId", "token") DO UPDATE
         SET "subjectType" = EXCLUDED."subjectType",
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
