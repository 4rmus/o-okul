-- DEC-20261021-02: a multi-row student import fired o_okul_refresh_license_usage once per inserted Student and
-- StudentEnrollment row, and every call locks the LicenseTerm row and recounts the tenant's licensed students.
-- INSERT now refreshes once per tenant per statement through a transition table. UPDATE and DELETE keep the
-- per-row trigger and function from 20260801210000. AFTER ROW and AFTER STATEMENT triggers both fire when the
-- statement ends, so a statement that crosses the limit still fails with ACTIVE_STUDENT_LIMIT_REACHED.

CREATE OR REPLACE FUNCTION o_okul_sync_license_usage_insert_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inserted_tenant_id TEXT;
BEGIN
  FOR inserted_tenant_id IN
    SELECT DISTINCT inserted."tenantId"
    FROM inserted_rows inserted
    WHERE inserted."tenantId" IS NOT NULL
    ORDER BY inserted."tenantId"
  LOOP
    PERFORM o_okul_refresh_license_usage(inserted_tenant_id);
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION o_okul_sync_license_usage_insert_statement() FROM PUBLIC;

DROP TRIGGER "Student_sync_license_usage" ON "Student";

CREATE TRIGGER "Student_sync_license_usage"
AFTER UPDATE OF "tenantId", "status", "deletedAt" OR DELETE
ON "Student"
FOR EACH ROW
EXECUTE FUNCTION o_okul_sync_license_usage_trigger();

CREATE TRIGGER "Student_sync_license_usage_insert"
AFTER INSERT
ON "Student"
REFERENCING NEW TABLE AS inserted_rows
FOR EACH STATEMENT
EXECUTE FUNCTION o_okul_sync_license_usage_insert_statement();

DROP TRIGGER "StudentEnrollment_sync_license_usage" ON "StudentEnrollment";

CREATE TRIGGER "StudentEnrollment_sync_license_usage"
AFTER UPDATE OF "tenantId", "studentId", "status", "endsAt" OR DELETE
ON "StudentEnrollment"
FOR EACH ROW
EXECUTE FUNCTION o_okul_sync_license_usage_trigger();

CREATE TRIGGER "StudentEnrollment_sync_license_usage_insert"
AFTER INSERT
ON "StudentEnrollment"
REFERENCING NEW TABLE AS inserted_rows
FOR EACH STATEMENT
EXECUTE FUNCTION o_okul_sync_license_usage_insert_statement();
