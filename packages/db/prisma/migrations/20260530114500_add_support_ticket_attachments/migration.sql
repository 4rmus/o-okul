CREATE UNIQUE INDEX "SupportTicket_tenantId_id_key" ON "SupportTicket"("tenantId", "id");

CREATE TABLE "SupportTicketAttachment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "uploadedById" TEXT,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "contentBase64" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicketAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportTicketAttachment_tenantId_ticketId_deletedAt_idx"
  ON "SupportTicketAttachment"("tenantId", "ticketId", "deletedAt");
CREATE INDEX "SupportTicketAttachment_tenantId_sha256_idx"
  ON "SupportTicketAttachment"("tenantId", "sha256");

ALTER TABLE "SupportTicketAttachment" ADD CONSTRAINT "SupportTicketAttachment_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicketAttachment" ADD CONSTRAINT "SupportTicketAttachment_tenantId_ticketId_fkey"
  FOREIGN KEY ("tenantId", "ticketId") REFERENCES "SupportTicket"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportTicketAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportTicketAttachment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SupportTicketAttachment_tenant_isolation" ON "SupportTicketAttachment"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SupportTicketAttachment" TO app;
  END IF;
END $$;
