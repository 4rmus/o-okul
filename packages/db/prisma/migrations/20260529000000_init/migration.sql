CREATE TYPE "TenantRole" AS ENUM ('SYSTEM_ADMIN', 'TENANT_ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN');

CREATE TABLE "Tenant" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TenantMembership" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "TenantRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Class" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "level" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Student" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "classId" TEXT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "studentNo" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT,
  "updatedById" TEXT,
  CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Teacher" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "branch" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Guardian" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "phone" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Guardian_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuardianStudent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "guardianId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GuardianStudent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduleLesson" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduleLesson_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudySession" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudySessionStudent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "studySessionId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudySessionStudent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomeworkMaterial" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HomeworkMaterial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Homework" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "sourceMaterialId" TEXT,
  "sourceMaterialTitle" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "dueAt" TIMESTAMP(3),
  "checkedAt" TIMESTAMP(3),
  "checkedById" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Homework_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Exam" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "startsAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ParserConfig" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "encoding" TEXT NOT NULL,
  "delimiter" TEXT NOT NULL,
  "skipHeaderLines" INTEGER NOT NULL DEFAULT 0,
  "fieldMapping" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ParserConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExamParticipant" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "participantNo" TEXT,
  "bookletType" TEXT,
  "status" TEXT NOT NULL DEFAULT 'REGISTERED',
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExamParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RawImport" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "s3Key" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "parserConfigVersion" TEXT NOT NULL,
  "metadata" JSONB,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RawImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnswerKey" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "keyData" JSONB NOT NULL,
  "scoringConfig" JSONB,
  "publishedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnswerKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExamResult" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "rawImportId" TEXT NOT NULL,
  "answerKeyId" TEXT NOT NULL,
  "answerKeyVersion" TEXT NOT NULL,
  "parserConfigVersion" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "resultKey" TEXT NOT NULL,
  "scoreData" JSONB NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExamResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ParsedAnswer" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "rawImportId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "parserConfigVersion" TEXT NOT NULL,
  "rowNumber" INTEGER,
  "answers" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'MATCHED',
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ParsedAnswer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportQuarantine" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "rawImportId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "rawRow" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "resolvedStudentId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportQuarantine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReportSnapshot" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "reportType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "inputRefs" JSONB NOT NULL,
  "snapshotData" JSONB,
  "generatedAt" TIMESTAMP(3),
  "staleAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "actorUserId" TEXT,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "action" TEXT NOT NULL,
  "diff" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "TenantMembership_tenantId_userId_role_key" ON "TenantMembership"("tenantId", "userId", "role");
CREATE INDEX "TenantMembership_tenantId_role_idx" ON "TenantMembership"("tenantId", "role");
CREATE INDEX "Class_tenantId_deletedAt_idx" ON "Class"("tenantId", "deletedAt");
CREATE INDEX "Student_tenantId_deletedAt_idx" ON "Student"("tenantId", "deletedAt");
CREATE INDEX "Student_tenantId_classId_deletedAt_idx" ON "Student"("tenantId", "classId", "deletedAt");
CREATE UNIQUE INDEX "Student_tenantId_studentNo_key" ON "Student"("tenantId", "studentNo");
CREATE UNIQUE INDEX "Student_tenantId_id_key" ON "Student"("tenantId", "id");
CREATE INDEX "Teacher_tenantId_deletedAt_idx" ON "Teacher"("tenantId", "deletedAt");
CREATE INDEX "Guardian_tenantId_deletedAt_idx" ON "Guardian"("tenantId", "deletedAt");
CREATE UNIQUE INDEX "GuardianStudent_tenantId_guardianId_studentId_key" ON "GuardianStudent"("tenantId", "guardianId", "studentId");
CREATE INDEX "GuardianStudent_tenantId_studentId_idx" ON "GuardianStudent"("tenantId", "studentId");
CREATE INDEX "ScheduleLesson_tenantId_deletedAt_idx" ON "ScheduleLesson"("tenantId", "deletedAt");
CREATE INDEX "ScheduleLesson_tenantId_teacherId_startsAt_endsAt_deletedAt_idx" ON "ScheduleLesson"("tenantId", "teacherId", "startsAt", "endsAt", "deletedAt");
CREATE INDEX "ScheduleLesson_tenantId_classId_startsAt_idx" ON "ScheduleLesson"("tenantId", "classId", "startsAt");
CREATE INDEX "StudySession_tenantId_deletedAt_idx" ON "StudySession"("tenantId", "deletedAt");
CREATE INDEX "StudySession_tenantId_teacherId_startsAt_endsAt_deletedAt_idx" ON "StudySession"("tenantId", "teacherId", "startsAt", "endsAt", "deletedAt");
CREATE INDEX "StudySession_tenantId_classId_startsAt_idx" ON "StudySession"("tenantId", "classId", "startsAt");
CREATE UNIQUE INDEX "StudySessionStudent_tenantId_studySessionId_studentId_key" ON "StudySessionStudent"("tenantId", "studySessionId", "studentId");
CREATE INDEX "StudySessionStudent_tenantId_studentId_idx" ON "StudySessionStudent"("tenantId", "studentId");
CREATE INDEX "HomeworkMaterial_tenantId_deletedAt_idx" ON "HomeworkMaterial"("tenantId", "deletedAt");
CREATE INDEX "Homework_tenantId_deletedAt_idx" ON "Homework"("tenantId", "deletedAt");
CREATE INDEX "Homework_tenantId_classId_dueAt_deletedAt_idx" ON "Homework"("tenantId", "classId", "dueAt", "deletedAt");
CREATE INDEX "Homework_tenantId_sourceMaterialId_idx" ON "Homework"("tenantId", "sourceMaterialId");
CREATE INDEX "Homework_tenantId_checkedAt_idx" ON "Homework"("tenantId", "checkedAt");
CREATE UNIQUE INDEX "Exam_tenantId_id_key" ON "Exam"("tenantId", "id");
CREATE INDEX "Exam_tenantId_deletedAt_idx" ON "Exam"("tenantId", "deletedAt");
CREATE INDEX "Exam_tenantId_status_deletedAt_idx" ON "Exam"("tenantId", "status", "deletedAt");
CREATE UNIQUE INDEX "ParserConfig_tenantId_id_key" ON "ParserConfig"("tenantId", "id");
CREATE UNIQUE INDEX "ParserConfig_tenantId_examId_version_key" ON "ParserConfig"("tenantId", "examId", "version");
CREATE INDEX "ParserConfig_tenantId_examId_idx" ON "ParserConfig"("tenantId", "examId");
CREATE INDEX "ParserConfig_tenantId_deletedAt_idx" ON "ParserConfig"("tenantId", "deletedAt");
CREATE UNIQUE INDEX "ExamParticipant_tenantId_id_key" ON "ExamParticipant"("tenantId", "id");
CREATE UNIQUE INDEX "ExamParticipant_tenantId_examId_id_key" ON "ExamParticipant"("tenantId", "examId", "id");
CREATE UNIQUE INDEX "ExamParticipant_tenantId_examId_studentId_key" ON "ExamParticipant"("tenantId", "examId", "studentId");
CREATE INDEX "ExamParticipant_tenantId_examId_idx" ON "ExamParticipant"("tenantId", "examId");
CREATE INDEX "ExamParticipant_tenantId_studentId_idx" ON "ExamParticipant"("tenantId", "studentId");
CREATE INDEX "ExamParticipant_tenantId_status_deletedAt_idx" ON "ExamParticipant"("tenantId", "status", "deletedAt");
CREATE UNIQUE INDEX "RawImport_tenantId_id_key" ON "RawImport"("tenantId", "id");
CREATE UNIQUE INDEX "RawImport_tenantId_examId_id_key" ON "RawImport"("tenantId", "examId", "id");
CREATE UNIQUE INDEX "RawImport_tenantId_examId_sha256_parserConfigVersion_key" ON "RawImport"("tenantId", "examId", "sha256", "parserConfigVersion");
CREATE INDEX "RawImport_tenantId_examId_idx" ON "RawImport"("tenantId", "examId");
CREATE INDEX "RawImport_tenantId_sha256_idx" ON "RawImport"("tenantId", "sha256");
CREATE INDEX "RawImport_tenantId_deletedAt_idx" ON "RawImport"("tenantId", "deletedAt");
CREATE UNIQUE INDEX "AnswerKey_tenantId_id_key" ON "AnswerKey"("tenantId", "id");
CREATE UNIQUE INDEX "AnswerKey_tenantId_examId_version_key" ON "AnswerKey"("tenantId", "examId", "version");
CREATE INDEX "AnswerKey_tenantId_examId_idx" ON "AnswerKey"("tenantId", "examId");
CREATE INDEX "AnswerKey_tenantId_deletedAt_idx" ON "AnswerKey"("tenantId", "deletedAt");
CREATE UNIQUE INDEX "ExamResult_tenantId_resultKey_key" ON "ExamResult"("tenantId", "resultKey");
CREATE UNIQUE INDEX "ExamResult_tenantId_participantId_answerKeyVersion_parserConfigVersion_engineVersion_key" ON "ExamResult"("tenantId", "participantId", "answerKeyVersion", "parserConfigVersion", "engineVersion");
CREATE INDEX "ExamResult_tenantId_examId_idx" ON "ExamResult"("tenantId", "examId");
CREATE INDEX "ExamResult_tenantId_studentId_idx" ON "ExamResult"("tenantId", "studentId");
CREATE INDEX "ExamResult_tenantId_deletedAt_idx" ON "ExamResult"("tenantId", "deletedAt");
CREATE UNIQUE INDEX "ParsedAnswer_tenantId_id_key" ON "ParsedAnswer"("tenantId", "id");
CREATE UNIQUE INDEX "ParsedAnswer_tenantId_rawImportId_participantId_parserConfigVersion_key" ON "ParsedAnswer"("tenantId", "rawImportId", "participantId", "parserConfigVersion");
CREATE INDEX "ParsedAnswer_tenantId_examId_idx" ON "ParsedAnswer"("tenantId", "examId");
CREATE INDEX "ParsedAnswer_tenantId_participantId_idx" ON "ParsedAnswer"("tenantId", "participantId");
CREATE INDEX "ParsedAnswer_tenantId_status_deletedAt_idx" ON "ParsedAnswer"("tenantId", "status", "deletedAt");
CREATE UNIQUE INDEX "ImportQuarantine_tenantId_id_key" ON "ImportQuarantine"("tenantId", "id");
CREATE UNIQUE INDEX "ImportQuarantine_tenantId_rawImportId_rowNumber_key" ON "ImportQuarantine"("tenantId", "rawImportId", "rowNumber");
CREATE INDEX "ImportQuarantine_tenantId_examId_idx" ON "ImportQuarantine"("tenantId", "examId");
CREATE INDEX "ImportQuarantine_tenantId_status_deletedAt_idx" ON "ImportQuarantine"("tenantId", "status", "deletedAt");
CREATE UNIQUE INDEX "ReportSnapshot_tenantId_id_key" ON "ReportSnapshot"("tenantId", "id");
CREATE INDEX "ReportSnapshot_tenantId_examId_idx" ON "ReportSnapshot"("tenantId", "examId");
CREATE INDEX "ReportSnapshot_tenantId_status_deletedAt_idx" ON "ReportSnapshot"("tenantId", "status", "deletedAt");
CREATE INDEX "AuditLog_tenantId_entityType_createdAt_idx" ON "AuditLog"("tenantId", "entityType", "createdAt");

ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Class" ADD CONSTRAINT "Class_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Student" ADD CONSTRAINT "Student_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Student" ADD CONSTRAINT "Student_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Student" ADD CONSTRAINT "Student_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Student" ADD CONSTRAINT "Student_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Guardian" ADD CONSTRAINT "Guardian_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuardianStudent" ADD CONSTRAINT "GuardianStudent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuardianStudent" ADD CONSTRAINT "GuardianStudent_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuardianStudent" ADD CONSTRAINT "GuardianStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleLesson" ADD CONSTRAINT "ScheduleLesson_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleLesson" ADD CONSTRAINT "ScheduleLesson_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleLesson" ADD CONSTRAINT "ScheduleLesson_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudySessionStudent" ADD CONSTRAINT "StudySessionStudent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudySessionStudent" ADD CONSTRAINT "StudySessionStudent_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudySessionStudent" ADD CONSTRAINT "StudySessionStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeworkMaterial" ADD CONSTRAINT "HomeworkMaterial_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_sourceMaterialId_fkey" FOREIGN KEY ("sourceMaterialId") REFERENCES "HomeworkMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Homework" ADD CONSTRAINT "Homework_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParserConfig" ADD CONSTRAINT "ParserConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParserConfig" ADD CONSTRAINT "ParserConfig_tenantId_examId_fkey" FOREIGN KEY ("tenantId", "examId") REFERENCES "Exam"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamParticipant" ADD CONSTRAINT "ExamParticipant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamParticipant" ADD CONSTRAINT "ExamParticipant_tenantId_examId_fkey" FOREIGN KEY ("tenantId", "examId") REFERENCES "Exam"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamParticipant" ADD CONSTRAINT "ExamParticipant_tenantId_studentId_fkey" FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RawImport" ADD CONSTRAINT "RawImport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RawImport" ADD CONSTRAINT "RawImport_tenantId_examId_fkey" FOREIGN KEY ("tenantId", "examId") REFERENCES "Exam"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnswerKey" ADD CONSTRAINT "AnswerKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnswerKey" ADD CONSTRAINT "AnswerKey_tenantId_examId_fkey" FOREIGN KEY ("tenantId", "examId") REFERENCES "Exam"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_tenantId_examId_fkey" FOREIGN KEY ("tenantId", "examId") REFERENCES "Exam"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_tenantId_participantId_fkey" FOREIGN KEY ("tenantId", "participantId") REFERENCES "ExamParticipant"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_tenantId_studentId_fkey" FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_tenantId_rawImportId_fkey" FOREIGN KEY ("tenantId", "rawImportId") REFERENCES "RawImport"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_tenantId_answerKeyId_fkey" FOREIGN KEY ("tenantId", "answerKeyId") REFERENCES "AnswerKey"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParsedAnswer" ADD CONSTRAINT "ParsedAnswer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParsedAnswer" ADD CONSTRAINT "ParsedAnswer_tenantId_examId_fkey" FOREIGN KEY ("tenantId", "examId") REFERENCES "Exam"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParsedAnswer" ADD CONSTRAINT "ParsedAnswer_tenantId_examId_rawImportId_fkey" FOREIGN KEY ("tenantId", "examId", "rawImportId") REFERENCES "RawImport"("tenantId", "examId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParsedAnswer" ADD CONSTRAINT "ParsedAnswer_tenantId_examId_participantId_fkey" FOREIGN KEY ("tenantId", "examId", "participantId") REFERENCES "ExamParticipant"("tenantId", "examId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportQuarantine" ADD CONSTRAINT "ImportQuarantine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportQuarantine" ADD CONSTRAINT "ImportQuarantine_tenantId_examId_fkey" FOREIGN KEY ("tenantId", "examId") REFERENCES "Exam"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportQuarantine" ADD CONSTRAINT "ImportQuarantine_tenantId_rawImportId_fkey" FOREIGN KEY ("tenantId", "rawImportId") REFERENCES "RawImport"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_tenantId_examId_fkey" FOREIGN KEY ("tenantId", "examId") REFERENCES "Exam"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TenantMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantMembership" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TenantMembership_tenant_isolation" ON "TenantMembership"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "Class" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Class" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Class_tenant_isolation" ON "Class"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "Student" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Student" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Student_tenant_isolation" ON "Student"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "Teacher" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Teacher" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Teacher_tenant_isolation" ON "Teacher"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "Guardian" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Guardian" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Guardian_tenant_isolation" ON "Guardian"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "GuardianStudent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuardianStudent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "GuardianStudent_tenant_isolation" ON "GuardianStudent"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "ScheduleLesson" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScheduleLesson" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ScheduleLesson_tenant_isolation" ON "ScheduleLesson"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "StudySession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudySession" FORCE ROW LEVEL SECURITY;
CREATE POLICY "StudySession_tenant_isolation" ON "StudySession"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "StudySessionStudent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudySessionStudent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "StudySessionStudent_tenant_isolation" ON "StudySessionStudent"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "HomeworkMaterial" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HomeworkMaterial" FORCE ROW LEVEL SECURITY;
CREATE POLICY "HomeworkMaterial_tenant_isolation" ON "HomeworkMaterial"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "Homework" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Homework" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Homework_tenant_isolation" ON "Homework"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "Exam" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Exam" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Exam_tenant_isolation" ON "Exam"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "ParserConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ParserConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ParserConfig_tenant_isolation" ON "ParserConfig"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "ExamParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExamParticipant" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ExamParticipant_tenant_isolation" ON "ExamParticipant"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "RawImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RawImport" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RawImport_tenant_isolation" ON "RawImport"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "AnswerKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnswerKey" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AnswerKey_tenant_isolation" ON "AnswerKey"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "ExamResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExamResult" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ExamResult_tenant_isolation" ON "ExamResult"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "ParsedAnswer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ParsedAnswer" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ParsedAnswer_tenant_isolation" ON "ParsedAnswer"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "ImportQuarantine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportQuarantine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ImportQuarantine_tenant_isolation" ON "ImportQuarantine"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "ReportSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ReportSnapshot_tenant_isolation" ON "ReportSnapshot"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AuditLog_tenant_isolation" ON "AuditLog"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true) OR current_setting('app.bypass_rls', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT USAGE ON SCHEMA public TO app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "Tenant",
      "User",
      "TenantMembership",
      "Class",
      "Student",
      "Teacher",
      "Guardian",
      "GuardianStudent",
      "ScheduleLesson",
      "StudySession",
      "StudySessionStudent",
      "HomeworkMaterial",
      "Homework",
      "Exam",
      "ParserConfig",
      "ExamParticipant",
      "RawImport",
      "AnswerKey",
      "ExamResult",
      "ParsedAnswer",
      "ImportQuarantine",
      "ReportSnapshot",
      "AuditLog"
    TO app;
  END IF;
END $$;
