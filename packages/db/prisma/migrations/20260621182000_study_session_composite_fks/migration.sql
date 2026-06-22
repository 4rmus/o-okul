DO $$
DECLARE
  invalid_class_count INTEGER;
  invalid_study_session_count INTEGER;
  invalid_student_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_class_count
  FROM "StudySession" session
  LEFT JOIN "Class" klass
    ON klass."tenantId" = session."tenantId"
   AND klass."id" = session."classId"
  WHERE klass."id" IS NULL;

  IF invalid_class_count > 0 THEN
    RAISE EXCEPTION 'StudySession class FK preflight failed: % study session rows are orphan or cross-tenant', invalid_class_count;
  END IF;

  SELECT COUNT(*) INTO invalid_study_session_count
  FROM "StudySessionStudent" link
  LEFT JOIN "StudySession" session
    ON session."tenantId" = link."tenantId"
   AND session."id" = link."studySessionId"
  WHERE session."id" IS NULL;

  IF invalid_study_session_count > 0 THEN
    RAISE EXCEPTION 'StudySessionStudent studySession FK preflight failed: % rows are orphan or cross-tenant', invalid_study_session_count;
  END IF;

  SELECT COUNT(*) INTO invalid_student_count
  FROM "StudySessionStudent" link
  LEFT JOIN "Student" student
    ON student."tenantId" = link."tenantId"
   AND student."id" = link."studentId"
  WHERE student."id" IS NULL;

  IF invalid_student_count > 0 THEN
    RAISE EXCEPTION 'StudySessionStudent student FK preflight failed: % rows are orphan or cross-tenant', invalid_student_count;
  END IF;
END $$;

ALTER TABLE "StudySession" DROP CONSTRAINT IF EXISTS "StudySession_classId_fkey";
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_class_fkey"
  FOREIGN KEY ("tenantId", "classId") REFERENCES "Class"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_tenantId_id_key" UNIQUE ("tenantId", "id");

ALTER TABLE "StudySessionStudent" DROP CONSTRAINT IF EXISTS "StudySessionStudent_studySessionId_fkey";
ALTER TABLE "StudySessionStudent" DROP CONSTRAINT IF EXISTS "StudySessionStudent_studentId_fkey";

ALTER TABLE "StudySessionStudent" ADD CONSTRAINT "StudySessionStudent_studySession_fkey"
  FOREIGN KEY ("tenantId", "studySessionId") REFERENCES "StudySession"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudySessionStudent" ADD CONSTRAINT "StudySessionStudent_student_fkey"
  FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
