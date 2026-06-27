CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Student_search_trgm_idx"
  ON "Student"
  USING GIN (lower(
    coalesce("firstName", '') || ' ' ||
    coalesce("lastName", '') || ' ' ||
    coalesce("studentNo", '')
  ) gin_trgm_ops)
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Guardian_search_trgm_idx"
  ON "Guardian"
  USING GIN (lower(
    coalesce("firstName", '') || ' ' ||
    coalesce("lastName", '') || ' ' ||
    coalesce("phone", '')
  ) gin_trgm_ops)
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Teacher_search_trgm_idx"
  ON "Teacher"
  USING GIN (lower(
    coalesce("firstName", '') || ' ' ||
    coalesce("lastName", '') || ' ' ||
    coalesce("branch", '')
  ) gin_trgm_ops)
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Class_search_trgm_idx"
  ON "Class"
  USING GIN (lower(
    coalesce("name", '') || ' ' ||
    coalesce("level", '') || ' ' ||
    coalesce("section", '')
  ) gin_trgm_ops)
  WHERE "deletedAt" IS NULL;
