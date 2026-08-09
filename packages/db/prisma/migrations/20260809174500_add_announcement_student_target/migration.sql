ALTER TABLE "Announcement"
  ADD COLUMN "studentId" TEXT;

CREATE INDEX "Announcement_tenantId_studentId_idx"
  ON "Announcement" ("tenantId", "studentId");

ALTER TABLE "Announcement"
  ADD CONSTRAINT "Announcement_tenantId_studentId_fkey"
  FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
