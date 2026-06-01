#!/usr/bin/env bash
# Run a one-off Medusa backfill / exec script against prod RDS by
# launching a Fargate task that reuses the medusa-server task definition.
#
# Why this approach
#   - The script files compile into .medusa/server/src/scripts/*.js and
#     ship inside the medusa-server image, so the same container can run
#     them with no new image build.
#   - Re-using the existing task def means we inherit the SSM-backed
#     secrets (DATABASE_URL, ENCRYPTION_KEY, OPENROUTER_API_KEY, …),
#     the IAM role with RDS+S3+SSM access, and the VPC subnets /
#     security group that can reach RDS.
#   - We just override the container command so the entrypoint runs
#     `medusa exec` against the requested script instead of starting
#     the HTTP server.
#
# Usage
#   ./deploy/aws/scripts/run-backfill.sh backfill-product-search
#   ./deploy/aws/scripts/run-backfill.sh backfill-ai-platforms-from-env
#
# Optional env
#   BATCH=50              -> exposed to scripts that batch (e.g. product search)
#   DRY_RUN=1             -> exposed to scripts that support it
#   FOLLOW=1              -> tail CloudWatch logs until the task exits
#   IMAGE_TAG=sha-<hash>  -> run against a specific image tag instead of
#                            whatever the live task def uses (:latest).
#                            Used to dry-run scripts that haven't been
#                            merged to main yet — the deploy workflow
#                            supports a workflow_dispatch with
#                            deploy_services=false that builds + mirrors
#                            an image without rolling the prod service;
#                            grab its sha tag from the build summary and
#                            pass it here.
#   ECR_REGISTRY=...      -> override the ECR account ref. Auto-detected
#                            from the existing task def when IMAGE_TAG
#                            is set; only needed if your shell already
#                            has it cached.

set -euo pipefail

SCRIPT_NAME="${1:-}"
if [ -z "$SCRIPT_NAME" ]; then
  echo "Usage: $0 <script-name>"
  echo "  e.g. $0 backfill-product-search"
  echo "       $0 backfill-ai-platforms-from-env"
  exit 1
fi

: "${AWS_REGION:=us-east-1}"
: "${ECS_CLUSTER:=jyt-prod-Cluster-JOcsxaMtDKJ3}"
: "${TASK_FAMILY:=jyt-prod-medusa-server}"
: "${CONTAINER_NAME:=medusa-server}"
: "${SUBNETS:=subnet-0fbeafa1ebdf9026a,subnet-05ebe6f3b9fb25673}"
: "${SECURITY_GROUP:=sg-0c3685e1a91b5d60e}"
: "${LOG_GROUP:=/copilot/jyt-prod-medusa-server}"

echo "== Region:          $AWS_REGION"
echo "== Cluster:         $ECS_CLUSTER"
echo "== Task family:     $TASK_FAMILY"
echo "== Container:       $CONTAINER_NAME"
echo "== Script:          $SCRIPT_NAME"
echo "== BATCH:           ${BATCH:-(unset, script default)}"
echo "== DRY_RUN:         ${DRY_RUN:-0}"
echo "== IMAGE_TAG:       ${IMAGE_TAG:-(unset, use live task def image)}"
echo

# Resolve the task definition to run against.
#
# Default path (no IMAGE_TAG): use the current active revision of the
# medusa-server family. The one-off task pulls whatever image that
# revision references (:latest in prod today).
#
# Branch dry-run path (IMAGE_TAG set): describe the current revision,
# swap the container image to the supplied sha tag, register a new
# revision in the family, and target that new revision. The new
# revision is a one-off — `copilot svc deploy` references the family
# by name and would still pick whatever the manifest says when the
# next real deploy runs, so this side-revision doesn't pollute the
# normal deploy path. ECS keeps old revisions free of charge.
if [ -n "${IMAGE_TAG:-}" ]; then
  echo "Registering a one-off task def revision with image tag ${IMAGE_TAG}…"
  # Write describe-task-definition output to a temp file so python can
  # read it positionally — `python3 - <<'PY'` heredocs take over stdin,
  # so we can't pipe JSON in alongside the heredoc.
  CURRENT_DEF_FILE=$(mktemp -t run-backfill-current-td.XXXXXX.json)
  aws ecs describe-task-definition \
    --task-definition "$TASK_FAMILY" \
    --region "$AWS_REGION" \
    --output json > "$CURRENT_DEF_FILE"

  # Compose the new image ref. If ECR_REGISTRY isn't passed in, parse
  # it out of the existing image on the current task def. `-c` reads
  # code from the arg so stdin is free for the pipe.
  if [ -z "${ECR_REGISTRY:-}" ]; then
    CURRENT_IMAGE=$(python3 -c "
import json, sys
td = json.load(open(sys.argv[1]))['taskDefinition']
for c in td['containerDefinitions']:
    if c['name'] == sys.argv[2]:
        print(c['image']); break
" "$CURRENT_DEF_FILE" "$CONTAINER_NAME")
    # An image looks like 123456789012.dkr.ecr.us-east-1.amazonaws.com/jyt-medusa:latest
    ECR_REGISTRY="${CURRENT_IMAGE%/*}"
  fi
  NEW_IMAGE="${ECR_REGISTRY}/${ECR_REPOSITORY:-jyt-medusa}:${IMAGE_TAG}"
  echo "  New image: ${NEW_IMAGE}"

  # Filter the current task def down to the fields register-task-definition
  # accepts and swap the container image. describe-task-definition returns
  # extra fields (revision, status, registeredAt, taskDefinitionArn,
  # requiresAttributes, compatibilities, registeredBy) that register-
  # task-definition rejects.
  NEW_DEF_FILE=$(mktemp -t run-backfill-taskdef.XXXXXX.json)
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
  echo "  Registered: ${TASK_DEF_ARN}"
else
  TASK_DEF_ARN=$(aws ecs describe-task-definition \
    --task-definition "$TASK_FAMILY" \
    --region "$AWS_REGION" \
    --query "taskDefinition.taskDefinitionArn" \
    --output text)
fi
echo "Using task definition: $TASK_DEF_ARN"

# Compose the command override. WORKDIR inside the runtime image is
# /app/.medusa/server (see apps/backend/Dockerfile), so the script
# resolves at ./src/scripts/<name>.js once compiled. Use the local node
# (`pnpm exec`) because medusa CLI lives in the prod node_modules.
CMD_PARTS=(pnpm exec medusa exec "./src/scripts/${SCRIPT_NAME}.js")

# Build environment override list — only set keys we explicitly passed.
ENV_LIST=()
add_env() {
  local key="$1" val="$2"
  if [ -n "$val" ]; then
    # JSON-escape the value (handles quotes, backslashes, …).
    local escaped
    escaped=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$val")
    ENV_LIST+=("{\"name\":\"${key}\",\"value\":${escaped}}")
  fi
}
add_env BATCH                    "${BATCH:-}"
add_env DRY_RUN                  "${DRY_RUN:-}"
# 0A region/fanout backfill knobs — see apps/docs/notes/PLATFORM_0A_RUNBOOK.md.
add_env REGION_IDS               "${REGION_IDS:-}"
add_env PARTNER_IDS              "${PARTNER_IDS:-}"
add_env CONCURRENCY              "${CONCURRENCY:-}"
# Pass-throughs for the AI-platforms backfill: keys live in the local
# `.env` during development and not yet in prod SSM. Exporting them
# before calling this script (e.g. via `set -a; source .env; set +a`)
# threads them into the one-off Fargate task without persisting them in
# Parameter Store.
add_env DASHSCOPE_API_KEY        "${DASHSCOPE_API_KEY:-}"
add_env CLOUDFLARE_AI_ACCOUNT_ID "${CLOUDFLARE_AI_ACCOUNT_ID:-}"
add_env CLOUDFLARE_AI_TOKEN      "${CLOUDFLARE_AI_TOKEN:-}"
add_env STOREFRONT_SEARCH_DASHSCOPE_MODEL  "${STOREFRONT_SEARCH_DASHSCOPE_MODEL:-}"
add_env STOREFRONT_SEARCH_CLOUDFLARE_MODEL "${STOREFRONT_SEARCH_CLOUDFLARE_MODEL:-}"
add_env PRODUCT_SEARCH_EMBED_PROVIDER       "${PRODUCT_SEARCH_EMBED_PROVIDER:-}"
add_env PRODUCT_SEARCH_DASHSCOPE_MODEL      "${PRODUCT_SEARCH_DASHSCOPE_MODEL:-}"
add_env PRODUCT_SEARCH_CLOUDFLARE_MODEL     "${PRODUCT_SEARCH_CLOUDFLARE_MODEL:-}"
add_env FAL_DEFAULT_MODEL        "${FAL_DEFAULT_MODEL:-}"

ENV_JSON=""
if [ ${#ENV_LIST[@]} -gt 0 ]; then
  ENV_JSON=$(IFS=, ; echo "[${ENV_LIST[*]}]")
fi

OVERRIDES_FILE=$(mktemp -t run-backfill-overrides.XXXXXX.json)
# Single EXIT trap cleans up both temp files — the IMAGE_TAG path
# above also creates NEW_DEF_FILE, which we want gone whether or not
# the run-task call succeeded.
trap 'rm -f "$OVERRIDES_FILE" "${NEW_DEF_FILE:-}" "${CURRENT_DEF_FILE:-}"' EXIT

python3 - "$CONTAINER_NAME" "$OVERRIDES_FILE" "$ENV_JSON" "${CMD_PARTS[@]}" <<'PY'
import json, sys
container, out_path, env_json, *cmd = sys.argv[1:]
override = {"name": container, "command": cmd}
if env_json:
    override["environment"] = json.loads(env_json)
with open(out_path, "w") as f:
    json.dump({"containerOverrides": [override]}, f)
PY

RUN_OUT=$(aws ecs run-task \
  --cluster "$ECS_CLUSTER" \
  --task-definition "$TASK_DEF_ARN" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=ENABLED}" \
  --overrides "file://$OVERRIDES_FILE" \
  --started-by "backfill:${SCRIPT_NAME}" \
  --region "$AWS_REGION" \
  --output json)

TASK_ARN=$(echo "$RUN_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin)['tasks'][0]['taskArn'])")
TASK_ID="${TASK_ARN##*/}"

echo
echo "✅ Task started"
echo "   ARN:     $TASK_ARN"
echo "   ID:      $TASK_ID"
echo "   Logs:    $LOG_GROUP/copilot/$TASK_ID  (after task pulls + boots)"
echo
echo "Console:   https://${AWS_REGION}.console.aws.amazon.com/ecs/v2/clusters/${ECS_CLUSTER}/tasks/${TASK_ID}?region=${AWS_REGION}"
echo

if [ "${FOLLOW:-0}" = "1" ]; then
  echo "Tailing logs (Ctrl-C to detach)…"
  # The log stream name is constructed by the awslogs driver as
  # copilot/<container>/<task-id>. We poll with `aws logs tail` once the
  # stream exists.
  STREAM="copilot/${CONTAINER_NAME}/${TASK_ID}"
  for i in $(seq 1 60); do
    if aws logs describe-log-streams \
        --log-group-name "$LOG_GROUP" \
        --log-stream-name-prefix "$STREAM" \
        --region "$AWS_REGION" \
        --query "logStreams[?logStreamName=='$STREAM'] | length(@)" \
        --output text 2>/dev/null | grep -q "^1$"; then
      break
    fi
    sleep 2
  done
  aws logs tail "$LOG_GROUP" \
    --log-stream-name-prefix "$STREAM" \
    --follow \
    --region "$AWS_REGION" || true
fi
