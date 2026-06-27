ALTER TABLE "User"
  ADD COLUMN "tenantId" TEXT,
  ADD COLUMN "nationalIdEncrypted" TEXT,
  ADD COLUMN "nationalIdHash" TEXT,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "passwordChangedAt" TIMESTAMPTZ(6);

ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

UPDATE "User" u
SET "tenantId" = first_membership."tenantId"
FROM (
  SELECT DISTINCT ON ("userId") "userId", "tenantId"
  FROM "TenantMembership"
  ORDER BY "userId", "createdAt" ASC
) AS first_membership
WHERE first_membership."userId" = u."id";

ALTER TABLE "User"
  ADD CONSTRAINT "User_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "User_tenantId_nationalIdHash_key"
  ON "User" ("tenantId", "nationalIdHash");

CREATE UNIQUE INDEX "User_tenantId_id_key"
  ON "User" ("tenantId", "id");

CREATE INDEX "User_tenantId_idx" ON "User" ("tenantId");

CREATE UNIQUE INDEX "Student_tenantId_userId_key"
  ON "Student" ("tenantId", "userId");

CREATE UNIQUE INDEX "Teacher_tenantId_userId_key"
  ON "Teacher" ("tenantId", "userId");

CREATE UNIQUE INDEX "Guardian_tenantId_userId_key"
  ON "Guardian" ("tenantId", "userId");

ALTER TABLE "NotificationDeviceToken" DROP CONSTRAINT "NotificationDeviceToken_userId_fkey";
ALTER TABLE "NotificationDeviceToken"
  ADD CONSTRAINT "NotificationDeviceToken_tenantId_userId_fkey"
  FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantMembership" DROP CONSTRAINT "TenantMembership_userId_fkey";
ALTER TABLE "TenantMembership"
  ADD CONSTRAINT "TenantMembership_tenantId_userId_fkey"
  FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuthSession" DROP CONSTRAINT "AuthSession_userId_fkey";
ALTER TABLE "AuthSession"
  ADD CONSTRAINT "AuthSession_tenantId_userId_fkey"
  FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Student" DROP CONSTRAINT "Student_userId_fkey";
ALTER TABLE "Student"
  ADD CONSTRAINT "Student_tenantId_userId_fkey"
  FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Student" DROP CONSTRAINT "Student_createdById_fkey";
ALTER TABLE "Student"
  ADD CONSTRAINT "Student_tenantId_createdById_fkey"
  FOREIGN KEY ("tenantId", "createdById") REFERENCES "User"("tenantId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Student" DROP CONSTRAINT "Student_updatedById_fkey";
ALTER TABLE "Student"
  ADD CONSTRAINT "Student_tenantId_updatedById_fkey"
  FOREIGN KEY ("tenantId", "updatedById") REFERENCES "User"("tenantId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Teacher" DROP CONSTRAINT "Teacher_userId_fkey";
ALTER TABLE "Teacher"
  ADD CONSTRAINT "Teacher_tenantId_userId_fkey"
  FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Guardian" DROP CONSTRAINT "Guardian_userId_fkey";
ALTER TABLE "Guardian"
  ADD CONSTRAINT "Guardian_tenantId_userId_fkey"
  FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Homework" DROP CONSTRAINT "Homework_checkedById_fkey";
ALTER TABLE "Homework"
  ADD CONSTRAINT "Homework_tenantId_checkedById_fkey"
  FOREIGN KEY ("tenantId", "checkedById") REFERENCES "User"("tenantId", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;

CREATE POLICY "User_tenant_isolation" ON "User"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "User" TO app;
  END IF;
END $$;
