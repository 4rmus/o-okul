CREATE TABLE "Campus" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Campus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Campus_tenantId_id_key" ON "Campus"("tenantId", "id");
CREATE UNIQUE INDEX "Campus_tenantId_code_key" ON "Campus"("tenantId", "code");
CREATE INDEX "Campus_tenantId_deletedAt_idx" ON "Campus"("tenantId", "deletedAt");

ALTER TABLE "Campus" ADD CONSTRAINT "Campus_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Class" ADD COLUMN "campusId" TEXT;

CREATE UNIQUE INDEX "Class_tenantId_id_key" ON "Class"("tenantId", "id");
CREATE INDEX "Class_tenantId_campusId_idx" ON "Class"("tenantId", "campusId");

ALTER TABLE "Class" ADD CONSTRAINT "Class_tenantId_campusId_fkey"
  FOREIGN KEY ("tenantId", "campusId") REFERENCES "Campus"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
