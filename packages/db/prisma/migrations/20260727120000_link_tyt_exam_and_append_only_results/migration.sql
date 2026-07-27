ALTER TABLE "Exam"
ADD COLUMN "linkedTytExamId" TEXT,
ADD COLUMN "examYear" INTEGER,
ADD COLUMN "scoringProfileId" TEXT;

CREATE INDEX "Exam_tenantId_linkedTytExamId_idx"
ON "Exam"("tenantId", "linkedTytExamId");

ALTER TABLE "Exam"
ADD CONSTRAINT "Exam_tenantId_linkedTytExamId_fkey"
FOREIGN KEY ("tenantId", "linkedTytExamId")
REFERENCES "Exam"("tenantId", "id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ExamResult_tenantId_rawImportId_resultKey_key"
ON "ExamResult"("tenantId", "rawImportId", "resultKey");

DROP INDEX "ExamResult_tenantId_resultKey_key";
DROP INDEX "ExamResult_tenantId_participantId_answerKeyVersion_parserCo_key";
