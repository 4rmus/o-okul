ALTER TABLE "SupportTicket"
  ADD COLUMN "campusId" TEXT,
  ADD COLUMN "gradeLevelId" TEXT,
  ADD COLUMN "classId" TEXT,
  ADD COLUMN "courseId" TEXT,
  ADD COLUMN "termId" TEXT;

CREATE INDEX "SupportTicket_tenantId_campusId_idx" ON "SupportTicket"("tenantId", "campusId");
CREATE INDEX "SupportTicket_tenantId_gradeLevelId_idx" ON "SupportTicket"("tenantId", "gradeLevelId");
CREATE INDEX "SupportTicket_tenantId_classId_idx" ON "SupportTicket"("tenantId", "classId");
CREATE INDEX "SupportTicket_tenantId_courseId_idx" ON "SupportTicket"("tenantId", "courseId");
CREATE INDEX "SupportTicket_tenantId_termId_idx" ON "SupportTicket"("tenantId", "termId");

ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_tenantId_campusId_fkey"
  FOREIGN KEY ("tenantId", "campusId") REFERENCES "Campus"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_tenantId_gradeLevelId_fkey"
  FOREIGN KEY ("tenantId", "gradeLevelId") REFERENCES "GradeLevel"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_tenantId_courseId_fkey"
  FOREIGN KEY ("tenantId", "courseId") REFERENCES "Course"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_tenantId_termId_fkey"
  FOREIGN KEY ("tenantId", "termId") REFERENCES "AcademicTerm"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
