-- Backfill existing human-entered text to Turkish-locale uppercase.
-- Uses the ICU "tr-x-icu" collation so i -> İ (dotted) maps correctly;
-- plain upper() would produce i -> I. Tables have FORCE ROW LEVEL SECURITY,
-- so bypass RLS for this one-off data migration. Use session scope (is_local
-- = false) so the setting persists across every statement even if the migration
-- runner executes them outside a single wrapping transaction; a transaction-local
-- (true) setting would be lost and the RLS-forced UPDATEs below would silently
-- affect zero rows.
SELECT set_config('app.bypass_rls', 'true', false);

UPDATE "Tenant" SET "name" = upper("name" COLLATE "tr-x-icu") WHERE "name" IS NOT NULL;
UPDATE "User" SET "name" = upper("name" COLLATE "tr-x-icu") WHERE "name" IS NOT NULL;
UPDATE "Campus" SET "name" = upper("name" COLLATE "tr-x-icu") WHERE "name" IS NOT NULL;
UPDATE "GradeLevel" SET "name" = upper("name" COLLATE "tr-x-icu") WHERE "name" IS NOT NULL;
UPDATE "Alan" SET "name" = upper("name" COLLATE "tr-x-icu") WHERE "name" IS NOT NULL;
UPDATE "Course" SET "name" = upper("name" COLLATE "tr-x-icu") WHERE "name" IS NOT NULL;
UPDATE "AcademicYear" SET "name" = upper("name" COLLATE "tr-x-icu") WHERE "name" IS NOT NULL;
UPDATE "AcademicTerm" SET "name" = upper("name" COLLATE "tr-x-icu") WHERE "name" IS NOT NULL;
UPDATE "Class"
  SET "name" = upper("name" COLLATE "tr-x-icu"),
      "section" = upper("section" COLLATE "tr-x-icu")
  WHERE "name" IS NOT NULL OR "section" IS NOT NULL;
UPDATE "Teacher"
  SET "firstName" = upper("firstName" COLLATE "tr-x-icu"),
      "lastName" = upper("lastName" COLLATE "tr-x-icu"),
      "branch" = upper("branch" COLLATE "tr-x-icu")
  WHERE "firstName" IS NOT NULL OR "lastName" IS NOT NULL OR "branch" IS NOT NULL;
UPDATE "Student"
  SET "firstName" = upper("firstName" COLLATE "tr-x-icu"),
      "lastName" = upper("lastName" COLLATE "tr-x-icu")
  WHERE "firstName" IS NOT NULL OR "lastName" IS NOT NULL;
UPDATE "Guardian"
  SET "firstName" = upper("firstName" COLLATE "tr-x-icu"),
      "lastName" = upper("lastName" COLLATE "tr-x-icu")
  WHERE "firstName" IS NOT NULL OR "lastName" IS NOT NULL;
UPDATE "LearningOutcome" SET "branch" = upper("branch" COLLATE "tr-x-icu") WHERE "branch" IS NOT NULL;
