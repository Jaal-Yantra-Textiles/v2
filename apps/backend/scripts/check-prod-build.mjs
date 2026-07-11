#!/usr/bin/env node
/**
 * Prod-parity build check (run BEFORE pushing).
 *
 * Reproduces what the AWS ECS Dockerfile does — build the backend against
 * `medusa-config.prod.ts` — so a build that is green locally with the dev config
 * but RED in CI with the prod config is caught here instead of on `main`.
 *
 * This is the check that would have caught the 2026-07-11 failure: the dev-config
 * `medusa build` passed, but the prod-config build (Dockerfile does
 * `cp medusa-config.prod.ts medusa-config.ts`) failed. It also raises the Node
 * heap so the workflow-schema scan doesn't OOM (SIGABRT / exit 134).
 *
 * It swaps medusa-config.prod.ts over medusa-config.ts, runs the real build, and
 * ALWAYS restores the original config (even on failure / Ctrl-C).
 *
 *   node ./scripts/check-prod-build.mjs        # or: pnpm check:prod-build
 */
import { execSync } from "node:child_process"
import { copyFileSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..")
const devConfig = join(backendDir, "medusa-config.ts")
const prodConfig = join(backendDir, "medusa-config.prod.ts")

if (!existsSync(prodConfig)) {
  console.error("✗ medusa-config.prod.ts not found — cannot run prod-parity build.")
  process.exit(1)
}

const original = readFileSync(devConfig)
let restored = false
const restore = () => {
  if (restored) return
  writeFileSync(devConfig, original)
  restored = true
}
// Restore on any exit path, including SIGINT/SIGTERM.
process.on("exit", restore)
process.on("SIGINT", () => { restore(); process.exit(130) })
process.on("SIGTERM", () => { restore(); process.exit(143) })

try {
  console.log("→ Building with medusa-config.prod.ts (mirrors the ECS Dockerfile)…")
  copyFileSync(prodConfig, devConfig)
  execSync("pnpm run build", {
    cwd: backendDir,
    stdio: "inherit",
    // Same heap headroom the Dockerfile sets — the schema scan + tsc otherwise
    // OOM past Node's ~2GB default old-space.
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=6144" },
  })
  restore()
  console.log("\n✓ Prod-config build passed.")
} catch (e) {
  restore()
  console.error("\n✗ Prod-config build FAILED — this is what CI/ECS will hit. Fix before pushing.")
  process.exit(1)
}
