DO $$
DECLARE
  invalid_homework_classes INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO invalid_homework_classes
  FROM "Homework" homework
  LEFT JOIN "Class" klass
    ON klass."tenantId" = homework."tenantId"
   AND klass."id" = homework."classId"
  WHERE klass."id" IS NULL;

  IF invalid_homework_classes > 0 THEN
    RAISE EXCEPTION 'Homework class FK preflight failed: % homework rows are orphan or cross-tenant', invalid_homework_classes;
  END IF;
END $$;

ALTER TABLE "Homework" DROP CONSTRAINT IF EXISTS "Homework_classId_fkey";

ALTER TABLE "Homework" ADD CONSTRAINT "Homework_class_fkey"
  FOREIGN KEY ("tenantId", "classId") REFERENCES "Class"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
