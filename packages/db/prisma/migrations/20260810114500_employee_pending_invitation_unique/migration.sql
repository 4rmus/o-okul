BEGIN;

LOCK TABLE "IdentityInvitation" IN SHARE ROW EXCLUSIVE MODE;

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "tenantId", "subjectId"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS "position"
  FROM "IdentityInvitation"
  WHERE "subjectType" = 'EMPLOYEE' AND "status" = 'PENDING'
), invalidated AS (
  UPDATE "IdentityInvitation" AS invitation
  SET
    "status" = 'REVOKED',
    "updatedAt" = now()
  FROM ranked
  WHERE invitation."id" = ranked."id"
    AND ranked."position" > 1
  RETURNING invitation."id"
)
UPDATE "SecretDeliveryOutbox"
SET
  "status" = 'EXPIRED',
  "payloadEncrypted" = NULL,
  "claimedAt" = NULL,
  "claimToken" = NULL,
  "lastErrorCode" = NULL,
  "updatedAt" = now()
WHERE "purpose" = 'IDENTITY_INVITATION'
  AND "sourceId" IN (SELECT "id" FROM invalidated)
  AND "payloadEncrypted" IS NOT NULL;

CREATE UNIQUE INDEX "IdentityInvitation_one_pending_employee_key"
  ON "IdentityInvitation" ("tenantId", "subjectId")
  WHERE "subjectType" = 'EMPLOYEE' AND "status" = 'PENDING';

COMMIT;
