CREATE UNIQUE INDEX "Announcement_tenantId_id_key"
  ON "Announcement"("tenantId", "id");

DO $$
DECLARE
  missing_receipt_tenants INTEGER;
  invalid_receipt_announcements INTEGER;
  invalid_delivery_announcements INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO missing_receipt_tenants
  FROM "AnnouncementReceipt" receipt
  LEFT JOIN "Tenant" tenant ON tenant."id" = receipt."tenantId"
  WHERE tenant."id" IS NULL;

  IF missing_receipt_tenants > 0 THEN
    RAISE EXCEPTION 'AnnouncementReceipt tenant FK preflight failed: % receipt rows reference a missing tenant', missing_receipt_tenants;
  END IF;

  SELECT COUNT(*)
    INTO invalid_receipt_announcements
  FROM "AnnouncementReceipt" receipt
  LEFT JOIN "Announcement" announcement
    ON announcement."tenantId" = receipt."tenantId"
   AND announcement."id" = receipt."announcementId"
  WHERE announcement."id" IS NULL;

  IF invalid_receipt_announcements > 0 THEN
    RAISE EXCEPTION 'AnnouncementReceipt announcement FK preflight failed: % receipt rows are orphan or cross-tenant', invalid_receipt_announcements;
  END IF;

  SELECT COUNT(*)
    INTO invalid_delivery_announcements
  FROM "AnnouncementDeliveryReport" delivery
  LEFT JOIN "Announcement" announcement
    ON announcement."tenantId" = delivery."tenantId"
   AND announcement."id" = delivery."announcementId"
  WHERE announcement."id" IS NULL;

  IF invalid_delivery_announcements > 0 THEN
    RAISE EXCEPTION 'AnnouncementDeliveryReport announcement FK preflight failed: % delivery rows are orphan or cross-tenant', invalid_delivery_announcements;
  END IF;
END $$;

ALTER TABLE "AnnouncementReceipt" ADD CONSTRAINT "AnnouncementReceipt_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnnouncementReceipt" ADD CONSTRAINT "AnnouncementReceipt_announcement_fkey"
  FOREIGN KEY ("tenantId", "announcementId") REFERENCES "Announcement"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnnouncementDeliveryReport" DROP CONSTRAINT "AnnouncementDeliveryReport_announcementId_fkey";

ALTER TABLE "AnnouncementDeliveryReport" ADD CONSTRAINT "AnnouncementDeliveryReport_announcement_fkey"
  FOREIGN KEY ("tenantId", "announcementId") REFERENCES "Announcement"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
