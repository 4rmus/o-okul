DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app LOGIN PASSWORD 'app';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration') THEN
    CREATE ROLE migration LOGIN PASSWORD 'migration' CREATEDB;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'secret_delivery_worker') THEN
    CREATE ROLE secret_delivery_worker LOGIN;
  END IF;
END $$;

GRANT CONNECT ON DATABASE o_okul TO app, migration, secret_delivery_worker;
GRANT USAGE, CREATE ON SCHEMA public TO migration;
ALTER SCHEMA public OWNER TO migration;
