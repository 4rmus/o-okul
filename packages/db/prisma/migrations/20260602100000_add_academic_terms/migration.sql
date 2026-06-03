CREATE TABLE "AcademicYear" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startsAt" DATE NOT NULL,
  "endsAt" DATE NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcademicYear_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcademicTerm" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "academicYearId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startsAt" DATE NOT NULL,
  "endsAt" DATE NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcademicTerm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AcademicYear_tenantId_id_key" ON "AcademicYear"("tenantId", "id");
CREATE UNIQUE INDEX "AcademicYear_tenantId_name_key" ON "AcademicYear"("tenantId", "name");
CREATE INDEX "AcademicYear_tenantId_isActive_deletedAt_idx" ON "AcademicYear"("tenantId", "isActive", "deletedAt");

CREATE UNIQUE INDEX "AcademicTerm_tenantId_id_key" ON "AcademicTerm"("tenantId", "id");
CREATE UNIQUE INDEX "AcademicTerm_tenantId_academicYearId_name_key" ON "AcademicTerm"("tenantId", "academicYearId", "name");
CREATE INDEX "AcademicTerm_tenantId_academicYearId_deletedAt_idx" ON "AcademicTerm"("tenantId", "academicYearId", "deletedAt");
CREATE INDEX "AcademicTerm_tenantId_isActive_deletedAt_idx" ON "AcademicTerm"("tenantId", "isActive", "deletedAt");

ALTER TABLE "AcademicYear" ADD CONSTRAINT "AcademicYear_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AcademicTerm" ADD CONSTRAINT "AcademicTerm_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AcademicTerm" ADD CONSTRAINT "AcademicTerm_tenantId_academicYearId_fkey"
  FOREIGN KEY ("tenantId", "academicYearId") REFERENCES "AcademicYear"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherAssignment" ADD COLUMN "termId" TEXT;
ALTER TABLE "ScheduleLesson" ADD COLUMN "termId" TEXT;
ALTER TABLE "StudySession" ADD COLUMN "termId" TEXT;

CREATE INDEX "TeacherAssignment_tenantId_termId_idx" ON "TeacherAssignment"("tenantId", "termId");
CREATE INDEX "ScheduleLesson_tenantId_termId_idx" ON "ScheduleLesson"("tenantId", "termId");
CREATE INDEX "StudySession_tenantId_termId_idx" ON "StudySession"("tenantId", "termId");

ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_tenantId_termId_fkey"
  FOREIGN KEY ("tenantId", "termId") REFERENCES "AcademicTerm"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduleLesson" ADD CONSTRAINT "ScheduleLesson_tenantId_termId_fkey"
  FOREIGN KEY ("tenantId", "termId") REFERENCES "AcademicTerm"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_tenantId_termId_fkey"
  FOREIGN KEY ("tenantId", "termId") REFERENCES "AcademicTerm"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
