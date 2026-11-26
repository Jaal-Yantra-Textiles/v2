#!/usr/bin/env bash
# Copy compose.yml to the A1 box, pull the latest arm64 image, recreate.
#
# Usage: deploy/oracle/deploy.sh [ubuntu@130.61.141.163] [compose profiles...]
#   deploy.sh                          server + valkey only (safe while AWS runs)
#   deploy.sh ubuntu@host worker tunnel full stack — ONLY after AWS is stopped
set -euo pipefail

HOST="${1:-ubuntu@130.61.141.163}"; shift || true
DIR="$(cd "$(dirname "$0")" && pwd)"
PROFILES=""
for p in "$@"; do PROFILES="$PROFILES --profile $p"; done

ssh "$HOST" 'test -f /opt/jyt/secrets.env' \
  || { echo "no /opt/jyt/secrets.env on $HOST: run render-env.sh first" >&2; exit 1; }
scp -q "$DIR/compose.yml" "$DIR/cloudflared.yml" "$HOST:/opt/jyt/"
# cosign verifies every image before auto-deploy.sh runs it. Pinned release,
# checked against the release's own checksum file.
ssh "$HOST" 'set -e; V=v2.4.1; command -v cosign >/dev/null && cosign version 2>/dev/null | grep -q "$V" && exit 0
  cd /tmp && B=cosign-linux-arm64
  curl -fsSLO "https://github.com/sigstore/cosign/releases/download/$V/$B"
  curl -fsSL "https://github.com/sigstore/cosign/releases/download/$V/cosign_checksums.txt" | grep " $B\$" | sha256sum -c -
  sudo install -m 755 "$B" /usr/local/bin/cosign && rm -f "$B" && cosign version | head -3'

# The box deploys itself after cutover (auto-deploy.sh, every 2 min). It is a
# no-op until /opt/jyt/LIVE exists, so installing it early is safe.
scp -q "$DIR/auto-deploy.sh" "$DIR/jyt-auto-deploy.service" "$DIR/jyt-auto-deploy.timer" "$HOST:/tmp/"
ssh "$HOST" 'set -e; install -m 755 /tmp/auto-deploy.sh /opt/jyt/auto-deploy.sh
  sudo install -m 644 /tmp/jyt-auto-deploy.service /tmp/jyt-auto-deploy.timer /etc/systemd/system/
  rm -f /tmp/auto-deploy.sh /tmp/jyt-auto-deploy.service /tmp/jyt-auto-deploy.timer
  sudo systemctl daemon-reload && sudo systemctl enable --now jyt-auto-deploy.timer'

# First deploy only: the on-box Postgres password. Never overwritten, since
# the data volume is initialised with it.
ssh "$HOST" 'test -f /opt/jyt/.env || (umask 077 && printf "POSTGRES_PASSWORD=%s\n" "$(openssl rand -hex 24)" > /opt/jyt/.env && echo "created /opt/jyt/.env")'

ssh "$HOST" "cd /opt/jyt && docker compose $PROFILES pull && docker compose $PROFILES up -d --remove-orphans && docker compose $PROFILES ps"

echo "waiting for /health (Medusa takes 3-4 min to be fully ready)…"
for _ in $(seq 1 40); do
  if ssh "$HOST" 'curl -fsS -m 5 http://127.0.0.1:9000/health' >/dev/null 2>&1; then
    echo "healthy"; exit 0
  fi
  sleep 10
done
echo "not healthy after ~7 min: ssh $HOST 'cd /opt/jyt && docker compose logs --tail 100 server'" >&2
exit 1
