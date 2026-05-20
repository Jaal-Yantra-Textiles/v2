#!/usr/bin/env bash
#
# Mirror a Medusa image tag from GitHub Container Registry to AWS ECR.
#
# Why: ECS tasks pull from ECR using their native task-execution role —
# no PATs to rotate, no docker config to manage. We use GHCR as the build
# target and ECR as the deploy source.
#
# Usage:
#   bash deploy/aws/scripts/ghcr-to-ecr.sh [tag]
#
# Defaults to mirroring `latest`. Pass a specific tag (e.g. a git SHA) for
# pinned deploys. The script tags the ECR image with BOTH the source tag and
# `latest` so that `copilot svc deploy` can resolve `:latest`.
#
# Prereqs:
#   - Docker daemon running locally
#   - `aws` CLI configured (`aws sts get-caller-identity` works)
#   - GHCR auth: either the image is public, OR these envs are set:
#       GHCR_USER  — your GitHub username
#       GHCR_PAT   — a Personal Access Token with `read:packages` scope
#
set -euo pipefail

TAG="${1:-latest}"
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

GHCR_REPO="ghcr.io/jaal-yantra-textiles/v2"
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
ECR_REPO="${ECR_REGISTRY}/jyt-medusa"

echo "→ Source: ${GHCR_REPO}:${TAG}"
echo "→ Target: ${ECR_REPO}:${TAG} (and :latest)"
echo

# GHCR login (only if PAT provided; public images don't need it)
if [[ -n "${GHCR_PAT:-}" ]]; then
  echo "Logging into GHCR…"
  echo "${GHCR_PAT}" | docker login ghcr.io -u "${GHCR_USER:?GHCR_USER required when GHCR_PAT is set}" --password-stdin
fi

# ECR login
echo "Logging into ECR…"
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

echo "Pulling ${GHCR_REPO}:${TAG} (forcing linux/amd64 for Fargate)…"
docker pull --platform linux/amd64 "${GHCR_REPO}:${TAG}"

echo "Tagging for ECR…"
docker tag "${GHCR_REPO}:${TAG}" "${ECR_REPO}:${TAG}"
docker tag "${GHCR_REPO}:${TAG}" "${ECR_REPO}:latest"

echo "Pushing to ECR…"
docker push "${ECR_REPO}:${TAG}"
docker push "${ECR_REPO}:latest"

# Capture the image digest so we can refer to the exact bytes deployed.
DIGEST="$(docker inspect --format='{{index .RepoDigests 0}}' "${ECR_REPO}:${TAG}" | awk -F'@' '{print $2}')"

cat <<EOF

✓ Done.
  ECR repo:   ${ECR_REPO}
  Tags:       ${TAG}, latest
  Digest:     ${DIGEST}

Next step:
  copilot svc deploy --name medusa-server --env prod --tag ${TAG}
  copilot svc deploy --name medusa-worker --env prod --tag ${TAG}
EOF
