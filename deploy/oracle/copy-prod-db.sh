#!/usr/bin/env bash
# Copy the prod RDS database into the A1 box's Postgres.
#
# RDS is private (not publicly accessible), so the dump runs INSIDE the VPC as
# a one-off Fargate task, the same mechanism as deploy/aws/scripts/run-migrations.sh.
# The dump is handed over through a private, encrypted S3 bucket, via
# short-lived pre-signed URLs, and deleted at the end. Neither the task nor the
# box gets AWS credentials. Read-only against RDS: pg_dump takes no locks that
# block writes.
#
# ⚠️ The dump holds every customer's PII. It lives only in the private bucket
# (deleted below) and in /opt/jyt/restore on the box (deleted after restore).
#
# Usage (operator laptop with AWS credentials, from the repo root or anywhere):
#   deploy/oracle/copy-prod-db.sh [ubuntu@130.61.141.163]
#
# Restores with --clean: it REPLACES whatever the box's database holds. Fine
# before cutover; after cutover the box IS prod, so never run it again.
set -euo pipefail

HOST="${1:-ubuntu@130.61.141.163}"
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
: "${AWS_REGION:=us-east-1}"; export AWS_REGION
: "${ECS_CLUSTER:=jyt-prod-Cluster-JOcsxaMtDKJ3}"
: "${SUBNETS:=subnet-0fbeafa1ebdf9026a,subnet-05ebe6f3b9fb25673}"
: "${SECURITY_GROUP:=sg-0c3685e1a91b5d60e}"
: "${EXEC_ROLE:=arn:aws:iam::369351873445:role/jyt-prod-medusa-server-ExecutionRole-FeEzcBNJzNL3}"
: "${LOG_GROUP:=/copilot/jyt-prod-medusa-server}"
: "${BUCKET:=task-jyt-dbsnap-s3bucket-jc6ijxvcfvfn}"
: "${TIMEOUT_SECONDS:=1800}"
KEY="oracle/prod-$(date -u +%Y%m%dT%H%M%SZ).dump"

ssh "$HOST" 'cd /opt/jyt && test -f .env && docker compose ps --status running postgres | grep -q postgres' \
  || { echo "postgres is not running on $HOST: run deploy.sh first" >&2; exit 1; }

presign() { # method key seconds
  (cd "$REPO" && node -e '
    const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3")
    const { getSignedUrl } = require("@aws-sdk/s3-request-presigner")
    const [m, b, k, s] = process.argv.slice(1)
    const C = m === "PUT" ? PutObjectCommand : GetObjectCommand
    getSignedUrl(new S3Client({ region: process.env.AWS_REGION }), new C({ Bucket: b, Key: k }), { expiresIn: Number(s) })
      .then((u) => process.stdout.write(u))
  ' "$1" "$BUCKET" "$2" "$3")
}

cleanup() { aws s3 rm "s3://$BUCKET/$KEY" --region "$AWS_REGION" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# ── 1. Dump inside the VPC ───────────────────────────────────────────────────
TD=$(mktemp); OV=$(mktemp); trap 'rm -f "$TD" "$OV"; cleanup' EXIT
python3 - "$TD" "$EXEC_ROLE" "$LOG_GROUP" "$AWS_REGION" <<'PY'
import json, sys
out, role, group, region = sys.argv[1:]
json.dump({
  "family": "jyt-oracle-pgdump",
  "executionRoleArn": role,
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024", "memory": "2048",
  "ephemeralStorage": {"sizeInGiB": 30},
  "containerDefinitions": [{
    "name": "pgdump",
    "image": "public.ecr.aws/docker/library/postgres:16-bookworm",
    "essential": True,
    "secrets": [{"name": "DATABASE_URL", "valueFrom": "/jyt/prod/DATABASE_URL"}],
    "logConfiguration": {"logDriver": "awslogs", "options": {
      "awslogs-group": group, "awslogs-region": region, "awslogs-stream-prefix": "oracle-pgdump"}},
  }],
}, open(out, "w"))
PY
TD_ARN=$(aws ecs register-task-definition --region "$AWS_REGION" --cli-input-json "file://$TD" \
  --query taskDefinition.taskDefinitionArn --output text)
echo "task def: $TD_ARN"

PUT_URL=$(presign PUT "$KEY" 7200)
# libpq does not know node-postgres' sslmode=no-verify; `require` = encrypted,
# same as what the app gets.
DUMP_CMD='set -eu
apt-get update -qq && apt-get install -y -qq curl >/dev/null
URL=$(printf %s "$DATABASE_URL" | sed "s/sslmode=no-verify/sslmode=require/")
echo "pg_dump client: $(pg_dump --version)"
pg_dump --no-owner --no-acl -Fc -Z 6 -d "$URL" -f /tmp/db.dump
echo "dump bytes: $(stat -c %s /tmp/db.dump)  tables with data: $(pg_restore -l /tmp/db.dump | grep -c "TABLE DATA")"
curl -fsS --retry 3 -T /tmp/db.dump "$UPLOAD_URL"
echo UPLOAD_OK'
python3 - "$OV" "$DUMP_CMD" "$PUT_URL" <<'PY'
import json, sys
out, cmd, url = sys.argv[1:]
json.dump({"containerOverrides": [{"name": "pgdump", "command": ["sh", "-c", cmd],
  "environment": [{"name": "UPLOAD_URL", "value": url}]}]}, open(out, "w"))
PY
TASK_ARN=$(aws ecs run-task --cluster "$ECS_CLUSTER" --task-definition "$TD_ARN" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=ENABLED}" \
  --overrides "file://$OV" --started-by oracle-pgdump --region "$AWS_REGION" \
  --query 'tasks[0].taskArn' --output text)
TASK_ID="${TASK_ARN##*/}"
echo "dump task: $TASK_ID"

DEADLINE=$(( $(date +%s) + TIMEOUT_SECONDS ))
while :; do
  S=$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$TASK_ARN" --region "$AWS_REGION" \
      --query 'tasks[0].[lastStatus,containers[0].exitCode,stoppedReason]' --output text)
  case "$S" in STOPPED*) break ;; esac
  [ "$(date +%s)" -lt "$DEADLINE" ] || { aws ecs stop-task --cluster "$ECS_CLUSTER" --task "$TASK_ARN" --region "$AWS_REGION" >/dev/null; echo "dump timed out" >&2; exit 1; }
  sleep 15
done
sleep 5
aws logs get-log-events --log-group-name "$LOG_GROUP" --log-stream-name "oracle-pgdump/pgdump/$TASK_ID" \
  --region "$AWS_REGION" --query 'events[].message' --output text | tr '\t' '\n' | grep -v '^$' || true
read -r _ CODE REASON <<<"$S"
[ "$CODE" = "0" ] || { echo "dump task failed: exit=$CODE $REASON" >&2; exit 1; }

# ── 2. Restore on the box ────────────────────────────────────────────────────
GET_URL=$(presign GET "$KEY" 3600)
ssh "$HOST" "set -euo pipefail
  install -d -m 700 /opt/jyt/restore
  curl -fsS --retry 3 -o /opt/jyt/restore/prod.dump '$GET_URL'
  ls -l /opt/jyt/restore/prod.dump
  cd /opt/jyt
  docker compose cp /opt/jyt/restore/prod.dump postgres:/tmp/prod.dump
  # --clean --if-exists: replace, not merge. Errors are printed, then counted.
  docker compose exec -T postgres pg_restore -U medusa -d medusa --no-owner --no-acl \
    --clean --if-exists -j 2 /tmp/prod.dump 2>&1 | tail -20 || true
  docker compose exec -T postgres rm -f /tmp/prod.dump
  rm -f /opt/jyt/restore/prod.dump
  docker compose exec -T postgres psql -U medusa -d medusa -Atc \"
    select 'orders', count(*)::text from \\\"order\\\" union all
    select 'products', count(*)::text from product union all
    select 'customers', count(*)::text from customer union all
    select 'extensions', string_agg(extname, ',') from pg_extension union all
    select 'size', pg_size_pretty(pg_database_size('medusa'))\""
echo "restored. Compare the counts above with prod before trusting the copy."
