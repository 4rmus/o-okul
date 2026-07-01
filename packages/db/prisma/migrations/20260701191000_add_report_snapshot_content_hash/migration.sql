ALTER TABLE "ReportSnapshot" ADD COLUMN "contentHash" TEXT;

UPDATE "ReportSnapshot"
SET "contentHash" = "id"
WHERE "contentHash" IS NULL;

ALTER TABLE "ReportSnapshot" ALTER COLUMN "contentHash" SET NOT NULL;

CREATE UNIQUE INDEX "ReportSnapshot_tenantId_contentHash_key" ON "ReportSnapshot"("tenantId", "contentHash");
