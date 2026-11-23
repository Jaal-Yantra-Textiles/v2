#!/usr/bin/env bash
# Copy deploy/oracle/ops to /opt/jyt-ops on the box and (re)start it.
# Usage: deploy/oracle/deploy-ops.sh [ubuntu@130.61.141.163] [metrics]
#   add `metrics` once BESZEL_KEY/BESZEL_TOKEN are in /opt/jyt-ops/.env
set -euo pipefail
HOST="${1:-ubuntu@130.61.141.163}"; shift || true
DIR="$(cd "$(dirname "$0")" && pwd)"
PROFILES=""
for p in "$@"; do PROFILES="$PROFILES --profile $p"; done

ssh "$HOST" 'sudo install -d -o ubuntu -g ubuntu -m 750 /opt/jyt-ops'
scp -q "$DIR/ops/compose.yml" "$DIR/ops/loki.yml" "$DIR/ops/config.alloy" "$DIR/ops/gatus.yml" "$HOST:/opt/jyt-ops/"
# First deploy only: the token pg-backup.sh uses to push its heartbeat.
ssh "$HOST" 'test -f /opt/jyt-ops/.env || (umask 077 && printf "GATUS_BACKUP_TOKEN=%s\n" "$(openssl rand -hex 24)" > /opt/jyt-ops/.env && echo "created /opt/jyt-ops/.env")'
ssh "$HOST" "cd /opt/jyt-ops && docker compose $PROFILES pull -q && docker compose $PROFILES up -d --remove-orphans && docker compose $PROFILES ps --format 'table {{.Service}}\t{{.Status}}'"
