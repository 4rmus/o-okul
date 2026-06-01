CREATE TABLE "Announcement" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "audience" TEXT NOT NULL DEFAULT 'SCHOOL',
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Announcement_tenantId_deletedAt_idx" ON "Announcement"("tenantId", "deletedAt");
CREATE INDEX "Announcement_tenantId_audience_publishedAt_idx" ON "Announcement"("tenantId", "audience", "publishedAt");

ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Announcement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Announcement" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Announcement_tenant_isolation" ON "Announcement"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');
