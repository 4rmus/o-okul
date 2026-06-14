ALTER TABLE "User"
  ADD COLUMN "totpSecretEncrypted" TEXT,
  ADD COLUMN "totpEnabledAt" TIMESTAMPTZ(6),
  ADD COLUMN "totpRecoveryCodeHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "totpLastUsedCounter" TEXT;
