DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'secret_delivery_worker') THEN
    RAISE EXCEPTION 'SECRET_DELIVERY_WORKER_ROLE_REQUIRED';
  END IF;
END $$;

GRANT SELECT, UPDATE ON "SecretDeliveryOutbox" TO secret_delivery_worker;
