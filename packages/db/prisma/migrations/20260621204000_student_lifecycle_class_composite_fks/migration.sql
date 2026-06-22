DO $$
DECLARE
  invalid_student_class_history_count INTEGER;
  invalid_student_enrollment_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_student_class_history_count
  FROM "StudentClassHistory" history
  LEFT JOIN "Class" klass
    ON klass."tenantId" = history."tenantId"
   AND klass."id" = history."classId"
  WHERE history."classId" IS NOT NULL
    AND klass."id" IS NULL;

  IF invalid_student_class_history_count > 0 THEN
    RAISE EXCEPTION 'StudentClassHistory class FK preflight failed: % rows are orphan or cross-tenant', invalid_student_class_history_count;
  END IF;

  SELECT COUNT(*) INTO invalid_student_enrollment_count
  FROM "StudentEnrollment" enrollment
  LEFT JOIN "Class" klass
    ON klass."tenantId" = enrollment."tenantId"
   AND klass."id" = enrollment."classId"
  WHERE enrollment."classId" IS NOT NULL
    AND klass."id" IS NULL;

  IF invalid_student_enrollment_count > 0 THEN
    RAISE EXCEPTION 'StudentEnrollment class FK preflight failed: % rows are orphan or cross-tenant', invalid_student_enrollment_count;
  END IF;
END $$;

ALTER TABLE "StudentClassHistory" DROP CONSTRAINT IF EXISTS "StudentClassHistory_classId_fkey";
ALTER TABLE "StudentEnrollment" DROP CONSTRAINT IF EXISTS "StudentEnrollment_classId_fkey";

ALTER TABLE "StudentClassHistory" ADD CONSTRAINT "StudentClassHistory_class_fkey"
  FOREIGN KEY ("tenantId", "classId") REFERENCES "Class"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudentEnrollment" ADD CONSTRAINT "StudentEnrollment_class_fkey"
  FOREIGN KEY ("tenantId", "classId") REFERENCES "Class"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
