ALTER TABLE "Campus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campus" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GradeLevel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GradeLevel" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Campus' AND policyname = 'Campus_tenant_isolation'
  ) THEN
    CREATE POLICY "Campus_tenant_isolation" ON "Campus"
      USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
      WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'GradeLevel' AND policyname = 'GradeLevel_tenant_isolation'
  ) THEN
    CREATE POLICY "GradeLevel_tenant_isolation" ON "GradeLevel"
      USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
      WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Campus", "GradeLevel" TO app;
  END IF;
END $$;
