DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app LOGIN PASSWORD 'app';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration') THEN
    CREATE ROLE migration LOGIN PASSWORD 'migration' CREATEDB;
  END IF;
END $$;

GRANT CONNECT ON DATABASE uzman_hocam TO app, migration;
GRANT USAGE, CREATE ON SCHEMA public TO migration;
ALTER SCHEMA public OWNER TO migration;
