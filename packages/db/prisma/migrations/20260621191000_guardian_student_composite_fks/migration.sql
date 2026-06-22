DO $$
DECLARE
  invalid_guardian_count INTEGER;
  invalid_student_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_guardian_count
  FROM "GuardianStudent" link
  LEFT JOIN "Guardian" guardian
    ON guardian."tenantId" = link."tenantId"
   AND guardian."id" = link."guardianId"
  WHERE guardian."id" IS NULL;

  IF invalid_guardian_count > 0 THEN
    RAISE EXCEPTION 'GuardianStudent guardian FK preflight failed: % rows are orphan or cross-tenant', invalid_guardian_count;
  END IF;

  SELECT COUNT(*) INTO invalid_student_count
  FROM "GuardianStudent" link
  LEFT JOIN "Student" student
    ON student."tenantId" = link."tenantId"
   AND student."id" = link."studentId"
  WHERE student."id" IS NULL;

  IF invalid_student_count > 0 THEN
    RAISE EXCEPTION 'GuardianStudent student FK preflight failed: % rows are orphan or cross-tenant', invalid_student_count;
  END IF;
END $$;

ALTER TABLE "Guardian" ADD CONSTRAINT "Guardian_tenantId_id_key" UNIQUE ("tenantId", "id");

ALTER TABLE "GuardianStudent" DROP CONSTRAINT IF EXISTS "GuardianStudent_guardianId_fkey";
ALTER TABLE "GuardianStudent" DROP CONSTRAINT IF EXISTS "GuardianStudent_studentId_fkey";

ALTER TABLE "GuardianStudent" ADD CONSTRAINT "GuardianStudent_guardian_fkey"
  FOREIGN KEY ("tenantId", "guardianId") REFERENCES "Guardian"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuardianStudent" ADD CONSTRAINT "GuardianStudent_student_fkey"
  FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
