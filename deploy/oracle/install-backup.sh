#!/usr/bin/env bash
# Installs the nightly backup timer on the box and runs one backup now.
# Usage: deploy/oracle/install-backup.sh [ubuntu@130.61.141.163]
set -euo pipefail
HOST="${1:-ubuntu@130.61.141.163}"
DIR="$(cd "$(dirname "$0")" && pwd)"
ssh "$HOST" 'test -f /opt/jyt/backup.env' \
  || { echo "no /opt/jyt/backup.env: run setup-backup-bucket.sh first" >&2; exit 1; }
scp -q "$DIR/backup/pg-backup.sh" "$HOST:/opt/jyt/pg-backup.sh"
scp -q "$DIR/backup/jyt-pg-backup.service" "$DIR/backup/jyt-pg-backup.timer" "$HOST:/tmp/"
ssh "$HOST" 'set -e
  chmod 700 /opt/jyt/pg-backup.sh
  sudo install -m 644 /tmp/jyt-pg-backup.service /tmp/jyt-pg-backup.timer /etc/systemd/system/
  rm -f /tmp/jyt-pg-backup.service /tmp/jyt-pg-backup.timer
  sudo systemctl daemon-reload
  sudo systemctl enable --now jyt-pg-backup.timer
  echo "running one backup now…"
  sudo systemctl start jyt-pg-backup.service
  systemctl status --no-pager jyt-pg-backup.service | tail -5
  systemctl list-timers --no-pager jyt-pg-backup.timer'
echo "now prove it restores: deploy/oracle/verify-backup.sh $HOST"
