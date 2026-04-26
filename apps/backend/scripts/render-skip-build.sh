#!/usr/bin/env bash
# Render Skip-Build Script
# Exit 0 = skip build, Exit 1 = proceed with build
#
# Usage in render.yaml or Render dashboard:
#   Set "Build Filter" → Custom Script → ./scripts/render-skip-build.sh <app-name>
#
# Example:
#   ./scripts/render-skip-build.sh partner-ui
#   ./scripts/render-skip-build.sh storefront-starter
#   ./scripts/render-skip-build.sh docs

set -euo pipefail

APP_NAME="${1:?Usage: render-skip-build.sh <app-name>}"
APP_DIR="apps/${APP_NAME}"

if [ ! -d "$APP_DIR" ]; then
  echo "Error: $APP_DIR does not exist"
  exit 1 # proceed with build as a safety fallback
fi

# Render sets RENDER_GIT_COMMIT (current) and RENDER_GIT_LAST_SUCCESSFUL_COMMIT (previous deploy)
if [ -z "${RENDER_GIT_LAST_SUCCESSFUL_COMMIT:-}" ]; then
  echo "No previous successful deploy found — building."
  exit 1
fi

echo "Comparing ${RENDER_GIT_LAST_SUCCESSFUL_COMMIT:0:8}..${RENDER_GIT_COMMIT:0:8}"

# Paths that should trigger a rebuild for any app
SHARED_PATHS=(
  "package.json"
  "pnpm-lock.yaml"
  "pnpm-workspace.yaml"
  "tsconfig.json"
)

# Check if shared root files changed
for path in "${SHARED_PATHS[@]}"; do
  if git diff --name-only "$RENDER_GIT_LAST_SUCCESSFUL_COMMIT" "$RENDER_GIT_COMMIT" -- "$path" | grep -q .; then
    echo "Shared file changed: $path — building."
    exit 1
  fi
done

# Check if the app's own files changed
CHANGED=$(git diff --name-only "$RENDER_GIT_LAST_SUCCESSFUL_COMMIT" "$RENDER_GIT_COMMIT" -- "$APP_DIR")

if [ -n "$CHANGED" ]; then
  echo "Changes detected in $APP_DIR:"
  echo "$CHANGED"
  echo "Building."
  exit 1
else
  echo "No changes in $APP_DIR — skipping build."
  exit 0
fi
