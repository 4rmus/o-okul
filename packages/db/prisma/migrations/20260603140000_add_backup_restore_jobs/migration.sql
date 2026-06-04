CREATE TABLE "BackupRestoreJob" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "operationType" TEXT NOT NULL,
  "targetReference" TEXT NOT NULL,
  "reason" TEXT,
  "queueName" TEXT NOT NULL DEFAULT 'backup-restore',
  "jobId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "result" TEXT,
  "checkedTables" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BackupRestoreJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BackupRestoreJob_tenantId_jobId_key"
  ON "BackupRestoreJob"("tenantId", "jobId");
CREATE INDEX "BackupRestoreJob_tenantId_status_updatedAt_idx"
  ON "BackupRestoreJob"("tenantId", "status", "updatedAt");
CREATE INDEX "BackupRestoreJob_tenantId_operationType_updatedAt_idx"
  ON "BackupRestoreJob"("tenantId", "operationType", "updatedAt");

ALTER TABLE "BackupRestoreJob" ADD CONSTRAINT "BackupRestoreJob_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BackupRestoreJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BackupRestoreJob" FORCE ROW LEVEL SECURITY;
CREATE POLICY "BackupRestoreJob_tenant_isolation" ON "BackupRestoreJob"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "BackupRestoreJob" TO app;
  END IF;
END $$;
