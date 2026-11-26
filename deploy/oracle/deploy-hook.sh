#!/usr/bin/env bash
# The ONLY thing GitHub's deploy key can run on the A1 box (#1085).
#
# Installed at /opt/jyt/deploy-hook.sh and bound to the key in
# ~/.ssh/authorized_keys as a forced command:
#   restrict,command="/opt/jyt/deploy-hook.sh" ssh-ed25519 AAAA… jyt-github-deploy
# so whatever the client asks for arrives in $SSH_ORIGINAL_COMMAND and nothing
# else can run — the key cannot open a shell, forward ports or copy files.
#
# Commands:
#   check          print what is running; changes nothing (connectivity test)
#   deploy <sha>   deploy image sha-<sha>-arm64: pull → migrate → restart →
#                  wait for /health; on an unhealthy start, put the previous
#                  image back.
#
# 🔴 Refuses to deploy unless /opt/jyt/LIVE exists. That file is created in the
# cutover window, AFTER AWS is scaled to 0. Before it, the box is a copy that
# holds prod's real keys, and starting its worker beside AWS's would run every
# scheduled job twice.
set -euo pipefail

cd /opt/jyt
IMAGE_REPO="ghcr.io/jaal-yantra-textiles/v2"
PROFILES=(--profile worker --profile tunnel)
read -r CMD ARG EXTRA <<<"${SSH_ORIGINAL_COMMAND:-${*:-}}" || true

current_image() { grep -E '^JYT_IMAGE=' .env 2>/dev/null | cut -d= -f2- || true; }

set_image() {
  # .env holds POSTGRES_PASSWORD too: replace only the JYT_IMAGE line.
  if grep -qE '^JYT_IMAGE=' .env; then
    sed -i "s|^JYT_IMAGE=.*|JYT_IMAGE=$1|" .env
  else
    printf 'JYT_IMAGE=%s\n' "$1" >> .env
  fi
}

wait_healthy() {
  for _ in $(seq 1 48); do
    curl -fsS -m 5 http://127.0.0.1:9000/health >/dev/null 2>&1 && return 0
    sleep 10
  done
  return 1
}

case "${CMD:-}" in
  check)
    echo "live: $([ -f LIVE ] && echo yes || echo no)"
    echo "image: $(current_image || true)"
    docker compose "${PROFILES[@]}" ps --format '{{.Service}} {{.Status}}'
    ;;
  deploy)
    [[ "${ARG:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "deploy needs a full 40-char commit sha" >&2; exit 2; }
    [ -z "${EXTRA:-}" ] || { echo "unexpected extra arguments" >&2; exit 2; }
    [ -f LIVE ] || { echo "refusing: /opt/jyt/LIVE is absent — the box is not prod yet (AWS may still be live)" >&2; exit 3; }

    exec 9>/opt/jyt/deploy.lock
    flock -n 9 || { echo "another deploy is running" >&2; exit 4; }

    NEW="$IMAGE_REPO:sha-$ARG-arm64"
    OLD="$(current_image)"
    echo "deploying $NEW (was ${OLD:-latest-arm64})"
    docker pull -q "$NEW"

    # Migrate with the NEW image while the old server keeps serving — the same
    # order as the ECS deploy: a failed migration leaves the old code running.
    echo "running migrations…"
    JYT_IMAGE="$NEW" docker compose run --rm -T server pnpm predeploy:force

    set_image "$NEW"
    docker compose "${PROFILES[@]}" up -d --remove-orphans
    if wait_healthy; then
      echo "healthy on $NEW"
      docker image prune -f >/dev/null || true
      exit 0
    fi

    echo "NOT healthy on $NEW — restoring ${OLD:-latest-arm64}" >&2
    docker compose logs --tail 60 server >&2 || true
    set_image "${OLD:-$IMAGE_REPO:latest-arm64}"
    docker compose "${PROFILES[@]}" up -d --remove-orphans
    wait_healthy && echo "previous image restored and healthy" >&2 || echo "previous image ALSO unhealthy — look now" >&2
    exit 1
    ;;
  *)
    echo "usage: check | deploy <40-char sha>" >&2
    exit 2
    ;;
esac
