CREATE TABLE "HomeworkMaterialAssignment" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "assignedById" TEXT,
  "note" TEXT,
  "dueAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HomeworkMaterialAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HomeworkMaterialAssignment_tenantId_materialId_deletedAt_idx"
  ON "HomeworkMaterialAssignment"("tenantId", "materialId", "deletedAt");
CREATE INDEX "HomeworkMaterialAssignment_tenantId_studentId_deletedAt_idx"
  ON "HomeworkMaterialAssignment"("tenantId", "studentId", "deletedAt");

ALTER TABLE "HomeworkMaterialAssignment" ADD CONSTRAINT "HomeworkMaterialAssignment_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeworkMaterialAssignment" ADD CONSTRAINT "HomeworkMaterialAssignment_tenantId_materialId_fkey"
  FOREIGN KEY ("tenantId", "materialId") REFERENCES "HomeworkMaterial"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeworkMaterialAssignment" ADD CONSTRAINT "HomeworkMaterialAssignment_tenantId_studentId_fkey"
  FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HomeworkMaterialAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HomeworkMaterialAssignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "HomeworkMaterialAssignment_tenant_isolation" ON "HomeworkMaterialAssignment"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true)
         OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true)
              OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "HomeworkMaterialAssignment" TO app;
  END IF;
END $$;
