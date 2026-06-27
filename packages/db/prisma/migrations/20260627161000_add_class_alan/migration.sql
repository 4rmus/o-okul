ALTER TABLE "Class" ADD COLUMN "alanId" TEXT;

CREATE INDEX "Class_tenantId_alanId_idx" ON "Class"("tenantId", "alanId");

ALTER TABLE "Class"
  ADD CONSTRAINT "Class_tenantId_alanId_fkey"
  FOREIGN KEY ("tenantId", "alanId")
  REFERENCES "Alan"("tenantId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
