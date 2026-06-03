CREATE TABLE "NotificationDeviceToken" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subjectType" TEXT,
  "subjectId" TEXT,
  "provider" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "platform" TEXT,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationDeviceToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationDeviceToken_tenantId_userId_token_key"
  ON "NotificationDeviceToken"("tenantId", "userId", "token");
CREATE INDEX "NotificationDeviceToken_tenantId_userId_disabledAt_idx"
  ON "NotificationDeviceToken"("tenantId", "userId", "disabledAt");
CREATE INDEX "NotificationDeviceToken_tenantId_subjectType_subjectId_disabledAt_idx"
  ON "NotificationDeviceToken"("tenantId", "subjectType", "subjectId", "disabledAt");

ALTER TABLE "NotificationDeviceToken" ADD CONSTRAINT "NotificationDeviceToken_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDeviceToken" ADD CONSTRAINT "NotificationDeviceToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDeviceToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationDeviceToken" FORCE ROW LEVEL SECURITY;
CREATE POLICY "NotificationDeviceToken_tenant_isolation" ON "NotificationDeviceToken"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "NotificationDeviceToken" TO app;
  END IF;
END $$;
