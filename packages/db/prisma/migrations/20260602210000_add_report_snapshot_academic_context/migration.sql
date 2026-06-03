ALTER TABLE "ReportSnapshot"
  ADD COLUMN "campusId" TEXT,
  ADD COLUMN "gradeLevelId" TEXT,
  ADD COLUMN "classId" TEXT,
  ADD COLUMN "courseId" TEXT,
  ADD COLUMN "termId" TEXT;

CREATE INDEX "ReportSnapshot_tenantId_campusId_idx" ON "ReportSnapshot"("tenantId", "campusId");
CREATE INDEX "ReportSnapshot_tenantId_gradeLevelId_idx" ON "ReportSnapshot"("tenantId", "gradeLevelId");
CREATE INDEX "ReportSnapshot_tenantId_classId_idx" ON "ReportSnapshot"("tenantId", "classId");
CREATE INDEX "ReportSnapshot_tenantId_courseId_idx" ON "ReportSnapshot"("tenantId", "courseId");
CREATE INDEX "ReportSnapshot_tenantId_termId_idx" ON "ReportSnapshot"("tenantId", "termId");

ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_tenantId_campusId_fkey"
  FOREIGN KEY ("tenantId", "campusId") REFERENCES "Campus"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_tenantId_gradeLevelId_fkey"
  FOREIGN KEY ("tenantId", "gradeLevelId") REFERENCES "GradeLevel"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_tenantId_courseId_fkey"
  FOREIGN KEY ("tenantId", "courseId") REFERENCES "Course"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_tenantId_termId_fkey"
  FOREIGN KEY ("tenantId", "termId") REFERENCES "AcademicTerm"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
