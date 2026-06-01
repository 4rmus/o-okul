CREATE TABLE "LearningOutcome" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "level" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningOutcome_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearningOutcome_tenantId_code_key"
  ON "LearningOutcome"("tenantId", "code");
CREATE INDEX "LearningOutcome_tenantId_branch_deletedAt_idx"
  ON "LearningOutcome"("tenantId", "branch", "deletedAt");

ALTER TABLE "LearningOutcome" ADD CONSTRAINT "LearningOutcome_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LearningOutcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LearningOutcome" FORCE ROW LEVEL SECURITY;
CREATE POLICY "LearningOutcome_tenant_isolation" ON "LearningOutcome"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true)
         OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true)
              OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "LearningOutcome" TO app;
  END IF;
END $$;
