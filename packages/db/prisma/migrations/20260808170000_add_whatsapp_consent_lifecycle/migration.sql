BEGIN;

LOCK TABLE "WhatsAppConsent" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'true', true);
  IF (SELECT count(*) FROM "WhatsAppConsent") <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'WHATSAPP_CONSENT_LIFECYCLE_REQUIRES_EMPTY_PROJECTION';
  END IF;
  PERFORM set_config('app.bypass_rls', 'false', true);
END $$;

ALTER TABLE "WhatsAppConsent"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "WhatsAppConsent"
  DROP CONSTRAINT "WhatsAppConsent_noticeVersion_check",
  ADD CONSTRAINT "WhatsAppConsent_noticeVersion_check"
  CHECK ("noticeVersion" = 'UNRECORDED' OR "noticeVersion" ~ '^[a-z0-9][a-z0-9._-]{0,63}$');

CREATE UNIQUE INDEX "WhatsAppConsent_tenantId_id_purpose_key"
  ON "WhatsAppConsent"("tenantId", "id", "purpose");

CREATE TABLE "WhatsAppConsentEvent" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" TEXT NOT NULL,
  "whatsappConsentId" TEXT NOT NULL,
  "studentContactId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "eventType" TEXT NOT NULL,
  "noticeVersion" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "commandKeyHash" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppConsentEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WhatsAppConsentEvent_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "WhatsAppConsentEvent_purpose_check" CHECK ("purpose" = 'UTILITY_ANNOUNCEMENT'),
  CONSTRAINT "WhatsAppConsentEvent_eventType_check" CHECK ("eventType" IN ('GRANTED', 'WITHDRAWN')),
  CONSTRAINT "WhatsAppConsentEvent_noticeVersion_check" CHECK ("noticeVersion" ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  CONSTRAINT "WhatsAppConsentEvent_source_check" CHECK ("source" IN ('CONTACT_SELF_SERVICE', 'TENANT_ADMIN_DOCUMENTED')),
  CONSTRAINT "WhatsAppConsentEvent_commandKeyHash_check" CHECK ("commandKeyHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "WhatsAppConsentEvent_requestHash_check" CHECK ("requestHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "WhatsAppConsentEvent_tenantId_id_key"
  ON "WhatsAppConsentEvent"("tenantId", "id");
CREATE UNIQUE INDEX "WhatsAppConsentEvent_tenantId_whatsappConsentId_sequence_key"
  ON "WhatsAppConsentEvent"("tenantId", "whatsappConsentId", "sequence");
CREATE UNIQUE INDEX "WhatsAppConsentEvent_tenantId_commandKeyHash_key"
  ON "WhatsAppConsentEvent"("tenantId", "commandKeyHash");
CREATE INDEX "WhatsAppConsentEvent_tenantId_studentContactId_recordedAt_idx"
  ON "WhatsAppConsentEvent"("tenantId", "studentContactId", "recordedAt");

ALTER TABLE "WhatsAppConsentEvent"
  ADD CONSTRAINT "WhatsAppConsentEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppConsentEvent_tenantId_whatsappConsentId_purpose_fkey"
  FOREIGN KEY ("tenantId", "whatsappConsentId", "purpose")
  REFERENCES "WhatsAppConsent"("tenantId", "id", "purpose")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppConsentEvent_tenantId_studentContactId_fkey"
  FOREIGN KEY ("tenantId", "studentContactId")
  REFERENCES "StudentContact"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.o_okul_guard_whatsapp_consent_projection_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW."canReceiveWhatsapp" OR NEW."version" <> 0 OR NEW."withdrawnAt" IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'WHATSAPP_CONSENT_PROJECTION_MUST_START_INACTIVE';
  END IF;

  NEW."noticeVersion" := 'UNRECORDED';
  NEW."source" := 'UNRECORDED';
  NEW."recordedAt" := clock_timestamp();
  NEW."updatedAt" := NEW."recordedAt";
  RETURN NEW;
END $$;

CREATE TRIGGER "WhatsAppConsent_guard_projection_insert"
BEFORE INSERT ON "WhatsAppConsent"
FOR EACH ROW EXECUTE FUNCTION public.o_okul_guard_whatsapp_consent_projection_insert();

CREATE OR REPLACE FUNCTION public.o_okul_record_whatsapp_consent_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  projection public."WhatsAppConsent"%ROWTYPE;
  existing_event public."WhatsAppConsentEvent"%ROWTYPE;
  contact_phone_hash TEXT;
BEGIN
  SELECT event.*
    INTO existing_event
    FROM public."WhatsAppConsentEvent" event
   WHERE event."tenantId" = NEW."tenantId"
     AND event."commandKeyHash" = NEW."commandKeyHash";

  IF FOUND THEN
    IF existing_event."whatsappConsentId" = NEW."whatsappConsentId"
      AND existing_event."studentContactId" = NEW."studentContactId"
      AND existing_event."purpose" = NEW."purpose"
      AND existing_event."eventType" = NEW."eventType"
      AND existing_event."noticeVersion" = NEW."noticeVersion"
      AND existing_event."source" = NEW."source"
      AND existing_event."requestHash" = NEW."requestHash" THEN
      RETURN NULL;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'WHATSAPP_CONSENT_IDEMPOTENCY_CONFLICT';
  END IF;

  SELECT *
    INTO projection
    FROM public."WhatsAppConsent"
   WHERE "tenantId" = NEW."tenantId"
     AND "id" = NEW."whatsappConsentId"
     AND "purpose" = NEW."purpose"
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'WHATSAPP_CONSENT_PROJECTION_NOT_FOUND';
  END IF;

  SELECT event.*
    INTO existing_event
    FROM public."WhatsAppConsentEvent" event
   WHERE event."tenantId" = NEW."tenantId"
     AND event."commandKeyHash" = NEW."commandKeyHash";

  IF FOUND THEN
    IF existing_event."whatsappConsentId" = NEW."whatsappConsentId"
      AND existing_event."studentContactId" = NEW."studentContactId"
      AND existing_event."purpose" = NEW."purpose"
      AND existing_event."eventType" = NEW."eventType"
      AND existing_event."noticeVersion" = NEW."noticeVersion"
      AND existing_event."source" = NEW."source"
      AND existing_event."requestHash" = NEW."requestHash" THEN
      RETURN NULL;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'WHATSAPP_CONSENT_IDEMPOTENCY_CONFLICT';
  END IF;

  SELECT contact."phoneHash"
    INTO contact_phone_hash
    FROM public."StudentContact" contact
   WHERE contact."tenantId" = NEW."tenantId"
     AND contact."id" = NEW."studentContactId"
     AND contact."deletedAt" IS NULL
     AND contact."phoneHash" IS NOT NULL;

  IF contact_phone_hash IS NULL OR contact_phone_hash <> projection."phoneHash" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'WHATSAPP_CONSENT_CONTACT_INACTIVE_OR_PHONE_MISMATCH';
  END IF;

  IF (NEW."eventType" = 'GRANTED') = projection."canReceiveWhatsapp" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'WHATSAPP_CONSENT_INVALID_STATE_TRANSITION';
  END IF;

  NEW."sequence" := projection."version" + 1;
  NEW."recordedAt" := clock_timestamp();
  NEW."createdAt" := NEW."recordedAt";

  UPDATE public."WhatsAppConsent"
     SET "canReceiveWhatsapp" = NEW."eventType" = 'GRANTED',
         "version" = NEW."sequence",
         "noticeVersion" = NEW."noticeVersion",
         "source" = NEW."source",
         "recordedAt" = NEW."recordedAt",
         "withdrawnAt" = CASE WHEN NEW."eventType" = 'WITHDRAWN' THEN NEW."recordedAt" ELSE NULL END,
         "updatedAt" = NEW."recordedAt"
   WHERE "tenantId" = projection."tenantId"
     AND "id" = projection."id";

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.o_okul_record_whatsapp_consent_event() FROM PUBLIC;

CREATE TRIGGER "WhatsAppConsentEvent_record"
BEFORE INSERT ON "WhatsAppConsentEvent"
FOR EACH ROW EXECUTE FUNCTION public.o_okul_record_whatsapp_consent_event();

ALTER TABLE "WhatsAppConsentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppConsentEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY "WhatsAppConsent_tenant_isolation" ON "WhatsAppConsent";
CREATE POLICY "WhatsAppConsent_tenant_isolation" ON "WhatsAppConsent"
  USING (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY "WhatsAppConsentEvent_tenant_isolation" ON "WhatsAppConsentEvent"
  USING (current_setting('app.bypass_rls', true) = 'true' OR "tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "WhatsAppConsent" FROM app;
    GRANT SELECT, INSERT ON "WhatsAppConsent" TO app;
    REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "WhatsAppConsentEvent" FROM app;
    GRANT SELECT, INSERT ON "WhatsAppConsentEvent" TO app;
  END IF;
END $$;

COMMIT;
