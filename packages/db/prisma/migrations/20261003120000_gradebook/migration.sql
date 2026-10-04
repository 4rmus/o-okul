-- ADR-0011: school grades live apart from the optical exam pipeline (Exam, ExamResult, ReportSnapshot untouched).
CREATE TABLE "GradeAssessment" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "termId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "heldOn" DATE NOT NULL,
  "maxScore" DECIMAL(5,2) NOT NULL DEFAULT 100,
  "publishedVersion" INTEGER,
  "notifiedVersion" INTEGER,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "GradeAssessment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "GradeAssessment_class_fkey" FOREIGN KEY ("tenantId", "classId") REFERENCES "Class"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "GradeAssessment_course_fkey" FOREIGN KEY ("tenantId", "courseId") REFERENCES "Course"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "GradeAssessment_term_fkey" FOREIGN KEY ("tenantId", "termId") REFERENCES "AcademicTerm"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "GradeAssessment_kind_check" CHECK ("kind" IN ('WRITTEN', 'PERFORMANCE', 'PROJECT', 'PARTICIPATION')),
  CONSTRAINT "GradeAssessment_maxScore_check" CHECK ("maxScore" > 0),
  CONSTRAINT "GradeAssessment_versions_check" CHECK (
    ("publishedVersion" IS NULL OR "publishedVersion" >= 1)
    AND ("notifiedVersion" IS NULL OR ("publishedVersion" IS NOT NULL AND "notifiedVersion" BETWEEN 1 AND "publishedVersion"))
  )
);
CREATE UNIQUE INDEX "GradeAssessment_tenantId_id_key" ON "GradeAssessment" ("tenantId", "id");
CREATE INDEX "GradeAssessment_tenantId_classId_termId_idx" ON "GradeAssessment" ("tenantId", "classId", "termId");

CREATE TABLE "GradeEntry" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "score" DECIMAL(5,2),
  "absent" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMPTZ(6),
  "enteredById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "GradeEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "GradeEntry_assessment_fkey" FOREIGN KEY ("tenantId", "assessmentId") REFERENCES "GradeAssessment"("tenantId", "id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "GradeEntry_student_fkey" FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "GradeEntry_version_check" CHECK ("version" >= 1),
  CONSTRAINT "GradeEntry_score_check" CHECK (("absent" AND "score" IS NULL) OR (NOT "absent" AND "score" IS NOT NULL AND "score" >= 0))
);
CREATE UNIQUE INDEX "GradeEntry_tenantId_id_key" ON "GradeEntry" ("tenantId", "id");
CREATE UNIQUE INDEX "GradeEntry_tenantId_assessmentId_studentId_version_key" ON "GradeEntry" ("tenantId", "assessmentId", "studentId", "version");
CREATE INDEX "GradeEntry_tenantId_studentId_idx" ON "GradeEntry" ("tenantId", "studentId");

-- A published entry never changes; a correction is a new version row. Only the tenant reset worker
-- (legal-clearance gated, child-first) may delete published rows; app and device restore may not.
-- Cascades from Student/GradeAssessment run as the table owner, so they are refused too.
CREATE FUNCTION protect_grade_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(NEW."id", NEW."tenantId", NEW."assessmentId", NEW."studentId", NEW."version")
     IS DISTINCT FROM ROW(OLD."id", OLD."tenantId", OLD."assessmentId", OLD."studentId", OLD."version") THEN
    RAISE EXCEPTION 'GRADE_ENTRY_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD."publishedAt" IS NOT NULL AND current_user <> 'o_okul_reset_worker' THEN
    RAISE EXCEPTION 'GRADE_ENTRY_PUBLISHED_IMMUTABLE';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER grade_entry_published_guard BEFORE UPDATE OR DELETE ON "GradeEntry" FOR EACH ROW EXECUTE FUNCTION protect_grade_entry();

-- Once published, the assessment's meaning (class, course, term, kind, date, scale) is fixed and the
-- published version only moves forward.
CREATE FUNCTION protect_grade_assessment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."publishedVersion" IS NOT NULL AND (
    ROW(NEW."tenantId", NEW."classId", NEW."courseId", NEW."termId", NEW."kind", NEW."heldOn", NEW."maxScore")
      IS DISTINCT FROM ROW(OLD."tenantId", OLD."classId", OLD."courseId", OLD."termId", OLD."kind", OLD."heldOn", OLD."maxScore")
    OR NEW."publishedVersion" IS NULL OR NEW."publishedVersion" < OLD."publishedVersion"
  ) THEN
    RAISE EXCEPTION 'GRADE_ASSESSMENT_PUBLISHED_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER grade_assessment_published_guard BEFORE UPDATE ON "GradeAssessment" FOR EACH ROW EXECUTE FUNCTION protect_grade_assessment();

ALTER TABLE "GradeAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GradeAssessment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GradeEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GradeEntry" FORCE ROW LEVEL SECURITY;

CREATE POLICY "GradeAssessment_tenant_isolation" ON "GradeAssessment"
  USING (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true));

-- Restricted profile: writes always carry the tenant context, never the bypass flag.
CREATE POLICY "GradeEntry_tenant_isolation" ON "GradeEntry"
  USING (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "GradeAssessment" TO app;
GRANT SELECT, INSERT, UPDATE ON "GradeEntry" TO app;

GRANT SELECT ON "GradeAssessment" TO o_okul_reset_worker;
GRANT DELETE ON "GradeAssessment" TO o_okul_reset_worker;
CREATE POLICY "GradeAssessment_reset_boundary" ON "GradeAssessment" AS RESTRICTIVE TO o_okul_reset_worker USING ("tenantId" = current_setting('app.current_tenant_id', true) AND "tenantId" <> 'system') WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true) AND "tenantId" <> 'system');
GRANT SELECT ON "GradeEntry" TO o_okul_reset_worker;
GRANT DELETE ON "GradeEntry" TO o_okul_reset_worker;
CREATE POLICY "GradeEntry_reset_boundary" ON "GradeEntry" AS RESTRICTIVE TO o_okul_reset_worker USING ("tenantId" = current_setting('app.current_tenant_id', true) AND "tenantId" <> 'system') WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true) AND "tenantId" <> 'system');

-- Device restore preserves grades like finance history: it reads them for the backup, never rewrites them.
GRANT SELECT ON "GradeAssessment" TO o_okul_device_restore_worker;
CREATE POLICY "GradeAssessment_device_restore_boundary" ON "GradeAssessment" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("GradeAssessment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("GradeAssessment"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
GRANT SELECT ON "GradeEntry" TO o_okul_device_restore_worker;
CREATE POLICY "GradeEntry_device_restore_boundary" ON "GradeEntry" AS RESTRICTIVE TO o_okul_device_restore_worker USING (("GradeEntry"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true))) WITH CHECK (("GradeEntry"."tenantId" = current_setting('app.current_tenant_id',true)) AND EXISTS (SELECT 1 FROM "Tenant" boundary WHERE boundary.id=current_setting('app.current_tenant_id',true)));
