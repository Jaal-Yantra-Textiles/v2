#!/usr/bin/env node
/**
 * #1027 — Limit storefront Vercel builds to the production branch only.
 *
 * The storefront projects are linked to the shared monorepo, so every push to
 * any feature branch fans out a preview build to EVERY storefront project. This
 * sets each project's "Ignored Build Step" so it only builds its production
 * branch. Provisioning bakes the same command into new projects
 * (provision-storefront.ts); this backfills the existing ones.
 *
 * Vercel ignore-step semantics: exit code 1 => build, exit code 0 => skip.
 *
 * Usage (token/team read from apps/backend/.env, or the process env):
 *   node scripts/limit-storefront-builds-to-main.mjs            # DRY RUN (default)
 *   APPLY=1 node scripts/limit-storefront-builds-to-main.mjs    # actually patch
 *   PREFIX=storefront- node scripts/...                         # name filter (default: storefront-)
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const API = "https://api.vercel.com"

// ── Load token/team from apps/backend/.env if not already in the environment ──
function loadEnvFallback() {
  if (process.env.VERCEL_TOKEN) return
  try {
    const raw = readFileSync(join(__dirname, "..", ".env"), "utf8")
    for (const line of raw.split("\n")) {
      const m = line.match(/^(VERCEL_TOKEN|VERCEL_TEAM_ID)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
    }
  } catch {
    // no .env — rely on process env
  }
}
loadEnvFallback()

const TOKEN = process.env.VERCEL_TOKEN
const TEAM_ID = process.env.VERCEL_TEAM_ID
const PREFIX = process.env.PREFIX ?? "storefront-"
const APPLY = process.env.APPLY === "1"

if (!TOKEN) {
  console.error("VERCEL_TOKEN not set (and not found in apps/backend/.env) — aborting")
  process.exit(1)
}

const teamQ = TEAM_ID ? `?teamId=${TEAM_ID}` : ""
const teamQAmp = TEAM_ID ? `&teamId=${TEAM_ID}` : ""
const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }

const ignoreCommandFor = (branch) =>
  `if [ "$VERCEL_GIT_COMMIT_REF" = "${branch}" ]; then exit 1; else exit 0; fi`

async function listAllProjects() {
  const out = []
  let until
  while (true) {
    const url = new URL(`${API}/v9/projects`)
    if (TEAM_ID) url.searchParams.set("teamId", TEAM_ID)
    url.searchParams.set("limit", "100")
    if (until) url.searchParams.set("until", String(until))
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`listProjects ${res.status}: ${await res.text()}`)
    const data = await res.json()
    out.push(...(data.projects || []))
    const next = data.pagination?.next
    if (!next) break
    until = next
  }
  return out
}

async function patchIgnoreCommand(project, cmd) {
  const res = await fetch(`${API}/v9/projects/${project.id}${teamQ}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ commandForIgnoringBuildStep: cmd }),
  })
  if (!res.ok) throw new Error(`patch ${project.name} ${res.status}: ${await res.text()}`)
}

const projects = await listAllProjects()
const storefronts = projects.filter((p) => p.name.startsWith(PREFIX))

console.log(
  `Found ${projects.length} projects; ${storefronts.length} match prefix "${PREFIX}".`
)
console.log(APPLY ? "MODE: APPLY (patching)\n" : "MODE: DRY RUN (no changes)\n")

let changed = 0
let alreadyOk = 0
for (const p of storefronts) {
  const branch = p.link?.productionBranch || "main"
  const want = ignoreCommandFor(branch)
  const current = p.commandForIgnoringBuildStep || null
  const repo = p.link ? `${p.link.org || p.link.owner || "?"}/${p.link.repo || "?"}` : "(no git link)"

  if (current === want) {
    alreadyOk++
    console.log(`  ✓ ${p.name}  [${repo}@${branch}]  already limited`)
    continue
  }

  changed++
  console.log(`  ${APPLY ? "→" : "•"} ${p.name}  [${repo}@${branch}]`)
  console.log(`      current: ${current ?? "(none)"}`)
  console.log(`      set to : ${want}`)
  if (APPLY) {
    try {
      await patchIgnoreCommand(p, want)
      console.log("      patched ✓")
    } catch (e) {
      console.error(`      FAILED: ${e.message}`)
    }
  }
}

console.log(
  `\nSummary: ${alreadyOk} already limited, ${changed} ${APPLY ? "patched" : "would change"}.`
)
if (!APPLY && changed > 0) {
  console.log("Re-run with APPLY=1 to apply.")
}
