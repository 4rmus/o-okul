-- DEC-20261003-01 (KV-3): a StudentContact may point at the guardian account the institution admin created for it.
-- The FK targets the GuardianStudent link itself (ADR-0001: tenantId leads every composite key), so a contact can only
-- reference a guardian already linked to the same student in the same tenant. Removing that link clears only
-- "guardianId"; the contact row, its consent fields and its tenant/student keys stay intact.
-- RLS: StudentContact already carries tenant isolation, reset and device-restore boundary policies; a new
-- nullable column needs no policy or grant change.
ALTER TABLE "StudentContact" ADD COLUMN "guardianId" TEXT;

ALTER TABLE "StudentContact"
  ADD CONSTRAINT "StudentContact_tenantId_guardianId_studentId_fkey"
  FOREIGN KEY ("tenantId", "guardianId", "studentId")
  REFERENCES "GuardianStudent"("tenantId", "guardianId", "studentId")
  ON DELETE SET NULL ("guardianId")
  ON UPDATE NO ACTION;

CREATE INDEX "StudentContact_tenantId_guardianId_idx" ON "StudentContact"("tenantId", "guardianId");
