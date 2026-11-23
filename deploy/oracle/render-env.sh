#!/usr/bin/env bash
# Render secrets.env for the A1 stack from SSM /jyt/prod and copy it to the box.
#
# Runs on an operator laptop with AWS credentials. The box never gets AWS keys,
# and the file is never committed (.gitignore).
#
# Source of truth for WHICH parameters: the `secrets:` block of the ECS server
# manifest (the worker's list is a subset). Anything listed there but missing
# in SSM fails the render, exactly as it would fail an ECS task start.
#
# Usage: deploy/oracle/render-env.sh [ubuntu@130.61.141.163]
set -euo pipefail

HOST="${1:-ubuntu@130.61.141.163}"
DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="$DIR/../aws/copilot/medusa-server/manifest.yml"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT
chmod 600 "$OUT"

# Set by compose.yml instead: the stack runs its own Valkey and Postgres, so
# the AWS ElastiCache / RDS URLs must never reach the box.
SKIP_RE='^(REDIS_URL|DATABASE_URL)$'

# `  NAME: /jyt/prod/PATH` lines inside the secrets: block, commented lines skipped.
# (a while-read loop, not mapfile: macOS ships bash 3.2)
PAIRS=()
while IFS= read -r line; do PAIRS+=("$line"); done < <(
  awk '/^secrets:/{on=1;next} /^[a-z]/{on=0} on' "$MANIFEST" \
    | grep -E '^  [A-Z0-9_]+: /jyt/prod/' \
    | sed -E 's/^  ([A-Z0-9_]+): (.*)$/\1 \2/'
)
[ "${#PAIRS[@]}" -gt 50 ] || { echo "parsed only ${#PAIRS[@]} secrets from $MANIFEST" >&2; exit 1; }

missing=0
for pair in "${PAIRS[@]}"; do
  name="${pair%% *}"; path="${pair#* }"
  [[ "$name" =~ $SKIP_RE ]] && continue
  if ! value="$(aws ssm get-parameter --name "$path" --with-decryption \
        --query Parameter.Value --output text 2>/dev/null)"; then
    echo "MISSING in SSM: $path" >&2; missing=1; continue
  fi
  # env_file `format: raw` is one line per variable.
  if [[ "$value" == *$'\n'* ]]; then
    echo "multi-line value for $name: compact it (jq -c) before storing" >&2; missing=1; continue
  fi
  printf '%s=%s\n' "$name" "$value" >> "$OUT"
done
[ "$missing" -eq 0 ] || { echo "not copying: fix the parameters above" >&2; exit 1; }

echo "rendered $(wc -l < "$OUT" | tr -d ' ') variables"
ssh "$HOST" 'sudo install -d -o ubuntu -g ubuntu -m 700 /opt/jyt'
scp -q "$OUT" "$HOST:/opt/jyt/secrets.env.new"
ssh "$HOST" 'chmod 600 /opt/jyt/secrets.env.new && mv /opt/jyt/secrets.env.new /opt/jyt/secrets.env'
echo "copied to $HOST:/opt/jyt/secrets.env"
