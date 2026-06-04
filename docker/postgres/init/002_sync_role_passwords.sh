#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 \
  -v app_user="${APP_DB_USER}" \
  -v app_password="${APP_DB_PASSWORD}" \
  -v migration_user="${MIGRATION_DB_USER}" \
  -v migration_password="${MIGRATION_DB_PASSWORD}" \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" <<'SQL'
ALTER ROLE :"app_user" PASSWORD :'app_password';
ALTER ROLE :"migration_user" PASSWORD :'migration_password';
SQL
