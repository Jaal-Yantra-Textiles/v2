#!/usr/bin/env node
/**
 * migrate-apex-to-shared.mjs
 *
 * Flip a partner-owned APEX storefront (apex + www) from its dedicated Vercel
 * project onto the shared multi-tenant project — with NO DNS change.
 *
 * Why flip-only works (proven on ielocraft/aurumkashmir/perennial):
 *   - Partner apexes are NOT claimed on another Vercel account, so a fresh add
 *     verifies via the A/CNAME alone — no `_vercel` TXT (unlike cicilabel.com
 *     subdomains, whose apex IS on another account → TXT required).
 *   - Vercel's per-project `<hash>.vercel-dns-017` CNAME targets are anycast
 *     that route by Host, so the domain resolves to WHICHEVER project owns it —
 *     the stale per-project CNAME keeps working after the flip.
 *
 * So this only reassigns the Vercel domains, preserving the apex↔www redirect.
 * The partner's `<handle>.cicilabel.com` subdomain is NOT handled here — that one
 * lives in a zone we own and DOES need the TXT/CNAME dance → use
 * thin-down-vercel-storefronts.mjs for it.
 *
 * Ordering matters (learned the hard way): the redirect SOURCE must be removed
 * from the dedicated project before its target (else "domain used as redirect
 * target" 409), and the redirect TARGET must exist on the shared project before
 * re-adding the source with its redirect.
 *
 * Usage:
 *   node scripts/migrate-apex-to-shared.mjs --apex perennial.to --dedicated prj_xxx --shared prj_yyy [--dry-run]
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
const APEX = val("--apex", "")
const DEDICATED = val("--dedicated", "")
const SHARED = val("--shared", process.env.VERCEL_SHARED_PROJECT_ID || "")
const TEAM = val("--team", "team_pqAtvcBteqeMkeyM3AGJyPhK")
const DRY = args.includes("--dry-run")
if (!APEX || !DEDICATED || !SHARED) {
  console.error("usage: --apex <domain> --dedicated <projectId> --shared <projectId> [--dry-run]")
  process.exit(1)
}
const WWW = `www.${APEX}`

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
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) },
  })
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) }
}
const getDomain = async (pid, d) => (await vc(`/v9/projects/${pid}/domains/${d}${q}`)).body
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function renders(host) {
  const res = await fetch(`https://${host}/in`, { redirect: "manual" }).catch(() => null)
  if (!res) return { ok: false, reason: "fetch failed" }
  if (res.headers.get("x-vercel-error")) return { ok: false, reason: res.headers.get("x-vercel-error") }
  const ok = res.status === 200 || (res.status >= 300 && res.status < 400)
  return { ok, reason: `HTTP ${res.status}` }
}

async function main() {
  console.log(`\n=== apex flip ${APEX} → shared (${DRY ? "DRY-RUN" : "APPLY"}) ===`)

  // Read redirect direction from the dedicated project (default: apex → www).
  const apexDom = await getDomain(DEDICATED, APEX)
  const wwwDom = await getDomain(DEDICATED, WWW)
  const apexRedirects = apexDom?.redirect || null
  const wwwRedirects = wwwDom?.redirect || null
  // canonical = the one that does NOT redirect; source = the one that redirects.
  let canonical, source, redirectStatus
  if (apexRedirects) {
    source = APEX; canonical = WWW; redirectStatus = apexDom.redirectStatusCode || 308
  } else if (wwwRedirects) {
    source = WWW; canonical = APEX; redirectStatus = wwwDom.redirectStatusCode || 308
  } else {
    // no redirect configured — treat www as canonical, no redirect to recreate.
    source = null; canonical = WWW; redirectStatus = 308
  }
  console.log(`  canonical=${canonical}  redirect-source=${source || "(none)"} → ${canonical} (${redirectStatus})`)
  console.log(`  current: apex verified=${apexDom?.verified} redirect=${apexRedirects} | www verified=${wwwDom?.verified} redirect=${wwwRedirects}`)
  if (DRY) { console.log("  (dry-run — no changes)"); return }

  // 1. remove the redirect SOURCE from dedicated first (clears the dependency).
  if (source) {
    const d = await vc(`/v9/projects/${DEDICATED}/domains/${source}${q}`, { method: "DELETE" })
    console.log(`  1. del ${source} from dedicated: ${d.status}`)
  }
  // 2. move the CANONICAL: delete from dedicated → add to shared.
  await vc(`/v9/projects/${DEDICATED}/domains/${canonical}${q}`, { method: "DELETE" })
  const addC = await vc(`/v10/projects/${SHARED}/domains${q}`, { method: "POST", body: JSON.stringify({ name: canonical }) })
  if (!addC.ok) { console.error(`  ✗ add canonical failed: ${JSON.stringify(addC.body?.error || addC.body)}`); process.exit(1) }
  console.log(`  2. ${canonical} → shared: verified=${addC.body.verified} verification=${JSON.stringify(addC.body.verification)}`)
  // 3. re-add the SOURCE to shared WITH its redirect (target now present).
  if (source) {
    const addS = await vc(`/v10/projects/${SHARED}/domains${q}`, {
      method: "POST",
      body: JSON.stringify({ name: source, redirect: canonical, redirectStatusCode: redirectStatus }),
    })
    if (!addS.ok) { console.error(`  ✗ add source failed: ${JSON.stringify(addS.body?.error || addS.body)}`); process.exit(1) }
    console.log(`  3. ${source} → shared: verified=${addS.body.verified} redirect=${addS.body.redirect}`)
  }

  // 4. verify render of the canonical (with the stale per-project CNAME still live).
  await sleep(6000)
  const r = await renders(canonical)
  console.log(`  4. render ${canonical}: ${r.ok ? "✓ " + r.reason + " (no vercel error)" : "✗ " + r.reason}`)
  if (source) {
    const sc = await fetch(`https://${source}/`, { redirect: "manual" }).then((x) => x.status).catch(() => 0)
    console.log(`     redirect ${source} → ${sc}`)
  }
  console.log(r.ok ? "\n✓ apex flip complete — now migrate the cicilabel subdomain via thin-down script" : "\n✗ FAILED — rollback: re-add domains to the dedicated project")
}

main().catch((e) => { console.error(e); process.exit(1) })
