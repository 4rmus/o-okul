ALTER TABLE "AnnouncementReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnnouncementReceipt" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DevelopmentCriterion" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DevelopmentAssessment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DevelopmentScore" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'AnnouncementReceipt' AND policyname = 'AnnouncementReceipt_tenant_isolation'
  ) THEN
    CREATE POLICY "AnnouncementReceipt_tenant_isolation" ON "AnnouncementReceipt"
      USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
      WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AnnouncementReceipt" TO app;
  END IF;
END $$;
