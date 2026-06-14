ALTER TABLE "HomeworkMaterialFile"
  ALTER COLUMN "contentBase64" DROP NOT NULL;

ALTER TABLE "SupportTicketAttachment"
  ALTER COLUMN "contentBase64" DROP NOT NULL;
