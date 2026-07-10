#!/usr/bin/env bash
# Local dev bench for the Faire plugin.
#
# Rebuilds the plugin from local source and overlays the built `.medusa/server`
# into the npm-resolved package inside apps/backend's node_modules, so the
# running backend executes LOCAL plugin source WITHOUT changing any committed
# dependency (apps/backend still declares "latest"). This avoids the pnpm
# dep-duplication crash you'd get from repointing the whole package symlink
# (duplicate @medusajs/core-flows → "workflow already exists").
#
# Usage:
#   scripts/faire-bench.sh          # build + overlay (then restart `pnpm dev`)
#
# To revert to the published package: `pnpm install` (restores the symlink/copy).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/packages/medusa-plugin-faire-store-sync"

echo "▸ Building plugin from local source…"
( cd "$PLUGIN" && pnpm build >/dev/null )

# Resolve the EXACT package dir apps/backend loads (there may be several
# versions under .pnpm — overlay the one actually in use, not just the first).
PKG=$(cd "$ROOT/apps/backend" && node -e \
  "console.log(require('path').dirname(require.resolve('@jytextiles/medusa-plugin-faire-store-sync/package.json')))")
if [ ! -d "$PKG" ]; then
  echo "✖ Could not resolve the Faire package from apps/backend — run 'pnpm install' first." >&2
  exit 1
fi

echo "▸ Overlaying build into: ${PKG#$ROOT/}"
rm -rf "$PKG/.medusa"
cp -R "$PLUGIN/.medusa" "$PKG/.medusa"

echo "✔ Bench synced. Restart the backend (pnpm dev) to load the new build."
