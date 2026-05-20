#!/usr/bin/env bash
# Cloudflare Worker secrets for the JYT Medusa backend.
#
# This file lists every `wrangler secret put` call needed for a working
# deployment. It contains NO secret values — wrangler prompts for each one
# interactively. Run it once per CF environment (staging / production).
#
# Prereqs:
#   - `wrangler login` complete
#   - Working directory: repo root (so wrangler.toml is resolvable)
#
# Source the actual values from:
#   - apps/backend/.env.railway.server  (server-side secrets)
#   - apps/backend/.env.railway.worker  (worker-side secrets)
#   - Cloudflare R2 dashboard          (S3_* values — new for CF)
#   - Upstash Redis dashboard          (REDIS_URL — new for CF)
#
# Usage:
#   bash deploy/cloudflare/secrets.example.sh
#
set -euo pipefail

cd "$(dirname "$0")/../.."   # repo root

echo "Setting Cloudflare Worker secrets for medusa-router…"
echo "You'll be prompted for each value. Cmd-C aborts."
echo

# ─── Connection strings ────────────────────────────────────────────────────
wrangler secret put DATABASE_URL          # postgres://...@railway/db
wrangler secret put REDIS_URL             # rediss://default:...@<id>.upstash.io:6379

# ─── Auth / session ────────────────────────────────────────────────────────
wrangler secret put JWT_SECRET
wrangler secret put COOKIE_SECRET

# ─── R2 (S3-compatible file storage) ───────────────────────────────────────
wrangler secret put S3_ACCESS_KEY_ID      # R2 API token access key
wrangler secret put S3_SECRET_ACCESS_KEY  # R2 API token secret
wrangler secret put S3_BUCKET             # bucket name (e.g. jyt-uploads-prod)
wrangler secret put S3_ENDPOINT           # https://<account_id>.r2.cloudflarestorage.com
wrangler secret put S3_FILE_URL           # public-facing URL for served files

# ─── Public URLs / CORS ────────────────────────────────────────────────────
wrangler secret put MEDUSA_BACKEND_URL    # https://api.jaalyantra.in (or workers.dev URL in staging)
wrangler secret put STORE_CORS            # comma-separated storefront origins
wrangler secret put ADMIN_CORS            # comma-separated admin origins
wrangler secret put AUTH_CORS             # comma-separated auth origins

# ─── Observability ─────────────────────────────────────────────────────────
wrangler secret put SENTRY_DSN

# ─── Anything in .env.railway.server / .env.railway.worker NOT listed above ──
# Walk both files and add corresponding `wrangler secret put X` lines here.
# Then mirror the new var into deploy/cloudflare/src/containers.ts under the
# right Container class's envVars, and into the Env type in worker.ts.

echo
echo "Done. Verify with: wrangler secret list"
