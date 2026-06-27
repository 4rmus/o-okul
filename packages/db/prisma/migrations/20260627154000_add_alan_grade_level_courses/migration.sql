CREATE TABLE "Alan" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "gradeLevelId" TEXT,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Alan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GradeLevelCourse" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "gradeLevelId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "alanId" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GradeLevelCourse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Alan_tenantId_id_key" ON "Alan"("tenantId", "id");
CREATE UNIQUE INDEX "Alan_tenantId_code_key" ON "Alan"("tenantId", "code");
CREATE INDEX "Alan_tenantId_gradeLevelId_idx" ON "Alan"("tenantId", "gradeLevelId");
CREATE INDEX "Alan_tenantId_deletedAt_idx" ON "Alan"("tenantId", "deletedAt");

CREATE UNIQUE INDEX "GradeLevelCourse_tenantId_id_key" ON "GradeLevelCourse"("tenantId", "id");
CREATE INDEX "GradeLevelCourse_tenantId_gradeLevelId_idx" ON "GradeLevelCourse"("tenantId", "gradeLevelId");
CREATE INDEX "GradeLevelCourse_tenantId_courseId_idx" ON "GradeLevelCourse"("tenantId", "courseId");
CREATE INDEX "GradeLevelCourse_tenantId_alanId_idx" ON "GradeLevelCourse"("tenantId", "alanId");
CREATE UNIQUE INDEX "GradeLevelCourse_common_course_key"
  ON "GradeLevelCourse"("tenantId", "gradeLevelId", "courseId")
  WHERE "alanId" IS NULL;
CREATE UNIQUE INDEX "GradeLevelCourse_alan_course_key"
  ON "GradeLevelCourse"("tenantId", "gradeLevelId", "courseId", "alanId")
  WHERE "alanId" IS NOT NULL;

ALTER TABLE "Alan"
  ADD CONSTRAINT "Alan_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Alan"
  ADD CONSTRAINT "Alan_tenantId_gradeLevelId_fkey"
  FOREIGN KEY ("tenantId", "gradeLevelId") REFERENCES "GradeLevel"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GradeLevelCourse"
  ADD CONSTRAINT "GradeLevelCourse_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GradeLevelCourse"
  ADD CONSTRAINT "GradeLevelCourse_tenantId_gradeLevelId_fkey"
  FOREIGN KEY ("tenantId", "gradeLevelId") REFERENCES "GradeLevel"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GradeLevelCourse"
  ADD CONSTRAINT "GradeLevelCourse_tenantId_courseId_fkey"
  FOREIGN KEY ("tenantId", "courseId") REFERENCES "Course"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GradeLevelCourse"
  ADD CONSTRAINT "GradeLevelCourse_tenantId_alanId_fkey"
  FOREIGN KEY ("tenantId", "alanId") REFERENCES "Alan"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Alan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Alan" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GradeLevelCourse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GradeLevelCourse" FORCE ROW LEVEL SECURITY;

CREATE POLICY "Alan_tenant_isolation" ON "Alan"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

CREATE POLICY "GradeLevelCourse_tenant_isolation" ON "GradeLevelCourse"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Alan", "GradeLevelCourse" TO app;
  END IF;
END $$;
