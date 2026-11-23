#!/usr/bin/env bash
# Proves the newest backup restores: loads it into a scratch database on the
# box, compares row counts with the live database, then drops the scratch copy.
# Read-only against the live database. Run it after install, then monthly.
#
# Usage (operator laptop with AWS credentials): deploy/oracle/verify-backup.sh [host]
set -euo pipefail
HOST="${1:-ubuntu@130.61.141.163}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
BUCKET="${BUCKET:-jyt-oracle-pg-backups}"
export AWS_REGION="${REGION:-eu-central-1}"

KEY=$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix pg/ --region "$AWS_REGION" \
  --query 'sort_by(Contents,&LastModified)[-1].[Key,Size,LastModified]' --output text)
read -r KEY SIZE WHEN <<<"$KEY"
[ -n "$KEY" ] && [ "$KEY" != "None" ] || { echo "no backups in s3://$BUCKET/pg/" >&2; exit 1; }
echo "newest backup: $KEY  ($SIZE bytes, $WHEN)"

URL=$(cd "$REPO" && node -e '
  const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3")
  const { getSignedUrl } = require("@aws-sdk/s3-request-presigner")
  getSignedUrl(new S3Client({ region: process.env.AWS_REGION }),
    new GetObjectCommand({ Bucket: process.argv[1], Key: process.argv[2] }), { expiresIn: 900 })
    .then((u) => process.stdout.write(u))' "$BUCKET" "$KEY")

COUNTS="select 'orders', count(*)::text from \\\"order\\\" union all
  select 'products', count(*)::text from product union all
  select 'customers', count(*)::text from customer union all
  select 'tables', count(*)::text from information_schema.tables where table_schema = 'public'"

ssh "$HOST" "set -euo pipefail
  cd /opt/jyt
  trap 'docker compose exec -T postgres rm -f /tmp/verify.dump; docker compose exec -T postgres dropdb -U medusa --if-exists medusa_verify' EXIT
  curl -fsS --retry 3 '$URL' | docker compose exec -T postgres sh -c 'cat > /tmp/verify.dump'
  docker compose exec -T postgres dropdb -U medusa --if-exists medusa_verify
  docker compose exec -T postgres createdb -U medusa medusa_verify
  docker compose exec -T postgres pg_restore -U medusa -d medusa_verify --no-owner --no-acl -j 2 --exit-on-error /tmp/verify.dump
  echo '--- restored backup'
  docker compose exec -T postgres psql -U medusa -d medusa_verify -Atc \"$COUNTS\"
  echo '--- live database'
  docker compose exec -T postgres psql -U medusa -d medusa -Atc \"$COUNTS\""
echo "backup restores. Counts can differ only by writes made after $WHEN."
