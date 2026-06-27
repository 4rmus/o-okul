DROP INDEX IF EXISTS "Class_search_trgm_idx";

ALTER TABLE "Class" DROP COLUMN IF EXISTS "level";

CREATE INDEX "Class_search_trgm_idx"
  ON "Class"
  USING GIN (lower(
    coalesce("name", '') || ' ' ||
    coalesce("section", '')
  ) gin_trgm_ops)
  WHERE "deletedAt" IS NULL;
