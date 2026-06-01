CREATE UNIQUE INDEX "HomeworkMaterial_tenantId_id_key" ON "HomeworkMaterial"("tenantId", "id");

CREATE TABLE "HomeworkMaterialFile" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "uploadedById" TEXT,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "contentBase64" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HomeworkMaterialFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HomeworkMaterialFile_tenantId_materialId_deletedAt_idx"
  ON "HomeworkMaterialFile"("tenantId", "materialId", "deletedAt");
CREATE INDEX "HomeworkMaterialFile_tenantId_sha256_idx"
  ON "HomeworkMaterialFile"("tenantId", "sha256");

ALTER TABLE "HomeworkMaterialFile" ADD CONSTRAINT "HomeworkMaterialFile_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeworkMaterialFile" ADD CONSTRAINT "HomeworkMaterialFile_tenantId_materialId_fkey"
  FOREIGN KEY ("tenantId", "materialId") REFERENCES "HomeworkMaterial"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HomeworkMaterialFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HomeworkMaterialFile" FORCE ROW LEVEL SECURITY;
CREATE POLICY "HomeworkMaterialFile_tenant_isolation" ON "HomeworkMaterialFile"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "HomeworkMaterialFile" TO app;
  END IF;
END $$;
