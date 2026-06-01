CREATE TABLE "AuthSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "roles" TEXT[] NOT NULL,
  "subjectType" TEXT,
  "subjectId" TEXT,
  "tokenFamilyId" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "membershipVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsumedRefreshToken" (
  "refreshTokenHash" TEXT NOT NULL,
  "tokenFamilyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConsumedRefreshToken_pkey" PRIMARY KEY ("refreshTokenHash")
);

CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key" ON "AuthSession"("refreshTokenHash");
CREATE INDEX "AuthSession_tenantId_userId_status_idx" ON "AuthSession"("tenantId", "userId", "status");
CREATE INDEX "AuthSession_tokenFamilyId_idx" ON "AuthSession"("tokenFamilyId");
CREATE INDEX "ConsumedRefreshToken_tokenFamilyId_idx" ON "ConsumedRefreshToken"("tokenFamilyId");

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuthSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AuthSession_tenant_isolation" ON "AuthSession"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AuthSession", "ConsumedRefreshToken" TO app;
  END IF;
END $$;
