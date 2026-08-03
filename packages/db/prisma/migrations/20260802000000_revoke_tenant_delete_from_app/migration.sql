DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    REVOKE DELETE ON TABLE "Tenant" FROM app;
  END IF;
END $$;
