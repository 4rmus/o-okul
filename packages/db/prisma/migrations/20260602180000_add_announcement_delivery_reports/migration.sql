CREATE TABLE "AnnouncementDeliveryReport" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "announcementId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "recipientCount" INTEGER NOT NULL DEFAULT 0,
  "deliveredCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "providerErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnnouncementDeliveryReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnouncementDeliveryReport_tenantId_announcementId_channel_key"
  ON "AnnouncementDeliveryReport"("tenantId", "announcementId", "channel");
CREATE INDEX "AnnouncementDeliveryReport_tenantId_announcementId_idx"
  ON "AnnouncementDeliveryReport"("tenantId", "announcementId");
CREATE INDEX "AnnouncementDeliveryReport_tenantId_channel_status_idx"
  ON "AnnouncementDeliveryReport"("tenantId", "channel", "status");

ALTER TABLE "AnnouncementDeliveryReport" ADD CONSTRAINT "AnnouncementDeliveryReport_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementDeliveryReport" ADD CONSTRAINT "AnnouncementDeliveryReport_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnnouncementDeliveryReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnnouncementDeliveryReport" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AnnouncementDeliveryReport_tenant_isolation" ON "AnnouncementDeliveryReport"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AnnouncementDeliveryReport" TO app;
  END IF;
END $$;
