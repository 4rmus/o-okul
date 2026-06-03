import { randomUUID } from "node:crypto";
import type { AnnouncementDeliveryReportRecord } from "@uzman-hocam/shared-types";
import pg from "pg";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export interface AnnouncementDeliveryReportStore {
  listByAnnouncement(tenantId: string, announcementId: string): Promise<AnnouncementDeliveryReportRecord[]>;
  upsert(input: AnnouncementDeliveryReportUpsertInput): Promise<AnnouncementDeliveryReportRecord>;
}

export type AnnouncementDeliveryReportUpsertInput = Pick<
  AnnouncementDeliveryReportRecord,
  "tenantId" | "announcementId" | "channel" | "recipientCount" | "deliveredCount" | "failedCount" | "status"
> & Pick<Partial<AnnouncementDeliveryReportRecord>, "providerErrorCode">;

export const announcementDeliveryReportStoreToken = Symbol("AnnouncementDeliveryReportStore");

const demoReports: AnnouncementDeliveryReportRecord[] = [
  {
    id: "announcement-delivery-report-email-a",
    tenantId: "tenant-a",
    announcementId: "announcement-a",
    channel: "EMAIL",
    recipientCount: 3,
    deliveredCount: 2,
    failedCount: 1,
    status: "completed",
    providerErrorCode: "EMAIL_PROVIDER_RETRY",
    createdAt: "2026-06-08T09:05:00.000Z",
    updatedAt: "2026-06-08T09:10:00.000Z",
  },
  {
    id: "announcement-delivery-report-push-a",
    tenantId: "tenant-a",
    announcementId: "announcement-a",
    channel: "PUSH",
    recipientCount: 3,
    deliveredCount: 0,
    failedCount: 0,
    status: "queued",
    createdAt: "2026-06-08T09:05:00.000Z",
    updatedAt: "2026-06-08T09:05:00.000Z",
  },
  {
    id: "announcement-delivery-report-email-b",
    tenantId: "tenant-b",
    announcementId: "announcement-b",
    channel: "EMAIL",
    recipientCount: 1,
    deliveredCount: 1,
    failedCount: 0,
    status: "completed",
    createdAt: "2026-06-08T09:05:00.000Z",
    updatedAt: "2026-06-08T09:10:00.000Z",
  },
];

export class InMemoryAnnouncementDeliveryReportStore implements AnnouncementDeliveryReportStore {
  private readonly reports = demoReports.map((record) => ({ ...record }));

  async listByAnnouncement(tenantId: string, announcementId: string): Promise<AnnouncementDeliveryReportRecord[]> {
    return this.reports
      .filter((report) => report.tenantId === tenantId && report.announcementId === announcementId)
      .sort((left, right) => left.channel.localeCompare(right.channel, "tr"));
  }

  async upsert(input: AnnouncementDeliveryReportUpsertInput): Promise<AnnouncementDeliveryReportRecord> {
    const existing = this.reports.find(
      (report) => report.tenantId === input.tenantId &&
        report.announcementId === input.announcementId &&
        report.channel === input.channel,
    );
    const now = new Date().toISOString();
    if (existing) {
      existing.recipientCount = input.recipientCount;
      existing.deliveredCount = input.deliveredCount;
      existing.failedCount = input.failedCount;
      existing.status = input.status;
      existing.providerErrorCode = input.providerErrorCode;
      existing.updatedAt = now;
      return existing;
    }

    const record: AnnouncementDeliveryReportRecord = {
      id: `announcement-delivery-report-${this.reports.length + 1}`,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.reports.push(record);
    return record;
  }
}

export class PostgresAnnouncementDeliveryReportStore implements AnnouncementDeliveryReportStore {
  constructor(
    private readonly pool: TenantQueryable = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/uzman_hocam",
    }),
  ) {}

  async listByAnnouncement(tenantId: string, announcementId: string): Promise<AnnouncementDeliveryReportRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AnnouncementDeliveryReportRow>(
        `SELECT * FROM "AnnouncementDeliveryReport"
         WHERE "tenantId" = $1 AND "announcementId" = $2
         ORDER BY "channel" ASC`,
        [tenantId, announcementId],
      );
      return result.rows.map(toAnnouncementDeliveryReportRecord);
    });
  }

  async upsert(input: AnnouncementDeliveryReportUpsertInput): Promise<AnnouncementDeliveryReportRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AnnouncementDeliveryReportRow>(
        `INSERT INTO "AnnouncementDeliveryReport" (
           "id", "tenantId", "announcementId", "channel", "recipientCount", "deliveredCount", "failedCount", "status", "providerErrorCode", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT ("tenantId", "announcementId", "channel") DO UPDATE
         SET "recipientCount" = EXCLUDED."recipientCount",
             "deliveredCount" = EXCLUDED."deliveredCount",
             "failedCount" = EXCLUDED."failedCount",
             "status" = EXCLUDED."status",
             "providerErrorCode" = EXCLUDED."providerErrorCode",
             "updatedAt" = now()
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.announcementId,
          input.channel,
          input.recipientCount,
          input.deliveredCount,
          input.failedCount,
          input.status,
          input.providerErrorCode ?? null,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("ANNOUNCEMENT_DELIVERY_REPORT_UPSERT_FAILED");
      }
      return toAnnouncementDeliveryReportRecord(record);
    });
  }
}

export function createAnnouncementDeliveryReportStore(): AnnouncementDeliveryReportStore {
  return process.env.ANNOUNCEMENT_DELIVERY_REPORT_STORE === "postgres"
    ? new PostgresAnnouncementDeliveryReportStore()
    : new InMemoryAnnouncementDeliveryReportStore();
}

interface AnnouncementDeliveryReportRow {
  id: string;
  tenantId: string;
  announcementId: string;
  channel: AnnouncementDeliveryReportRecord["channel"];
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  status: AnnouncementDeliveryReportRecord["status"];
  providerErrorCode: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function toAnnouncementDeliveryReportRecord(row: AnnouncementDeliveryReportRow): AnnouncementDeliveryReportRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    announcementId: row.announcementId,
    channel: row.channel,
    recipientCount: row.recipientCount,
    deliveredCount: row.deliveredCount,
    failedCount: row.failedCount,
    status: row.status,
    providerErrorCode: row.providerErrorCode ?? undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
