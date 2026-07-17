#!/usr/bin/env node
/**
 * delete-idle-storefronts.mjs
 *
 * Delete the per-partner Vercel storefront projects that were thinned down onto
 * `storefront-shared`. Safety-gated: only deletes a `storefront-*` project that
 * has ZERO custom domains (all `.vercel.app` internal aliases are ignored) and
 * is NOT the shared project. Anything still holding a custom domain is SKIPPED —
 * that would mean the partner wasn't migrated.
 *
 * PRECONDITION: run the `repoint-partner-storefront-shared` ops job first so no
 * partner record still points deployment_project_id at a project being deleted
 * (else the partner status page's getProject-404 handler wipes storefront_domain).
 *
 * Usage:
 *   node scripts/delete-idle-storefronts.mjs            # dry-run (lists targets)
 *   node scripts/delete-idle-storefronts.mjs --confirm  # actually delete
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const VERCEL_API = "https://api.vercel.com"
const TEAM = "team_pqAtvcBteqeMkeyM3AGJyPhK"
const SHARED = process.env.VERCEL_SHARED_PROJECT_ID || "prj_0ilDYOzSHLhviU9OLnnvJl0b0BbJ"
const CONFIRM = process.argv.includes("--confirm")

function token() {
  if (process.env.VERCEL_STOREFRONT_FIX) return process.env.VERCEL_STOREFRONT_FIX
  const env = readFileSync(join(__dirname, "..", ".env"), "utf8")
  const line = env.split("\n").find((l) => l.startsWith("VERCEL_STOREFRONT_FIX="))
  return line ? line.slice("VERCEL_STOREFRONT_FIX=".length).trim().replace(/^["']|["']$/g, "") : null
}
const TOKEN = token()
const q = `?teamId=${TEAM}`
async function vc(path, init = {}) {
  const res = await fetch(`${VERCEL_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) },
  })
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) }
}

async function main() {
  console.log(`\n=== delete idle storefronts (${CONFIRM ? "CONFIRM" : "DRY-RUN"}) ===`)
  console.log(`keeping shared: ${SHARED}\n`)
  const projects = (await vc(`/v9/projects${q}&limit=100`)).body.projects || []
  const targets = projects.filter((p) => p.name.startsWith("storefront-") && p.id !== SHARED)

  let deleted = 0, skipped = 0
  for (const p of targets) {
    const domains = (await vc(`/v9/projects/${p.id}/domains${q}&limit=100`)).body.domains || []
    const custom = domains.filter((d) => !d.name.endsWith(".vercel.app")).map((d) => d.name)
    if (custom.length) {
      console.log(`  SKIP  ${p.name} — still has ${custom.length} custom domain(s): ${custom.join(", ")}`)
      skipped++
      continue
    }
    if (!CONFIRM) {
      console.log(`  would delete  ${p.name}  (${p.id})`)
      continue
    }
    const del = await vc(`/v9/projects/${p.id}${q}`, { method: "DELETE" })
    console.log(`  ${del.ok || del.status === 204 ? "deleted" : "FAILED " + del.status}  ${p.name}`)
    if (del.ok || del.status === 204) deleted++
  }

  console.log(
    CONFIRM
      ? `\n=== deleted ${deleted}, skipped ${skipped} (non-empty) ===`
      : `\n(dry-run — ${targets.length - skipped} would be deleted, ${skipped} skipped; re-run with --confirm)`
  )
}
main().catch((e) => { console.error(e); process.exit(1) })
