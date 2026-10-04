-- KF-2/KF-3: overdue is derived on read (dueDate < today AND status = 'PENDING').
-- OVERDUE is no longer a stored status; backfill existing rows and forbid new writes.
BEGIN;

SELECT set_config('app.bypass_rls', 'true', true);

LOCK TABLE "PaymentInstallment" IN SHARE ROW EXCLUSIVE MODE;

UPDATE "PaymentInstallment"
SET "status" = 'PENDING'
WHERE "status" = 'OVERDUE';

ALTER TABLE "PaymentInstallment"
  ADD CONSTRAINT "PaymentInstallment_status_check"
    CHECK ("status" IN ('PENDING', 'PAID', 'CANCELED'));

COMMIT;
