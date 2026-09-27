#!/bin/sh
# Restores into a disposable, network-isolated DB. Never targets the running DB.
set -eu
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Usage: sh scripts/check-db-restore.sh BACKUP.dump" >&2
  exit 2
fi
archive=$1
container=
cleanup() { if [ -n "$container" ]; then docker rm -f -v "$container" > /dev/null; fi; }
trap cleanup EXIT HUP INT TERM
container=$(docker run -d --network none --label kr.shnea.ggeujeok=restore-check \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=restore_check postgres:17-alpine)
attempt=0
until docker exec "$container" pg_isready -U postgres -d restore_check > /dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then echo 'Restore database did not start.' >&2; exit 1; fi
  sleep 1
done
docker exec -i "$container" pg_restore -U postgres -d restore_check \
  --no-owner --no-privileges --exit-on-error --single-transaction < "$archive"
# Check every table without printing user content or credentials.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d restore_check <<'SQL'
SELECT format('SELECT %L AS table_name, count(*) AS rows FROM %I.%I;', tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname='public' ORDER BY tablename
\gexec
SQL
printf 'Restore check passed. The disposable database will now be removed.\n'
