CREATE UNIQUE INDEX "StudentEnrollment_one_open_active_per_student_key"
  ON "StudentEnrollment"("tenantId", "studentId")
  WHERE "status" = 'ACTIVE' AND "endsAt" IS NULL;

CREATE OR REPLACE FUNCTION o_okul_refresh_license_usage(p_tenant_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_term RECORD;
  active_count INTEGER;
BEGIN
  IF p_tenant_id IS NULL OR p_tenant_id = 'system' THEN
    RETURN;
  END IF;

  SELECT term."id", term."activeStudentLimit"
  INTO current_term
  FROM "LicenseTerm" term
  WHERE term."tenantId" = p_tenant_id
    AND term."cancelledAt" IS NULL
    AND term."startsAt" <= now()
    AND now() < term."endsAt"
  ORDER BY term."startsAt" DESC, term."id" ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*)::int
  INTO active_count
  FROM "Student" student
  WHERE student."tenantId" = p_tenant_id
    AND student."deletedAt" IS NULL
    AND student."status" = 'ACTIVE'
    AND 1 = (
      SELECT count(*)
      FROM "StudentEnrollment" enrollment
      WHERE enrollment."tenantId" = student."tenantId"
        AND enrollment."studentId" = student."id"
        AND enrollment."status" = 'ACTIVE'
        AND enrollment."endsAt" IS NULL
    );

  IF active_count > current_term."activeStudentLimit" THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'ACTIVE_STUDENT_LIMIT_REACHED';
  END IF;

  INSERT INTO "LicenseUsage" (
    "tenantId", "licenseTermId", "usageDate", "activeStudentCount",
    "peakActiveStudentCount", "reconciledAt", "updatedAt"
  ) VALUES (
    p_tenant_id,
    current_term."id",
    timezone('UTC', now())::date,
    active_count,
    active_count,
    now(),
    now()
  )
  ON CONFLICT ("tenantId", "usageDate") DO UPDATE
  SET "licenseTermId" = EXCLUDED."licenseTermId",
      "activeStudentCount" = EXCLUDED."activeStudentCount",
      "peakActiveStudentCount" = GREATEST(
        "LicenseUsage"."peakActiveStudentCount",
        EXCLUDED."activeStudentCount"
      ),
      "reconciledAt" = now(),
      "updatedAt" = now();
END;
$$;

REVOKE ALL ON FUNCTION o_okul_refresh_license_usage(TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION o_okul_sync_license_usage_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM o_okul_refresh_license_usage(OLD."tenantId");
    RETURN OLD;
  END IF;

  PERFORM o_okul_refresh_license_usage(NEW."tenantId");
  IF TG_OP = 'UPDATE' AND OLD."tenantId" IS DISTINCT FROM NEW."tenantId" THEN
    PERFORM o_okul_refresh_license_usage(OLD."tenantId");
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION o_okul_sync_license_usage_trigger() FROM PUBLIC;

CREATE TRIGGER "Student_sync_license_usage"
AFTER INSERT OR UPDATE OF "tenantId", "status", "deletedAt" OR DELETE
ON "Student"
FOR EACH ROW
EXECUTE FUNCTION o_okul_sync_license_usage_trigger();

CREATE TRIGGER "StudentEnrollment_sync_license_usage"
AFTER INSERT OR UPDATE OF "tenantId", "studentId", "status", "endsAt" OR DELETE
ON "StudentEnrollment"
FOR EACH ROW
EXECUTE FUNCTION o_okul_sync_license_usage_trigger();
