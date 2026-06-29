#!/usr/bin/env node
/**
 * verify-analysis.mjs — mechanically check a delegated analysis/behaviour doc
 * (produced by `delegate.mjs --mode analysis`) against the actual code.
 *
 * The free model is hallucination-prone, so the analysis prompt forces every
 * factual claim to cite a backticked repo-relative `path/to/file.ts:Symbol` (or
 * a route). This script extracts those citations and checks:
 *   - every cited FILE exists in the repo, and
 *   - every cited `:Symbol` is actually found in that file.
 * A missing file is a hard hallucination signal (exit 1). The human/daemon
 * still reads the prose, but this auto-catches the bulk of invented references
 * so "verify per module" is a quick, grep-backed pass instead of a manual hunt.
 *
 * Usage:  node scripts/agent-daemon/verify-analysis.mjs <doc.md> [repoRoot]
 * Exit:   0 = every cited file exists; 1 = ≥1 cited file missing (or no doc).
 */
import { readFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const docPath = process.argv[2]
const REPO = process.argv[3] || process.env.DAEMON_CWD || resolve(HERE, "../..")
if (!docPath || !existsSync(docPath)) {
  console.error(`verify-analysis: doc not found: ${docPath || "(none)"}`)
  process.exit(1)
}
const doc = readFileSync(docPath, "utf8")

// ── extract citations ───────────────────────────────────────────────────────
// Backticked tokens that look like a repo path: contain "/" and a file ext,
// optionally suffixed with ":Symbol" or ":<line>".
// A file citation must contain a "/" (a path), so property/method accesses like
// `metadata.role` or `digest.ai_summary` aren't mistaken for files.
const CITE = /`((?:\.{1,3}\/|[A-Za-z0-9_.-]*\/)[A-Za-z0-9_./-]*\.[A-Za-z]{1,5}(?::[A-Za-z0-9_]+)?)`/g
const ROUTE = /`((?:GET|POST|PUT|PATCH|DELETE)\s+\/[A-Za-z0-9_/:*\[\]{}-]+)`/g

const fileCites = new Map() // "path[:sym]" -> count
for (const m of doc.matchAll(CITE)) fileCites.set(m[1], (fileCites.get(m[1]) || 0) + 1)
const routeCites = new Set([...doc.matchAll(ROUTE)].map((m) => m[1].replace(/\s+/g, " ")))
const unverifiedCount = (doc.match(/\(unverified\)/gi) || []).length

// Tracked file list — lets us resolve ABBREVIATED citations (`.../goals/route.ts`,
// bare `service.ts`) by path-suffix, so a real-but-shortened path isn't mistaken
// for a hallucination. Only a citation that matches ZERO tracked files is "missing".
let repoFiles = []
try {
  repoFiles = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" })
    .trim().split("\n").filter(Boolean)
} catch {
  repoFiles = []
}
const resolveCite = (path) => {
  const stripped = path.replace(/^(?:\.+\/)+/, "") // drop leading "../" and "..." ellipsis segments
  if (existsSync(join(REPO, stripped))) return [stripped]
  // suffix match against tracked files (e.g. "goals/route.ts" → ".../ad-planning/goals/route.ts")
  return repoFiles.filter((f) => f === stripped || f.endsWith("/" + stripped))
}

// ── check each file/symbol citation ─────────────────────────────────────────
const ok = []
const ambiguous = []
const missingFile = []
const missingSymbol = []
for (const cite of fileCites.keys()) {
  const [path, symOrLine] = cite.split(":")
  const matches = resolveCite(path)
  if (matches.length === 0) {
    missingFile.push(cite)
    continue
  }
  if (matches.length > 1) {
    ambiguous.push(`${cite} (${matches.length} files match — full path would disambiguate)`)
    continue
  }
  if (symOrLine && !/^\d+$/.test(symOrLine)) {
    const body = readFileSync(join(REPO, matches[0]), "utf8")
    const found = new RegExp(`\\b${symOrLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(body)
    ;(found ? ok : missingSymbol).push(cite)
  } else {
    ok.push(cite)
  }
}

// ── report ──────────────────────────────────────────────────────────────────
const docRel = docPath.startsWith(REPO) ? docPath.slice(REPO.length + 1) : docPath
console.log(`[verify-analysis] ${docRel}`)
console.log(`  file/symbol citations: ${fileCites.size}  (✓ ${ok.length}  ~ambiguous ${ambiguous.length}  ✗file ${missingFile.length}  ✗symbol ${missingSymbol.length})`)
console.log(`  route citations: ${routeCites.size} (not auto-checked — verify by hand)`)
console.log(`  (unverified) markers: ${unverifiedCount}`)
if (missingFile.length) {
  console.log(`  ✗ MISSING FILES (hallucinated references):`)
  for (const c of missingFile) console.log(`      ${c}`)
}
if (ambiguous.length) {
  console.log(`  ~ ambiguous (file exists but cited by a non-unique short path):`)
  for (const c of ambiguous) console.log(`      ${c}`)
}
if (missingSymbol.length) {
  console.log(`  ⚠ symbol not found in cited file (may be renamed/approximate):`)
  for (const c of missingSymbol) console.log(`      ${c}`)
}
console.log(
  missingFile.length
    ? `[verify-analysis] ⇒ FAIL — ${missingFile.length} cited file(s) don't exist. Treat the doc as suspect; have the verifier read it closely or discard.`
    : `[verify-analysis] ⇒ all cited files exist. Verifier: spot-check the prose + the ${routeCites.size} route(s) and ${missingSymbol.length} unmatched symbol(s), then keep.`
)
process.exit(missingFile.length ? 1 : 0)
