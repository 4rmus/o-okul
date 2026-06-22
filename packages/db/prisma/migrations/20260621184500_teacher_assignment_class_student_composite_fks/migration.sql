DO $$
DECLARE
  invalid_class_count INTEGER;
  invalid_student_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_class_count
  FROM "TeacherAssignment" assignment
  LEFT JOIN "Class" klass
    ON klass."tenantId" = assignment."tenantId"
   AND klass."id" = assignment."classId"
  WHERE assignment."classId" IS NOT NULL
    AND klass."id" IS NULL;

  IF invalid_class_count > 0 THEN
    RAISE EXCEPTION 'TeacherAssignment class FK preflight failed: % rows are orphan or cross-tenant', invalid_class_count;
  END IF;

  SELECT COUNT(*) INTO invalid_student_count
  FROM "TeacherAssignment" assignment
  LEFT JOIN "Student" student
    ON student."tenantId" = assignment."tenantId"
   AND student."id" = assignment."studentId"
  WHERE assignment."studentId" IS NOT NULL
    AND student."id" IS NULL;

  IF invalid_student_count > 0 THEN
    RAISE EXCEPTION 'TeacherAssignment student FK preflight failed: % rows are orphan or cross-tenant', invalid_student_count;
  END IF;
END $$;

ALTER TABLE "TeacherAssignment" DROP CONSTRAINT IF EXISTS "TeacherAssignment_classId_fkey";
ALTER TABLE "TeacherAssignment" DROP CONSTRAINT IF EXISTS "TeacherAssignment_studentId_fkey";

ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_class_fkey"
  FOREIGN KEY ("tenantId", "classId") REFERENCES "Class"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_student_fkey"
  FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
