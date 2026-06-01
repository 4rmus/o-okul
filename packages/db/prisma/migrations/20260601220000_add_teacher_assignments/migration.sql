CREATE TABLE "TeacherAssignment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "classId" TEXT,
  "studentId" TEXT,
  "courseId" TEXT,
  "role" TEXT NOT NULL,
  "startsAt" DATE,
  "endsAt" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TeacherAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeacherAssignment_tenantId_teacherId_idx" ON "TeacherAssignment"("tenantId", "teacherId");
CREATE INDEX "TeacherAssignment_tenantId_classId_idx" ON "TeacherAssignment"("tenantId", "classId");
CREATE INDEX "TeacherAssignment_tenantId_studentId_idx" ON "TeacherAssignment"("tenantId", "studentId");
CREATE INDEX "TeacherAssignment_tenantId_role_idx" ON "TeacherAssignment"("tenantId", "role");

ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
