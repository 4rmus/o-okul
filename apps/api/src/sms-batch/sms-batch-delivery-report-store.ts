import { randomUUID } from "node:crypto";
import pg from "pg";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export interface SmsBatchDeliveryReportRecord {
  id: string;
  tenantId: string;
  jobId: string;
  templateId: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  billableSegments: number;
  status: "queued" | "completed" | "failed";
  providerErrorCode?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SmsBatchDeliveryReportStore {
  findByJobId(jobId: string): Promise<SmsBatchDeliveryReportRecord | undefined>;
  upsertQueued(input: SmsBatchQueuedReportInput): Promise<SmsBatchDeliveryReportRecord>;
}

export type SmsBatchQueuedReportInput = Pick<
  SmsBatchDeliveryReportRecord,
  "tenantId" | "jobId" | "templateId" | "recipientCount"
>;

export const smsBatchDeliveryReportStoreToken = Symbol("SmsBatchDeliveryReportStore");

const demoReports: SmsBatchDeliveryReportRecord[] = [];

export class InMemorySmsBatchDeliveryReportStore implements SmsBatchDeliveryReportStore {
  private readonly reports = demoReports.map((record) => ({ ...record }));

  async findByJobId(jobId: string): Promise<SmsBatchDeliveryReportRecord | undefined> {
    return this.reports.find((candidate) => candidate.jobId === jobId);
  }

  async upsertQueued(input: SmsBatchQueuedReportInput): Promise<SmsBatchDeliveryReportRecord> {
    const existing = this.reports.find(
      (candidate) => candidate.tenantId === input.tenantId && candidate.jobId === input.jobId,
    );
    if (existing) {
      existing.templateId = input.templateId;
      existing.recipientCount = input.recipientCount;
      existing.status = "queued";
      existing.updatedAt = new Date().toISOString();
      return existing;
    }

    const now = new Date().toISOString();
    const record: SmsBatchDeliveryReportRecord = {
      id: `sms-delivery-report-${this.reports.length + 1}`,
      ...input,
      sentCount: 0,
      failedCount: 0,
      billableSegments: 0,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    this.reports.push(record);
    return record;
  }
}

export class PostgresSmsBatchDeliveryReportStore implements SmsBatchDeliveryReportStore {
  constructor(
    private readonly pool: TenantQueryable = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/uzman_hocam",
    }),
  ) {}

  async findByJobId(jobId: string): Promise<SmsBatchDeliveryReportRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<SmsBatchDeliveryReportRow>(
        `SELECT * FROM "SmsBatchDeliveryReport"
         WHERE "jobId" = $1
         LIMIT 1`,
        [jobId],
      );
      return result.rows[0] ? toSmsBatchDeliveryReportRecord(result.rows[0]) : undefined;
    });
  }

  async upsertQueued(input: SmsBatchQueuedReportInput): Promise<SmsBatchDeliveryReportRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<SmsBatchDeliveryReportRow>(
        `INSERT INTO "SmsBatchDeliveryReport" (
           "id", "tenantId", "jobId", "templateId", "recipientCount", "status", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, 'queued', now())
         ON CONFLICT ("tenantId", "jobId") DO UPDATE
         SET "templateId" = EXCLUDED."templateId",
             "recipientCount" = EXCLUDED."recipientCount",
             "status" = 'queued',
             "updatedAt" = now()
         RETURNING *`,
        [randomUUID(), input.tenantId, input.jobId, input.templateId, input.recipientCount],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("SMS_BATCH_DELIVERY_REPORT_UPSERT_FAILED");
      }
      return toSmsBatchDeliveryReportRecord(record);
    });
  }
}

export function createSmsBatchDeliveryReportStore(): SmsBatchDeliveryReportStore {
  return process.env.SMS_BATCH_DELIVERY_REPORT_STORE === "postgres"
    ? new PostgresSmsBatchDeliveryReportStore()
    : new InMemorySmsBatchDeliveryReportStore();
}

interface SmsBatchDeliveryReportRow {
  id: string;
  tenantId: string;
  jobId: string;
  templateId: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  billableSegments: number;
  status: SmsBatchDeliveryReportRecord["status"];
  providerErrorCode: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function toSmsBatchDeliveryReportRecord(row: SmsBatchDeliveryReportRow): SmsBatchDeliveryReportRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    jobId: row.jobId,
    templateId: row.templateId,
    recipientCount: row.recipientCount,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    billableSegments: row.billableSegments,
    status: row.status,
    providerErrorCode: row.providerErrorCode ?? undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
