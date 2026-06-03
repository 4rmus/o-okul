CREATE TABLE "ExamBookletVariant" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "permutation" JSONB NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExamBookletVariant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExamBookletVariant_tenantId_id_key"
  ON "ExamBookletVariant"("tenantId", "id");
CREATE UNIQUE INDEX "ExamBookletVariant_tenantId_examId_code_key"
  ON "ExamBookletVariant"("tenantId", "examId", "code");
CREATE INDEX "ExamBookletVariant_tenantId_examId_idx"
  ON "ExamBookletVariant"("tenantId", "examId");
CREATE INDEX "ExamBookletVariant_tenantId_deletedAt_idx"
  ON "ExamBookletVariant"("tenantId", "deletedAt");

ALTER TABLE "ExamBookletVariant" ADD CONSTRAINT "ExamBookletVariant_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamBookletVariant" ADD CONSTRAINT "ExamBookletVariant_tenantId_examId_fkey"
  FOREIGN KEY ("tenantId", "examId") REFERENCES "Exam"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExamBookletVariant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExamBookletVariant" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ExamBookletVariant_tenant_isolation" ON "ExamBookletVariant"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ExamBookletVariant" TO app;
  END IF;
END $$;
