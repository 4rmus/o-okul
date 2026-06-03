ALTER TABLE "HomeworkMaterialAssignment"
  ADD COLUMN "courseId" TEXT,
  ADD COLUMN "termId" TEXT;

CREATE INDEX "HomeworkMaterialAssignment_tenantId_courseId_idx" ON "HomeworkMaterialAssignment"("tenantId", "courseId");
CREATE INDEX "HomeworkMaterialAssignment_tenantId_termId_idx" ON "HomeworkMaterialAssignment"("tenantId", "termId");

ALTER TABLE "HomeworkMaterialAssignment" ADD CONSTRAINT "HomeworkMaterialAssignment_tenantId_courseId_fkey"
  FOREIGN KEY ("tenantId", "courseId") REFERENCES "Course"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HomeworkMaterialAssignment" ADD CONSTRAINT "HomeworkMaterialAssignment_tenantId_termId_fkey"
  FOREIGN KEY ("tenantId", "termId") REFERENCES "AcademicTerm"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
