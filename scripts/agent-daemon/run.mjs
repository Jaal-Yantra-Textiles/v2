#!/usr/bin/env node
/**
 * Autonomous PR daemon via the Claude Agent SDK.
 * Docs: https://docs.anthropic.com/en/agent-sdk/overview
 *
 * Each chunk is a SEPARATE `query()` call → FRESH, EMPTY context by default.
 * That IS "clear context between chunks"; continuity rides on the durable
 * handoff (GitHub #352 → active issue → latest Handoff + .claude/SESSION_HANDOFF.md),
 * NOT leftover conversation.
 *
 * Long-running, budget-aware, self-healing; modes: build | analyze | auto.
 * Usage ledger appended per chunk. Stops on budget cap / DONE token / N
 * consecutive errors (which also catches "plan limit hit" → graceful stop).
 *
 *   Install:  cd scripts/agent-daemon && npm i
 *   Auth:     unset ANTHROPIC_API_KEY → Claude Code SUBSCRIPTION; set it → API billing.
 *   Run:      node scripts/agent-daemon/run.mjs   (or bash scripts/agent-daemon/launch.sh)
 *
 * Env: DAEMON_CWD, DAEMON_MAX_CHUNKS=6, DAEMON_BUDGET_USD=15, DAEMON_MAX_CONSEC_ERRORS=2,
 *      DAEMON_MODE=auto, DAEMON_MODEL=claude-opus-4-8, DAEMON_AUTONOMOUS=1, DAEMON_MERGE=1,
 *      DAEMON_TASK="<focus>", DAEMON_ISSUE=<n>
 */
import { query } from "@anthropic-ai/claude-agent-sdk"
import { appendFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = process.env.DAEMON_CWD || process.cwd()
const MAX_CHUNKS = Number(process.env.DAEMON_MAX_CHUNKS || 6)
const BUDGET_USD = Number(process.env.DAEMON_BUDGET_USD || 15)
const MAX_CONSEC_ERRORS = Number(process.env.DAEMON_MAX_CONSEC_ERRORS || 2)
const MODE = (process.env.DAEMON_MODE || "auto").toLowerCase()
const MODEL = process.env.DAEMON_MODEL || "claude-opus-4-8"
const AUTONOMOUS = process.env.DAEMON_AUTONOMOUS === "1"
const MERGE = process.env.DAEMON_MERGE === "1"
const TASK = process.env.DAEMON_TASK || ""
const ISSUE = process.env.DAEMON_ISSUE || ""
const LEDGER = join(HERE, "usage-ledger.jsonl")
const MEMORY_DIR =
  process.env.DAEMON_MEMORY_DIR ||
  `${process.env.HOME}/.claude/projects/-Users-saranshsharma-Developer-jyt/memory`
const DONE = "DAEMON_DONE"

const modeClause = (mode) => {
  if (mode === "analyze")
    return `This is an ANALYSIS chunk. Do NOT ship code. Deeply understand ONE subsystem/open question, write a concise notes doc under apps/docs/notes/, and persist a memory file. Then end.`
  if (mode === "build")
    return `This is a BUILD chunk. Implement the next buildable slice and open a PR.`
  return `AUTO: if there is a clean, well-scoped buildable slice, BUILD it and open a PR. If nothing is cleanly buildable (blocked/ambiguous/needs a decision/guessing), switch to an ANALYSIS chunk: understand one subsystem, write a notes doc + memory file, end. Prefer analysis over a risky build.`
}

const chunkPrompt = (n) => `
You are an autonomous PR daemon in the JYT repo (chunk ${n}/${MAX_CHUNKS}).
FRESH session, no prior context — recover everything from the handoff.

${modeClause(MODE)}

RESUME (first, in order):
  1. \`gh issue view 352\` → latest "Session pointer".
  2. Read apps/docs/notes/AUTONOMOUS_DAEMON.md — work queue + conventions.
  3. ${
    ISSUE
      ? `Work issue **#${ISSUE}**: \`gh issue view ${ISSUE} --comments\`, read its latest "Handoff".`
      : `Pick the next buildable task: the active issue in the #352 pointer if it has remaining work, else the next \`roadmap\`-labelled issue in the queue.`
  }
  4. Read .claude/SESSION_HANDOFF.md and any design/plan note under apps/docs/notes/ for that issue.
  5. Check recent memory: list ${MEMORY_DIR} and read its MEMORY.md for what's already known.
${TASK ? `  Focus for this run: ${TASK}` : ""}

BUILD (when building): implement ONE concrete slice under apps/backend. Add/extend tests. Run the relevant
integration spec PER-FILE (\`pnpm test:integration:http:shared -- <one spec path>\`) — never the whole dir
(@medusajs/index CREATE INDEX CONCURRENTLY vs TRUNCATE boot deadlock). Prefer a unit spec for pure
executor/graph logic. Typecheck changed files (zero NEW errors). UI slices (apps/backend/src/admin or any
React surface): you MUST drive the change with the Playwright skill (\`playwright-skill\`/\`webapp-testing\`)
against a live \`yarn dev\` and capture a screenshot — unit tests don't count for UI. If dev/Playwright
can't run, say so in the handoff.

SHIP (build chunks): \`git fetch origin\`, branch off \`origin/main\` (single workspace — no worktrees). ${
  MERGE
    ? "Push + open a PR; if ALL local verification passed you may `gh pr merge <n> --squash --admin` (auto-deploys to prod)."
    : "Push + open a PR. DO NOT merge — leave for human review."
}

PERSIST (every chunk): write/update a memory file in ${MEMORY_DIR} (frontmatter name/description/metadata.type)
+ a one-line pointer in its MEMORY.md (don't duplicate — update). Append any non-obvious gotcha/effective
workflow as one bullet to scripts/agent-daemon/BEST_PRACTICES.md.

HANDOFF (always, even if blocked/erroring): update the issue's "Handoff" comment, the #352 pointer, and run
\`.claude/scripts/write-handoff.sh "<headline>"\` (body on stdin) with the next concrete action + watch-outs.

STOP: if no buildable slice AND no useful analysis remains, or blocked on a product decision — write the
handoff and END your final message with the exact token ${DONE}. Otherwise end normally.

Conventions: single workspace, no git worktrees; specs per-file; mirror admin API patterns (don't invent);
\`query.graph\` uses \`relation.*\` suffix; every merge auto-deploys (~18-45m); prod verify v3.jaalyantra.com.
Respect issue-specific locked decisions in that issue's Handoff. Be token-frugal — shared daily/weekly limit.

NEVER run destructive workspace ops — they delete THIS daemon's own SDK (scripts/agent-daemon/node_modules)
and break the loop: NO \`git clean -fd/-fdx\`, NO \`git stash\`/\`git reset --hard\` of unrelated state, NO
repo-ROOT \`pnpm install\`/\`npm install\` (scope installs to apps/backend only). Stage feature files
EXPLICITLY — never \`git add -A\`/\`git add .\` (it sweeps the 215MB scripts/agent-daemon SDK binary → push
rejected by GitHub's 100MB hook). Touch only your slice's files; leave scripts/agent-daemon/ untouched.
`.trim()

async function runChunk(n) {
  const startedAt = Date.now()
  let finalText = ""
  let cost = 0
  let turns = 0
  let isError = false
  let errText = ""
  try {
    for await (const msg of query({
      prompt: chunkPrompt(n),
      options: {
        cwd: REPO,
        model: MODEL,
        settingSources: ["user", "project", "local"],
        permissionMode: AUTONOMOUS ? "bypassPermissions" : "acceptEdits",
      },
    })) {
      if (msg.type === "assistant") {
        const text = (msg.message?.content || [])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("")
        if (text) process.stdout.write(text)
      } else if (msg.type === "result") {
        finalText = msg.result || ""
        cost = msg.total_cost_usd || 0
        turns = msg.num_turns || 0
        isError = !!msg.is_error
        if (isError) errText = String(msg.result || msg.subtype || "unknown").slice(0, 300)
      }
    }
  } catch (e) {
    isError = true
    errText = String(e?.message || e).slice(0, 300)
  }
  return { finalText, cost, turns, isError, errText, durationMs: Date.now() - startedAt }
}

function recordLedger(entry) {
  try {
    appendFileSync(LEDGER, JSON.stringify(entry) + "\n")
  } catch (e) {
    console.error("[daemon] ledger write failed:", e.message)
  }
}

async function main() {
  console.log(
    `[daemon] repo=${REPO} mode=${MODE} maxChunks=${MAX_CHUNKS} budget=$${BUDGET_USD} ` +
      `maxConsecErr=${MAX_CONSEC_ERRORS} model=${MODEL} autonomous=${AUTONOMOUS} merge=${MERGE}`
  )
  let total = 0
  let consecErrors = 0
  let ranOk = 0
  let errored = 0

  for (let n = 1; n <= MAX_CHUNKS; n++) {
    if (total >= BUDGET_USD) {
      console.log(`[daemon] budget cap $${BUDGET_USD} reached (est. $${total.toFixed(2)}). Stopping.`)
      break
    }
    console.log(
      `\n[daemon] ===== chunk ${n}/${MAX_CHUNKS} — fresh context · est. spent $${total.toFixed(2)}/$${BUDGET_USD} =====`
    )
    const r = await runChunk(n)
    total += r.cost
    recordLedger({
      ts: new Date().toISOString(),
      chunk: n,
      mode: MODE,
      cost_usd_est: Number(r.cost.toFixed(4)),
      cumulative_usd_est: Number(total.toFixed(4)),
      turns: r.turns,
      duration_ms: r.durationMs,
      error: r.isError,
      error_text: r.isError ? r.errText : undefined,
    })

    if (r.isError) {
      errored++
      consecErrors++
      console.log(
        `\n[daemon] ⚠️ chunk ${n} ERRORED (${consecErrors}/${MAX_CONSEC_ERRORS} consecutive): ${r.errText}`
      )
      if (consecErrors >= MAX_CONSEC_ERRORS) {
        console.log(
          `[daemon] ${MAX_CONSEC_ERRORS} consecutive errors (possibly plan limit/auth/SDK) — stopping. ` +
            `Resume from the handoff; ledger: ${LEDGER}`
        )
        break
      }
      console.log(`[daemon] continuing with fresh context next chunk.`)
      continue
    }

    consecErrors = 0
    ranOk++
    console.log(
      `\n[daemon] chunk ${n} done · turns=${r.turns} · est=$${r.cost.toFixed(4)} · ${Math.round(
        r.durationMs / 1000
      )}s`
    )
    if (r.finalText.includes(DONE)) {
      console.log("[daemon] DONE token — queue drained / blocked. Stopping.")
      break
    }
  }

  console.log(
    `\n[daemon] finished · chunks ok=${ranOk} errored=${errored} · total est. ~$${total.toFixed(
      2
    )} · ledger: ${LEDGER}`
  )
}

main().catch((e) => {
  console.error("[daemon] fatal:", e)
  process.exit(1)
})
