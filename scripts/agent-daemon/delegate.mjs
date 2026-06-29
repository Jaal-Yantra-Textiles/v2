#!/usr/bin/env node
/**
 * delegate.mjs — hand a well-scoped, low-risk subtask to a FREE opencode model
 * (default: opencode/deepseek-v4-flash-free) instead of spending Claude tokens.
 *
 * The opencode sub-agent is a DRAFTER, not a shipper:
 *   - runs SEQUENTIALLY in this same workspace (the caller blocks on it — no
 *     concurrent-edit collision with the daemon's own work),
 *   - behind the restricted `jyt-drafter` agent (opencode-drafter.json): git,
 *     installs, and network are HARD-DENIED at the permission layer; it can only
 *     author files,
 *   - never commits / pushes / merges.
 *
 * The CALLER (the Claude daemon, or a human) is the verifier: this script just
 * produces working-tree edits + a precise report of what changed, then the
 * caller reviews the diff, typechecks, runs the per-file spec / Playwright, and
 * either keeps the draft or `git checkout --` discards it.
 *
 * Usage:
 *   node scripts/agent-daemon/delegate.mjs [--files "a.ts,b.ts"] [--model <m>] "<task prompt>"
 *
 * Exit code: 0 = opencode ran clean AND stayed in scope; 1 = opencode errored,
 * drafter self-reported DRAFT_BLOCKED, or it touched files outside --files.
 * The caller MUST still verify on exit 0 — a clean run is not a correct run.
 *
 * Outputs (under scripts/agent-daemon/delegate-logs/):
 *   <ts>.log          full opencode transcript
 *   last-result.json  { ok, model, changed[], out_of_scope[], blocked, summary, log }
 */
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative, resolve } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = process.env.DAEMON_CWD || resolve(HERE, "../..")
const LOG_DIR = join(HERE, "delegate-logs")
const CONFIG = join(HERE, "opencode-drafter.json")
const MODEL_DEFAULT =
  process.env.DAEMON_DELEGATE_MODEL || "opencode/deepseek-v4-flash-free"

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
let model = MODEL_DEFAULT
let scope = []
let mode = "draft" // draft = author code/tests; analysis = document module behaviour
const rest = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--model") model = argv[++i]
  else if (argv[i] === "--mode") mode = argv[++i]
  else if (argv[i] === "--files")
    scope = argv[++i].split(",").map((s) => s.trim()).filter(Boolean)
  else rest.push(argv[i])
}
if (!["draft", "analysis"].includes(mode)) {
  console.error(`delegate: --mode must be 'draft' or 'analysis' (got '${mode}')`)
  process.exit(2)
}
const task = rest.join(" ").trim()
if (!task) {
  console.error('delegate: missing task prompt.\n  node delegate.mjs [--mode draft|analysis] [--files "a,b"] "<task>"')
  process.exit(2)
}

// ── git snapshot helpers (READ-ONLY git — safe alongside a running daemon) ──────
const git = (args) =>
  execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim()
const statusMap = () => {
  const m = new Map()
  // -uall lists individual untracked FILES (not the collapsed parent dir), so a
  // brand-new file shows as `src/slugify.ts`, not `src/`.
  for (const line of git(["status", "--porcelain", "-uall"]).split("\n")) {
    if (!line) continue
    m.set(line.slice(3).trim(), line.slice(0, 2)) // path -> XY status
  }
  return m
}
const before = statusMap()

// ── guardrail envelope around the caller's task ────────────────────────────────
const scopeClause = scope.length
  ? `Edit ONLY these files (create any that don't exist yet): ${scope.join(", ")}. Touch NOTHING else.`
  : `Edit ONLY the file(s) named in the task. Touch nothing outside that.`

const draftPrompt = `You are "jyt-drafter", a DRAFTING sub-agent inside the JYT codebase (Medusa 2.x e-commerce backend, TypeScript). A senior verifier agent will REVIEW, TYPECHECK, and TEST your work and will DISCARD it if it's wrong — you do NOT ship, so be precise and conservative.

HARD RULES:
- ${scopeClause}
- git, npm/pnpm/yarn, installs, and network are BLOCKED — you physically cannot run them. Author files with your edit tools only; do not try to run tests, builds, or commands.
- Do NOT commit, push, or open PRs. Do NOT modify scripts/agent-daemon/**, lockfiles, or config.
- Match the surrounding file's style, imports, and conventions. Follow .claude/CLAUDE.md (wrapSchema for zod, model.define for models, MedusaService, mirror admin API patterns, kebab-case files).
- If the task is ambiguous, underspecified, or you cannot do it safely, write NOTHING and make your FINAL message exactly: DRAFT_BLOCKED: <one-line reason>.

When finished, end your FINAL message with:
CHANGED: <comma-separated files you wrote> — then one short line per file on what it contains.

TASK:
${task}`

const analysisPrompt = `You are "jyt-drafter", a code-ANALYSIS sub-agent inside the JYT codebase (Medusa 2.x e-commerce backend, TypeScript). Your job is to produce a GROUNDED behaviour document for the module/area named in the task. A senior verifier will CHECK EVERY CLAIM against the code per-module and DELETE the doc if it hallucinates — so cite, don't guess.

HARD RULES:
- ${scopeClause} (this is normally ONE markdown doc.)
- READ the actual code (use your read/grep/glob tools) before writing. Every factual claim MUST cite the source as a backticked FULL repo-relative path from the repo root — e.g. \`apps/backend/src/modules/x/service.ts:Symbol\` — NOT an abbreviated \`.../x/service.ts\` and NOT a bare \`service.ts\`. Use \`path:Symbol\` or \`path:lineNumber\`, or a route like \`POST /admin/...\`. NO uncited claims; full paths only (a verifier greps them).
- Write ONLY what you can ground in code you actually read. If you cannot verify something, either omit it or mark it explicitly as \`(unverified)\` — never present a guess as fact. Inventing files, symbols, routes, or behaviour is the one unforgivable error.
- git, installs, and network are BLOCKED — you cannot run code, tests, or builds. Reason only from the source you read.
- Do NOT modify any source file, scripts/agent-daemon/**, lockfiles, or config — only write the doc.

Structure the doc with these sections (omit a section if N/A, don't pad):
1. **Purpose** — what the module does, in 2-3 sentences.
2. **Entry points** — routes / exported services / workflows / subscribers, each with its \`path:symbol\`.
3. **Data models & links** — model.define tables + module links, with \`path\`.
4. **Key behaviours** — the important logic/flows, each citing the \`path:symbol\` that implements it.
5. **Gotchas / invariants** — non-obvious constraints, ordering, side effects (cite).
6. **Open questions / (unverified)** — anything you could not ground.

End your FINAL message with:
CHANGED: <the doc path> — one line on what module it documents and how many claims it cites.

TASK:
${task}`

const prompt = mode === "analysis" ? analysisPrompt : draftPrompt

// ── run opencode (restricted agent, free model, headless) ──────────────────────
mkdirSync(LOG_DIR, { recursive: true })
const ts = git(["rev-parse", "--short", "HEAD"]).slice(0, 7) + "-" + process.pid
const logPath = join(LOG_DIR, `${ts}.log`)

console.log(`[delegate] mode=${mode} model=${model} agent=jyt-drafter scope=${scope.join("|") || "(task-named)"}`)
console.log(`[delegate] running opencode (free) — verifier owns correctness…`)

const run = spawnSync(
  "opencode",
  [
    "run",
    "--dir", REPO,
    "--agent", "jyt-drafter",
    "--model", model,
    // No --dangerously-skip-permissions: the jyt-drafter agent's explicit policy
    // (edit=allow, bash=deny, webfetch=deny) is enough to run headless without
    // approval prompts, and keeps git/installs/network HARD-blocked. Approval
    // gates are NOT globally disabled.
    prompt,
  ],
  {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      OPENCODE_CONFIG: CONFIG, // restricted jyt-drafter lives here, not in the repo root
      OPENCODE_DISABLE_PROJECT_CONFIG: "1", // ignore any repo-root opencode.json
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
  }
)

const transcript = (run.stdout || "") + (run.stderr ? "\n--- stderr ---\n" + run.stderr : "")
writeFileSync(logPath, transcript)
process.stdout.write(transcript.slice(-4000)) // tail to console; full log on disk

// ── diff what actually changed vs the snapshot ─────────────────────────────────
const after = statusMap()
// The wrapper writes its OWN transcript/result under delegate-logs/ before this
// snapshot — exclude that so it's never mistaken for a draft edit / scope breach.
const logRel = relative(REPO, LOG_DIR)
const isWrapperOutput = (p) => logRel && !logRel.startsWith("..") && p.startsWith(logRel + "/")
const changed = []
for (const [path, st] of after)
  if (before.get(path) !== st && !isWrapperOutput(path)) changed.push(path)
const inScope = (p) =>
  scope.length === 0 || scope.some((s) => p === s || p.endsWith("/" + s))
const outOfScope = scope.length ? changed.filter((p) => !inScope(p)) : []

const blocked = /(^|\n)\s*DRAFT_BLOCKED:/.test(run.stdout || "")
const ranClean = run.status === 0 && !blocked
const ok = ranClean && outOfScope.length === 0

writeFileSync(
  join(LOG_DIR, "last-result.json"),
  JSON.stringify(
    { ok, mode, model, changed, out_of_scope: outOfScope, blocked, log: logPath, status: run.status },
    null, 2
  )
)

console.log(`\n[delegate] ── result ───────────────────────────────`)
console.log(`[delegate] exit=${run.status} blocked=${blocked} changed=${changed.length} out_of_scope=${outOfScope.length}`)
if (changed.length) {
  console.log(`[delegate] changed files:`)
  for (const p of changed) console.log(`  ${outOfScope.includes(p) ? "⚠ OUT-OF-SCOPE" : "•"} ${p}`)
}
if (changed.length) {
  console.log(`[delegate] per-file size (new files show total lines; modified show diffstat):`)
  for (const p of changed) {
    const st = after.get(p) || ""
    if (st.startsWith("??")) {
      const n = (spawnSync("wc", ["-l", join(REPO, p)], { encoding: "utf8" }).stdout || "").trim().split(/\s+/)[0]
      console.log(`  + ${p} (new, ${n || "?"} lines)`)
    } else {
      const s = (spawnSync("git", ["diff", "--stat", "--", p], { cwd: REPO, encoding: "utf8" }).stdout || "").trim()
      console.log(s ? "  " + s.replace(/\n/g, "\n  ") : `  ~ ${p}`)
    }
  }
}
console.log(`[delegate] full log: ${logPath}`)
console.log(`[delegate] ⇒ VERIFIER: review the diff, typecheck + run the per-file spec / Playwright, then keep or \`git checkout -- <files>\` to discard.`)

process.exit(ok ? 0 : 1)
