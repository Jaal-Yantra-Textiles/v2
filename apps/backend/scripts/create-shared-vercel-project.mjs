#!/usr/bin/env node
/**
 * create-shared-vercel-project.mjs
 *
 * Stand up the ONE shared multi-tenant Vercel storefront project that the
 * legacy per-partner projects get thinned down onto. Idempotent-ish: if the
 * project already exists it reuses it and only reconciles env/deploy.
 *
 *   1. Create project `storefront-shared` linked to the storefront GitHub repo
 *      (same repo/branch/framework/install-cmd as the existing storefronts).
 *   2. Build ONLY the production branch (ignore-step), like the per-partner ones.
 *   3. Copy the shared env vars from a source project (default storefront-pml)
 *      EXCEPT the per-tenant NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY, and add
 *      NEXT_PUBLIC_MULTI_TENANT=true. Secret VALUES are copied programmatically
 *      and never printed.
 *   4. Trigger a production deployment from `main`.
 *
 * Does NOT add any custom domain or move any live tenant — that's the gated
 * thin-down step. Prints the new project id to set as VERCEL_SHARED_PROJECT_ID.
 *
 * Usage: node scripts/create-shared-vercel-project.mjs [--source storefront-pml] [--name storefront-shared] [--no-deploy]
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const VERCEL_API = "https://api.vercel.com"

const args = process.argv.slice(2)
const val = (f, d) => {
  const i = args.indexOf(f)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
const NAME = val("--name", "storefront-shared")
const SOURCE = val("--source", "storefront-pml")
const NO_DEPLOY = args.includes("--no-deploy")
const TEAM = val("--team", "team_pqAtvcBteqeMkeyM3AGJyPhK")
const BRANCH = "main"

function readEnvToken() {
  if (process.env.VERCEL_STOREFRONT_FIX) return process.env.VERCEL_STOREFRONT_FIX
  const env = readFileSync(join(__dirname, "..", ".env"), "utf8")
  const line = env.split("\n").find((l) => l.startsWith("VERCEL_STOREFRONT_FIX="))
  return line ? line.slice("VERCEL_STOREFRONT_FIX=".length).trim().replace(/^["']|["']$/g, "") : null
}
const TOKEN = readEnvToken()
if (!TOKEN) {
  console.error("✗ VERCEL_STOREFRONT_FIX token not found")
  process.exit(1)
}

const q = (extra = "") => `?teamId=${TEAM}${extra}`
async function vc(path, init = {}) {
  const res = await fetch(`${VERCEL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

// Per-tenant key — resolved at runtime in multi-tenant mode, must NOT be baked.
const SKIP_ENV = new Set(["NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY"])

async function main() {
  const projects = (await vc(`/v9/projects${q("&limit=100")}`)).body.projects || []
  const source = projects.find((p) => p.name === SOURCE)
  if (!source) {
    console.error(`✗ source project "${SOURCE}" not found`)
    process.exit(1)
  }
  const link = source.link || {}
  const repo = `${link.org}/${link.repo}`
  console.log(`source: ${source.name}  repo: ${repo}@${BRANCH}  framework: ${source.framework}`)

  // 1. create (or reuse) the shared project
  let shared = projects.find((p) => p.name === NAME)
  if (shared) {
    console.log(`↺ project "${NAME}" already exists (${shared.id}) — reusing`)
  } else {
    const create = await vc(`/v11/projects${q()}`, {
      method: "POST",
      body: JSON.stringify({
        name: NAME,
        framework: source.framework || "nextjs",
        gitRepository: { type: "github", repo },
        installCommand: source.installCommand || "pnpm install --no-frozen-lockfile",
      }),
    })
    if (!create.ok) {
      console.error(`✗ create failed (${create.status}):`, JSON.stringify(create.body?.error || create.body))
      process.exit(1)
    }
    shared = create.body
    console.log(`✓ created ${NAME} (${shared.id})`)
  }

  // 2. build only the production branch (mirror the per-partner ignore step)
  const ignore = `if [ "$VERCEL_GIT_COMMIT_REF" = "${BRANCH}" ]; then exit 1; else exit 0; fi`
  await vc(`/v9/projects/${shared.id}${q()}`, {
    method: "PATCH",
    body: JSON.stringify({ commandForIgnoringBuildStep: ignore }),
  })
  console.log(`✓ ignore-build-step set (build only ${BRANCH})`)

  // 3. copy shared env from source (decrypt) -> shared (never printed), skip pk, add MT flag
  const srcEnv = (await vc(`/v9/projects/${source.id}/env${q("&decrypt=true")}`)).body.envs || []
  const existing = new Set(
    ((await vc(`/v9/projects/${shared.id}/env${q()}`)).body.envs || []).map((e) => e.key)
  )
  let copied = 0
  for (const e of srcEnv) {
    if (SKIP_ENV.has(e.key) || existing.has(e.key)) continue
    const up = await vc(`/v10/projects/${shared.id}/env${q("&upsert=true")}`, {
      method: "POST",
      body: JSON.stringify({
        key: e.key,
        value: e.value,
        type: "plain",
        target: e.target || ["production", "preview"],
      }),
    })
    if (up.ok) copied++
    else console.log(`  ⚠ env ${e.key} failed: ${JSON.stringify(up.body?.error || up.body)}`)
  }
  // multi-tenant switch
  if (!existing.has("NEXT_PUBLIC_MULTI_TENANT")) {
    await vc(`/v10/projects/${shared.id}/env${q("&upsert=true")}`, {
      method: "POST",
      body: JSON.stringify({
        key: "NEXT_PUBLIC_MULTI_TENANT",
        value: "true",
        type: "plain",
        target: ["production", "preview"],
      }),
    })
  }
  console.log(`✓ env: copied ${copied} shared var(s) (pk skipped), NEXT_PUBLIC_MULTI_TENANT=true`)

  // 4. trigger a production deployment from main
  if (!NO_DEPLOY) {
    const dep = await vc(`/v13/deployments${q("&forceNew=1&skipAutoDetectionConfirmation=1")}`, {
      method: "POST",
      body: JSON.stringify({
        name: NAME,
        project: shared.id,
        target: "production",
        gitSource: { type: "github", ref: BRANCH, repoId: link.repoId },
      }),
    })
    if (dep.ok) {
      console.log(`✓ deployment queued: ${dep.body.url || dep.body.id} (state ${dep.body.readyState || dep.body.status})`)
    } else {
      console.log(`⚠ deploy trigger failed (${dep.status}): ${JSON.stringify(dep.body?.error || dep.body)}`)
      console.log("  (a git push to main will also build it)")
    }
  }

  console.log(`\n=== DONE ===`)
  console.log(`shared project id: ${shared.id}`)
  console.log(`Set in apps/backend/.env:  VERCEL_SHARED_PROJECT_ID=${shared.id}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
