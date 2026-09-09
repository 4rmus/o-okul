-- Institution authority is retained with the tenant; existing tenants have no authority.
ALTER TABLE "Tenant" ADD COLUMN "resetRequest" jsonb;
ALTER TABLE "TenantFreshResetOperation" ADD COLUMN "institutionRequestId" text;
CREATE UNIQUE INDEX "TenantFreshResetOperation_request_once" ON "TenantFreshResetOperation" ("tenantId", "institutionRequestId");
-- Once claimed, the authority cannot be revoked, replaced, or reassigned.
CREATE FUNCTION guard_tenant_reset_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'o_okul_reset_worker' AND NEW."resetRequest" IS DISTINCT FROM OLD."resetRequest" AND
     (OLD."resetRequest" IS NULL OR OLD."resetRequest"->>'status' IS DISTINCT FROM 'ACCEPTED' OR
      NEW."resetRequest" IS DISTINCT FROM jsonb_set(OLD."resetRequest", '{status}', '"COMPLETED"'::jsonb)) THEN
    RAISE EXCEPTION 'RESET_REQUEST_ACTOR_INVALID';
  END IF;
  IF OLD."resetRequest"->>'status' = 'ACCEPTED' AND NEW."resetRequest" IS DISTINCT FROM OLD."resetRequest" THEN
    IF NEW."resetRequest" IS DISTINCT FROM jsonb_set(OLD."resetRequest", '{status}', '"COMPLETED"'::jsonb)
       OR NOT EXISTS (SELECT 1 FROM "TenantFreshResetOperation" o WHERE o."tenantId" = OLD."id" AND o."id" = OLD."resetRequest"->>'operationId' AND o."institutionRequestId" = OLD."resetRequest"->>'id' AND o."status" = 'COMPLETED') THEN
      RAISE EXCEPTION 'RESET_REQUEST_ALREADY_ACCEPTED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tenant_reset_request_immutable BEFORE UPDATE OF "resetRequest" ON "Tenant" FOR EACH ROW EXECUTE FUNCTION guard_tenant_reset_request();

GRANT UPDATE ("resetRequest") ON "Tenant" TO o_okul_reset_worker;
