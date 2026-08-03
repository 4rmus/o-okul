ALTER TABLE "IdentityInvitation"
  ALTER COLUMN "email" DROP NOT NULL,
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'EMAIL_LINK',
  ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 5;

ALTER TABLE "IdentityInvitation"
  ADD CONSTRAINT "IdentityInvitation_kind_check"
    CHECK ("kind" IN ('EMAIL_LINK', 'STUDENT_CODE')),
  ADD CONSTRAINT "IdentityInvitation_attempts_check"
    CHECK ("failedAttempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 10 AND "failedAttempts" <= "maxAttempts"),
  ADD CONSTRAINT "IdentityInvitation_kind_payload_check"
    CHECK (
      ("kind" = 'EMAIL_LINK' AND "email" IS NOT NULL)
      OR
      ("kind" = 'STUDENT_CODE' AND "subjectType" = 'STUDENT' AND "role" = 'STUDENT' AND "email" IS NULL)
    );

CREATE UNIQUE INDEX "IdentityInvitation_one_pending_student_code_key"
  ON "IdentityInvitation" ("tenantId", "subjectId")
  WHERE "kind" = 'STUDENT_CODE' AND "subjectType" = 'STUDENT' AND "status" = 'PENDING';

CREATE INDEX "IdentityInvitation_student_code_lookup_idx"
  ON "IdentityInvitation" ("tenantId", "subjectId", "kind", "status", "expiresAt");
