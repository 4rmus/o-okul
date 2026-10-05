import { type TenantQueryable, withTenantDb } from "@o-okul/db";
import type { AnnouncementDeliveryReportInput } from "./announcement-delivery-job.js";
import type { AnnouncementPushStore, PushDevice } from "./announcement-push-delivery.js";

export class PostgresAnnouncementPushStore implements AnnouncementPushStore {
  constructor(private readonly pool: TenantQueryable) {}

  async listActiveDevices(tenantId: string, deviceIds: string[]): Promise<PushDevice[]> {
    return withTenantDb(this.pool, { tenantId }, async (client) => {
      const result = await client.query<PushDevice>(
        `SELECT "id", "token", "subjectType"
         FROM "NotificationDeviceToken"
         WHERE "tenantId" = $1 AND "id" = ANY($2::text[]) AND "provider" = 'web-push' AND "disabledAt" IS NULL
         ORDER BY "id"`,
        [tenantId, deviceIds],
      );
      return result.rows;
    });
  }

  async disableDevices(tenantId: string, deviceIds: string[]): Promise<void> {
    await withTenantDb(this.pool, { tenantId }, async (client) => {
      await client.query(
        `UPDATE "NotificationDeviceToken"
         SET "disabledAt" = now(), "updatedAt" = now()
         WHERE "tenantId" = $1 AND "id" = ANY($2::text[]) AND "disabledAt" IS NULL`,
        [tenantId, deviceIds],
      );
    });
  }

  async addDeliveryCounts(input: AnnouncementDeliveryReportInput): Promise<void> {
    await withTenantDb(this.pool, { tenantId: input.tenantId }, async (client) => {
      await client.query(
        `INSERT INTO "AnnouncementDeliveryReport" AS report (
           "id", "tenantId", "announcementId", "channel", "recipientCount", "deliveredCount", "failedCount", "status", "providerErrorCode", "updatedAt"
         )
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT ("tenantId", "announcementId", "channel") DO UPDATE
         SET "recipientCount" = report."recipientCount" + EXCLUDED."recipientCount",
             "deliveredCount" = report."deliveredCount" + EXCLUDED."deliveredCount",
             "failedCount" = report."failedCount" + EXCLUDED."failedCount",
             "status" = CASE
               WHEN report."deliveredCount" + EXCLUDED."deliveredCount" > 0
                 OR report."failedCount" + EXCLUDED."failedCount" = 0 THEN 'completed'
               ELSE 'failed'
             END,
             "providerErrorCode" = COALESCE(EXCLUDED."providerErrorCode", report."providerErrorCode"),
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
    });
  }
}
