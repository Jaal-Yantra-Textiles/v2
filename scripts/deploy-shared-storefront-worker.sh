#!/usr/bin/env bash
#
# deploy-shared-storefront-worker.sh
# ──────────────────────────────────
# Build + deploy the SHARED multi-tenant storefront Cloudflare Worker
# (`nextjs-starter-medusa`, zone cicilabel.com, account c9b8…). This is the
# reusable recipe for restoring/redeploying the shared worker.
#
# WHY THIS SCRIPT EXISTS (do not "just run pnpm deploy" in the repo):
#   apps/storefront-starter is a member of the jyt pnpm WORKSPACE. Building it
#   in place makes OpenNext resolve Next.js against the hoisted ROOT
#   node_modules → 54 esbuild "Could not resolve …/next-server" errors and the
#   build fails. So we copy it OUT of the workspace and
#   `pnpm install --ignore-workspace` against its own lockfile first.
#
# BUILD-TIME vars matter: every NEXT_PUBLIC_* is INLINED into the client bundle
# at build time (NOT read at runtime), so they must be exported HERE. These
# mirror the Vercel `storefront-shared` project 1:1. `MEDUSA_BACKEND_URL` is the
# only runtime var and lives in the storefront's wrangler.jsonc `vars`.
#
# PREREQUISITES
#   • CLOUDFLARE_API_TOKEN  — a token with **Workers Scripts: Edit** on account
#     c9b8…. NOTE: the SSM `/jyt/prod/CLOUDFLARE_API_TOKEN` is a ZONE token and
#     CANNOT deploy workers — pass a Workers-capable token (e.g. the deployment
#     account's `cfat_…`) via env.
#   • aws CLI configured (reads the Stripe publishable key + account id from SSM).
#   • pnpm, node ≥20.
#
# USAGE
#   CLOUDFLARE_API_TOKEN=cfat_xxxxx ./scripts/deploy-shared-storefront-worker.sh
#
# Optional overrides: BUILD_DIR, NEXT_PUBLIC_MEDUSA_BACKEND_URL,
#   MEDUSA_CLOUD_S3_HOSTNAME, MEDUSA_CLOUD_S3_PATHNAME, CLOUDFLARE_ACCOUNT_ID.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/apps/storefront-starter"
BUILD_DIR="${BUILD_DIR:-/tmp/jyt-shared-worker-build}"

: "${CLOUDFLARE_API_TOKEN:?Set a Workers-Scripts:Edit token — the SSM zone token cannot deploy workers}"
export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(aws ssm get-parameter --name /jyt/prod/CLOUDFLARE_ACCOUNT_ID --query Parameter.Value --output text)}"

# ── Build-time env (mirror Vercel storefront-shared; NEXT_PUBLIC_* are inlined) ─
export NEXT_PUBLIC_MULTI_TENANT="true"
export NEXT_PUBLIC_MEDUSA_BACKEND_URL="${NEXT_PUBLIC_MEDUSA_BACKEND_URL:-https://v3.jaalyantra.com}"
export NEXT_PUBLIC_STRIPE_KEY="$(aws ssm get-parameter --name /jyt/prod/STRIPE_PUBLISHABLE_KEY --with-decryption --query Parameter.Value --output text)"
export MEDUSA_CLOUD_S3_HOSTNAME="${MEDUSA_CLOUD_S3_HOSTNAME:-automatic.jaalyantra.com}"
export MEDUSA_CLOUD_S3_PATHNAME="${MEDUSA_CLOUD_S3_PATHNAME:-/automatica/**}"
export NODE_OPTIONS="--max-old-space-size=6144"

echo "▶ [1/4] copy storefront OUT of the workspace → $BUILD_DIR"
rm -rf "$BUILD_DIR"; mkdir -p "$BUILD_DIR"
rsync -a --exclude node_modules --exclude .next --exclude .open-next --exclude .git \
  "$SRC/" "$BUILD_DIR/"
cd "$BUILD_DIR"

echo "▶ [2/4] standalone install (own lockfile, --ignore-workspace)"
pnpm install --ignore-workspace --no-frozen-lockfile

echo "▶ [3/4] opennext build  (stripe ${NEXT_PUBLIC_STRIPE_KEY:0:8}…  s3=$MEDUSA_CLOUD_S3_HOSTNAME  mt=$NEXT_PUBLIC_MULTI_TENANT)"
pnpm exec opennextjs-cloudflare build

echo "▶ [4/4] deploy"
pnpm exec opennextjs-cloudflare deploy

cat <<'NOTE'

✔ deployed nextjs-starter-medusa

RUNTIME SECRET (one-time, server-read → NOT baked into the bundle):
  aws ssm get-parameter --name /jyt/prod/STOREFRONT_REVALIDATE_SECRET \
    --with-decryption --query Parameter.Value --output text \
  | pnpm exec wrangler secret put STOREFRONT_REVALIDATE_SECRET --name nextjs-starter-medusa

SMOKE:
  curl -s -o /dev/null -w '%{http_code}\n' https://nextjs-starter-medusa.saranshis.workers.dev/
  # 404 + "No storefront here" HTML at the bare workers.dev host is CORRECT
  # (no tenant maps to it); a real tenant Host resolves via /web/storefront/resolve.
NOTE
