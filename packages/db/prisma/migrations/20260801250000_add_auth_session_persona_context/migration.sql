ALTER TABLE "AuthSession"
  ADD COLUMN "membershipId" TEXT,
  ADD COLUMN "activePersona" TEXT;

UPDATE "AuthSession" AS session
SET "membershipId" = membership."id",
    "activePersona" = CASE
      WHEN session."subjectType" = 'STUDENT' THEN 'STUDENT'
      WHEN session."subjectType" = 'TEACHER' THEN 'TEACHER'
      WHEN membership."staffRole" IS NOT NULL THEN 'STAFF'
      ELSE NULL
    END
FROM "TenantMembership" AS membership
WHERE membership."tenantId" = session."tenantId"
  AND membership."userId" = session."userId"
  AND membership."status" = 'ACTIVE'
  AND (
    membership."staffRole" IS NOT NULL
    OR membership."hasTeacherPersona"
    OR membership."hasStudentPersona"
  );

ALTER TABLE "AuthSession"
  ADD CONSTRAINT "AuthSession_activePersona_check"
  CHECK ("activePersona" IS NULL OR "activePersona" IN ('STAFF', 'TEACHER', 'STUDENT')),
  ADD CONSTRAINT "AuthSession_membership_persona_pair_check"
  CHECK (("membershipId" IS NULL) = ("activePersona" IS NULL)),
  ADD CONSTRAINT "AuthSession_tenantId_membershipId_fkey"
  FOREIGN KEY ("tenantId", "membershipId")
  REFERENCES "TenantMembership"("tenantId", "id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE INDEX "AuthSession_tenantId_membershipId_status_idx"
  ON "AuthSession"("tenantId", "membershipId", "status");
