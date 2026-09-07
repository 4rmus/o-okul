#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'o_okul_reset_worker') THEN
    CREATE ROLE o_okul_reset_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'o_okul_reset_worker'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit
      OR EXISTS (SELECT 1 FROM pg_auth_members membership WHERE membership.roleid = pg_roles.oid OR membership.member = pg_roles.oid))) THEN
    RAISE EXCEPTION 'TENANT_RESET_WORKER_ROLE_UNSAFE';
  END IF;
END $$;
SQL
