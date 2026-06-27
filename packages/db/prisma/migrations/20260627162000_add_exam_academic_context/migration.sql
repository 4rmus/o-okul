ALTER TABLE "Exam"
  ADD COLUMN "gradeLevelId" TEXT,
  ADD COLUMN "alanId" TEXT,
  ADD COLUMN "examType" TEXT;

CREATE INDEX "Exam_tenantId_gradeLevelId_idx" ON "Exam"("tenantId", "gradeLevelId");
CREATE INDEX "Exam_tenantId_alanId_idx" ON "Exam"("tenantId", "alanId");
CREATE INDEX "Exam_tenantId_examType_idx" ON "Exam"("tenantId", "examType");

ALTER TABLE "Exam"
  ADD CONSTRAINT "Exam_tenantId_gradeLevelId_fkey"
  FOREIGN KEY ("tenantId", "gradeLevelId")
  REFERENCES "GradeLevel"("tenantId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "Exam"
  ADD CONSTRAINT "Exam_tenantId_alanId_fkey"
  FOREIGN KEY ("tenantId", "alanId")
  REFERENCES "Alan"("tenantId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
