ALTER TABLE "AuditLog" RENAME TO "AuditLog_legacy";
ALTER INDEX "AuditLog_tenantId_entityType_createdAt_idx" RENAME TO "AuditLog_legacy_tenantId_entityType_createdAt_idx";
ALTER TABLE "AuditLog_legacy" RENAME CONSTRAINT "AuditLog_pkey" TO "AuditLog_legacy_pkey";
ALTER TABLE "AuditLog_legacy" RENAME CONSTRAINT "AuditLog_tenantId_fkey" TO "AuditLog_legacy_tenantId_fkey";

DROP POLICY IF EXISTS "AuditLog_tenant_isolation" ON "AuditLog_legacy";

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "actorUserId" TEXT,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "action" TEXT NOT NULL,
  "diff" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");

CREATE TABLE "AuditLog_default" PARTITION OF "AuditLog" DEFAULT;

CREATE TABLE "AuditLog_2026_01" PARTITION OF "AuditLog"
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE "AuditLog_2026_02" PARTITION OF "AuditLog"
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE "AuditLog_2026_03" PARTITION OF "AuditLog"
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE "AuditLog_2026_04" PARTITION OF "AuditLog"
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE "AuditLog_2026_05" PARTITION OF "AuditLog"
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE "AuditLog_2026_06" PARTITION OF "AuditLog"
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE "AuditLog_2026_07" PARTITION OF "AuditLog"
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE "AuditLog_2026_08" PARTITION OF "AuditLog"
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE "AuditLog_2026_09" PARTITION OF "AuditLog"
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE "AuditLog_2026_10" PARTITION OF "AuditLog"
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "AuditLog_2026_11" PARTITION OF "AuditLog"
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "AuditLog_2026_12" PARTITION OF "AuditLog"
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE INDEX "AuditLog_tenantId_entityType_createdAt_idx" ON "AuditLog"("tenantId", "entityType", "createdAt");
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AuditLog_tenant_isolation" ON "AuditLog"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

INSERT INTO "AuditLog" ("id", "tenantId", "actorUserId", "entityType", "entityId", "action", "diff", "createdAt")
SELECT "id", "tenantId", "actorUserId", "entityType", "entityId", "action", "diff", "createdAt"
FROM "AuditLog_legacy";

DROP TABLE "AuditLog_legacy";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AuditLog" TO app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "AuditLog_default" TO app;
  END IF;
END $$;
