DO $$
DECLARE
  invalid_homework_material_count INTEGER;
  invalid_support_ticket_class_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_homework_material_count
  FROM "Homework" homework
  LEFT JOIN "HomeworkMaterial" material
    ON material."tenantId" = homework."tenantId"
   AND material."id" = homework."sourceMaterialId"
  WHERE homework."sourceMaterialId" IS NOT NULL
    AND material."id" IS NULL;

  IF invalid_homework_material_count > 0 THEN
    RAISE EXCEPTION 'Homework sourceMaterial FK preflight failed: % rows are orphan or cross-tenant', invalid_homework_material_count;
  END IF;

  SELECT COUNT(*) INTO invalid_support_ticket_class_count
  FROM "SupportTicket" ticket
  LEFT JOIN "Class" klass
    ON klass."tenantId" = ticket."tenantId"
   AND klass."id" = ticket."classId"
  WHERE ticket."classId" IS NOT NULL
    AND klass."id" IS NULL;

  IF invalid_support_ticket_class_count > 0 THEN
    RAISE EXCEPTION 'SupportTicket class FK preflight failed: % rows are orphan or cross-tenant', invalid_support_ticket_class_count;
  END IF;
END $$;

ALTER TABLE "Homework" DROP CONSTRAINT IF EXISTS "Homework_sourceMaterialId_fkey";
ALTER TABLE "SupportTicket" DROP CONSTRAINT IF EXISTS "SupportTicket_classId_fkey";

ALTER TABLE "Homework" ADD CONSTRAINT "Homework_sourceMaterial_fkey"
  FOREIGN KEY ("tenantId", "sourceMaterialId") REFERENCES "HomeworkMaterial"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_class_fkey"
  FOREIGN KEY ("tenantId", "classId") REFERENCES "Class"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
