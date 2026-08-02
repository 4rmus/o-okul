WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "userId"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS "position"
  FROM "PasswordResetToken"
  WHERE "status" = 'PENDING'
), invalidated AS (
  UPDATE "PasswordResetToken" AS reset
  SET
    "status" = 'REVOKED',
    "updatedAt" = now()
  FROM ranked
  WHERE reset."id" = ranked."id"
    AND ranked."position" > 1
  RETURNING reset."id"
)
UPDATE "SecretDeliveryOutbox"
SET
  "status" = 'EXPIRED',
  "payloadEncrypted" = NULL,
  "claimedAt" = NULL,
  "lastErrorCode" = NULL,
  "updatedAt" = now()
WHERE "purpose" = 'PASSWORD_RESET'
  AND "sourceId" IN (SELECT "id" FROM invalidated)
  AND "payloadEncrypted" IS NOT NULL;

CREATE UNIQUE INDEX "PasswordResetToken_single_pending_user_key"
  ON "PasswordResetToken" ("userId")
  WHERE "status" = 'PENDING';
