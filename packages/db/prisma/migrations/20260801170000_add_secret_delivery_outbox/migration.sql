CREATE TABLE "SecretDeliveryOutbox" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "purpose" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "payloadEncrypted" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "claimedAt" TIMESTAMPTZ(6),
  "deliveredAt" TIMESTAMPTZ(6),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecretDeliveryOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SecretDeliveryOutbox_purpose_check" CHECK ("purpose" IN ('PASSWORD_RESET', 'IDENTITY_INVITATION')),
  CONSTRAINT "SecretDeliveryOutbox_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'EXPIRED')),
  CONSTRAINT "SecretDeliveryOutbox_attempts_check" CHECK ("attempts" >= 0)
);

CREATE INDEX "SecretDeliveryOutbox_status_availableAt_idx" ON "SecretDeliveryOutbox"("status", "availableAt");
CREATE INDEX "SecretDeliveryOutbox_tenantId_purpose_createdAt_idx" ON "SecretDeliveryOutbox"("tenantId", "purpose", "createdAt");
CREATE INDEX "SecretDeliveryOutbox_purpose_sourceId_status_idx" ON "SecretDeliveryOutbox"("purpose", "sourceId", "status");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SecretDeliveryOutbox" TO app;
  END IF;
END $$;
