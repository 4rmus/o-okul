CREATE TABLE "StudentEnrollment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "academicYearId" TEXT,
  "termId" TEXT,
  "classId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "startsAt" DATE NOT NULL,
  "endsAt" DATE,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentEnrollment_tenantId_studentId_startsAt_idx"
  ON "StudentEnrollment"("tenantId", "studentId", "startsAt");
CREATE INDEX "StudentEnrollment_tenantId_academicYearId_idx"
  ON "StudentEnrollment"("tenantId", "academicYearId");
CREATE INDEX "StudentEnrollment_tenantId_termId_idx"
  ON "StudentEnrollment"("tenantId", "termId");
CREATE INDEX "StudentEnrollment_tenantId_classId_idx"
  ON "StudentEnrollment"("tenantId", "classId");
CREATE INDEX "StudentEnrollment_tenantId_status_endsAt_idx"
  ON "StudentEnrollment"("tenantId", "status", "endsAt");

ALTER TABLE "StudentEnrollment" ADD CONSTRAINT "StudentEnrollment_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentEnrollment" ADD CONSTRAINT "StudentEnrollment_tenantId_studentId_fkey"
  FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentEnrollment" ADD CONSTRAINT "StudentEnrollment_tenantId_academicYearId_fkey"
  FOREIGN KEY ("tenantId", "academicYearId") REFERENCES "AcademicYear"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentEnrollment" ADD CONSTRAINT "StudentEnrollment_tenantId_termId_fkey"
  FOREIGN KEY ("tenantId", "termId") REFERENCES "AcademicTerm"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentEnrollment" ADD CONSTRAINT "StudentEnrollment_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudentEnrollment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentEnrollment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "StudentEnrollment_tenant_isolation" ON "StudentEnrollment"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "StudentEnrollment" TO app;
  END IF;
END $$;
