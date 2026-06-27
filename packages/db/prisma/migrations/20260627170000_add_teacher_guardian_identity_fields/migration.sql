ALTER TABLE "Teacher"
  ADD COLUMN "nationalIdEncrypted" TEXT,
  ADD COLUMN "nationalIdHash" TEXT,
  ADD COLUMN "phone" TEXT;

ALTER TABLE "Guardian"
  ADD COLUMN "nationalIdEncrypted" TEXT,
  ADD COLUMN "nationalIdHash" TEXT;

CREATE UNIQUE INDEX "Teacher_tenantId_nationalIdHash_key"
  ON "Teacher" ("tenantId", "nationalIdHash");

CREATE UNIQUE INDEX "Guardian_tenantId_nationalIdHash_key"
  ON "Guardian" ("tenantId", "nationalIdHash");
