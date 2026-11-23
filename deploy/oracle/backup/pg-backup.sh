#!/usr/bin/env bash
# Runs ON THE BOX (systemd jyt-pg-backup.timer). Streams pg_dump straight to S3;
# nothing touches the disk. Exits non-zero on any failure, so systemd marks the
# unit failed. Every run pushes its result to Gatus; no push for 26 h = alert.
set -euo pipefail
cd /opt/jyt
set -a; . /opt/jyt/backup.env; set +a
KEY="pg/medusa-$(date -u +%Y%m%dT%H%M%SZ).dump"
START=$(date +%s)

heartbeat() { # success error
  local token
  token=$(sed -n 's/^GATUS_BACKUP_TOKEN=//p' /opt/jyt-ops/.env 2>/dev/null || true)
  [ -n "$token" ] || return 0
  curl -fsS -m 10 -X POST -G -H "Authorization: Bearer $token" \
    --data-urlencode "success=$1" --data-urlencode "error=$2" \
    --data-urlencode "duration=$(( $(date +%s) - START ))s" \
    http://127.0.0.1:8080/api/v1/endpoints/a1_pg-backup/external >/dev/null || echo "warning: could not reach Gatus" >&2
}
trap 'heartbeat false "pg-backup.sh failed, see journalctl -u jyt-pg-backup"' ERR

# pipefail: a pg_dump failure fails the pipeline even if the upload "succeeds".
docker compose exec -T postgres pg_dump -U medusa -d medusa --no-owner --no-acl -Fc -Z 6 \
| docker run --rm -i --env-file /opt/jyt/backup.env public.ecr.aws/aws-cli/aws-cli:2.27.50 \
    s3 cp - "s3://$BACKUP_BUCKET/$KEY" --only-show-errors

date -u +%FT%TZ > /opt/jyt/backup.last-ok
heartbeat true ""
echo "uploaded s3://$BACKUP_BUCKET/$KEY in $(( $(date +%s) - START ))s"
