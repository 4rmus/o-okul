ALTER TABLE "TenantMutationActivity" ADD COLUMN "referenceId" text;
CREATE UNIQUE INDEX "TenantMutationActivity_reference_key" ON "TenantMutationActivity" ("tenantId", "lifecycleVersion", "kind", "referenceId");
ALTER TABLE "SecretDeliveryOutbox" ADD COLUMN "sourceScope" text, ADD COLUMN "tenantLifecycleVersion" integer, ADD COLUMN "providerMessageId" text;
ALTER TABLE "SecretDeliveryOutbox" DROP CONSTRAINT "SecretDeliveryOutbox_status_check";
ALTER TABLE "SecretDeliveryOutbox" ADD CONSTRAINT "SecretDeliveryOutbox_status_check" CHECK ("status" IN ('PENDING','PROCESSING','UNCERTAIN','DELIVERED','FAILED','EXPIRED'));
ALTER TABLE "SecretDeliveryOutbox" ADD CONSTRAINT "SecretDeliveryOutbox_provenance_check" CHECK (COALESCE((
  ("sourceScope" IS NULL AND "tenantLifecycleVersion" IS NULL) OR
  ("sourceScope" = 'SYSTEM' AND "tenantId" IS NULL AND "tenantLifecycleVersion" IS NULL) OR
  ("sourceScope" = 'TENANT' AND "tenantId" IS NOT NULL AND "tenantId" <> 'system' AND "tenantLifecycleVersion" IS NOT NULL AND "tenantLifecycleVersion" >= 0)
), false));
-- Legacy rows stay unverified; never backfill them from the current Tenant epoch.
CREATE FUNCTION protect_secret_delivery_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."id", NEW."tenantId", NEW."purpose", NEW."sourceId", NEW."sourceScope", NEW."tenantLifecycleVersion") IS DISTINCT FROM ROW(OLD."id", OLD."tenantId", OLD."purpose", OLD."sourceId", OLD."sourceScope", OLD."tenantLifecycleVersion") THEN
    RAISE EXCEPTION 'OUTBOX_PROVENANCE_IMMUTABLE';
  END IF;
  IF NEW."status" = 'EXPIRED' AND (OLD."status" IN ('PROCESSING','UNCERTAIN') OR OLD."attempts" > 0) THEN
    NEW."status" := 'UNCERTAIN'; NEW."claimToken" := OLD."claimToken"; NEW."claimedAt" := OLD."claimedAt"; NEW."lastErrorCode" := 'DELIVERY_CANCELLED_AFTER_ATTEMPT';
  END IF;
  IF (OLD."status" = 'UNCERTAIN' AND NEW."status" <> 'UNCERTAIN') OR (OLD."attempts" > 0 AND NEW."status" = 'PENDING') THEN
    RAISE EXCEPTION 'OUTBOX_DISPATCH_UNCERTAIN';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER secret_delivery_provenance_guard BEFORE UPDATE ON "SecretDeliveryOutbox" FOR EACH ROW EXECUTE FUNCTION protect_secret_delivery_provenance();
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'secret_delivery_worker') THEN
    GRANT SELECT ("id", "status", "lifecycleVersion") ON "Tenant" TO secret_delivery_worker;
  END IF;
END $$;

ALTER TABLE "TenantMutationActivity" DROP CONSTRAINT "TenantMutationActivity_kind_check";
ALTER TABLE "TenantMutationActivity" ADD CONSTRAINT "TenantMutationActivity_kind_check" CHECK ("kind" IN ('HTTP_MUTATION','S3_MUTATION','QUEUE_ADMISSION','WORKER_JOB','AUTH_MUTATION','ADMIN_MUTATION','PROVIDER_MUTATION'));
