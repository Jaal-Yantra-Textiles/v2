#!/usr/bin/env bash
# Build and start the partner storefront (apps/storefront-starter, Next 16) on
# :8000 against the local e2e backend, as the tenant e2e-storefront-seed.ts
# created. Used as a Playwright webServer by playwright.storefront.config.ts
# (E2E_LOCAL_STACK=1), which starts the backend first.
#
# Single-tenant on purpose: the publishable key is baked in at BUILD time
# (NEXT_PUBLIC_*), which is why this builds here, after the seed, and not in
# an earlier workflow step. The tenant's website row is found by the request
# host with the port stripped, so http://localhost:8000 resolves to the row
# for domain `localhost`.
#
# `STOREFRONT_SKIP_BUILD=1` reuses an existing .next build (local reruns).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SEED_FILE="$ROOT/apps/backend/.e2e-seed.storefront.json"
BACKEND_URL="${E2E_BACKEND_URL:-http://localhost:${E2E_BACKEND_PORT:-9000}}"

if [ ! -f "$SEED_FILE" ]; then
  echo "start-storefront: $SEED_FILE is missing. Run 'pnpm e2e:seed:storefront' in apps/backend first." >&2
  exit 1
fi
if [ ! -f "$ROOT/apps/storefront-starter/package.json" ]; then
  echo "start-storefront: apps/storefront-starter is empty. Run 'git submodule update --init apps/storefront-starter'." >&2
  exit 1
fi

KEY="$(node -e 'process.stdout.write(require(process.argv[1]).publishableKey)' "$SEED_FILE")"

export MEDUSA_BACKEND_URL="$BACKEND_URL"
export NEXT_PUBLIC_MEDUSA_BACKEND_URL="$BACKEND_URL"
export NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY="$KEY"
export NEXT_PUBLIC_BASE_URL="http://localhost:8000"
export NEXT_PUBLIC_DEFAULT_REGION="in"
export NEXT_TELEMETRY_DISABLED=1
# The Playwright job runs with NODE_ENV=test; Next must build and serve as
# production or it refuses ("non-standard NODE_ENV") and behaves unlike prod.
export NODE_ENV=production

cd "$ROOT"
if [ "${STOREFRONT_SKIP_BUILD:-}" != "1" ]; then
  pnpm --filter @jyt/storefront-starter build
fi
exec pnpm --filter @jyt/storefront-starter start
