import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export interface AnnouncementReceiptRecord {
  id: string;
  tenantId: string;
  announcementId: string;
  userId: string;
  subjectType: string;
  subjectId: string;
  readAt: string;
}

export type AnnouncementReceiptViewer = Pick<AnnouncementReceiptRecord, "tenantId" | "userId" | "subjectType" | "subjectId">;

export type AnnouncementReceiptInput = AnnouncementReceiptViewer & Pick<AnnouncementReceiptRecord, "announcementId" | "readAt">;

export interface AnnouncementReceiptStore {
  listByViewer(viewer: AnnouncementReceiptViewer): Promise<AnnouncementReceiptRecord[]>;
  listByAnnouncement(tenantId: string, announcementId: string): Promise<AnnouncementReceiptRecord[]>;
  markRead(input: AnnouncementReceiptInput): Promise<AnnouncementReceiptRecord>;
}

export const announcementReceiptStoreToken = Symbol("AnnouncementReceiptStore");

export class InMemoryAnnouncementReceiptStore implements AnnouncementReceiptStore {
  private readonly receipts: AnnouncementReceiptRecord[] = [];

  async listByViewer(viewer: AnnouncementReceiptViewer): Promise<AnnouncementReceiptRecord[]> {
    return this.receipts.filter((receipt) =>
      receipt.tenantId === viewer.tenantId &&
      receipt.userId === viewer.userId &&
      receipt.subjectType === viewer.subjectType &&
      receipt.subjectId === viewer.subjectId,
    );
  }

  async listByAnnouncement(tenantId: string, announcementId: string): Promise<AnnouncementReceiptRecord[]> {
    return this.receipts.filter((receipt) => receipt.tenantId === tenantId && receipt.announcementId === announcementId);
  }

  async markRead(input: AnnouncementReceiptInput): Promise<AnnouncementReceiptRecord> {
    const existing = this.receipts.find((receipt) =>
      receipt.tenantId === input.tenantId &&
      receipt.announcementId === input.announcementId &&
      receipt.userId === input.userId &&
      receipt.subjectType === input.subjectType &&
      receipt.subjectId === input.subjectId,
    );
    if (existing) {
      existing.readAt = input.readAt;
      return existing;
    }

    const receipt = { id: `announcement-receipt-${this.receipts.length + 1}`, ...input };
    this.receipts.push(receipt);
    return receipt;
  }
}

export class PostgresAnnouncementReceiptStore implements AnnouncementReceiptStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async listByViewer(viewer: AnnouncementReceiptViewer): Promise<AnnouncementReceiptRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AnnouncementReceiptRow>(
        `SELECT *
         FROM "AnnouncementReceipt"
         WHERE "tenantId" = $1
           AND "userId" = $2
           AND "subjectType" = $3
           AND "subjectId" = $4`,
        [viewer.tenantId, viewer.userId, viewer.subjectType, viewer.subjectId],
      );
      return result.rows.map(toAnnouncementReceiptRecord);
    });
  }

  async listByAnnouncement(tenantId: string, announcementId: string): Promise<AnnouncementReceiptRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AnnouncementReceiptRow>(
        `SELECT *
         FROM "AnnouncementReceipt"
         WHERE "tenantId" = $1
           AND "announcementId" = $2`,
        [tenantId, announcementId],
      );
      return result.rows.map(toAnnouncementReceiptRecord);
    });
  }

  async markRead(input: AnnouncementReceiptInput): Promise<AnnouncementReceiptRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AnnouncementReceiptRow>(
        `INSERT INTO "AnnouncementReceipt" ("id", "tenantId", "announcementId", "userId", "subjectType", "subjectId", "readAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT ("tenantId", "announcementId", "userId", "subjectType", "subjectId")
         DO UPDATE SET "readAt" = EXCLUDED."readAt", "updatedAt" = now()
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.announcementId,
          input.userId,
          input.subjectType,
          input.subjectId,
          input.readAt,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("ANNOUNCEMENT_RECEIPT_UPSERT_FAILED");
      }
      return toAnnouncementReceiptRecord(record);
    });
  }
}

export function createAnnouncementReceiptStore(): AnnouncementReceiptStore {
  return resolvePersistenceDriver(process.env.ANNOUNCEMENT_RECEIPT_STORE) === "postgres"
    ? new PostgresAnnouncementReceiptStore()
    : new InMemoryAnnouncementReceiptStore();
}

interface AnnouncementReceiptRow {
  id: string;
  tenantId: string;
  announcementId: string;
  userId: string;
  subjectType: string;
  subjectId: string;
  readAt: Date | string;
}

function toAnnouncementReceiptRecord(row: AnnouncementReceiptRow): AnnouncementReceiptRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    announcementId: row.announcementId,
    userId: row.userId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    readAt: row.readAt instanceof Date ? row.readAt.toISOString() : row.readAt,
  };
}
