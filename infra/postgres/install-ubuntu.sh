#!/usr/bin/env bash
# Installs PostgreSQL 17 with PostGIS 3 and pgvector from the PostgreSQL apt
# repository (apt.postgresql.org) on Ubuntu or Debian, starts the cluster, and
# creates a password login for local tests and CI. Run as root (or with sudo).
#
#   sudo infra/postgres/install-ubuntu.sh            # user/password serendipity/serendipity
#   DATABASE_URL=postgresql://serendipity:serendipity@127.0.0.1:5432/postgres
#
# Development credentials only; never reuse them outside a throwaway machine.
set -euo pipefail

PG_MAJOR="${PG_MAJOR:-17}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-serendipity}"
PG_PASSWORD="${PG_PASSWORD:-serendipity}"

codename="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
keyring=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates postgresql-common >/dev/null
if [ ! -f "$keyring" ]; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o "$keyring" https://www.postgresql.org/media/keys/ACCC4CF8.asc
fi
echo "deb [signed-by=$keyring] https://apt.postgresql.org/pub/repos/apt ${codename}-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update -qq
# Do not let the package create a default cluster; we create ours on PG_PORT.
mkdir -p /etc/postgresql-common/createcluster.d
echo "create_main_cluster = false" > /etc/postgresql-common/createcluster.d/00-serendipity.conf
apt-get install -y -qq "postgresql-${PG_MAJOR}" "postgresql-${PG_MAJOR}-postgis-3" \
  "postgresql-${PG_MAJOR}-pgvector" >/dev/null

if ! pg_lsclusters -h | awk '{print $1" "$2}' | grep -qx "${PG_MAJOR} serendipity"; then
  pg_createcluster "$PG_MAJOR" serendipity --port "$PG_PORT" -- --auth-local=peer --auth-host=scram-sha-256
fi
pg_ctlcluster "$PG_MAJOR" serendipity start || true
pg_lsclusters

su postgres -c "psql -p $PG_PORT -v ON_ERROR_STOP=1 -q" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_USER}') THEN
    CREATE ROLE ${PG_USER} LOGIN SUPERUSER PASSWORD '${PG_PASSWORD}';
  END IF;
END \$\$;
SQL
echo "ready: postgresql://${PG_USER}:***@127.0.0.1:${PG_PORT}/postgres (PostgreSQL ${PG_MAJOR})"
