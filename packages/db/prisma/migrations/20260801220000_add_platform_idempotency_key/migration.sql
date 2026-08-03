CREATE TABLE "PlatformIdempotencyKey" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "platformAccountId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "responseBody" JSONB,
  "completedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformIdempotencyKey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformIdempotencyKey_status_check" CHECK ("status" IN ('IN_PROGRESS', 'COMPLETED')),
  CONSTRAINT "PlatformIdempotencyKey_platformAccountId_fkey"
    FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "PlatformIdempotencyKey_account_key_operation_key"
  ON "PlatformIdempotencyKey"("platformAccountId", "key", "operation");
CREATE INDEX "PlatformIdempotencyKey_status_createdAt_idx"
  ON "PlatformIdempotencyKey"("status", "createdAt");
