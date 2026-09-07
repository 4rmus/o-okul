BEGIN;

LOCK TABLE "Tenant" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  unsupported_statuses TEXT;
BEGIN
  SELECT string_agg(quote_literal(status), ', ' ORDER BY status)
  INTO unsupported_statuses
  FROM (
    SELECT DISTINCT "status" AS status
    FROM "Tenant"
    WHERE "status" NOT IN ('ACTIVE', 'SUSPENDED', 'TRIAL', 'CLOSED')
  ) statuses;

  IF unsupported_statuses IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'TENANT_STATUS_UNSUPPORTED',
      DETAIL = unsupported_statuses;
  END IF;

  IF EXISTS (SELECT 1 FROM "Tenant" WHERE "id" = 'system' AND "status" <> 'ACTIVE') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'SYSTEM_TENANT_STATUS_INVALID';
  END IF;
END $$;

-- CLOSED was the legacy access-denied state. Preserve data and the last-change
-- timestamp; do not invent a closure reason or reactivate the institution.
UPDATE "Tenant"
SET "status" = 'SUSPENDED'
WHERE "status" = 'CLOSED';

UPDATE "Tenant"
SET "status" = 'ACTIVE', "updatedAt" = now()
WHERE "status" = 'TRIAL';

ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_status_check"
  CHECK ("status" IN ('ACTIVE', 'SUSPENDED'));

ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_system_status_check"
  CHECK ("id" <> 'system' OR "status" = 'ACTIVE');

COMMIT;
