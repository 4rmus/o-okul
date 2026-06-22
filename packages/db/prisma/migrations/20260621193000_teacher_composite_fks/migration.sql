DO $$
DECLARE
  invalid_development_assessment_count INTEGER;
  invalid_teacher_assignment_count INTEGER;
  invalid_teacher_note_count INTEGER;
  invalid_schedule_lesson_count INTEGER;
  invalid_study_session_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_development_assessment_count
  FROM "DevelopmentAssessment" assessment
  LEFT JOIN "Teacher" teacher
    ON teacher."tenantId" = assessment."tenantId"
   AND teacher."id" = assessment."teacherId"
  WHERE teacher."id" IS NULL;

  IF invalid_development_assessment_count > 0 THEN
    RAISE EXCEPTION 'DevelopmentAssessment teacher FK preflight failed: % rows are orphan or cross-tenant', invalid_development_assessment_count;
  END IF;

  SELECT COUNT(*) INTO invalid_teacher_assignment_count
  FROM "TeacherAssignment" assignment
  LEFT JOIN "Teacher" teacher
    ON teacher."tenantId" = assignment."tenantId"
   AND teacher."id" = assignment."teacherId"
  WHERE teacher."id" IS NULL;

  IF invalid_teacher_assignment_count > 0 THEN
    RAISE EXCEPTION 'TeacherAssignment teacher FK preflight failed: % rows are orphan or cross-tenant', invalid_teacher_assignment_count;
  END IF;

  SELECT COUNT(*) INTO invalid_teacher_note_count
  FROM "TeacherNote" note
  LEFT JOIN "Teacher" teacher
    ON teacher."tenantId" = note."tenantId"
   AND teacher."id" = note."teacherId"
  WHERE teacher."id" IS NULL;

  IF invalid_teacher_note_count > 0 THEN
    RAISE EXCEPTION 'TeacherNote teacher FK preflight failed: % rows are orphan or cross-tenant', invalid_teacher_note_count;
  END IF;

  SELECT COUNT(*) INTO invalid_schedule_lesson_count
  FROM "ScheduleLesson" lesson
  LEFT JOIN "Teacher" teacher
    ON teacher."tenantId" = lesson."tenantId"
   AND teacher."id" = lesson."teacherId"
  WHERE teacher."id" IS NULL;

  IF invalid_schedule_lesson_count > 0 THEN
    RAISE EXCEPTION 'ScheduleLesson teacher FK preflight failed: % rows are orphan or cross-tenant', invalid_schedule_lesson_count;
  END IF;

  SELECT COUNT(*) INTO invalid_study_session_count
  FROM "StudySession" session
  LEFT JOIN "Teacher" teacher
    ON teacher."tenantId" = session."tenantId"
   AND teacher."id" = session."teacherId"
  WHERE teacher."id" IS NULL;

  IF invalid_study_session_count > 0 THEN
    RAISE EXCEPTION 'StudySession teacher FK preflight failed: % rows are orphan or cross-tenant', invalid_study_session_count;
  END IF;
END $$;

ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_tenantId_id_key" UNIQUE ("tenantId", "id");

ALTER TABLE "DevelopmentAssessment" DROP CONSTRAINT IF EXISTS "DevelopmentAssessment_teacher_fkey";
ALTER TABLE "TeacherAssignment" DROP CONSTRAINT IF EXISTS "TeacherAssignment_teacherId_fkey";
ALTER TABLE "TeacherNote" DROP CONSTRAINT IF EXISTS "TeacherNote_teacherId_fkey";
ALTER TABLE "ScheduleLesson" DROP CONSTRAINT IF EXISTS "ScheduleLesson_teacherId_fkey";
ALTER TABLE "StudySession" DROP CONSTRAINT IF EXISTS "StudySession_teacherId_fkey";

ALTER TABLE "DevelopmentAssessment" ADD CONSTRAINT "DevelopmentAssessment_teacher_fkey"
  FOREIGN KEY ("tenantId", "teacherId") REFERENCES "Teacher"("tenantId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_teacher_fkey"
  FOREIGN KEY ("tenantId", "teacherId") REFERENCES "Teacher"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherNote" ADD CONSTRAINT "TeacherNote_teacher_fkey"
  FOREIGN KEY ("tenantId", "teacherId") REFERENCES "Teacher"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduleLesson" ADD CONSTRAINT "ScheduleLesson_teacher_fkey"
  FOREIGN KEY ("tenantId", "teacherId") REFERENCES "Teacher"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_teacher_fkey"
  FOREIGN KEY ("tenantId", "teacherId") REFERENCES "Teacher"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
