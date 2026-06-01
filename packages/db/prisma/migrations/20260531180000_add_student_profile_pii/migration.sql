ALTER TABLE "Student" ADD COLUMN "nationalIdEncrypted" TEXT;
ALTER TABLE "Student" ADD COLUMN "nationalIdHash" TEXT;
ALTER TABLE "Student" ADD COLUMN "birthDate" DATE;
ALTER TABLE "Student" ADD COLUMN "phone" TEXT;
ALTER TABLE "Student" ADD COLUMN "email" TEXT;
ALTER TABLE "Student" ADD COLUMN "photoKey" TEXT;

CREATE UNIQUE INDEX "Student_tenantId_nationalIdHash_key" ON "Student"("tenantId", "nationalIdHash");
