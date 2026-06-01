CREATE TABLE "TeacherNote" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
  "body" TEXT NOT NULL,
  "developmentStatus" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeacherNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeacherNote_tenantId_studentId_visibility_deletedAt_idx"
  ON "TeacherNote"("tenantId", "studentId", "visibility", "deletedAt");
CREATE INDEX "TeacherNote_tenantId_teacherId_deletedAt_idx"
  ON "TeacherNote"("tenantId", "teacherId", "deletedAt");

ALTER TABLE "TeacherNote" ADD CONSTRAINT "TeacherNote_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherNote" ADD CONSTRAINT "TeacherNote_tenantId_studentId_fkey"
  FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherNote" ADD CONSTRAINT "TeacherNote_teacherId_fkey"
  FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeacherNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TeacherNote_tenant_isolation" ON "TeacherNote"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true)
         OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true)
              OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "TeacherNote" TO app;
  END IF;
END $$;
