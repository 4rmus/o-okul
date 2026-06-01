CREATE TABLE "Attendance" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "status" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Attendance_tenantId_studentId_date_key"
  ON "Attendance"("tenantId", "studentId", "date");
CREATE INDEX "Attendance_tenantId_date_deletedAt_idx"
  ON "Attendance"("tenantId", "date", "deletedAt");
CREATE INDEX "Attendance_tenantId_studentId_date_deletedAt_idx"
  ON "Attendance"("tenantId", "studentId", "date", "deletedAt");

ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_tenantId_studentId_fkey"
  FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attendance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Attendance_tenant_isolation" ON "Attendance"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true)
         OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true)
              OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Attendance" TO app;
  END IF;
END $$;
