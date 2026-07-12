#!/usr/bin/env bash
# Run Medusa DB migrations as a ONE-OFF Fargate task, decoupled from the
# server/worker boot.
#
# Why this exists
#   The server container used to run `predeploy:force` (medusa db:migrate
#   --execute-all-links) inline before starting the HTTP server, so every
#   rolling deploy had to finish all migrations before the new task could pass
#   /health — stretching the deploy and coupling schema changes to boot.
#   Instead, the deploy workflow now runs THIS script off the freshly-built
#   image, waits for it to finish, and only then rolls the services (which now
#   just `start`). Migrations get their own task, their own logs, and their own
#   pass/fail exit code.
#
# Mechanism (mirrors run-backfill.sh)
#   - Register a one-off task-def revision off jyt-prod-medusa-server with the
#     supplied image tag (so migrations run the NEW image, not :latest).
#   - Override the container command to `pnpm predeploy:force`.
#   - run-task, then BLOCK until the task stops and propagate its exit code.
#
# Usage
#   IMAGE_TAG=sha-<hash> ./deploy/aws/scripts/run-migrations.sh
#
# Optional env
#   TIMEOUT_SECONDS=1200  -> how long to wait for the task to stop (default 1200)
#   ECR_REGISTRY=...      -> override the ECR account ref (auto-detected)

set -euo pipefail

: "${AWS_REGION:=us-east-1}"
: "${ECS_CLUSTER:=jyt-prod-Cluster-JOcsxaMtDKJ3}"
: "${TASK_FAMILY:=jyt-prod-medusa-server}"
: "${CONTAINER_NAME:=medusa-server}"
: "${SUBNETS:=subnet-0fbeafa1ebdf9026a,subnet-05ebe6f3b9fb25673}"
: "${SECURITY_GROUP:=sg-0c3685e1a91b5d60e}"
: "${LOG_GROUP:=/copilot/jyt-prod-medusa-server}"
: "${ECR_REPOSITORY:=jyt-medusa}"
: "${TIMEOUT_SECONDS:=1200}"

if [ -z "${IMAGE_TAG:-}" ]; then
  echo "❌ IMAGE_TAG is required (e.g. sha-<hash>)." >&2
  echo "   The migration must run the exact image being deployed." >&2
  exit 2
fi

echo "== Region:        $AWS_REGION"
echo "== Cluster:       $ECS_CLUSTER"
echo "== Task family:   $TASK_FAMILY"
echo "== Image tag:     $IMAGE_TAG"
echo "== Timeout:       ${TIMEOUT_SECONDS}s"
echo

# ── Register a one-off task-def revision pinned to IMAGE_TAG ────────────────
CURRENT_DEF_FILE=$(mktemp -t run-migrations-current-td.XXXXXX.json)
aws ecs describe-task-definition \
  --task-definition "$TASK_FAMILY" \
  --region "$AWS_REGION" \
  --output json > "$CURRENT_DEF_FILE"

if [ -z "${ECR_REGISTRY:-}" ]; then
  CURRENT_IMAGE=$(python3 -c "
import json, sys
td = json.load(open(sys.argv[1]))['taskDefinition']
for c in td['containerDefinitions']:
    if c['name'] == sys.argv[2]:
        print(c['image']); break
" "$CURRENT_DEF_FILE" "$CONTAINER_NAME")
  ECR_REGISTRY="${CURRENT_IMAGE%/*}"
fi
NEW_IMAGE="${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"
echo "Registering one-off migration task def with image: ${NEW_IMAGE}"

NEW_DEF_FILE=$(mktemp -t run-migrations-taskdef.XXXXXX.json)
python3 - "$CURRENT_DEF_FILE" "$CONTAINER_NAME" "$NEW_IMAGE" "$NEW_DEF_FILE" <<'PY'
import json, sys
in_path, container_name, new_image, out_path = sys.argv[1:]
td = json.load(open(in_path))['taskDefinition']
allowed_keys = {
  'family', 'taskRoleArn', 'executionRoleArn', 'networkMode',
  'containerDefinitions', 'volumes', 'placementConstraints',
  'requiresCompatibilities', 'cpu', 'memory', 'tags',
  'pidMode', 'ipcMode', 'proxyConfiguration', 'inferenceAccelerators',
  'ephemeralStorage', 'runtimePlatform',
}
filtered = {k: v for k, v in td.items() if k in allowed_keys and v is not None}
for c in filtered.get('containerDefinitions', []):
    if c.get('name') == container_name:
        c['image'] = new_image
with open(out_path, 'w') as f:
    json.dump(filtered, f)
PY

TASK_DEF_ARN=$(aws ecs register-task-definition \
  --region "$AWS_REGION" \
  --cli-input-json "file://${NEW_DEF_FILE}" \
  --query "taskDefinition.taskDefinitionArn" \
  --output text)
echo "Registered: ${TASK_DEF_ARN}"

# ── Command override: run migrations only (no server boot) ─────────────────
OVERRIDES_FILE=$(mktemp -t run-migrations-overrides.XXXXXX.json)
trap 'rm -f "$OVERRIDES_FILE" "${NEW_DEF_FILE:-}" "${CURRENT_DEF_FILE:-}"' EXIT
python3 - "$CONTAINER_NAME" "$OVERRIDES_FILE" <<'PY'
import json, sys
container, out_path = sys.argv[1:]
override = {"name": container, "command": ["sh", "-c", "pnpm predeploy:force"]}
with open(out_path, "w") as f:
    json.dump({"containerOverrides": [override]}, f)
PY

RUN_OUT=$(aws ecs run-task \
  --cluster "$ECS_CLUSTER" \
  --task-definition "$TASK_DEF_ARN" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=ENABLED}" \
  --overrides "file://$OVERRIDES_FILE" \
  --started-by "migrate:${IMAGE_TAG}" \
  --region "$AWS_REGION" \
  --output json)

TASK_ARN=$(echo "$RUN_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin)['tasks'][0]['taskArn'])")
TASK_ID="${TASK_ARN##*/}"
echo
echo "✅ Migration task started: $TASK_ID"
echo "   Console: https://${AWS_REGION}.console.aws.amazon.com/ecs/v2/clusters/${ECS_CLUSTER}/tasks/${TASK_ID}?region=${AWS_REGION}"
echo

# ── Block until the task stops, polling lastStatus ─────────────────────────
DEADLINE=$(( $(date +%s) + TIMEOUT_SECONDS ))
LAST_STATUS=""
while true; do
  DESC=$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$TASK_ARN" \
    --region "$AWS_REGION" --output json)
  LAST_STATUS=$(echo "$DESC" | python3 -c "import json,sys; print(json.load(sys.stdin)['tasks'][0].get('lastStatus',''))")
  if [ "$LAST_STATUS" = "STOPPED" ]; then
    break
  fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "❌ Migration task did not stop within ${TIMEOUT_SECONDS}s (last status: ${LAST_STATUS})." >&2
    echo "   Stopping the task to avoid a dangling migration." >&2
    aws ecs stop-task --cluster "$ECS_CLUSTER" --task "$TASK_ARN" \
      --reason "migration timeout" --region "$AWS_REGION" >/dev/null || true
    exit 1
  fi
  echo "⏳ task ${LAST_STATUS:-PENDING}…"
  sleep 10
done

# ── Print the migration logs, then propagate the container exit code ───────
STREAM="copilot/${CONTAINER_NAME}/${TASK_ID}"
echo
echo "── Migration logs ──────────────────────────────────────────────"
aws logs tail "$LOG_GROUP" --log-stream-name-prefix "$STREAM" \
  --since 1h --region "$AWS_REGION" 2>/dev/null || echo "(logs unavailable)"
echo "────────────────────────────────────────────────────────────────"
echo

# exitCode is null when the container never ran (image-pull failure, OOM kill,
# …) — treat that as a failure too. stoppedReason/container reason go to stderr
# for the CI log; only the numeric code lands on stdout for the gate.
EXIT_CODE=$(echo "$DESC" | python3 -c "
import json, sys
t = json.load(sys.stdin)['tasks'][0]
c = next((c for c in t.get('containers', []) if c.get('name') == '${CONTAINER_NAME}'), {})
code = c.get('exitCode')
print('reason:', t.get('stoppedReason', ''), '| container:', c.get('reason', ''), file=sys.stderr)
print(code if code is not None else 'null')
")

if [ "$EXIT_CODE" = "0" ]; then
  echo "✅ Migrations completed (exit 0)."
  exit 0
fi
echo "❌ Migrations failed — exit code: ${EXIT_CODE}" >&2
exit 1
