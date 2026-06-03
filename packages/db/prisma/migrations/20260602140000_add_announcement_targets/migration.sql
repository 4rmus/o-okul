ALTER TABLE "Announcement"
  ADD COLUMN "campusId" TEXT,
  ADD COLUMN "gradeLevelId" TEXT,
  ADD COLUMN "classId" TEXT,
  ADD COLUMN "courseId" TEXT,
  ADD COLUMN "termId" TEXT;

CREATE INDEX "Announcement_tenantId_campusId_idx" ON "Announcement" ("tenantId", "campusId");
CREATE INDEX "Announcement_tenantId_gradeLevelId_idx" ON "Announcement" ("tenantId", "gradeLevelId");
CREATE INDEX "Announcement_tenantId_classId_idx" ON "Announcement" ("tenantId", "classId");
CREATE INDEX "Announcement_tenantId_courseId_idx" ON "Announcement" ("tenantId", "courseId");
CREATE INDEX "Announcement_tenantId_termId_idx" ON "Announcement" ("tenantId", "termId");
