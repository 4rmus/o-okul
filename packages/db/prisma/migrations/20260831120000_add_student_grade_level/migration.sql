BEGIN;

SELECT set_config('app.bypass_rls', 'true', true);

LOCK TABLE "Class", "Student", "StudentEnrollment" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "Student"
  ADD COLUMN "gradeLevelId" TEXT;

ALTER TABLE "StudentEnrollment"
  ADD COLUMN "gradeLevelId" TEXT;

UPDATE "Student" student
SET "gradeLevelId" = class."gradeLevelId"
FROM "Class" class
WHERE student."tenantId" = class."tenantId"
  AND student."classId" = class."id"
  AND class."gradeLevelId" IS NOT NULL;

UPDATE "StudentEnrollment" enrollment
SET "gradeLevelId" = student."gradeLevelId"
FROM "Student" student
WHERE enrollment."tenantId" = student."tenantId"
  AND enrollment."studentId" = student."id"
  AND enrollment."status" = 'ACTIVE'
  AND enrollment."endsAt" IS NULL
  AND student."gradeLevelId" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Student" student
    JOIN "Class" class
      ON class."tenantId" = student."tenantId"
     AND class."id" = student."classId"
    WHERE class."gradeLevelId" IS NOT NULL
      AND student."gradeLevelId" IS DISTINCT FROM class."gradeLevelId"
  ) THEN
    RAISE EXCEPTION 'STUDENT_GRADE_LEVEL_BACKFILL_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Student" student
    WHERE student."deletedAt" IS NULL
      AND student."status" = 'ACTIVE'
      AND student."gradeLevelId" IS NOT NULL
      AND 1 <> (
        SELECT count(*)
        FROM "StudentEnrollment" enrollment
        WHERE enrollment."tenantId" = student."tenantId"
          AND enrollment."studentId" = student."id"
          AND enrollment."status" = 'ACTIVE'
          AND enrollment."endsAt" IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'STUDENT_GRADE_LEVEL_ACTIVE_ENROLLMENT_BLOCK_MIGRATION';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "StudentEnrollment" enrollment
    JOIN "Student" student
      ON student."tenantId" = enrollment."tenantId"
     AND student."id" = enrollment."studentId"
    WHERE enrollment."status" = 'ACTIVE'
      AND enrollment."endsAt" IS NULL
      AND (
        enrollment."gradeLevelId" IS DISTINCT FROM student."gradeLevelId"
        OR enrollment."classId" IS DISTINCT FROM student."classId"
      )
  ) THEN
    RAISE EXCEPTION 'STUDENT_ENROLLMENT_GRADE_LEVEL_BACKFILL_MISMATCH';
  END IF;
END
$$;

ALTER TABLE "Student"
  ADD CONSTRAINT "Student_tenantId_gradeLevelId_fkey"
  FOREIGN KEY ("tenantId", "gradeLevelId")
  REFERENCES "GradeLevel"("tenantId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "StudentEnrollment"
  ADD CONSTRAINT "StudentEnrollment_tenantId_gradeLevelId_fkey"
  FOREIGN KEY ("tenantId", "gradeLevelId")
  REFERENCES "GradeLevel"("tenantId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "Class"
  ADD CONSTRAINT "Class_tenantId_id_gradeLevelId_key"
  UNIQUE ("tenantId", "id", "gradeLevelId");

ALTER TABLE "Student"
  ADD CONSTRAINT "Student_tenantId_classId_gradeLevelId_fkey"
  FOREIGN KEY ("tenantId", "classId", "gradeLevelId")
  REFERENCES "Class"("tenantId", "id", "gradeLevelId")
  ON DELETE RESTRICT
  ON UPDATE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "Student_tenantId_gradeLevelId_deletedAt_idx"
  ON "Student"("tenantId", "gradeLevelId", "deletedAt");

CREATE INDEX "StudentEnrollment_tenantId_gradeLevelId_idx"
  ON "StudentEnrollment"("tenantId", "gradeLevelId");

COMMIT;
