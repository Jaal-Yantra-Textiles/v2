#!/usr/bin/env node
/**
 * thin-down-vercel-storefronts.mjs
 *
 * Migrate the legacy per-partner Vercel storefront projects onto ONE shared
 * multi-tenant Vercel project by REASSIGNING their custom domains. No redeploy,
 * no env changes — Vercel routes a domain to whichever project owns it, and the
 * shared project resolves the tenant at runtime via /web/storefront/resolve.
 *
 * Safety model (why this is non-destructive):
 *   - DNS never changes (both dedicated + shared live on the same Vercel team).
 *   - A domain is only moved AFTER the resolve gate confirms the backend already
 *     maps that host -> the correct publishable key (identical render).
 *   - The dedicated project is left ALIVE (idle) — rollback = re-add the domain.
 *   - Default is --dry-run: prints the plan and runs the resolve gate only.
 *
 * The partner-record column flip (deployment_project_id -> shared) is NOT done
 * here — prod DB is VPC-locked from a laptop. This script prints the exact
 * per-partner payload to apply via the admin API / an ECS-run DP job afterwards.
 * Rendering does NOT depend on that column; it's bookkeeping for the admin UI
 * and future domain ops.
 *
 * Usage:
 *   node scripts/thin-down-vercel-storefronts.mjs                 # dry-run, all
 *   node scripts/thin-down-vercel-storefronts.mjs --only pml      # dry-run, one
 *   node scripts/thin-down-vercel-storefronts.mjs --only pml --apply
 *   node scripts/thin-down-vercel-storefronts.mjs --use-wildcard  # leave *.cicilabel.com for the shared wildcard
 *
 * Env / flags:
 *   VERCEL_STOREFRONT_FIX  (from apps/backend/.env)   Vercel API token
 *   --team   <id>          (default team_pqAtvcBteqeMkeyM3AGJyPhK)
 *   --shared <id|name>     shared project (default env VERCEL_SHARED_PROJECT_ID)
 *   --backend <url>        resolve gate host (default https://v3.jaalyantra.com)
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const VERCEL_API = "https://api.vercel.com"
const PLATFORM_SUFFIX = ".cicilabel.com"

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f, d) => {
  const i = args.indexOf(f)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
const APPLY = has("--apply")
const USE_WILDCARD = has("--use-wildcard")
const ONLY = (val("--only", "") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
const TEAM = val("--team", "team_pqAtvcBteqeMkeyM3AGJyPhK")
const BACKEND = val("--backend", "https://v3.jaalyantra.com").replace(/\/$/, "")

// ── token (from apps/backend/.env) ───────────────────────────────────────────
function readEnvToken() {
  if (process.env.VERCEL_STOREFRONT_FIX) return process.env.VERCEL_STOREFRONT_FIX
  try {
    const env = readFileSync(join(__dirname, "..", ".env"), "utf8")
    const line = env.split("\n").find((l) => l.startsWith("VERCEL_STOREFRONT_FIX="))
    if (line) return line.slice("VERCEL_STOREFRONT_FIX=".length).trim().replace(/^["']|["']$/g, "")
  } catch {
    /* ignore */
  }
  return null
}
const TOKEN = readEnvToken()
if (!TOKEN) {
  console.error("✗ VERCEL_STOREFRONT_FIX token not found (env or apps/backend/.env)")
  process.exit(1)
}
let SHARED = val("--shared", process.env.VERCEL_SHARED_PROJECT_ID || "")

// ── vercel api helpers ───────────────────────────────────────────────────────
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
const listProjects = async () =>
  (await vc(`/v9/projects${q("&limit=100")}`)).body.projects || []
const listDomains = async (projectId) =>
  (await vc(`/v9/projects/${projectId}/domains${q("&limit=100")}`)).body.domains || []

// ── resolve gate (backend host -> pk) ────────────────────────────────────────
async function resolveGate(host) {
  try {
    const res = await fetch(`${BACKEND}/web/storefront/resolve?host=${encodeURIComponent(host)}`)
    if (!res.ok) return { ok: false, reason: `resolve ${res.status}` }
    const d = await res.json()
    const pk = d.publishable_key || d.publishableKey
    if (!pk) return { ok: false, reason: "no publishable_key" }
    return { ok: true, pk, store: (d.store && d.store.name) || "" }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}

// ── render check ─────────────────────────────────────────────────────────────
async function renders(host) {
  try {
    const res = await fetch(`https://${host}/`, { redirect: "manual" })
    return res.status < 500 // 200 / 3xx redirect to /<cc> both fine
  } catch {
    return false
  }
}

// ── domain move (remove from dedicated -> add to shared, with rollback) ───────
async function moveDomain(domain, fromId, toId) {
  const add = await vc(`/v10/projects/${toId}/domains${q()}`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  })
  // Vercel refuses a domain already owned by another project on the same team,
  // so remove from the dedicated project first, then add to shared.
  if (!add.ok && add.body?.error?.code === "domain_already_in_use") {
    await vc(`/v9/projects/${fromId}/domains/${domain}${q()}`, { method: "DELETE" })
    const retry = await vc(`/v10/projects/${toId}/domains${q()}`, {
      method: "POST",
      body: JSON.stringify({ name: domain }),
    })
    if (!retry.ok) {
      // rollback: put it back on the dedicated project
      await vc(`/v9/projects/${fromId}/domains${q()}`, {
        method: "POST",
        body: JSON.stringify({ name: domain }),
      })
      return { ok: false, reason: JSON.stringify(retry.body?.error || retry.body) }
    }
    return { ok: true }
  }
  if (!add.ok) return { ok: false, reason: JSON.stringify(add.body?.error || add.body) }
  return { ok: true }
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Vercel storefront thin-down (${APPLY ? "APPLY" : "DRY-RUN"}) ===`)
  console.log(`team=${TEAM}  backend=${BACKEND}  wildcard-mode=${USE_WILDCARD}`)

  const projects = await listProjects()
  const shared = projects.find((p) => p.id === SHARED || p.name === SHARED)
  if (SHARED && !shared) {
    console.error(`\n✗ shared project "${SHARED}" not found on the team. Create it first.`)
    process.exit(1)
  }
  if (!SHARED) {
    console.warn(
      "\n⚠ No --shared / VERCEL_SHARED_PROJECT_ID set. Running the resolve gate only " +
        "(no target to move onto). Set it once the shared multi-tenant project exists.\n"
    )
  } else {
    SHARED = shared.id
    console.log(`shared project: ${shared.name} (${shared.id})`)
  }

  const dedicated = projects.filter(
    (p) => p.id !== SHARED && p.name.startsWith("storefront-")
  )
  const targets = ONLY.length
    ? dedicated.filter((p) => ONLY.some((h) => p.name === `storefront-${h}`))
    : dedicated

  let planned = 0
  let moved = 0
  const recordPayloads = []

  for (const proj of targets) {
    const handle = proj.name.replace(/^storefront-/, "")
    const domains = (await listDomains(proj.id)).map((d) => d.name)
    const custom = domains.filter((d) => !d.endsWith(".vercel.app"))
    const toMove = USE_WILDCARD
      ? custom.filter((d) => !d.endsWith(PLATFORM_SUFFIX)) // wildcard catches *.cicilabel.com
      : custom

    if (!toMove.length) {
      console.log(`\n• ${proj.name} — no custom domains to move (skip)`)
      continue
    }
    console.log(`\n• ${proj.name}  (${proj.id})`)

    for (const domain of toMove) {
      const gate = await resolveGate(domain)
      if (!gate.ok) {
        console.log(`    ✗ ${domain} — resolve gate FAILED (${gate.reason}) → SKIP`)
        continue
      }
      planned++
      console.log(
        `    ✓ ${domain} — gate ok (${gate.pk.slice(0, 14)}… ${gate.store}) ` +
          `→ move to ${shared ? shared.name : "<shared>"}`
      )
      if (!APPLY || !SHARED) continue

      const mv = await moveDomain(domain, proj.id, SHARED)
      if (!mv.ok) {
        console.log(`        ✗ move failed: ${mv.reason}`)
        continue
      }
      const rendered = await renders(domain)
      console.log(`        → moved; render check: ${rendered ? "200/redirect OK" : "⚠ 5xx — investigate"}`)
      moved++
    }

    recordPayloads.push({
      handle,
      from_project: proj.id,
      set: {
        hosting_provider: "vercel",
        deployment_project_id: SHARED || "<shared-id>",
        deployment_project_name: shared ? shared.name : "<shared-name>",
        vercel_project_id: SHARED || "<shared-id>",
        vercel_project_name: shared ? shared.name : "<shared-name>",
      },
    })
  }

  console.log(`\n=== summary: ${planned} domain(s) eligible, ${moved} moved ===`)
  if (!APPLY) console.log("(dry-run — re-run with --apply to perform the moves)")
  console.log(
    "\n── record-update payloads (apply via admin API / DP job after cutover) ──"
  )
  console.log(JSON.stringify(recordPayloads, null, 2))
  console.log(
    "\nRollback for any partner: re-add its domain(s) to the dedicated project " +
      "(kept alive). Delete dedicated projects only after a healthy grace period."
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
