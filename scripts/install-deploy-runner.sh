#!/bin/sh
# One-time NAS tool installation. Pass a short-lived GitHub registration token on stdin.
set -eu
PATH=/usr/local/bin:/var/packages/ContainerManager/target/usr/bin:/var/packages/Docker/target/usr/bin:$PATH
export PATH
NAME=ggeujeok-deploy-runner
IMAGE=ghcr.io/actions/actions-runner@sha256:e5496277be5d09bc968b3d64911b74e219ac4a3f2edce956a3ecf9271bea1ef4
if docker container inspect "$NAME" >/dev/null 2>&1; then
    echo 'Deployment runner already exists; preserve its registration and inspect it before replacing.' >&2
    exit 1
fi
docker pull "$IMAGE"
docker volume create "$NAME" >/dev/null
# Docker populates a new volume from the image, including the runner user's ownership.
# The token is read from stdin, never stored in the container configuration or project files.
docker run --rm -i --network host --security-opt no-new-privileges --cap-drop ALL \
    --mount "type=volume,source=$NAME,target=/home/runner" --entrypoint /bin/bash "$IMAGE" -ec '
        test ! -f .runner || { echo "Existing runner registration preserved." >&2; exit 1; }
        IFS= read -r registration_token
        registration_token=$(printf "%s" "$registration_token" | tr -d "\r")
        test -n "$registration_token"
        ./config.sh --unattended --url https://github.com/shnea/ggeujeok \
            --token "$registration_token" --name ggeujeok-nas-deploy \
            --labels ggeujeok-deploy --work _work
        unset registration_token
    '
docker run -d --name "$NAME" --restart unless-stopped --init --network host \
    --memory 512m --pids-limit 512 --security-opt no-new-privileges --cap-drop ALL \
    --mount "type=volume,source=$NAME,target=/home/runner" --entrypoint /bin/bash "$IMAGE" -ec './run.sh'
printf '%s\n' 'Deployment runner started. No Docker socket, application data or environment keys are mounted.'
