-- KV-8 (DEC-20261005-04, basis DEC-20261005-02): automatic guardian notifications for absence, payment due
-- dates and school grade publishing. No outbox table (DEC-20261004-07): each source row carries its own
-- "already notified" marker and the worker claims it before sending (announcement-delivery queue).
-- Additive only: existing rows get the decided defaults (every trigger on, threshold 10 days, guardians opted in).
-- RLS: every column lands on a table that already carries tenant isolation, reset and device-restore boundary
-- policies (Tenant has none by design); non-key columns need no new policy, grant or composite FK.

-- Institution settings (one row per tenant; DEC-20261005-04 defaults).
ALTER TABLE "Tenant"
  ADD COLUMN "guardianNotifyAbsence" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "guardianNotifyPaymentDue" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "guardianNotifyGradePublish" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "guardianAbsenceThreshold" INTEGER NOT NULL DEFAULT 10,
  ADD CONSTRAINT "Tenant_guardianAbsenceThreshold_check" CHECK ("guardianAbsenceThreshold" BETWEEN 1 AND 365);

-- Guardian's own opt-out per linked student (the guardian notification preference panel). Default on: operational
-- notifications need no consent (DEC-20261005-02); the guardian can still turn them off.
ALTER TABLE "GuardianStudent" ADD COLUMN "canReceiveAutoNotifications" BOOLEAN NOT NULL DEFAULT true;

-- Daily absence: notifiedAt is set once per attendance row (student + day), so ABSENT -> PRESENT -> ABSENT on the
-- same day sends nothing new. thresholdNotifiedAt marks the row on which the term threshold warning went out.
ALTER TABLE "Attendance"
  ADD COLUMN "notifiedAt" TIMESTAMPTZ(6),
  ADD COLUMN "thresholdNotifiedAt" TIMESTAMPTZ(6);

-- Payment due reminder: the Istanbul calendar day of the last reminder (idempotency key installment + day).
ALTER TABLE "PaymentInstallment" ADD COLUMN "notifiedOn" DATE;

-- Grade publish: publishedAt watermark of the last notified publish. Published GradeEntry rows are immutable, so the
-- marker lives on the assessment; every later publish (a correction too) is a new notification.
ALTER TABLE "GradeAssessment" ADD COLUMN "notifiedAt" TIMESTAMPTZ(6);

-- Payment scan: due installments per tenant and day.
CREATE INDEX "PaymentInstallment_tenantId_dueDate_idx" ON "PaymentInstallment" ("tenantId", "dueDate");
