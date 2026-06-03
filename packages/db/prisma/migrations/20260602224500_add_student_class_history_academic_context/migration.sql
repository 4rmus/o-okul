ALTER TABLE "StudentClassHistory"
  ADD COLUMN "academicYearId" TEXT,
  ADD COLUMN "termId" TEXT;

CREATE INDEX "StudentClassHistory_tenantId_academicYearId_idx" ON "StudentClassHistory"("tenantId", "academicYearId");
CREATE INDEX "StudentClassHistory_tenantId_termId_idx" ON "StudentClassHistory"("tenantId", "termId");

ALTER TABLE "StudentClassHistory" ADD CONSTRAINT "StudentClassHistory_tenantId_academicYearId_fkey"
  FOREIGN KEY ("tenantId", "academicYearId") REFERENCES "AcademicYear"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudentClassHistory" ADD CONSTRAINT "StudentClassHistory_tenantId_termId_fkey"
  FOREIGN KEY ("tenantId", "termId") REFERENCES "AcademicTerm"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
