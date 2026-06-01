ALTER TABLE "Student" ADD COLUMN "responsibleTeacherId" TEXT;

CREATE INDEX "Student_tenantId_responsibleTeacherId_idx" ON "Student"("tenantId", "responsibleTeacherId");

ALTER TABLE "Student"
  ADD CONSTRAINT "Student_responsibleTeacherId_fkey"
  FOREIGN KEY ("responsibleTeacherId") REFERENCES "Teacher"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
