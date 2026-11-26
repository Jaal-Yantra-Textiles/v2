#!/usr/bin/env bash
# The A1 box deploys ITSELF (#1085).
#
# GitHub cannot reach the box: its security list admits SSH only from a few
# fixed addresses, and GitHub's runners use thousands of changing ones. So the
# box pulls instead. "Build ARM64 Image (Oracle A1)" pushes `latest-arm64` on
# every merge to main; jyt-auto-deploy.timer runs `auto-deploy.sh auto` every
# 2 minutes, and when that tag points at a NEW image it deploys it:
#
#   pull → migrate with the new image (the old server keeps serving) →
#   pin JYT_IMAGE to the new image's digest → restart server + worker +
#   tunnel → wait for /health → on failure, put the previous image back.
#
# Every outcome goes to the founder's phone (ntfy topic in /opt/jyt-ops/.env).
#
# 🔴 Nothing deploys unless its cosign signature verifies: signed keylessly by
# build-arm64.yml running on refs/heads/main of this repo. Whoever can push to
# GHCR could otherwise put any image on prod; with this, only a merge to main
# can. An image that fails verification is refused and reported, never run.
#
# Commands:
#   check               what is running; changes nothing
#   auto                the timer's job (above); a no-op when nothing is new
#   deploy <image-ref>  deploy one image by hand, e.g. a rollback to
#                       ghcr.io/jaal-yantra-textiles/v2:sha-<commit>-arm64
#
# 🔴 Does nothing unless /opt/jyt/LIVE exists. That file is created in the
# cutover window AFTER AWS is scaled to 0. Before it, the box is a copy holding
# prod's real keys, and its worker beside AWS's would run every job twice.
set -euo pipefail

cd /opt/jyt
REPO="ghcr.io/jaal-yantra-textiles/v2"
TAG="$REPO:latest-arm64"
PROFILES=(--profile worker --profile tunnel)
LOG=/opt/jyt/deploy.log

SIGNER="https://github.com/Jaal-Yantra-Textiles/v2/.github/workflows/build-arm64.yml@refs/heads/main"
ISSUER="https://token.actions.githubusercontent.com"

log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }

notify() {
  local title="$1" body="$2" prio="${3:-3}" topic
  topic=$(sed -n 's/^NTFY_TOPIC=//p' /opt/jyt-ops/.env 2>/dev/null || true)
  [ -n "$topic" ] || return 0
  curl -fsS -m 10 -o /dev/null -H "Title: $title" -H "Priority: $prio" \
    -H "Click: https://v3.jaalyantra.com/health" --data-raw "$body" "https://ntfy.sh/$topic" || true
}

current_image() { sed -n 's/^JYT_IMAGE=//p' .env 2>/dev/null || true; }

set_image() {
  # .env also holds POSTGRES_PASSWORD: touch only the JYT_IMAGE line.
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

# The image the server container is actually running, as repo@digest.
running_digest() {
  local id
  id=$(docker compose ps -q server 2>/dev/null) || true
  [ -n "$id" ] || return 0
  docker image inspect --format '{{index .RepoDigests 0}}' "$(docker inspect --format '{{.Image}}' "$id")" 2>/dev/null || true
}

verify_signature() {
  command -v cosign >/dev/null || { log "cosign is not installed — refusing $1"; return 1; }
  cosign verify --certificate-identity "$SIGNER" --certificate-oidc-issuer "$ISSUER" "$1" >/dev/null 2>>"$LOG"
}

do_deploy() {
  local new="$1" old
  if ! verify_signature "$new"; then
    log "signature check FAILED for $new — not deployed"
    notify "Deploy refused: unsigned image" "${new##*@} is not signed by build-arm64.yml on main. Nothing changed. See /opt/jyt/deploy.log" 5
    return 1
  fi
  old="$(current_image)"
  [ -n "$old" ] || old="$(running_digest)"
  log "deploying $new (was ${old:-unknown})"

  # Migrate with the NEW image while the old server keeps serving — the same
  # order as the ECS deploy: a failed migration leaves the old code running.
  if ! JYT_IMAGE="$new" docker compose run --rm -T server pnpm predeploy:force >>"$LOG" 2>&1; then
    log "migration FAILED on $new — old image left running"
    notify "Deploy failed: migration" "Migrations failed for ${new##*@}. The old version is still serving. See /opt/jyt/deploy.log" 5
    return 1
  fi

  set_image "$new"
  docker compose "${PROFILES[@]}" up -d --remove-orphans >>"$LOG" 2>&1
  if wait_healthy; then
    log "healthy on $new"
    notify "Deployed" "Prod is on ${new##*@} and healthy." 2
    docker image prune -f >/dev/null 2>&1 || true
    return 0
  fi

  log "NOT healthy on $new — restoring ${old:-$TAG}"
  docker compose logs --tail 80 server >>"$LOG" 2>&1 || true
  set_image "${old:-$TAG}"
  docker compose "${PROFILES[@]}" up -d --remove-orphans >>"$LOG" 2>&1
  if wait_healthy; then
    notify "Deploy rolled back" "${new##*@} did not come up healthy; the previous version is back and healthy." 5
  else
    notify "PROD DOWN" "${new##*@} was unhealthy AND the previous version did not come back. Look now." 5
  fi
  return 1
}

CMD="${1:-}"
case "$CMD" in
  check)
    echo "live:    $([ -f LIVE ] && echo yes || echo no)"
    echo "pinned:  $(current_image)"
    echo "running: $(running_digest)"
    echo "cosign:  $(command -v cosign >/dev/null && cosign version 2>/dev/null | sed -n 's/^GitVersion:[[:space:]]*//p' || echo missing)"
    docker compose "${PROFILES[@]}" ps --format '{{.Service}} {{.Status}}'
    ;;
  auto|deploy)
    [ -f LIVE ] || { [ "$CMD" = auto ] && exit 0; echo "refusing: /opt/jyt/LIVE is absent — the box is not prod yet" >&2; exit 3; }
    exec 9>/opt/jyt/deploy.lock
    flock -n 9 || { [ "$CMD" = auto ] && exit 0; echo "another deploy is running" >&2; exit 4; }

    if [ "$CMD" = deploy ]; then
      [ -n "${2:-}" ] || { echo "usage: deploy <image-ref>" >&2; exit 2; }
      docker pull -q "$2" >/dev/null
      do_deploy "$(docker image inspect --format '{{index .RepoDigests 0}}' "$2")"
      exit $?
    fi

    docker pull -q "$TAG" >/dev/null 2>&1 || exit 0   # registry blip: try next tick
    latest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$TAG")
    pinned=$(current_image)
    [ -n "$pinned" ] || pinned=$(running_digest)
    [ "$latest" = "$pinned" ] && exit 0
    # A failed image is not retried every 2 minutes: it waits for a newer build.
    [ "$latest" = "$(cat /opt/jyt/deploy.failed 2>/dev/null || true)" ] && exit 0
    if do_deploy "$latest"; then rm -f /opt/jyt/deploy.failed; else echo "$latest" > /opt/jyt/deploy.failed; exit 1; fi
    ;;
  *)
    echo "usage: check | auto | deploy <image-ref>" >&2
    exit 2
    ;;
esac
