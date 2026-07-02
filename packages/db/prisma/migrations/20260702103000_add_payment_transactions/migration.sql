CREATE UNIQUE INDEX "PaymentInstallment_tenantId_id_key" ON "PaymentInstallment"("tenantId", "id");

CREATE TABLE "PaymentTransaction" (
  "id" text NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" text NOT NULL,
  "planId" text NOT NULL,
  "installmentId" text,
  "amount" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'TRY',
  "method" text NOT NULL,
  "paidAt" timestamp(3) NOT NULL,
  "receiptNo" text NOT NULL,
  "note" text,
  "recordedByUserId" text,
  "voidedAt" timestamp(3),
  "voidReason" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentTransaction_tenantId_id_key" ON "PaymentTransaction"("tenantId", "id");
CREATE UNIQUE INDEX "PaymentTransaction_tenantId_receiptNo_key" ON "PaymentTransaction"("tenantId", "receiptNo");
CREATE INDEX "PaymentTransaction_tenantId_planId_voidedAt_idx" ON "PaymentTransaction"("tenantId", "planId", "voidedAt");
CREATE INDEX "PaymentTransaction_tenantId_installmentId_idx" ON "PaymentTransaction"("tenantId", "installmentId");

ALTER TABLE "PaymentTransaction"
  ADD CONSTRAINT "PaymentTransaction_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentTransaction"
  ADD CONSTRAINT "PaymentTransaction_plan_fkey"
  FOREIGN KEY ("tenantId", "planId") REFERENCES "PaymentPlan"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentTransaction"
  ADD CONSTRAINT "PaymentTransaction_installment_fkey"
  FOREIGN KEY ("tenantId", "installmentId") REFERENCES "PaymentInstallment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentTransaction" FORCE ROW LEVEL SECURITY;

CREATE POLICY "PaymentTransaction_tenant_isolation" ON "PaymentTransaction"
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR "tenantId" = current_setting('app.current_tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR "tenantId" = current_setting('app.current_tenant_id', true)
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PaymentTransaction" TO app;
  END IF;
END $$;
