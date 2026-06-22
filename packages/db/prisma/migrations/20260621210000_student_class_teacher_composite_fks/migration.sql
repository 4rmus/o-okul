DO $$
DECLARE
  invalid_student_class_count INTEGER;
  invalid_student_teacher_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_student_class_count
  FROM "Student" student
  LEFT JOIN "Class" klass
    ON klass."tenantId" = student."tenantId"
   AND klass."id" = student."classId"
  WHERE student."classId" IS NOT NULL
    AND klass."id" IS NULL;

  IF invalid_student_class_count > 0 THEN
    RAISE EXCEPTION 'Student class FK preflight failed: % rows are orphan or cross-tenant', invalid_student_class_count;
  END IF;

  SELECT COUNT(*) INTO invalid_student_teacher_count
  FROM "Student" student
  LEFT JOIN "Teacher" teacher
    ON teacher."tenantId" = student."tenantId"
   AND teacher."id" = student."responsibleTeacherId"
  WHERE student."responsibleTeacherId" IS NOT NULL
    AND teacher."id" IS NULL;

  IF invalid_student_teacher_count > 0 THEN
    RAISE EXCEPTION 'Student responsibleTeacher FK preflight failed: % rows are orphan or cross-tenant', invalid_student_teacher_count;
  END IF;
END $$;

ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_classId_fkey";
ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_responsibleTeacherId_fkey";

ALTER TABLE "Student" ADD CONSTRAINT "Student_class_fkey"
  FOREIGN KEY ("tenantId", "classId") REFERENCES "Class"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Student" ADD CONSTRAINT "Student_responsibleTeacher_fkey"
  FOREIGN KEY ("tenantId", "responsibleTeacherId") REFERENCES "Teacher"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
