CREATE TABLE "SupportTicketComment" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "authorId" TEXT,
  "body" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicketComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportTicketComment_tenantId_ticketId_deletedAt_idx"
  ON "SupportTicketComment"("tenantId", "ticketId", "deletedAt");
CREATE INDEX "SupportTicketComment_tenantId_authorId_idx"
  ON "SupportTicketComment"("tenantId", "authorId");

ALTER TABLE "SupportTicketComment" ADD CONSTRAINT "SupportTicketComment_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicketComment" ADD CONSTRAINT "SupportTicketComment_tenantId_ticketId_fkey"
  FOREIGN KEY ("tenantId", "ticketId") REFERENCES "SupportTicket"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportTicketComment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportTicketComment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SupportTicketComment_tenant_isolation" ON "SupportTicketComment"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true)
         OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true)
              OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SupportTicketComment" TO app;
  END IF;
END $$;
