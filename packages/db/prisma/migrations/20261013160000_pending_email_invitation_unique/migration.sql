-- One pending email invitation per teacher, student or guardian (docs/idempotency-kapsam-plani.md, Dilim 1.1).
-- A retried create or teacher update used to add a second PENDING row and send a second activation e-mail.
-- Employees and student activation codes already have their own indexes. Older duplicates are revoked the
-- same way as in 20260810114500; staging had none on 2026-10-13.
BEGIN;

LOCK TABLE "IdentityInvitation" IN SHARE ROW EXCLUSIVE MODE;

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "tenantId", "subjectType", "subjectId"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS "position"
  FROM "IdentityInvitation"
  WHERE "kind" = 'EMAIL_LINK' AND "subjectType" <> 'EMPLOYEE' AND "status" = 'PENDING'
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

CREATE UNIQUE INDEX "IdentityInvitation_one_pending_email_link_key"
  ON "IdentityInvitation" ("tenantId", "subjectType", "subjectId")
  WHERE "kind" = 'EMAIL_LINK' AND "subjectType" <> 'EMPLOYEE' AND "status" = 'PENDING';

COMMIT;
