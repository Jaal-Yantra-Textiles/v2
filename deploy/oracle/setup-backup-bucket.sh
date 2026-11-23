#!/usr/bin/env bash
# One-time: the S3 bucket + a put-only IAM user for nightly Postgres backups,
# then hands the user's key straight to the box (/opt/jyt/backup.env, mode 600).
# The key is never printed.
#
# Usage (operator laptop with admin AWS credentials):
#   deploy/oracle/setup-backup-bucket.sh [ubuntu@130.61.141.163]
#
# What the box can do with its key: PutObject into this bucket. Nothing else.
# It cannot list, read or delete, and versioning keeps any overwritten object,
# so a compromised box cannot destroy existing backups.
set -euo pipefail

HOST="${1:-ubuntu@130.61.141.163}"
BUCKET="${BUCKET:-jyt-oracle-pg-backups}"
REGION="${REGION:-eu-central-1}"   # Frankfurt, same region as the A1 box
USER_NAME="jyt-oracle-backup"

if ! aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  echo "created s3://$BUCKET"
fi
aws s3api put-public-access-block --bucket "$BUCKET" --region "$REGION" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" --region "$REGION" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-versioning --bucket "$BUCKET" --region "$REGION" --versioning-configuration Status=Enabled
# 35 days of nightlies; an overwritten/deleted version lingers 7 more days.
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --region "$REGION" --lifecycle-configuration \
  '{"Rules":[{"ID":"expire-35d","Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"Days":35},"NoncurrentVersionExpiration":{"NoncurrentDays":7},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":2}}]}'
aws s3api put-bucket-tagging --bucket "$BUCKET" --region "$REGION" \
  --tagging 'TagSet=[{Key=app,Value=jyt},{Key=purpose,Value=oracle-pg-backups}]'

aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1 \
  || aws iam create-user --user-name "$USER_NAME" --tags Key=app,Value=jyt >/dev/null
aws iam put-user-policy --user-name "$USER_NAME" --policy-name put-only-pg-backups --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\",\"s3:AbortMultipartUpload\"],\"Resource\":\"arn:aws:s3:::$BUCKET/*\"}]}"

if ssh "$HOST" 'test -f /opt/jyt/backup.env'; then
  echo "/opt/jyt/backup.env already on $HOST; not issuing a new key (delete it to rotate)"
else
  N=$(aws iam list-access-keys --user-name "$USER_NAME" --query 'length(AccessKeyMetadata)' --output text)
  [ "$N" -lt 2 ] || { echo "$USER_NAME already has 2 keys; delete an old one first" >&2; exit 1; }
  aws iam create-access-key --user-name "$USER_NAME" \
    --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text \
  | ssh "$HOST" "read -r ID SECRET; umask 077; printf 'AWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\nAWS_DEFAULT_REGION=$REGION\nBACKUP_BUCKET=$BUCKET\n' \"\$ID\" \"\$SECRET\" > /opt/jyt/backup.env && echo 'wrote /opt/jyt/backup.env'"
fi
echo "next: deploy/oracle/install-backup.sh $HOST"
