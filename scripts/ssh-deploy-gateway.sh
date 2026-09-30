#!/bin/sh
# Installed root-owned; the installer supplies the private deployment root.
# A dedicated SSH key may call only "check" or "deploy <full source SHA>".
set -eu
umask 077
PATH=/usr/local/bin:/var/packages/ContainerManager/target/usr/bin:/var/packages/Docker/target/usr/bin:$PATH
export PATH
ROOT=${NAS_DEPLOY_PATH:?Set the deployment root in the root-owned installer.}
fail() { printf '%s\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail 'Run through the dedicated sudo rule.'
[ "$#" = 1 ] || fail 'Expected one restricted SSH command.'
case "$1" in
    check)
        test -x "$ROOT/.tools/dotenvx"
        test -f "$ROOT/.env.keys"
        docker version --format '{{.Server.Version}}'
        printf '%s\n' 'PASS ggeujeok SSH deployment gateway'
        exit 0;;
    deploy\ *) SHA=${1#deploy };;
    *) fail 'Only check or deploy <full source SHA> is allowed.';;
esac
printf '%s\n' "$SHA" | grep -Eq '^([a-f0-9]{40}|[a-f0-9]{64})$' || fail 'Invalid source SHA.'
TAG=$(printf '%s' "$SHA" | cut -c1-12)
cd "$ROOT"
mkdir -p .deploy
mkdir .deploy/lock 2>/dev/null || fail 'Another deployment is active.'
printf '%s\n' "$$" > .deploy/lock/pid
finish() {
    code=$?
    trap - EXIT HUP INT TERM
    printf '%s ssh tag=%s exit=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$TAG" "$code" >> .deploy/ssh-history
    rm -f .deploy/lock/pid
    rmdir .deploy/lock
    exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
STAGE=$(mktemp -d "$ROOT/.deploy/incoming.XXXXXX")
head -c 2097152 > "$STAGE/package.tar.gz"
[ "$(wc -c < "$STAGE/package.tar.gz")" -lt 2097152 ] || fail 'Configuration archive exceeds 2 MiB.'
FILES='compose.yaml
.env.prod
scripts/deploy.sh
docs/operations.md
운영안내.html'
printf '%s\nSOURCE_COMMIT\nIMAGE_DIGESTS\n' "$FILES" | LC_ALL=C sort > "$STAGE/expected"
# GNU tar escapes non-ASCII names under the NAS C locale; BusyBox lists literal names.
if tar --help 2>/dev/null | grep -q -- '--quoting-style'; then
    tar --quoting-style=literal -tzf "$STAGE/package.tar.gz" > "$STAGE/entries"
else
    tar -tzf "$STAGE/package.tar.gz" > "$STAGE/entries"
fi
LC_ALL=C sort "$STAGE/entries" > "$STAGE/actual"
cmp "$STAGE/expected" "$STAGE/actual" >/dev/null || fail 'Unexpected or duplicate configuration archive members.'
tar -tvzf "$STAGE/package.tar.gz" > "$STAGE/details"
if grep -qv '^-' "$STAGE/details"; then fail 'Archive must contain only regular files.'; fi
tar -xzf "$STAGE/package.tar.gz" -C "$STAGE"
[ "$(cat "$STAGE/SOURCE_COMMIT")" = "$SHA" ] || fail 'Archive belongs to a different source commit.'
[ "$(wc -l < "$STAGE/IMAGE_DIGESTS" | tr -d ' ')" = 3 ] || fail 'Incomplete image digest list.'
DOTENVX_BIN="$ROOT/.tools/dotenvx" DOTENV_KEYS_FILE="$ROOT/.env.keys" \
    sh "$STAGE/scripts/deploy.sh" check "$TAG"

# Keep the matching previous configuration for a deliberate rollback.
PREVIOUS=$(cat .deploy/current 2>/dev/null || printf 'pre-ci')
printf '%s\n' "$PREVIOUS" | grep -Eq '^[A-Za-z0-9_.-]+$' || fail 'Invalid previous deployment state.'
BACKUP="$ROOT/.deploy/configs/$PREVIOUS"
if [ ! -d "$BACKUP" ]; then
    mkdir -p "$BACKUP"
    printf '%s\n' "$FILES" | while IFS= read -r file; do
        if [ -f "$ROOT/$file" ]; then
            mkdir -p "$BACKUP/$(dirname "$file")"
            cp -p "$ROOT/$file" "$BACKUP/$file"
        fi
    done
fi
printf '%s\n' "$FILES" | while IFS= read -r file; do
    mkdir -p "$ROOT/$(dirname "$file")"
    cp "$STAGE/$file" "$ROOT/$file"
    chmod 644 "$ROOT/$file"
done
chmod 755 scripts/deploy.sh
DEPLOY_PARENT_PID=$$ RELEASE_DIGESTS="$STAGE/IMAGE_DIGESTS" sh scripts/deploy.sh "$TAG"
printf '%s\n' "$SHA" > .deploy/ci-source-commit
printf 'PASS GitHub SSH deployment: %s\n' "$TAG"
