DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT, INSERT, UPDATE ON "PlatformIdempotencyKey" TO app;
  END IF;
END $$;
