#!/bin/sh
# Run from the checkout, or set DOCKER_HOST to the server's Docker context.
set -eu
umask 077
if [ "$#" -ne 2 ]; then
  echo "Usage: sh scripts/backup-db.sh ENV_FILE BACKUP_DIRECTORY" >&2
  exit 2
fi
env_file=$1
backup_dir=$2
mkdir -p "$backup_dir"
backup_dir=$(cd "$backup_dir" && pwd)
# mktemp avoids collisions and keeps incomplete dumps visibly separate.
temporary=$(mktemp "$backup_dir/ggeujeok-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM
docker compose --env-file "$env_file" -f compose.yaml exec -T db \
  sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$temporary"
test -s "$temporary"
archive="$temporary.dump"
mv "$temporary" "$archive"
printf 'Database archive: %s\n' "$archive"
printf 'Private local backup only; encrypt before transferring outside this host.\n'
