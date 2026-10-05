-- DEC-20261004-10 (AK-6): per-student homework submission. Rows are created lazily on the first mark and
-- the status is derived: checkedAt -> checked, submittedAt -> submitted, no row -> not submitted. No file.
CREATE UNIQUE INDEX "Homework_tenantId_id_key" ON "Homework" ("tenantId", "id");

CREATE TABLE "HomeworkSubmission" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "homeworkId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "submittedAt" TIMESTAMPTZ(6),
  "checkedAt" TIMESTAMPTZ(6),
  "checkedById" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "HomeworkSubmission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "HomeworkSubmission_homework_fkey" FOREIGN KEY ("tenantId", "homeworkId") REFERENCES "Homework"("tenantId", "id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "HomeworkSubmission_student_fkey" FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "HomeworkSubmission_checkedBy_fkey" FOREIGN KEY ("tenantId", "checkedById") REFERENCES "User"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "HomeworkSubmission_checked_check" CHECK (("checkedAt" IS NULL) = ("checkedById" IS NULL))
);
CREATE UNIQUE INDEX "HomeworkSubmission_tenantId_id_key" ON "HomeworkSubmission" ("tenantId", "id");
CREATE UNIQUE INDEX "HomeworkSubmission_tenantId_homeworkId_studentId_key" ON "HomeworkSubmission" ("tenantId", "homeworkId", "studentId");
CREATE INDEX "HomeworkSubmission_tenantId_studentId_idx" ON "HomeworkSubmission" ("tenantId", "studentId");

ALTER TABLE "HomeworkSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HomeworkSubmission" FORCE ROW LEVEL SECURITY;

CREATE POLICY "HomeworkSubmission_tenant_isolation" ON "HomeworkSubmission"
  USING (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "HomeworkSubmission" TO app;

GRANT SELECT ON "HomeworkSubmission" TO o_okul_reset_worker;
GRANT DELETE ON "HomeworkSubmission" TO o_okul_reset_worker;
CREATE POLICY "HomeworkSubmission_reset_boundary" ON "HomeworkSubmission" AS RESTRICTIVE TO o_okul_reset_worker USING ("tenantId" = current_setting('app.current_tenant_id', true) AND "tenantId" <> 'system') WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true) AND "tenantId" <> 'system');

-- Device restore replaces homework data, submissions included (same policy as "Homework").
GRANT SELECT ON "HomeworkSubmission" TO o_okul_device_restore_worker;
CREATE POLICY "HomeworkSubmission_device_restore_boundary" ON "HomeworkSubmission" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("HomeworkSubmission"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("HomeworkSubmission"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT INSERT,UPDATE,DELETE ON "HomeworkSubmission" TO o_okul_device_restore_worker;
