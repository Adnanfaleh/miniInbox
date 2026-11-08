#!/bin/sh
# Runs once, when the Postgres volume is first created (after 00-create-test-db.sql).
# Creates the application role used by the API and worker (D-016).
#
# app_user is not a superuser, cannot bypass row-level security, and does not own any table,
# so the RLS policies apply to it. Table grants are added per table in the Prisma migrations.
# The owner role (POSTGRES_USER) runs migrations and the seed only.
set -eu
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set in .env}"

# The password is passed as a psql variable (:'pw'), which quotes it safely.
psql -v ON_ERROR_STOP=1 -v pw="$APP_DB_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE app_user LOGIN PASSWORD :'pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
SQL
