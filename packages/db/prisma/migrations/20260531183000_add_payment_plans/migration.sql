CREATE TABLE "PaymentPlan" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "totalAmount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'TRY',
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentInstallment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "installmentNo" INTEGER NOT NULL,
  "amount" INTEGER NOT NULL,
  "dueDate" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "paidAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentInstallment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentPlan_tenantId_studentId_deletedAt_idx"
  ON "PaymentPlan"("tenantId", "studentId", "deletedAt");
CREATE UNIQUE INDEX "PaymentPlan_tenantId_id_key"
  ON "PaymentPlan"("tenantId", "id");
CREATE UNIQUE INDEX "PaymentInstallment_tenantId_planId_installmentNo_key"
  ON "PaymentInstallment"("tenantId", "planId", "installmentNo");
CREATE INDEX "PaymentInstallment_tenantId_planId_dueDate_deletedAt_idx"
  ON "PaymentInstallment"("tenantId", "planId", "dueDate", "deletedAt");

ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_tenantId_studentId_fkey"
  FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentInstallment" ADD CONSTRAINT "PaymentInstallment_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentInstallment" ADD CONSTRAINT "PaymentInstallment_tenantId_planId_fkey"
  FOREIGN KEY ("tenantId", "planId") REFERENCES "PaymentPlan"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentPlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PaymentPlan_tenant_isolation" ON "PaymentPlan"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true)
         OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true)
              OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "PaymentInstallment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentInstallment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PaymentInstallment_tenant_isolation" ON "PaymentInstallment"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true)
         OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true)
              OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PaymentPlan" TO app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PaymentInstallment" TO app;
  END IF;
END $$;
