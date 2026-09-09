ALTER TABLE "Tenant"
  ADD COLUMN "lifecycleVersion" integer NOT NULL DEFAULT 0,
  ADD COLUMN "suspendedAt" timestamp(3),
  ADD COLUMN "suspendedReason" text,
  ADD CONSTRAINT "Tenant_lifecycleVersion_check" CHECK ("lifecycleVersion" >= 0),
  ADD CONSTRAINT "Tenant_suspendedReason_check" CHECK ("suspendedReason" IS NULL OR "suspendedReason" IN ('SECURITY_REVIEW', 'INSTITUTION_REQUEST', 'OPERATIONS_REVIEW'));
