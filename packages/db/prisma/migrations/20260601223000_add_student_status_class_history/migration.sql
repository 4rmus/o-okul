ALTER TABLE "Student" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX "Student_tenantId_status_deletedAt_idx" ON "Student"("tenantId", "status", "deletedAt");

CREATE TABLE "StudentClassHistory" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "classId" TEXT,
  "startsAt" DATE NOT NULL,
  "endsAt" DATE,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StudentClassHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentClassHistory_tenantId_studentId_startsAt_idx" ON "StudentClassHistory"("tenantId", "studentId", "startsAt");
CREATE INDEX "StudentClassHistory_tenantId_classId_idx" ON "StudentClassHistory"("tenantId", "classId");
CREATE INDEX "StudentClassHistory_tenantId_endsAt_idx" ON "StudentClassHistory"("tenantId", "endsAt");

ALTER TABLE "StudentClassHistory" ADD CONSTRAINT "StudentClassHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentClassHistory" ADD CONSTRAINT "StudentClassHistory_tenantId_studentId_fkey" FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentClassHistory" ADD CONSTRAINT "StudentClassHistory_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;
