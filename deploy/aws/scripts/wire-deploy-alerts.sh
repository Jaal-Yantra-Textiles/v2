#!/usr/bin/env bash
# Wire ECS deployment state-change events from the prod cluster into the
# existing jyt-prod-alerts SNS topic, and subscribe an email endpoint.
#
# Idempotent: safe to re-run. Only creates resources that don't exist.
#
# Resources touched:
#   - SNS topic policy on jyt-prod-alerts (allows events.amazonaws.com to publish)
#   - SNS email subscription for $ALERT_EMAIL (pending until recipient confirms)
#   - EventBridge rule `jyt-prod-ecs-deploy-state-change` on the default bus
#   - Rule target → jyt-prod-alerts with an InputTransformer so the email
#     is human-readable instead of raw JSON
#
# Usage:
#   ./deploy/aws/scripts/wire-deploy-alerts.sh
#
# Re-running with a different ALERT_EMAIL adds another subscription; it
# does NOT remove the old one. Unsubscribe via the SNS console if needed.

set -euo pipefail

: "${AWS_REGION:=us-east-1}"
: "${SNS_TOPIC_ARN:=arn:aws:sns:us-east-1:369351873445:jyt-prod-alerts}"
: "${ALERT_EMAIL:=services.deployed@jaalyantra.com}"
: "${ECS_CLUSTER_ARN:=arn:aws:ecs:us-east-1:369351873445:cluster/jyt-prod-Cluster-JOcsxaMtDKJ3}"
: "${RULE_NAME:=jyt-prod-ecs-deploy-state-change}"

echo "== Region:          $AWS_REGION"
echo "== SNS topic:       $SNS_TOPIC_ARN"
echo "== Alert email:     $ALERT_EMAIL"
echo "== ECS cluster:     $ECS_CLUSTER_ARN"
echo "== Rule name:       $RULE_NAME"
echo

# ---------------------------------------------------------------------------
# 1. Subscribe email (idempotent: re-subscribing the same address is a no-op
#    on AWS's side and just returns the existing pending or confirmed ARN).
# ---------------------------------------------------------------------------
echo "[1/4] Subscribing $ALERT_EMAIL to SNS topic..."
SUB_OUT=$(aws sns subscribe \
  --topic-arn "$SNS_TOPIC_ARN" \
  --protocol email \
  --notification-endpoint "$ALERT_EMAIL" \
  --region "$AWS_REGION" \
  --output json)
SUB_ARN=$(echo "$SUB_OUT" | python3 -c "import json,sys;print(json.load(sys.stdin).get('SubscriptionArn','?'))")
echo "    Subscription ARN: $SUB_ARN"
if [ "$SUB_ARN" = "pending confirmation" ]; then
  echo "    ⚠️  Recipient must click the confirmation link in the inbox."
fi
echo

# ---------------------------------------------------------------------------
# 2. Patch SNS topic policy so EventBridge can publish to it. Default policy
#    only allows same-account publishes; the events.amazonaws.com principal
#    is treated as a separate party even when the rule is in the same account.
# ---------------------------------------------------------------------------
echo "[2/4] Updating SNS topic policy for EventBridge..."
NEW_POLICY=$(cat <<EOF
{
  "Version": "2008-10-17",
  "Id": "jyt-prod-alerts-policy",
  "Statement": [
    {
      "Sid": "AllowSameAccountServices",
      "Effect": "Allow",
      "Principal": {"AWS": "*"},
      "Action": [
        "SNS:GetTopicAttributes",
        "SNS:SetTopicAttributes",
        "SNS:AddPermission",
        "SNS:RemovePermission",
        "SNS:DeleteTopic",
        "SNS:Subscribe",
        "SNS:ListSubscriptionsByTopic",
        "SNS:Publish"
      ],
      "Resource": "$SNS_TOPIC_ARN",
      "Condition": {"StringEquals": {"AWS:SourceOwner": "369351873445"}}
    },
    {
      "Sid": "AllowEventBridgePublish",
      "Effect": "Allow",
      "Principal": {"Service": "events.amazonaws.com"},
      "Action": "SNS:Publish",
      "Resource": "$SNS_TOPIC_ARN"
    }
  ]
}
EOF
)
aws sns set-topic-attributes \
  --topic-arn "$SNS_TOPIC_ARN" \
  --attribute-name Policy \
  --attribute-value "$NEW_POLICY" \
  --region "$AWS_REGION"
echo "    Policy updated."
echo

# ---------------------------------------------------------------------------
# 3. Create/update the EventBridge rule. We scope by clusterArn so other
#    AWS accounts/clusters can't accidentally trigger this rule, and we
#    match all three lifecycle events for full visibility.
# ---------------------------------------------------------------------------
echo "[3/4] Creating EventBridge rule $RULE_NAME..."
EVENT_PATTERN=$(cat <<EOF
{
  "source": ["aws.ecs"],
  "detail-type": ["ECS Deployment State Change"],
  "detail": {
    "clusterArn": ["$ECS_CLUSTER_ARN"]
  }
}
EOF
)
aws events put-rule \
  --name "$RULE_NAME" \
  --description "Forward ECS deployment lifecycle events from $ECS_CLUSTER_ARN to SNS jyt-prod-alerts" \
  --event-pattern "$EVENT_PATTERN" \
  --state ENABLED \
  --region "$AWS_REGION" >/dev/null
echo "    Rule put."
echo

# ---------------------------------------------------------------------------
# 4. Attach SNS target with an InputTransformer so the email shows a
#    human-readable summary instead of the raw event JSON.
#
#    InputTemplate quoting is tricky: AWS parses the rendered template as
#    JSON, so a plain-text email needs the template to be a JSON string
#    literal (i.e., wrapped in escaped quotes). Easiest reliable path is
#    to build the JSON in Python and write to a temp file.
# ---------------------------------------------------------------------------
echo "[4/4] Wiring SNS target with InputTransformer..."
TARGETS_FILE=$(mktemp -t wire-deploy-alerts-targets.XXXXXX.json)
trap 'rm -f "$TARGETS_FILE"' EXIT

python3 - "$SNS_TOPIC_ARN" "$TARGETS_FILE" <<'PY'
import json, sys

sns_arn, out_path = sys.argv[1], sys.argv[2]
template = (
    '"[ECS deploy] <eventName>\\n\\n'
    'Service:    <service>\\n'
    'Deployment: <deploymentId>\\n'
    'When:       <when>\\n\\n'
    'Reason: <reason>"'
)
targets = [{
    "Id": "sns-jyt-prod-alerts",
    "Arn": sns_arn,
    "InputTransformer": {
        "InputPathsMap": {
            "eventName": "$.detail.eventName",
            "reason": "$.detail.reason",
            "deploymentId": "$.detail.deploymentId",
            "service": "$.resources[0]",
            "when": "$.time",
        },
        "InputTemplate": template,
    },
}]
with open(out_path, "w") as f:
    json.dump(targets, f)
PY

aws events put-targets \
  --rule "$RULE_NAME" \
  --targets "file://$TARGETS_FILE" \
  --region "$AWS_REGION" >/dev/null
echo "    Target wired."
echo

echo "✅ Done."
echo
echo "Next step: $ALERT_EMAIL must confirm the SNS subscription (one-click link)."
echo "Test by triggering a deploy: copilot svc deploy --name medusa-server --env prod"
