CREATE TABLE "Course" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Course_tenantId_id_key" ON "Course"("tenantId", "id");
CREATE UNIQUE INDEX "Course_tenantId_code_key" ON "Course"("tenantId", "code");
CREATE INDEX "Course_tenantId_deletedAt_idx" ON "Course"("tenantId", "deletedAt");

ALTER TABLE "Course" ADD CONSTRAINT "Course_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "TeacherAssignment" ta
SET "courseId" = NULL
WHERE ta."courseId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Course" c WHERE c."tenantId" = ta."tenantId" AND c."id" = ta."courseId"
  );

ALTER TABLE "ScheduleLesson" ADD COLUMN "courseId" TEXT;
ALTER TABLE "StudySession" ADD COLUMN "courseId" TEXT;

CREATE INDEX "TeacherAssignment_tenantId_courseId_idx" ON "TeacherAssignment"("tenantId", "courseId");
CREATE INDEX "ScheduleLesson_tenantId_courseId_idx" ON "ScheduleLesson"("tenantId", "courseId");
CREATE INDEX "StudySession_tenantId_courseId_idx" ON "StudySession"("tenantId", "courseId");

ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_tenantId_courseId_fkey"
  FOREIGN KEY ("tenantId", "courseId") REFERENCES "Course"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduleLesson" ADD CONSTRAINT "ScheduleLesson_tenantId_courseId_fkey"
  FOREIGN KEY ("tenantId", "courseId") REFERENCES "Course"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_tenantId_courseId_fkey"
  FOREIGN KEY ("tenantId", "courseId") REFERENCES "Course"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
