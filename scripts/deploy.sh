#!/bin/sh
# Usage: sh scripts/deploy.sh <12-character SHA> | check <SHA> | status | logs [service]
# Existing pre-standard images: sh scripts/deploy.sh --legacy <protected-tag>
set -eu
# Synology sudo/non-login shells omit package executables from PATH.
PATH=/usr/local/bin:/var/packages/ContainerManager/target/usr/bin:/var/packages/Docker/target/usr/bin:$PATH
export PATH
umask 077
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
fail() { printf '%s\n' "$*" >&2; exit 1; }

if [ "${1:-}" != --loaded ]; then
    DOTENVX=${DOTENVX_BIN:-"$ROOT/.tools/dotenvx"}
    [ -x "$DOTENVX" ] || DOTENVX=$(command -v dotenvx) || fail 'Install Dotenvx 2.24.0; see docs/operations.md.'
    KEYS=${DOTENV_KEYS_FILE:-"$ROOT/.env.keys"}
    [ -f "$KEYS" ] || [ -n "${DOTENV_PRIVATE_KEY_PROD:-}" ] || fail 'Provide the production decryption key separately.'
    if [ -f "$KEYS" ]; then
        chmod 600 "$KEYS"
        exec "$DOTENVX" run --strict --overload --no-armor --no-native -fk "$KEYS" -f .env.prod -- sh "$ROOT/scripts/deploy.sh" --loaded "$@"
    fi
    exec "$DOTENVX" run --strict --overload --no-armor --no-native -f .env.prod -- sh "$ROOT/scripts/deploy.sh" --loaded "$@"
fi
shift
[ "${APP_ENV:-}" = production ] || fail 'Deployment requires APP_ENV=production.'
[ "${COMPOSE_PROJECT_NAME:-}" = ggeujeok-prod ] || fail 'Unexpected production Compose project; preserve the existing project.'
for data_path in "${DB_DATA_PATH:-}" "${UPLOAD_DATA_PATH:-}"; do
    case "$data_path" in /|/tmp|/var|/home|'') fail 'Invalid production data path.';; /*) ;; *) fail 'Production storage requires an absolute Linux path.';; esac
done
[ "${IMAGE_NAME:-}" = ggeujeok ] || fail 'Unexpected image namespace.'
REGISTRY_HOST=${REGISTRY_HOST:-registry.shnea.kr}
export REGISTRY_HOST
unset COMPOSE_FILE COMPOSE_PATH_SEPARATOR COMPOSE_PROFILES
if docker compose version >/dev/null 2>&1; then
    compose() { docker compose --env-file /dev/null -f "$ROOT/compose.yaml" "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
    compose() { docker-compose --env-file /dev/null -f "$ROOT/compose.yaml" "$@"; }
else
    fail 'Docker Compose v2 is required.'
fi

MODE=deploy
LEGACY=false
case ${1:-} in
    check) MODE=check; shift;;
    status|logs) MODE=$1; shift;;
    --legacy) LEGACY=true; shift;;
    '') fail 'Usage: deploy.sh <SHA> | check <SHA> | status | logs [service]';;
esac
if [ "$MODE" = status ] || [ "$MODE" = logs ]; then
    if [ -f .deploy/current ]; then
        IMAGE_TAG=$(cat .deploy/current)
    elif [ -f .deploy/legacy-tag ]; then
        IMAGE_TAG=$(cat .deploy/legacy-tag)
    else
        fail 'No deployment state. Deploy a release first.'
    fi
else
    [ "$#" -eq 1 ] || fail 'Pass exactly one image tag.'
    IMAGE_TAG=$1
fi
if printf '%s\n' "$IMAGE_TAG" | grep -Eq '^[a-f0-9]{12}$'; then
    :
else
    printf '%s\n' "$IMAGE_TAG" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$' || fail 'Invalid image tag.'
    [ "$LEGACY" = true ] || [ "$MODE" = status ] || [ "$MODE" = logs ] || fail 'New deployments require a 12-character Git SHA.'
    [ -f .deploy/legacy-tag ] && [ "$IMAGE_TAG" = "$(cat .deploy/legacy-tag)" ] || fail 'Legacy image is not protected for migration.'
fi
export IMAGE_TAG
compose config --quiet
case $MODE in
    check) printf 'PASS production configuration for %s (no deployment)\n' "$IMAGE_TAG"; exit 0;;
    status) [ "$#" -eq 0 ] || fail 'status takes no arguments'; compose ps -a; exit 0;;
    logs) [ "$#" -le 1 ] || fail 'logs accepts at most one service'; compose logs --tail 100 "$@"; exit 0;;
esac

mkdir -p .deploy
OWNS_LOCK=true
if [ -n "${DEPLOY_PARENT_PID:-}" ]; then
    [ -f .deploy/lock/pid ] && [ "$(cat .deploy/lock/pid)" = "$DEPLOY_PARENT_PID" ] || fail 'Invalid parent deployment lock.'
    kill -0 "$DEPLOY_PARENT_PID" 2>/dev/null || fail 'Parent deployment has stopped.'
    OWNS_LOCK=false
else
    mkdir .deploy/lock 2>/dev/null || fail 'Another deployment is active. Inspect .deploy/lock before retrying.'
    printf '%s\n' "$$" > .deploy/lock/pid
fi
SUCCESS=false
finish() {
    code=$?
    trap - EXIT HUP INT TERM
    if [ "$SUCCESS" != true ]; then
        printf '%s failed tag=%s exit=%s; inspect live containers before retrying\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$IMAGE_TAG" "$code" >> .deploy/history
    fi
    rm -f .deploy/target-images .deploy/new-current
    if [ "$OWNS_LOCK" = true ]; then rm -f .deploy/lock/pid; rmdir .deploy/lock; fi
    exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
printf '%s pending tag=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$IMAGE_TAG" >> .deploy/history
compose config --images > .deploy/target-images.raw
sort -u .deploy/target-images.raw > .deploy/target-images
compose pull
if [ -n "${RELEASE_DIGESTS:-}" ]; then
    [ -f "$RELEASE_DIGESTS" ] || fail 'Release digest list is missing.'
    while read -r ref expected; do
        digests=$(docker image inspect --format '{{join .RepoDigests " "}}' "$ref")
        case " $digests " in *" ${ref%:*}@$expected "*) ;; *) fail "Published image digest mismatch: $ref";; esac
    done < "$RELEASE_DIGESTS"
fi
if [ "$LEGACY" = true ] && [ -f .deploy/legacy-images ]; then
    while read -r ref expected; do
        actual=$(docker image inspect --format '{{.Id}}' "$ref")
        [ "$actual" = "$expected" ] || fail "Protected legacy image changed in registry: $ref"
    done < .deploy/legacy-images
fi

# Check source identity before changing containers. Legacy images predate revision labels.
REVISION=
while IFS= read -r ref; do
    case "$ref" in "$REGISTRY_HOST/$IMAGE_NAME-"*)
        if [ "$LEGACY" != true ]; then
            revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$ref")
            printf '%s\n' "$revision" | grep -Eq '^([a-f0-9]{40}|[a-f0-9]{64})$' || fail "Missing source revision: $ref"
            [ "$(printf '%s' "$revision" | cut -c1-12)" = "$IMAGE_TAG" ] || fail "Source/tag mismatch: $ref"
            [ -z "$REVISION" ] || [ "$REVISION" = "$revision" ] || fail 'Images belong to different commits.'
            REVISION=$revision
        fi;;
    esac
done < .deploy/target-images

# Record the actual previous container images; a legacy env tag alone is not proof of deployment.
: > .deploy/before-images
CONTAINERS=$(compose ps -a -q)
for container in $CONTAINERS; do
    docker inspect --format '{{.Config.Image}}' "$container" >> .deploy/before-images
done
PREVIOUS=$(awk -v prefix="$REGISTRY_HOST/$IMAGE_NAME-" 'index($0,prefix)==1 {n=split($0,a,":"); print a[n]}' .deploy/before-images | sort -u)
if [ -f .deploy/current ]; then PREVIOUS=$(cat .deploy/current); fi

# Pull completed for every service before any initialization or running-container change.
compose up -d --no-build --remove-orphans --wait --wait-timeout "${DEPLOY_WAIT_SECONDS:-300}"
compose exec -T nginx wget -q -O /dev/null http://127.0.0.1:8080/api/health
printf '%s\n' 'PASS /api/health through nginx'

: > .deploy/new-images
while IFS= read -r ref; do
    digest=$(docker image inspect --format '{{join .RepoDigests ","}}' "$ref")
    [ -n "$digest" ] || fail "Missing image digest: $ref"
    printf '%s %s\n' "$ref" "$digest" >> .deploy/new-images
done < .deploy/target-images
if [ -n "$PREVIOUS" ] && [ "$(printf '%s\n' "$PREVIOUS" | wc -l | tr -d ' ')" = 1 ] && [ "$PREVIOUS" != "$IMAGE_TAG" ]; then
    printf '%s\n' "$PREVIOUS" > .deploy/previous
fi
sha256sum compose.yaml .env.prod > .deploy/config-sha256
printf '%s\n' "${REVISION:-legacy-unrecorded}" > .deploy/source-commit
mv .deploy/new-images .deploy/current-images
printf '%s\n' "$IMAGE_TAG" > .deploy/new-current
mv .deploy/new-current .deploy/current
printf '%s success tag=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$IMAGE_TAG" >> .deploy/history
SUCCESS=true
printf 'Deployment healthy: %s\n' "$IMAGE_TAG"
