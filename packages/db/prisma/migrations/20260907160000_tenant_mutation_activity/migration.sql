CREATE TABLE "TenantMutationActivity" (
  "id" text PRIMARY KEY, "tenantId" text NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "lifecycleVersion" integer NOT NULL CHECK ("lifecycleVersion" >= 0),
  "kind" text NOT NULL CHECK ("kind" IN ('HTTP_MUTATION','S3_MUTATION','QUEUE_ADMISSION','WORKER_JOB')),
  "status" text NOT NULL DEFAULT 'RUNNING' CHECK ("status" IN ('RUNNING','UNCERTAIN')),
  "createdAt" timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX "TenantMutationActivity_tenantId_status_idx" ON "TenantMutationActivity"("tenantId", "status");
ALTER TABLE "TenantMutationActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantMutationActivity" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TenantMutationActivity_tenant_isolation" ON "TenantMutationActivity"
  USING ("tenantId" = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "TenantMutationActivity" TO app;
  END IF;
END $$;
GRANT SELECT ON "TenantMutationActivity" TO o_okul_reset_worker;
CREATE POLICY "TenantMutationActivity_reset_boundary" ON "TenantMutationActivity" AS RESTRICTIVE TO o_okul_reset_worker
  USING ("tenantId" = current_setting('app.current_tenant_id', true) AND "tenantId" <> 'system')
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true) AND "tenantId" <> 'system');
