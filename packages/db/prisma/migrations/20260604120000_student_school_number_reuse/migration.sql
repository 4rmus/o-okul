DROP INDEX IF EXISTS "Student_tenantId_studentNo_key";

DO $$
DECLARE
  tenant_record RECORD;
  student_record RECORD;
  candidate INTEGER;
BEGIN
  FOR tenant_record IN
    SELECT DISTINCT "tenantId"
    FROM "Student"
  LOOP
    FOR student_record IN
      SELECT "id"
      FROM "Student"
      WHERE "tenantId" = tenant_record."tenantId"
        AND ("studentNo" IS NULL OR btrim("studentNo") = '')
      ORDER BY "createdAt", "id"
    LOOP
      candidate := 100;
      WHILE EXISTS (
        SELECT 1
        FROM "Student"
        WHERE "tenantId" = tenant_record."tenantId"
          AND "deletedAt" IS NULL
          AND "studentNo" = candidate::text
      ) LOOP
        candidate := candidate + 1;
      END LOOP;

      UPDATE "Student"
      SET "studentNo" = candidate::text,
          "updatedAt" = now()
      WHERE "id" = student_record."id";
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE "Student" ALTER COLUMN "studentNo" SET NOT NULL;

CREATE INDEX "Student_tenantId_studentNo_idx"
  ON "Student" ("tenantId", "studentNo");

CREATE UNIQUE INDEX "Student_tenantId_studentNo_active_key"
  ON "Student" ("tenantId", "studentNo")
  WHERE "deletedAt" IS NULL;
