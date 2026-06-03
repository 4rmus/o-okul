CREATE TABLE "SmsBatchDeliveryReport" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "recipientCount" INTEGER NOT NULL,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "billableSegments" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "providerErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmsBatchDeliveryReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmsBatchDeliveryReport_tenantId_jobId_key"
  ON "SmsBatchDeliveryReport"("tenantId", "jobId");
CREATE INDEX "SmsBatchDeliveryReport_tenantId_status_updatedAt_idx"
  ON "SmsBatchDeliveryReport"("tenantId", "status", "updatedAt");
CREATE INDEX "SmsBatchDeliveryReport_tenantId_templateId_idx"
  ON "SmsBatchDeliveryReport"("tenantId", "templateId");

ALTER TABLE "SmsBatchDeliveryReport" ADD CONSTRAINT "SmsBatchDeliveryReport_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SmsBatchDeliveryReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SmsBatchDeliveryReport" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SmsBatchDeliveryReport_tenant_isolation" ON "SmsBatchDeliveryReport"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SmsBatchDeliveryReport" TO app;
  END IF;
END $$;
