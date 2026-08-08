CREATE TABLE "WhatsAppConsent" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" TEXT NOT NULL,
  "phoneHash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "canReceiveWhatsapp" BOOLEAN NOT NULL DEFAULT false,
  "noticeVersion" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "recordedAt" TIMESTAMPTZ(6) NOT NULL,
  "withdrawnAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppConsent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WhatsAppConsent_phoneHash_check" CHECK ("phoneHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "WhatsAppConsent_purpose_check" CHECK ("purpose" = 'UTILITY_ANNOUNCEMENT'),
  CONSTRAINT "WhatsAppConsent_noticeVersion_check" CHECK (btrim("noticeVersion") <> ''),
  CONSTRAINT "WhatsAppConsent_source_check" CHECK (btrim("source") <> ''),
  CONSTRAINT "WhatsAppConsent_state_check" CHECK (
    ("canReceiveWhatsapp" AND "withdrawnAt" IS NULL)
    OR
    (
      NOT "canReceiveWhatsapp"
      AND ("withdrawnAt" IS NULL OR "withdrawnAt" >= "recordedAt")
    )
  )
);

CREATE UNIQUE INDEX "WhatsAppConsent_tenantId_id_key" ON "WhatsAppConsent"("tenantId", "id");
CREATE UNIQUE INDEX "WhatsAppConsent_tenantId_phoneHash_purpose_key"
  ON "WhatsAppConsent"("tenantId", "phoneHash", "purpose");
CREATE INDEX "WhatsAppConsent_tenantId_purpose_active_withdrawnAt_idx"
  ON "WhatsAppConsent"("tenantId", "purpose", "canReceiveWhatsapp", "withdrawnAt");

ALTER TABLE "WhatsAppConsent"
  ADD CONSTRAINT "WhatsAppConsent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppConsent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppConsent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "WhatsAppConsent_tenant_isolation" ON "WhatsAppConsent"
  USING (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "WhatsAppConsent" TO app;
  END IF;
END $$;
