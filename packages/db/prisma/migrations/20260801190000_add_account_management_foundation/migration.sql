ALTER TYPE "TenantRole" ADD VALUE IF NOT EXISTS 'TENANT_OWNER';
ALTER TYPE "TenantRole" ADD VALUE IF NOT EXISTS 'OPERATIONS_STAFF';
ALTER TYPE "TenantRole" ADD VALUE IF NOT EXISTS 'FINANCE_STAFF';

CREATE TYPE "StaffRole" AS ENUM ('TENANT_OWNER', 'TENANT_ADMIN', 'OPERATIONS_STAFF', 'FINANCE_STAFF');

ALTER TABLE "User"
  ADD COLUMN "emailNormalized" TEXT,
  ADD COLUMN "loginName" TEXT,
  ADD COLUMN "loginNameNormalized" TEXT,
  ADD COLUMN "passwordHashVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "accountStatus" TEXT NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "TenantMembership"
  ADD COLUMN "staffRole" "StaffRole",
  ADD COLUMN "hasTeacherPersona" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hasStudentPersona" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "startsAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "endsAt" TIMESTAMPTZ(6),
  ADD COLUMN "endedReason" TEXT,
  ADD COLUMN "scopeMode" TEXT NOT NULL DEFAULT 'TENANT';

ALTER TABLE "Campus" ADD COLUMN "unitType" TEXT;
ALTER TABLE "Teacher" ADD COLUMN "employeeId" TEXT;

ALTER TABLE "User"
  ADD CONSTRAINT "User_passwordHashVersion_check" CHECK ("passwordHashVersion" >= 1),
  ADD CONSTRAINT "User_accountStatus_check" CHECK ("accountStatus" IN ('PENDING_ACTIVATION', 'ACTIVE', 'LOCKED', 'DISABLED')),
  ADD CONSTRAINT "User_loginNameNormalized_check" CHECK (
    "loginNameNormalized" IS NULL OR ("loginNameNormalized" = lower(btrim("loginNameNormalized")) AND "loginNameNormalized" <> '')
  ),
  ADD CONSTRAINT "User_emailNormalized_check" CHECK (
    "emailNormalized" IS NULL OR ("emailNormalized" = lower(btrim("emailNormalized")) AND "emailNormalized" <> '')
  );

ALTER TABLE "TenantMembership"
  ADD CONSTRAINT "TenantMembership_status_check" CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'ENDED')),
  ADD CONSTRAINT "TenantMembership_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "TenantMembership_dates_check" CHECK ("endsAt" IS NULL OR "startsAt" < "endsAt"),
  ADD CONSTRAINT "TenantMembership_ended_reason_check" CHECK ("status" <> 'ENDED' OR ("endsAt" IS NOT NULL AND "endedReason" IS NOT NULL)),
  ADD CONSTRAINT "TenantMembership_scopeMode_check" CHECK ("scopeMode" IN ('TENANT', 'CAMPUSES')),
  ADD CONSTRAINT "TenantMembership_persona_combination_check" CHECK (
    NOT "hasStudentPersona" OR ("staffRole" IS NULL AND NOT "hasTeacherPersona")
  );

CREATE UNIQUE INDEX "User_tenantId_loginNameNormalized_key" ON "User"("tenantId", "loginNameNormalized");
CREATE UNIQUE INDEX "User_tenantId_emailNormalized_key" ON "User"("tenantId", "emailNormalized");
CREATE UNIQUE INDEX "TenantMembership_tenantId_id_key" ON "TenantMembership"("tenantId", "id");
CREATE INDEX "TenantMembership_tenantId_userId_status_idx" ON "TenantMembership"("tenantId", "userId", "status");
CREATE UNIQUE INDEX "TenantMembership_tenantId_userId_canonical_key"
  ON "TenantMembership"("tenantId", "userId")
  WHERE "staffRole" IS NOT NULL OR "hasTeacherPersona" OR "hasStudentPersona";
CREATE UNIQUE INDEX "Teacher_employeeId_key" ON "Teacher"("employeeId");
CREATE UNIQUE INDEX "Teacher_tenantId_employeeId_key" ON "Teacher"("tenantId", "employeeId");

CREATE TABLE "PlatformAccount" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "loginName" TEXT NOT NULL,
  "loginNameNormalized" TEXT NOT NULL,
  "email" TEXT,
  "emailNormalized" TEXT,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "passwordHashVersion" INTEGER NOT NULL DEFAULT 2,
  "status" TEXT NOT NULL DEFAULT 'PENDING_ACTIVATION',
  "totpSecretEncrypted" TEXT,
  "totpEnabledAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformAccount_passwordHashVersion_check" CHECK ("passwordHashVersion" >= 1),
  CONSTRAINT "PlatformAccount_status_check" CHECK ("status" IN ('PENDING_ACTIVATION', 'ACTIVE', 'LOCKED', 'DISABLED')),
  CONSTRAINT "PlatformAccount_loginNameNormalized_check" CHECK (
    "loginNameNormalized" = lower(btrim("loginNameNormalized")) AND "loginNameNormalized" <> ''
  ),
  CONSTRAINT "PlatformAccount_emailNormalized_check" CHECK (
    "emailNormalized" IS NULL OR ("emailNormalized" = lower(btrim("emailNormalized")) AND "emailNormalized" <> '')
  )
);

CREATE UNIQUE INDEX "PlatformAccount_loginNameNormalized_key" ON "PlatformAccount"("loginNameNormalized");
CREATE UNIQUE INDEX "PlatformAccount_emailNormalized_key" ON "PlatformAccount"("emailNormalized");
CREATE INDEX "PlatformAccount_status_idx" ON "PlatformAccount"("status");

CREATE TABLE "PlatformSession" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "platformAccountId" TEXT NOT NULL,
  "tokenFamilyId" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformSession_status_check" CHECK ("status" IN ('ACTIVE', 'REVOKED', 'COMPROMISED'))
);

CREATE UNIQUE INDEX "PlatformSession_refreshTokenHash_key" ON "PlatformSession"("refreshTokenHash");
CREATE INDEX "PlatformSession_platformAccountId_status_idx" ON "PlatformSession"("platformAccountId", "status");
CREATE INDEX "PlatformSession_tokenFamilyId_idx" ON "PlatformSession"("tokenFamilyId");
CREATE INDEX "PlatformSession_expiresAt_idx" ON "PlatformSession"("expiresAt");

CREATE TABLE "LicenseTerm" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" TEXT NOT NULL,
  "planCode" TEXT NOT NULL,
  "startsAt" TIMESTAMPTZ(6) NOT NULL,
  "endsAt" TIMESTAMPTZ(6) NOT NULL,
  "activeStudentLimit" INTEGER NOT NULL,
  "cancelledAt" TIMESTAMPTZ(6),
  "createdByPlatformAccountId" TEXT,
  "auditReference" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LicenseTerm_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LicenseTerm_dates_check" CHECK ("startsAt" < "endsAt"),
  CONSTRAINT "LicenseTerm_activeStudentLimit_check" CHECK ("activeStudentLimit" > 0)
);

CREATE UNIQUE INDEX "LicenseTerm_tenantId_id_key" ON "LicenseTerm"("tenantId", "id");
CREATE INDEX "LicenseTerm_tenantId_startsAt_endsAt_idx" ON "LicenseTerm"("tenantId", "startsAt", "endsAt");
CREATE INDEX "LicenseTerm_createdByPlatformAccountId_idx" ON "LicenseTerm"("createdByPlatformAccountId");

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "LicenseTerm"
  ADD CONSTRAINT "LicenseTerm_no_active_overlap"
  EXCLUDE USING GIST (
    "tenantId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("cancelledAt" IS NULL);

CREATE TABLE "LicenseUsage" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" TEXT NOT NULL,
  "licenseTermId" TEXT,
  "usageDate" DATE NOT NULL,
  "activeStudentCount" INTEGER NOT NULL DEFAULT 0,
  "peakActiveStudentCount" INTEGER NOT NULL DEFAULT 0,
  "reconciledAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LicenseUsage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LicenseUsage_counts_check" CHECK (
    "activeStudentCount" >= 0 AND "peakActiveStudentCount" >= "activeStudentCount"
  )
);

CREATE UNIQUE INDEX "LicenseUsage_tenantId_id_key" ON "LicenseUsage"("tenantId", "id");
CREATE UNIQUE INDEX "LicenseUsage_tenantId_usageDate_key" ON "LicenseUsage"("tenantId", "usageDate");
CREATE INDEX "LicenseUsage_tenantId_licenseTermId_usageDate_idx" ON "LicenseUsage"("tenantId", "licenseTermId", "usageDate");

CREATE TABLE "Employee" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" TEXT NOT NULL,
  "employeeNo" TEXT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "nationalIdEncrypted" TEXT,
  "nationalIdHash" TEXT,
  "workEmail" TEXT,
  "phone" TEXT,
  "userId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "employmentStartsAt" DATE,
  "employmentEndsAt" DATE,
  "endedReason" TEXT,
  "deletedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Employee_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Employee_status_check" CHECK ("status" IN ('PLANNED', 'ACTIVE', 'LEAVE', 'ENDED')),
  CONSTRAINT "Employee_dates_check" CHECK (
    "employmentEndsAt" IS NULL OR "employmentStartsAt" IS NULL OR "employmentStartsAt" < "employmentEndsAt"
  ),
  CONSTRAINT "Employee_ended_reason_check" CHECK (
    "status" <> 'ENDED' OR ("employmentEndsAt" IS NOT NULL AND "endedReason" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "Employee_tenantId_id_key" ON "Employee"("tenantId", "id");
CREATE UNIQUE INDEX "Employee_tenantId_employeeNo_key" ON "Employee"("tenantId", "employeeNo");
CREATE UNIQUE INDEX "Employee_tenantId_userId_key" ON "Employee"("tenantId", "userId");
CREATE UNIQUE INDEX "Employee_tenantId_nationalIdHash_key" ON "Employee"("tenantId", "nationalIdHash");
CREATE INDEX "Employee_tenantId_status_deletedAt_idx" ON "Employee"("tenantId", "status", "deletedAt");
CREATE INDEX "Employee_tenantId_workEmail_idx" ON "Employee"("tenantId", "workEmail");

CREATE TABLE "MembershipCampusScope" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MembershipCampusScope_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MembershipCampusScope_tenantId_id_key" ON "MembershipCampusScope"("tenantId", "id");
CREATE UNIQUE INDEX "MembershipCampusScope_tenantId_membershipId_campusId_key" ON "MembershipCampusScope"("tenantId", "membershipId", "campusId");
CREATE INDEX "MembershipCampusScope_tenantId_campusId_idx" ON "MembershipCampusScope"("tenantId", "campusId");

CREATE TABLE "StudentContact" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "relationType" TEXT NOT NULL,
  "phoneEncrypted" TEXT,
  "phoneHash" TEXT,
  "emailEncrypted" TEXT,
  "emailHash" TEXT,
  "canReceiveSms" BOOLEAN NOT NULL DEFAULT false,
  "canReceiveAnnouncements" BOOLEAN NOT NULL DEFAULT false,
  "canReceiveFinance" BOOLEAN NOT NULL DEFAULT false,
  "consentSource" TEXT,
  "consentRecordedAt" TIMESTAMPTZ(6),
  "deletedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentContact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudentContact_relationType_check" CHECK ("relationType" IN ('MOTHER', 'FATHER', 'LEGAL_GUARDIAN', 'OTHER')),
  CONSTRAINT "StudentContact_consent_check" CHECK (
    NOT ("canReceiveSms" OR "canReceiveAnnouncements" OR "canReceiveFinance")
    OR ("consentRecordedAt" IS NOT NULL AND "consentSource" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "StudentContact_tenantId_id_key" ON "StudentContact"("tenantId", "id");
CREATE INDEX "StudentContact_tenantId_studentId_deletedAt_idx" ON "StudentContact"("tenantId", "studentId", "deletedAt");
CREATE INDEX "StudentContact_tenantId_phoneHash_idx" ON "StudentContact"("tenantId", "phoneHash");
CREATE INDEX "StudentContact_tenantId_emailHash_idx" ON "StudentContact"("tenantId", "emailHash");

ALTER TABLE "PlatformSession"
  ADD CONSTRAINT "PlatformSession_platformAccountId_fkey"
  FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LicenseTerm"
  ADD CONSTRAINT "LicenseTerm_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LicenseTerm_createdByPlatformAccountId_fkey"
  FOREIGN KEY ("createdByPlatformAccountId") REFERENCES "PlatformAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LicenseUsage"
  ADD CONSTRAINT "LicenseUsage_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LicenseUsage_licenseTerm_fkey"
  FOREIGN KEY ("tenantId", "licenseTermId") REFERENCES "LicenseTerm"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Employee"
  ADD CONSTRAINT "Employee_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Employee_accountUser_fkey"
  FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "Teacher"
  ADD CONSTRAINT "Teacher_employee_fkey"
  FOREIGN KEY ("tenantId", "employeeId") REFERENCES "Employee"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "MembershipCampusScope"
  ADD CONSTRAINT "MembershipCampusScope_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MembershipCampusScope_membership_fkey"
  FOREIGN KEY ("tenantId", "membershipId") REFERENCES "TenantMembership"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MembershipCampusScope_campus_fkey"
  FOREIGN KEY ("tenantId", "campusId") REFERENCES "Campus"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudentContact"
  ADD CONSTRAINT "StudentContact_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "StudentContact_student_fkey"
  FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LicenseTerm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LicenseTerm" FORCE ROW LEVEL SECURITY;
CREATE POLICY "LicenseTerm_tenant_isolation" ON "LicenseTerm"
  USING (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "LicenseUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LicenseUsage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "LicenseUsage_tenant_isolation" ON "LicenseUsage"
  USING (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Employee" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Employee_tenant_isolation" ON "Employee"
  USING (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "MembershipCampusScope" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MembershipCampusScope" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MembershipCampusScope_tenant_isolation" ON "MembershipCampusScope"
  USING (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "StudentContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentContact" FORCE ROW LEVEL SECURITY;
CREATE POLICY "StudentContact_tenant_isolation" ON "StudentContact"
  USING (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "LicenseTerm",
      "LicenseUsage",
      "Employee",
      "MembershipCampusScope",
      "StudentContact"
    TO app;
  END IF;
END $$;
