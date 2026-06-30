#!/usr/bin/env bash
# Tear down the ECS deployment-notification emails wired by
# wire-deploy-alerts.sh.
#
# We deliberately remove ONLY the EventBridge deploy rule + its SNS target.
# The jyt-prod-alerts SNS topic and its email subscription are LEFT INTACT
# because they are shared by the operational CloudWatch alarms (ALB 5xx /
# latency / unhealthy hosts, RDS cpu/conns/storage, cache CPU, no-healthy-
# hosts). Deleting the topic or unsubscribing the email would silence those
# too — GitHub already shows deploy status, but those alarms are real ops
# signal we want to keep.
#
# Idempotent: safe to re-run. No-ops if the rule is already gone.
#
# Usage:
#   ./deploy/aws/scripts/unwire-deploy-alerts.sh

set -euo pipefail

: "${AWS_REGION:=us-east-1}"
: "${RULE_NAME:=jyt-prod-ecs-deploy-state-change}"
: "${TARGET_ID:=sns-jyt-prod-alerts}"

echo "== Region:    $AWS_REGION"
echo "== Rule name: $RULE_NAME"
echo

if ! aws events describe-rule --name "$RULE_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
  echo "Rule $RULE_NAME does not exist — nothing to do."
  exit 0
fi

echo "[1/2] Removing SNS target from rule..."
aws events remove-targets \
  --rule "$RULE_NAME" \
  --ids "$TARGET_ID" \
  --region "$AWS_REGION" >/dev/null || true
echo "    Target removed."

echo "[2/2] Deleting EventBridge rule..."
aws events delete-rule \
  --name "$RULE_NAME" \
  --region "$AWS_REGION"
echo "    Rule deleted."
echo

echo "✅ Done. Deployment-notification emails stopped."
echo "   (SNS topic jyt-prod-alerts + email subscription kept for operational alarms.)"
