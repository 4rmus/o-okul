ALTER TABLE "Course" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Course" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AcademicYear" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcademicYear" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AcademicTerm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcademicTerm" FORCE ROW LEVEL SECURITY;
ALTER TABLE "StudentClassHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentClassHistory" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Course' AND policyname = 'Course_tenant_isolation'
  ) THEN
    CREATE POLICY "Course_tenant_isolation" ON "Course"
      USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
      WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'AcademicYear' AND policyname = 'AcademicYear_tenant_isolation'
  ) THEN
    CREATE POLICY "AcademicYear_tenant_isolation" ON "AcademicYear"
      USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
      WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'AcademicTerm' AND policyname = 'AcademicTerm_tenant_isolation'
  ) THEN
    CREATE POLICY "AcademicTerm_tenant_isolation" ON "AcademicTerm"
      USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
      WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'StudentClassHistory' AND policyname = 'StudentClassHistory_tenant_isolation'
  ) THEN
    CREATE POLICY "StudentClassHistory_tenant_isolation" ON "StudentClassHistory"
      USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
      WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Course", "AcademicYear", "AcademicTerm", "StudentClassHistory" TO app;
  END IF;
END $$;
