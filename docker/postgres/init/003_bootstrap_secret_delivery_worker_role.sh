#!/bin/sh
set -eu

: "${SECRET_DELIVERY_WORKER_DB_PASSWORD:?SECRET_DELIVERY_WORKER_DB_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 \
  -v worker_password="${SECRET_DELIVERY_WORKER_DB_PASSWORD}" \
  -v db_name="${POSTGRES_DB}" \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'secret_delivery_worker') THEN
    CREATE ROLE secret_delivery_worker LOGIN;
  END IF;
END $$;

ALTER ROLE secret_delivery_worker PASSWORD :'worker_password';
GRANT CONNECT ON DATABASE :"db_name" TO secret_delivery_worker;
SQL
