CREATE TABLE "IdentityInvitation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" "TenantRole" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "acceptedUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdentityInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdentityInvitation_tokenHash_key" ON "IdentityInvitation"("tokenHash");
CREATE INDEX "IdentityInvitation_tenantId_subjectType_subjectId_status_idx" ON "IdentityInvitation"("tenantId", "subjectType", "subjectId", "status");
CREATE INDEX "IdentityInvitation_tenantId_email_idx" ON "IdentityInvitation"("tenantId", "email");

ALTER TABLE "IdentityInvitation" ADD CONSTRAINT "IdentityInvitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IdentityInvitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdentityInvitation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "IdentityInvitation_tenant_isolation" ON "IdentityInvitation"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "IdentityInvitation" TO app;
  END IF;
END $$;
