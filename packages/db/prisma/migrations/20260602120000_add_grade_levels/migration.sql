CREATE TABLE "GradeLevel" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GradeLevel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GradeLevel_tenantId_id_key" ON "GradeLevel"("tenantId", "id");
CREATE UNIQUE INDEX "GradeLevel_tenantId_code_key" ON "GradeLevel"("tenantId", "code");
CREATE INDEX "GradeLevel_tenantId_deletedAt_idx" ON "GradeLevel"("tenantId", "deletedAt");

ALTER TABLE "GradeLevel" ADD CONSTRAINT "GradeLevel_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Class" ADD COLUMN "gradeLevelId" TEXT;
ALTER TABLE "Class" ADD COLUMN "section" TEXT;

CREATE INDEX "Class_tenantId_gradeLevelId_idx" ON "Class"("tenantId", "gradeLevelId");

ALTER TABLE "Class" ADD CONSTRAINT "Class_tenantId_gradeLevelId_fkey"
  FOREIGN KEY ("tenantId", "gradeLevelId") REFERENCES "GradeLevel"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
