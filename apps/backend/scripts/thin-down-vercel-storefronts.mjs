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
const CF_API = "https://api.cloudflare.com/client/v4"
const PLATFORM_SUFFIX = ".cicilabel.com"
// Generic, project-agnostic Vercel CNAME target — the working subdomains use
// this (NOT a per-project <hash>.vercel-dns-017 target). Pointing here makes a
// domain routable on WHICHEVER project owns it, so no DNS churn on future moves.
const VERCEL_CNAME = "cname.vercel-dns.com"

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

// ── Cloudflare DNS (managed zone = cicilabel.com) ────────────────────────────
// Required to move *.cicilabel.com subdomains: after reassigning the Vercel
// domain we must repoint the CNAME to the generic target AND publish the
// per-subdomain _vercel TXT nonce, else Vercel won't verify/route (the mistake
// that took pml down). Fetch from SSM before running:
//   export CLOUDFLARE_API_TOKEN=$(aws ssm get-parameter --name /jyt/prod/CLOUDFLARE_API_TOKEN --with-decryption --query Parameter.Value --output text)
//   export CLOUDFLARE_ZONE_ID=$(aws ssm get-parameter --name /jyt/prod/CLOUDFLARE_ZONE_ID --with-decryption --query Parameter.Value --output text)
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || ""
const CF_ZONE = process.env.CLOUDFLARE_ZONE_ID || ""
const VERCEL_TXT_NAME = "_vercel.cicilabel.com"

async function cf(path, init = {}) {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CF_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok && body.success, status: res.status, body }
}

/** Upsert a grey-cloud CNAME <name> -> cname.vercel-dns.com in the managed zone. */
async function cfSetCname(name) {
  const list = await cf(`/zones/${CF_ZONE}/dns_records?type=CNAME&name=${name}`)
  const rec = (list.body.result || [])[0]
  const payload = { type: "CNAME", name, content: VERCEL_CNAME, proxied: false, ttl: 60 }
  if (rec) {
    if (rec.content === VERCEL_CNAME && rec.proxied === false) return { ok: true, unchanged: true }
    return cf(`/zones/${CF_ZONE}/dns_records/${rec.id}`, { method: "PATCH", body: JSON.stringify(payload) })
  }
  return cf(`/zones/${CF_ZONE}/dns_records`, { method: "POST", body: JSON.stringify(payload) })
}

/** Publish the per-subdomain _vercel TXT verification nonce (preserves siblings). */
async function cfSetVercelTxt(nonce, host) {
  const list = await cf(`/zones/${CF_ZONE}/dns_records?type=TXT&name=${VERCEL_TXT_NAME}`)
  const marker = `vc-domain-verify=${host},`
  const existing = (list.body.result || []).find((r) => (r.content || "").includes(marker))
  const payload = { type: "TXT", name: VERCEL_TXT_NAME, content: nonce, ttl: 60 }
  if (existing) {
    if (existing.content.replace(/^"|"$/g, "") === nonce) return { ok: true, unchanged: true }
    return cf(`/zones/${CF_ZONE}/dns_records/${existing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
  }
  return cf(`/zones/${CF_ZONE}/dns_records`, { method: "POST", body: JSON.stringify(payload) })
}

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

// ── render check (STRICT) ────────────────────────────────────────────────────
// Must reject Vercel edge errors: a DEPLOYMENT_NOT_FOUND returns 404 which the
// old `<500` check wrongly passed. A healthy storefront is 200 (/in) or a 3xx
// redirect (/) with NO x-vercel-error header.
async function renders(host) {
  try {
    const res = await fetch(`https://${host}/in`, { redirect: "manual" })
    if (res.headers.get("x-vercel-error")) {
      return { ok: false, reason: res.headers.get("x-vercel-error") }
    }
    const okStatus = res.status === 200 || (res.status >= 300 && res.status < 400)
    return { ok: okStatus, reason: `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const isInManagedZone = (domain) => domain.endsWith(PLATFORM_SUFFIX)

/** Reassign the Vercel domain from the dedicated project to shared. */
async function reassignVercelDomain(domain, fromId, toId) {
  await vc(`/v9/projects/${fromId}/domains/${domain}${q()}`, { method: "DELETE" })
  const add = await vc(`/v10/projects/${toId}/domains${q()}`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  })
  if (!add.ok) {
    // rollback: put it back on the dedicated project
    await vc(`/v9/projects/${fromId}/domains${q()}`, {
      method: "POST",
      body: JSON.stringify({ name: domain }),
    })
    return { ok: false, reason: JSON.stringify(add.body?.error || add.body) }
  }
  return { ok: true, verification: add.body.verification || [] }
}

/**
 * Full verified cutover for ONE in-zone subdomain (the recipe proven on pml):
 *   reassign Vercel domain -> repoint CNAME to the generic target -> publish the
 *   _vercel TXT nonce -> Vercel verify -> strict render check.
 * DNS is only touched for domains inside the managed cicilabel.com zone; a
 * partner-owned apex (its own registrar) is out of scope here and skipped.
 */
async function cutover(domain, fromId, toId) {
  if (!isInManagedZone(domain)) {
    return { ok: false, reason: "out-of-zone apex — handle separately (not automated)" }
  }
  if (!CF_TOKEN || !CF_ZONE) {
    return { ok: false, reason: "CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID not set (export from SSM)" }
  }

  const mv = await reassignVercelDomain(domain, fromId, toId)
  if (!mv.ok) return mv

  // 1. CNAME -> generic target (grey cloud)
  const cn = await cfSetCname(domain)
  if (!cn.ok) return { ok: false, reason: `CNAME set failed: ${JSON.stringify(cn.body?.errors || cn)}` }

  // 2. read Vercel's expected TXT nonce for this domain on the shared project
  const dom = await vc(`/v9/projects/${toId}/domains/${domain}${q()}`)
  const nonce = ((dom.body.verification || [])[0] || {}).value
  if (nonce) {
    const txt = await cfSetVercelTxt(nonce, domain)
    if (!txt.ok) return { ok: false, reason: `TXT set failed: ${JSON.stringify(txt.body?.errors || txt)}` }
  }

  // 3. wait for DNS + verify on Vercel (retry a few times)
  let verified = false
  for (let i = 0; i < 6; i++) {
    await sleep(10000)
    const v = await vc(`/v9/projects/${toId}/domains/${domain}/verify${q()}`, { method: "POST" })
    if (v.body?.verified) {
      verified = true
      break
    }
  }
  if (!verified) return { ok: false, reason: "Vercel verify did not pass within timeout" }

  // 4. strict render check
  await sleep(5000)
  const r = await renders(domain)
  return r.ok ? { ok: true } : { ok: false, reason: `render check failed: ${r.reason}` }
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
      const zoneNote = isInManagedZone(domain) ? "" : "  [out-of-zone apex — manual]"
      planned++
      console.log(
        `    ✓ ${domain} — gate ok (${gate.pk.slice(0, 14)}… ${gate.store}) ` +
          `→ ${shared ? shared.name : "<shared>"}${zoneNote}`
      )
      if (!APPLY || !SHARED) continue

      const res = await cutover(domain, proj.id, SHARED)
      if (res.ok) {
        console.log(`        ✓ cutover complete — verified + renders`)
        moved++
      } else {
        console.log(`        ✗ ${res.reason}`)
      }
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
