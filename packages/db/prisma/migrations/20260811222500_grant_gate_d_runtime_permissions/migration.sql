DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT EXECUTE ON FUNCTION public.o_okul_refresh_license_usage(TEXT) TO app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'secret_delivery_worker') THEN
    GRANT USAGE ON SCHEMA public TO secret_delivery_worker;
  END IF;
END $$;
