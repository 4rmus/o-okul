import { type Queryable, type TenantQueryable, withTenantDb } from "@o-okul/db";
import type {
  SmsBatchDeliveryCompletedSnapshot,
  SmsBatchDeliveryCompletedInput,
  SmsBatchDeliveryFailedInput,
  SmsBatchDeliveryLookupInput,
  SmsBatchDeliveryReporter,
} from "./sms-batch-job.js";

export class PostgresSmsBatchDeliveryReporter implements SmsBatchDeliveryReporter {
  constructor(private readonly pool: TenantQueryable) {}

  async findCompleted(input: SmsBatchDeliveryLookupInput): Promise<SmsBatchDeliveryCompletedSnapshot | undefined> {
    return withTenantDb(this.pool, { tenantId: input.tenantId }, async (client) => {
      const result = await client.query<SmsBatchDeliveryCompletedSnapshot>(
        `SELECT "tenantId", "jobId", "templateId", "sentCount", "failedCount", "billableSegments"
         FROM "SmsBatchDeliveryReport"
         WHERE "tenantId" = $1
           AND "jobId" = $2
           AND "status" = 'completed'
         LIMIT 1`,
        [input.tenantId, input.jobId],
      );
      return result.rows[0];
    });
  }

  async markCompleted(input: SmsBatchDeliveryCompletedInput): Promise<void> {
    await withTenantDb(this.pool, { tenantId: input.tenantId }, async (client) => {
      await updateDeliveryReport(client, {
        ...input,
        status: "completed",
        providerErrorCode: null,
      });
    });
  }

  async markFailed(input: SmsBatchDeliveryFailedInput): Promise<void> {
    await withTenantDb(this.pool, { tenantId: input.tenantId }, async (client) => {
      await updateDeliveryReport(client, {
        ...input,
        sentCount: 0,
        failedCount: input.recipientCount,
        billableSegments: 0,
        status: "failed",
        providerErrorCode: input.providerErrorCode,
      });
    });
  }
}

interface DeliveryReportUpdate {
  tenantId: string;
  jobId: string;
  templateId: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  billableSegments: number;
  status: "completed" | "failed";
  providerErrorCode: string | null;
}

async function updateDeliveryReport(client: Queryable, input: DeliveryReportUpdate): Promise<void> {
  const result = await client.query<{ id: string }>(
    `UPDATE "SmsBatchDeliveryReport"
     SET "templateId" = $3,
         "recipientCount" = $4,
         "sentCount" = $5,
         "failedCount" = $6,
         "billableSegments" = $7,
         "status" = $8,
         "providerErrorCode" = $9,
         "updatedAt" = now()
     WHERE "tenantId" = $1
       AND "jobId" = $2
     RETURNING "id"`,
    [
      input.tenantId,
      input.jobId,
      input.templateId,
      input.recipientCount,
      input.sentCount,
      input.failedCount,
      input.billableSegments,
      input.status,
      input.providerErrorCode,
    ],
  );
  if (!result.rows[0]) {
    throw new Error("SMS_BATCH_DELIVERY_REPORT_NOT_FOUND");
  }
}
