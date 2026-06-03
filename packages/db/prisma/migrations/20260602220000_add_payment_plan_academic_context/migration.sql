ALTER TABLE "PaymentPlan"
  ADD COLUMN "campusId" TEXT,
  ADD COLUMN "gradeLevelId" TEXT,
  ADD COLUMN "classId" TEXT,
  ADD COLUMN "courseId" TEXT,
  ADD COLUMN "termId" TEXT;

CREATE INDEX "PaymentPlan_tenantId_campusId_idx" ON "PaymentPlan"("tenantId", "campusId");
CREATE INDEX "PaymentPlan_tenantId_gradeLevelId_idx" ON "PaymentPlan"("tenantId", "gradeLevelId");
CREATE INDEX "PaymentPlan_tenantId_classId_idx" ON "PaymentPlan"("tenantId", "classId");
CREATE INDEX "PaymentPlan_tenantId_courseId_idx" ON "PaymentPlan"("tenantId", "courseId");
CREATE INDEX "PaymentPlan_tenantId_termId_idx" ON "PaymentPlan"("tenantId", "termId");

ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_tenantId_campusId_fkey"
  FOREIGN KEY ("tenantId", "campusId") REFERENCES "Campus"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_tenantId_gradeLevelId_fkey"
  FOREIGN KEY ("tenantId", "gradeLevelId") REFERENCES "GradeLevel"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_tenantId_courseId_fkey"
  FOREIGN KEY ("tenantId", "courseId") REFERENCES "Course"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_tenantId_termId_fkey"
  FOREIGN KEY ("tenantId", "termId") REFERENCES "AcademicTerm"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
