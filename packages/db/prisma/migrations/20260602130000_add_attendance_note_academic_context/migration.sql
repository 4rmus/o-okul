ALTER TABLE "Attendance" ADD COLUMN "courseId" TEXT;
ALTER TABLE "Attendance" ADD COLUMN "termId" TEXT;

ALTER TABLE "TeacherNote" ADD COLUMN "courseId" TEXT;
ALTER TABLE "TeacherNote" ADD COLUMN "termId" TEXT;

CREATE INDEX "Attendance_tenantId_courseId_idx" ON "Attendance"("tenantId", "courseId");
CREATE INDEX "Attendance_tenantId_termId_idx" ON "Attendance"("tenantId", "termId");
CREATE INDEX "TeacherNote_tenantId_courseId_idx" ON "TeacherNote"("tenantId", "courseId");
CREATE INDEX "TeacherNote_tenantId_termId_idx" ON "TeacherNote"("tenantId", "termId");

ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_tenantId_courseId_fkey"
  FOREIGN KEY ("tenantId", "courseId") REFERENCES "Course"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_tenantId_termId_fkey"
  FOREIGN KEY ("tenantId", "termId") REFERENCES "AcademicTerm"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherNote" ADD CONSTRAINT "TeacherNote_tenantId_courseId_fkey"
  FOREIGN KEY ("tenantId", "courseId") REFERENCES "Course"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherNote" ADD CONSTRAINT "TeacherNote_tenantId_termId_fkey"
  FOREIGN KEY ("tenantId", "termId") REFERENCES "AcademicTerm"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
