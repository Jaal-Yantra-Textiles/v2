#!/usr/bin/env bash
#
# Assert that an ECS service is actually RUNNING the image we just pushed —
# and repair it if it isn't.
#
# Why this exists (#1372): the copilot manifests use `image.location` pinned to
# `<repo>:latest`, so every deploy re-creates the SAME task definition revision.
# CloudFormation sees no diff, ECS reports the deployment `COMPLETED` against
# the tasks already running, and `copilot svc deploy --force` returns success
# without replacing anything. On 20 Aug 2026 that left the API serving a commit
# four hours older than the one whose deploy had just gone green — the build,
# the push, the deploy job and the /health check all passed, because each was
# truthfully answering a different question. None of them was asked "is the new
# code running?".
#
# The only signal that settles it: a running task's startedAt must be LATER
# than the image's imagePushedAt. A task started before the image was pushed is
# running the previous image, whatever every other layer says.
#
# Usage: assert-service-rolled.sh <service-short-name> <image-tag>
#   e.g. assert-service-rolled.sh medusa-server sha-5e288f41883…
set -euo pipefail

SVC_SHORT="${1:?service short name, e.g. medusa-server}"
IMAGE_TAG="${2:?image tag that must be running, e.g. sha-<gitsha>}"
REGION="${AWS_REGION:-us-east-1}"
ECR_REPO="${ECR_REPO:-jyt-medusa}"
CLUSTER_MATCH="${CLUSTER_MATCH:-cluster/jyt-prod-Cluster}"
SERVICE_MATCH="${SERVICE_MATCH:-service/.*jyt-prod-${SVC_SHORT}-Service}"

log() { echo "[assert-rolled:${SVC_SHORT}] $*"; }

image_pushed_at() {
  aws ecr describe-images --region "$REGION" --repository-name "$ECR_REPO" \
    --image-ids imageTag="$IMAGE_TAG" \
    --query 'imageDetails[0].imagePushedAt' --output text
}

find_cluster() {
  aws ecs list-clusters --region "$REGION" --query 'clusterArns[]' --output text \
    | tr '\t' '\n' | grep -m1 "$CLUSTER_MATCH"
}

find_service() {
  aws ecs list-services --region "$REGION" --cluster "$1" --query 'serviceArns[]' --output text \
    | tr '\t' '\n' | grep -m1 -E "$SERVICE_MATCH"
}

# Oldest startedAt across the service's running tasks. The OLDEST is the one
# that matters: one fresh task alongside one stale task is still a half-rolled
# service serving two different commits to alternating requests.
oldest_task_start() {
  local cluster="$1" service="$2" tasks
  tasks=$(aws ecs list-tasks --region "$REGION" --cluster "$cluster" \
            --service-name "$service" --desired-status RUNNING \
            --query 'taskArns[]' --output text)
  if [ -z "$tasks" ]; then echo "0"; return; fi
  aws ecs describe-tasks --region "$REGION" --cluster "$cluster" --tasks $tasks \
    --query 'min(tasks[].startedAt)' --output text
}

CLUSTER=$(find_cluster)
SERVICE=$(find_service "$CLUSTER")
PUSHED=$(image_pushed_at)
log "cluster=${CLUSTER##*/} service=${SERVICE##*/}"
log "image ${IMAGE_TAG} pushed at ${PUSHED}"

check() {
  local started
  started=$(oldest_task_start "$CLUSTER" "$SERVICE")
  log "oldest running task started at ${started}"
  awk -v a="$started" -v b="$PUSHED" 'BEGIN { exit !(a > b) }'
}

if check; then
  log "✅ every running task is newer than the image — the new code is live"
  exit 0
fi

# Not rolled. This is the copilot --force no-op described above. Repair it with
# the API call that always rolls, then re-assert — a repair we don't verify is
# the same class of mistake as the deploy we didn't verify.
log "⚠️  tasks predate the image — the deploy did NOT roll. Forcing a new deployment."
aws ecs update-service --region "$REGION" --cluster "$CLUSTER" --service "$SERVICE" \
  --force-new-deployment >/dev/null
log "waiting for the service to stabilise…"
aws ecs wait services-stable --region "$REGION" --cluster "$CLUSTER" --services "$SERVICE"

if check; then
  log "✅ repaired — tasks replaced and the new code is live"
  exit 0
fi

log "❌ still running tasks older than the image after a forced deployment."
log "   The deploy is NOT live. Failing rather than reporting a green deploy."
exit 1
