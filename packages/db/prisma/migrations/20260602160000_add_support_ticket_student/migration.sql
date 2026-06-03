ALTER TABLE "SupportTicket"
  ADD COLUMN "studentId" TEXT;

CREATE INDEX "SupportTicket_tenantId_studentId_idx"
  ON "SupportTicket" ("tenantId", "studentId");
