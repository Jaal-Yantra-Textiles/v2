#!/usr/bin/env bash
#
# Push every KEY=VALUE pair from secrets.local.env into AWS SSM Parameter Store
# at /jyt/<env>/<KEY>. Sensitive keys (containing SECRET / TOKEN / KEY /
# PASS / DSN / DATABASE_URL / REDIS_URL) go in as SecureString (KMS-encrypted);
# the rest go in as plain String.
#
# Why SSM and not Secrets Manager:
#   - SSM Parameter Store is free for standard tier (up to 10K params).
#   - Secrets Manager is $0.40/secret/mo — at our ~70 vars that's ~$28/mo extra.
#   - Both support SecureString with KMS encryption; security parity for our needs.
#   - Native ECS task-definition integration is identical from the container's
#     perspective: env vars get injected at task start.
#
# Usage:
#   bash deploy/aws/scripts/seed-secrets.sh <env>
#
# Example:
#   bash deploy/aws/scripts/seed-secrets.sh prod
#
set -euo pipefail

ENVIRONMENT="${1:-prod}"
SECRETS_FILE="${SECRETS_FILE:-deploy/aws/secrets.local.env}"
REGION="${AWS_REGION:-us-east-1}"

if [[ ! -f "${SECRETS_FILE}" ]]; then
  cat <<EOF >&2
✗ ${SECRETS_FILE} not found.

  1. Copy the template:    cp deploy/aws/secrets.example.env deploy/aws/secrets.local.env
  2. Fill in real values.
  3. Re-run this script.
EOF
  exit 1
fi

# Patterns that mark a variable as sensitive — these go in as SecureString.
is_sensitive() {
  local name="$1"
  [[ "$name" =~ (SECRET|TOKEN|KEY|PASS|PASSWORD|DSN|DATABASE_URL|REDIS_URL|WEBHOOK) ]]
}

# Skip these — they're set in Copilot manifests, not seeded as SSM params.
SKIP_KEYS=(
  NODE_ENV
  PORT
  MEDUSA_WORKER_MODE
  DISABLE_MEDUSA_ADMIN
)

should_skip() {
  local name="$1"
  for skip in "${SKIP_KEYS[@]}"; do
    [[ "$name" == "$skip" ]] && return 0
  done
  return 1
}

push_param() {
  local key="$1" value="$2"
  local name="/jyt/${ENVIRONMENT}/${key}"
  local type
  if is_sensitive "$key"; then
    type="SecureString"
    icon="🔒"
  else
    type="String"
    icon="📝"
  fi
  # Use file:// to bypass AWS CLI's URI auto-fetch behavior, which would
  # otherwise treat values starting with https://, http://, s3:// etc. as
  # remote URLs to dereference rather than literal strings.
  local tmpfile
  tmpfile=$(mktemp)
  printf '%s' "$value" > "$tmpfile"
  aws ssm put-parameter \
    --name "$name" \
    --value "file://${tmpfile}" \
    --type "$type" \
    --overwrite \
    --region "$REGION" >/dev/null
  rm -f "$tmpfile"
  # Copilot's auto-grant for the ECS task execution role keys off these tags.
  # Without them, the task can't read the parameter at startup.
  aws ssm add-tags-to-resource \
    --resource-type Parameter \
    --resource-id "$name" \
    --tags "Key=copilot-application,Value=jyt" "Key=copilot-environment,Value=${ENVIRONMENT}" \
    --region "$REGION" >/dev/null
  echo "  ${icon} ${name} (${type})"
}

echo "Seeding /jyt/${ENVIRONMENT}/* from ${SECRETS_FILE}"
echo "  🔒 SecureString | 📝 String"
echo

count_secure=0
count_plain=0
count_skip=0
count_empty=0

while IFS='=' read -r key value; do
  # Skip comments and blanks
  [[ -z "${key:-}" ]] && continue
  [[ "${key:0:1}" == "#" ]] && continue
  # Trim trailing whitespace from key
  key="${key%%[[:space:]]*}"
  # Skip header keys (must match VAR_NAME pattern)
  [[ ! "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] && continue
  # Skip empty values
  if [[ -z "$value" ]]; then
    echo "  · skip ${key} (empty)"
    ((count_empty++))
    continue
  fi
  # Skip explicit per-service vars
  if should_skip "$key"; then
    echo "  · skip ${key} (set in Copilot manifest)"
    ((count_skip++))
    continue
  fi
  # Strip surrounding quotes if present
  if [[ ${#value} -ge 2 ]] && [[ "${value:0:1}${value: -1}" == '""' || "${value:0:1}${value: -1}" == "''" ]]; then
    value="${value:1:-1}"
  fi
  push_param "$key" "$value"
  if is_sensitive "$key"; then
    ((count_secure++))
  else
    ((count_plain++))
  fi
done < "$SECRETS_FILE"

echo
echo "Done:"
echo "  🔒 SecureString: $count_secure"
echo "  📝 String:       $count_plain"
echo "  · Skipped:       $count_skip (set in manifest)"
echo "  · Empty:         $count_empty"
echo
echo "Verify with:"
echo "  aws ssm get-parameters-by-path --path /jyt/${ENVIRONMENT}/ --region ${REGION} --query 'Parameters[].Name' --output table"
