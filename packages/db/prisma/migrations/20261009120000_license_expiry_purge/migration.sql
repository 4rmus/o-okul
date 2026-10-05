-- DEC-20261005-03: license-expiry purge reuses the reset operation ledger. No new table or column.
ALTER TABLE "TenantFreshResetOperation" DROP CONSTRAINT "TenantFreshResetOperation_preset_check";
ALTER TABLE "TenantFreshResetOperation" ADD CONSTRAINT "TenantFreshResetOperation_preset_check" CHECK ("preset" IN ('CLEAN_SETUP_V1', 'LICENSE_EXPIRY_PURGE_V1'));
ALTER TABLE "TenantFreshResetOperation" DROP CONSTRAINT "TenantFreshResetOperation_reason_check";
ALTER TABLE "TenantFreshResetOperation" ADD CONSTRAINT "TenantFreshResetOperation_reason_check" CHECK ("reason" IN ('SECURITY_REVIEW', 'INSTITUTION_REQUEST', 'OPERATIONS_REVIEW', 'LICENSE_EXPIRED'));
ALTER TABLE "TenantFreshResetOperation" DROP CONSTRAINT "TenantFreshResetOperation_status_check";
ALTER TABLE "TenantFreshResetOperation" ADD CONSTRAINT "TenantFreshResetOperation_status_check" CHECK ("status" IN ('QUEUED', 'RUNNING', 'BLOCKED', 'FAILED', 'COMPLETED', 'CANCELLED'));
-- A purge carries the LICENSE_EXPIRED reason and never an institution request. CANCELLED only stops a
-- purge whose database phase has not committed (license renewed in the meantime).
ALTER TABLE "TenantFreshResetOperation" ADD CONSTRAINT "TenantFreshResetOperation_purge_shape_check" CHECK (
  (("preset" = 'LICENSE_EXPIRY_PURGE_V1') = ("reason" = 'LICENSE_EXPIRED'))
  AND ("preset" = 'CLEAN_SETUP_V1' OR "institutionRequestId" IS NULL)
  AND ("status" <> 'CANCELLED' OR ("preset" = 'LICENSE_EXPIRY_PURGE_V1' AND "phase" IN ('PREFLIGHT', 'BACKUP', 'DATABASE')))
);
DROP INDEX "TenantFreshResetOperation_one_unfinished";
CREATE UNIQUE INDEX "TenantFreshResetOperation_one_unfinished" ON "TenantFreshResetOperation"("tenantId") WHERE "status" NOT IN ('COMPLETED', 'CANCELLED');

-- A purged tenant is a SUSPENDED tombstone and is never reactivated.
CREATE OR REPLACE FUNCTION o_okul_block_active_during_reset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'ACTIVE' AND OLD."status" <> 'ACTIVE' AND EXISTS (
    SELECT 1 FROM "TenantFreshResetOperation" WHERE "tenantId" = NEW."id" AND "status" NOT IN ('COMPLETED', 'CANCELLED')
  ) THEN RAISE EXCEPTION USING MESSAGE = 'RESET_OPERATION_IN_PROGRESS'; END IF;
  IF NEW."status" = 'ACTIVE' AND OLD."status" <> 'ACTIVE' AND EXISTS (
    SELECT 1 FROM "TenantFreshResetOperation" WHERE "tenantId" = NEW."id" AND "preset" = 'LICENSE_EXPIRY_PURGE_V1' AND "status" = 'COMPLETED'
  ) THEN RAISE EXCEPTION USING MESSAGE = 'TENANT_PURGED'; END IF;
  RETURN NEW;
END $$;

-- The narrowest AuditLog/finance/support/consent delete path: the reset worker keeps no DELETE grant on
-- those tables (assertResetWorkerRole still verifies that); only this function, callable only by the
-- reset worker for its own RUNNING purge operation, removes them after re-checking the license under
-- the Tenant row lock. p_final removes phase records written after the database purge, scrubs the
-- tombstone and writes the single system-scope receipt (tenant id, slug hash, time, counts; no PII).
CREATE FUNCTION o_okul_license_expiry_purge(p_tenant_id TEXT, p_operation_id TEXT, p_final BOOLEAN)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  previous_bypass TEXT := current_setting('app.bypass_rls', true);
  tenant_row RECORD;
  op_row RECORD;
  removed INTEGER := 0;
  step INTEGER;
BEGIN
  IF session_user <> 'o_okul_reset_worker' OR p_tenant_id IS NULL OR p_tenant_id = 'system'
     OR p_tenant_id IS DISTINCT FROM current_setting('app.current_tenant_id', true) THEN
    RAISE EXCEPTION USING MESSAGE = 'RESET_DATABASE_ROLE_INVALID';
  END IF;
  PERFORM set_config('app.bypass_rls', 'true', true);
  SELECT "id", "slug", "status" INTO tenant_row FROM "Tenant" WHERE "id" = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR tenant_row."status" <> 'SUSPENDED' THEN RAISE EXCEPTION USING MESSAGE = 'RESET_SOURCE_CHANGED'; END IF;
  SELECT "status", "phase", "actorUserId", "result" INTO op_row FROM "TenantFreshResetOperation"
  WHERE "id" = p_operation_id AND "tenantId" = p_tenant_id AND "preset" = 'LICENSE_EXPIRY_PURGE_V1' FOR UPDATE;
  IF NOT FOUND OR (p_final AND op_row."status" <> 'COMPLETED') OR (NOT p_final AND (op_row."status" <> 'RUNNING' OR op_row."phase" <> 'DATABASE')) THEN
    RAISE EXCEPTION USING MESSAGE = 'RESET_OPERATION_CHANGED';
  END IF;

  IF NOT p_final THEN
    IF NOT EXISTS (SELECT 1 FROM "LicenseTerm" WHERE "tenantId" = p_tenant_id AND "cancelledAt" IS NULL)
       OR EXISTS (SELECT 1 FROM "LicenseTerm" WHERE "tenantId" = p_tenant_id AND "cancelledAt" IS NULL AND "endsAt" + interval '91 days' > now()) THEN
      RAISE EXCEPTION USING MESSAGE = 'RESET_LICENSE_NOT_EXPIRED';
    END IF;
    DELETE FROM "PaymentTransaction" WHERE "tenantId" = p_tenant_id; GET DIAGNOSTICS step = ROW_COUNT; removed := removed + step;
    DELETE FROM "PaymentInstallment" WHERE "tenantId" = p_tenant_id; GET DIAGNOSTICS step = ROW_COUNT; removed := removed + step;
    DELETE FROM "PaymentPlan" WHERE "tenantId" = p_tenant_id; GET DIAGNOSTICS step = ROW_COUNT; removed := removed + step;
    DELETE FROM "SupportTicketComment" WHERE "tenantId" = p_tenant_id; GET DIAGNOSTICS step = ROW_COUNT; removed := removed + step;
    DELETE FROM "SupportTicketAttachment" WHERE "tenantId" = p_tenant_id; GET DIAGNOSTICS step = ROW_COUNT; removed := removed + step;
    DELETE FROM "SupportTicket" WHERE "tenantId" = p_tenant_id; GET DIAGNOSTICS step = ROW_COUNT; removed := removed + step;
    DELETE FROM "WhatsAppConsentEvent" WHERE "tenantId" = p_tenant_id; GET DIAGNOSTICS step = ROW_COUNT; removed := removed + step;
    DELETE FROM "WhatsAppConsent" WHERE "tenantId" = p_tenant_id; GET DIAGNOSTICS step = ROW_COUNT; removed := removed + step;
    DELETE FROM "LicenseUsage" WHERE "tenantId" = p_tenant_id; GET DIAGNOSTICS step = ROW_COUNT; removed := removed + step;
    DELETE FROM "BackupRestoreJob" WHERE "tenantId" = p_tenant_id; GET DIAGNOSTICS step = ROW_COUNT; removed := removed + step;
    -- The tenant-create idempotency response embeds tenant and owner details.
    DELETE FROM "PlatformIdempotencyKey" WHERE "responseBody" #>> '{tenant,id}' = p_tenant_id; GET DIAGNOSTICS step = ROW_COUNT; removed := removed + step;
  END IF;
  DELETE FROM "AuditLog" WHERE "tenantId" = p_tenant_id; GET DIAGNOSTICS step = ROW_COUNT; removed := removed + step;

  IF p_final THEN
    INSERT INTO "AuditLog" ("id", "tenantId", "actorUserId", "entityType", "entityId", "action", "diff")
    VALUES (gen_random_uuid()::text, NULL, op_row."actorUserId", 'TenantLicenseExpiryPurge', p_operation_id, 'tenant.license-expiry-purge.completed',
      jsonb_build_object('tenantId', p_tenant_id, 'slugSha256', encode(sha256(convert_to(tenant_row."slug", 'UTF8')), 'hex'), 'purgedAt', now(),
        'deletedRowCount', op_row."result" -> 'deletedRowCount', 'deletedObjectCount', op_row."result" -> 'deletedObjectCount'));
    UPDATE "Tenant" SET "name" = 'İmha edildi', "slug" = 'imha-' || substr(md5("id"), 1, 16), "contactEmail" = NULL, "logoUrl" = NULL,
      "institutionType" = NULL, "resetRequest" = NULL, "updatedAt" = now()
    WHERE "id" = p_tenant_id;
  END IF;
  PERFORM set_config('app.bypass_rls', coalesce(previous_bypass, 'false'), true);
  RETURN removed;
END $$;
REVOKE ALL ON FUNCTION o_okul_license_expiry_purge(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION o_okul_license_expiry_purge(TEXT, TEXT, BOOLEAN) TO o_okul_reset_worker;
