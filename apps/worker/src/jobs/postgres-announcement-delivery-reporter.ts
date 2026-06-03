import { type Queryable, type TenantQueryable, withTenantDb } from "@uzman-hocam/db";
import type { AnnouncementDeliveryReportInput, AnnouncementDeliveryReporter } from "./announcement-delivery-job.js";

export class PostgresAnnouncementDeliveryReporter implements AnnouncementDeliveryReporter {
  constructor(private readonly pool: TenantQueryable) {}

  async upsert(input: AnnouncementDeliveryReportInput): Promise<void> {
    await withTenantDb(this.pool, { tenantId: input.tenantId }, async (client) => {
      await upsertDeliveryReport(client, input);
    });
  }
}

async function upsertDeliveryReport(client: Queryable, input: AnnouncementDeliveryReportInput): Promise<void> {
  await client.query(
    `INSERT INTO "AnnouncementDeliveryReport" (
       "id", "tenantId", "announcementId", "channel", "recipientCount", "deliveredCount", "failedCount", "status", "providerErrorCode", "updatedAt"
     )
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT ("tenantId", "announcementId", "channel") DO UPDATE
     SET "recipientCount" = EXCLUDED."recipientCount",
         "deliveredCount" = EXCLUDED."deliveredCount",
         "failedCount" = EXCLUDED."failedCount",
         "status" = EXCLUDED."status",
         "providerErrorCode" = EXCLUDED."providerErrorCode",
         "updatedAt" = now()`,
    [
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
}
