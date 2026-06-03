CREATE TABLE "AnnouncementReceipt" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "announcementId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AnnouncementReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnouncementReceipt_tenantId_announcementId_userId_subjectType_subjectId_key"
  ON "AnnouncementReceipt" ("tenantId", "announcementId", "userId", "subjectType", "subjectId");

CREATE INDEX "AnnouncementReceipt_tenantId_userId_subjectType_subjectId_idx"
  ON "AnnouncementReceipt" ("tenantId", "userId", "subjectType", "subjectId");

CREATE INDEX "AnnouncementReceipt_tenantId_announcementId_idx"
  ON "AnnouncementReceipt" ("tenantId", "announcementId");
