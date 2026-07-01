ALTER TABLE "AuthSession" ADD COLUMN "expiresAt" TIMESTAMPTZ(6);

UPDATE "AuthSession"
SET "expiresAt" = COALESCE("createdAt", CURRENT_TIMESTAMP) + INTERVAL '30 days'
WHERE "expiresAt" IS NULL;

ALTER TABLE "AuthSession" ALTER COLUMN "expiresAt" SET NOT NULL;

CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
