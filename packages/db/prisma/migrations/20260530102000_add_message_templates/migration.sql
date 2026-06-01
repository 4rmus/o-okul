CREATE TABLE "MessageTemplate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'SMS',
  "body" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessageTemplate_tenantId_deletedAt_idx" ON "MessageTemplate"("tenantId", "deletedAt");
CREATE INDEX "MessageTemplate_tenantId_channel_idx" ON "MessageTemplate"("tenantId", "channel");

ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MessageTemplate_tenant_isolation" ON "MessageTemplate"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "MessageTemplate" TO app;
  END IF;
END $$;
