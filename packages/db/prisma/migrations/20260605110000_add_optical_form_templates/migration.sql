CREATE TABLE "OpticalFormTemplate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "encoding" TEXT NOT NULL,
  "delimiter" TEXT NOT NULL,
  "skipHeaderLines" INTEGER NOT NULL DEFAULT 0,
  "fieldMapping" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'APPROVED',
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpticalFormTemplate_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ParserConfig"
  ADD COLUMN "templateId" TEXT;

CREATE UNIQUE INDEX "OpticalFormTemplate_tenantId_id_key"
  ON "OpticalFormTemplate"("tenantId", "id");
CREATE UNIQUE INDEX "OpticalFormTemplate_tenantId_name_key"
  ON "OpticalFormTemplate"("tenantId", "name");
CREATE INDEX "OpticalFormTemplate_tenantId_status_deletedAt_idx"
  ON "OpticalFormTemplate"("tenantId", "status", "deletedAt");
CREATE INDEX "OpticalFormTemplate_tenantId_deletedAt_idx"
  ON "OpticalFormTemplate"("tenantId", "deletedAt");
CREATE INDEX "ParserConfig_tenantId_templateId_idx"
  ON "ParserConfig"("tenantId", "templateId");

ALTER TABLE "OpticalFormTemplate" ADD CONSTRAINT "OpticalFormTemplate_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpticalFormTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpticalFormTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "OpticalFormTemplate_tenant_isolation" ON "OpticalFormTemplate"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "OpticalFormTemplate" TO app;
  END IF;
END $$;
