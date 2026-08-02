CREATE INDEX "Student_portal_access_cursor_idx"
  ON "Student"("tenantId", lower("lastName"), lower("firstName"), "id")
  WHERE "deletedAt" IS NULL;

CREATE INDEX "User_emailNormalized_search_trgm_idx"
  ON "User"
  USING GIN (lower(coalesce("emailNormalized", '')) gin_trgm_ops)
  WHERE "tenantId" IS NOT NULL;

CREATE INDEX "IdentityInvitation_student_email_search_trgm_idx"
  ON "IdentityInvitation"
  USING GIN (lower(coalesce("email", '')) gin_trgm_ops)
  WHERE "subjectType" = 'STUDENT' AND "status" = 'PENDING';
