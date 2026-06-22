DO $$
DECLARE
  invalid_schedule_lesson_classes INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO invalid_schedule_lesson_classes
  FROM "ScheduleLesson" lesson
  LEFT JOIN "Class" klass
    ON klass."tenantId" = lesson."tenantId"
   AND klass."id" = lesson."classId"
  WHERE klass."id" IS NULL;

  IF invalid_schedule_lesson_classes > 0 THEN
    RAISE EXCEPTION 'ScheduleLesson class FK preflight failed: % schedule lesson rows are orphan or cross-tenant', invalid_schedule_lesson_classes;
  END IF;
END $$;

ALTER TABLE "ScheduleLesson" DROP CONSTRAINT IF EXISTS "ScheduleLesson_classId_fkey";

ALTER TABLE "ScheduleLesson" ADD CONSTRAINT "ScheduleLesson_class_fkey"
  FOREIGN KEY ("tenantId", "classId") REFERENCES "Class"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
