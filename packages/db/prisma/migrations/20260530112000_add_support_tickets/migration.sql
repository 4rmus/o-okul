CREATE TABLE "SupportTicket" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "requesterId" TEXT,
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportTicket_tenantId_status_deletedAt_idx" ON "SupportTicket"("tenantId", "status", "deletedAt");
CREATE INDEX "SupportTicket_tenantId_priority_idx" ON "SupportTicket"("tenantId", "priority");

ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportTicket" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SupportTicket_tenant_isolation" ON "SupportTicket"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SupportTicket" TO app;
  END IF;
END $$;
