CREATE TABLE IF NOT EXISTS "DevelopmentCriterion" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "scaleMin" INTEGER NOT NULL DEFAULT 1,
  "scaleMax" INTEGER NOT NULL DEFAULT 5,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "deletedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "DevelopmentCriterion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "DevelopmentCriterion_scale_check" CHECK ("scaleMin" < "scaleMax")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DevelopmentCriterion_tenantId_id_key" ON "DevelopmentCriterion" ("tenantId", "id");
CREATE INDEX IF NOT EXISTS "DevelopmentCriterion_tenantId_deletedAt_idx" ON "DevelopmentCriterion" ("tenantId", "deletedAt");

CREATE TABLE IF NOT EXISTS "DevelopmentAssessment" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "termId" TEXT,
  "periodLabel" TEXT NOT NULL,
  "mentorNote" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'GUARDIAN',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "DevelopmentAssessment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "DevelopmentAssessment_student_fkey" FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE,
  CONSTRAINT "DevelopmentAssessment_teacher_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT,
  CONSTRAINT "DevelopmentAssessment_visibility_check" CHECK ("visibility" IN ('INTERNAL', 'GUARDIAN'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "DevelopmentAssessment_tenantId_id_key" ON "DevelopmentAssessment" ("tenantId", "id");
CREATE INDEX IF NOT EXISTS "DevelopmentAssessment_tenantId_studentId_createdAt_idx" ON "DevelopmentAssessment" ("tenantId", "studentId", "createdAt");

CREATE TABLE IF NOT EXISTS "DevelopmentScore" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "criterionId" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "DevelopmentScore_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "DevelopmentScore_assessment_fkey" FOREIGN KEY ("tenantId", "assessmentId") REFERENCES "DevelopmentAssessment"("tenantId", "id") ON DELETE CASCADE,
  CONSTRAINT "DevelopmentScore_criterion_fkey" FOREIGN KEY ("tenantId", "criterionId") REFERENCES "DevelopmentCriterion"("tenantId", "id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "DevelopmentScore_tenantId_id_key" ON "DevelopmentScore" ("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "DevelopmentScore_tenantId_assessmentId_criterionId_key" ON "DevelopmentScore" ("tenantId", "assessmentId", "criterionId");

ALTER TABLE "DevelopmentCriterion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DevelopmentAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DevelopmentScore" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "DevelopmentCriterion_tenant_isolation" ON "DevelopmentCriterion"
  USING (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY "DevelopmentAssessment_tenant_isolation" ON "DevelopmentAssessment"
  USING (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY "DevelopmentScore_tenant_isolation" ON "DevelopmentScore"
  USING (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true));
