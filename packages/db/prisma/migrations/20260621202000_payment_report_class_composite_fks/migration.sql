DO $$
DECLARE
  invalid_payment_plan_class_count INTEGER;
  invalid_report_snapshot_class_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_payment_plan_class_count
  FROM "PaymentPlan" plan
  LEFT JOIN "Class" klass
    ON klass."tenantId" = plan."tenantId"
   AND klass."id" = plan."classId"
  WHERE plan."classId" IS NOT NULL
    AND klass."id" IS NULL;

  IF invalid_payment_plan_class_count > 0 THEN
    RAISE EXCEPTION 'PaymentPlan class FK preflight failed: % rows are orphan or cross-tenant', invalid_payment_plan_class_count;
  END IF;

  SELECT COUNT(*) INTO invalid_report_snapshot_class_count
  FROM "ReportSnapshot" snapshot
  LEFT JOIN "Class" klass
    ON klass."tenantId" = snapshot."tenantId"
   AND klass."id" = snapshot."classId"
  WHERE snapshot."classId" IS NOT NULL
    AND klass."id" IS NULL;

  IF invalid_report_snapshot_class_count > 0 THEN
    RAISE EXCEPTION 'ReportSnapshot class FK preflight failed: % rows are orphan or cross-tenant', invalid_report_snapshot_class_count;
  END IF;
END $$;

ALTER TABLE "PaymentPlan" DROP CONSTRAINT IF EXISTS "PaymentPlan_classId_fkey";
ALTER TABLE "ReportSnapshot" DROP CONSTRAINT IF EXISTS "ReportSnapshot_classId_fkey";

ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_class_fkey"
  FOREIGN KEY ("tenantId", "classId") REFERENCES "Class"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_class_fkey"
  FOREIGN KEY ("tenantId", "classId") REFERENCES "Class"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
