#!/usr/bin/env node
/**
 * delegate.mjs — hand a well-scoped, low-risk subtask to a FREE opencode model
 * (default: cloudflare-workers-ai/@cf/zai-org/glm-5.3) instead of spending Claude tokens.
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
import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative, resolve } from "node:path"
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = process.env.DAEMON_CWD || resolve(HERE, "../..")
const LOG_DIR = join(HERE, "delegate-logs")
const CONFIG_DRAFTER = join(HERE, "opencode-drafter.json")
const CONFIG_IMPLEMENTER = join(HERE, "opencode-implementer.json")
const MODEL_DEFAULT =
  process.env.DAEMON_DELEGATE_MODEL || "cloudflare-workers-ai/@cf/zai-org/glm-5.3"

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
let model = MODEL_DEFAULT
let scope = []
// draft    = author code/tests, no bash at all
// analysis = document module behaviour
// audit    = verify a GitHub issue against the code
// implement= author code + specs AND run typecheck/jest to check itself (jyt-implementer)
let mode = "draft"
// --worktree <slug>: run in a throwaway git worktree instead of the live checkout.
// REQUIRED for `implement`, and the only safe way to run two delegates at once —
// two runs in one workspace each see the other's writes as OUT-OF-SCOPE.
let worktreeSlug = ""
/**
 * --timeout <minutes>: hard wall-clock ceiling on the opencode run.
 *
 * 🔴 Not optional comfort. Eight audit runs in one session hung at 0.0% CPU for
 * 20-40 minutes each and had to be found with `ps` and killed by PID — a
 * headless batch script has no way to notice, so an unattended wave silently
 * stops making progress and looks like it is still working. `spawnSync` takes a
 * `timeout`, so the fix is a parameter, not a supervisor process.
 *
 * The default is generous on purpose: a real `implement` run that typechecks and
 * runs jest can legitimately take 15+ minutes, and killing honest work is worse
 * than waiting. Lower it for read-only `audit` waves, where nothing should take
 * anywhere near that long.
 */
let timeoutMin = Number(process.env.DELEGATE_TIMEOUT_MIN || 40)
const rest = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--model") model = argv[++i]
  else if (argv[i] === "--mode") mode = argv[++i]
  else if (argv[i] === "--worktree") worktreeSlug = argv[++i]
  else if (argv[i] === "--timeout") timeoutMin = Number(argv[++i])
  else if (argv[i] === "--files")
    scope = argv[++i].split(",").map((s) => s.trim()).filter(Boolean)
  else rest.push(argv[i])
}
if (!Number.isFinite(timeoutMin) || timeoutMin <= 0) {
  console.error(`delegate: --timeout must be a positive number of minutes (got '${timeoutMin}')`)
  process.exit(2)
}
if (!["draft", "analysis", "audit", "implement", "review"].includes(mode)) {
  console.error(`delegate: --mode must be 'draft', 'analysis', 'audit', 'implement' or 'review' (got '${mode}')`)
  process.exit(2)
}
const task = rest.join(" ").trim()
if (!task) {
  console.error(
    'delegate: missing task prompt.\n' +
    '  node delegate.mjs [--mode draft|analysis|audit|implement|review] [--worktree <slug>] [--model <m>] [--files "a,b"] "<task>"\n' +
    '  --mode implement REQUIRES --worktree; it is the only mode whose agent can run commands.\n' +
    '  --timeout <minutes> (default 40, or $DELEGATE_TIMEOUT_MIN) kills a hung run instead of waiting forever.'
  )
  process.exit(2)
}

// ── workspace: the live checkout, or a throwaway worktree ─────────────────────
// 🔴 `implement` MUST be isolated. It is the only mode whose agent can run
// commands, and the live checkout holds the daemon's own untracked SDK/ledger
// plus whatever the human is mid-edit on. A worktree also removes the reason two
// delegates cannot run at once: in a shared checkout each run's `git status`
// snapshot sees the OTHER run's writes and reports them as OUT-OF-SCOPE.
if (mode === "implement" && !worktreeSlug) {
  console.error("delegate: --mode implement requires --worktree <slug> (never runs in the live checkout)")
  process.exit(2)
}
let WORKDIR = REPO
let worktreePath = ""
if (worktreeSlug) {
  const safeSlug = worktreeSlug.replace(/[^A-Za-z0-9_-]/g, "-")
  worktreePath = resolve(REPO, "..", `jyt-wt-${safeSlug}`)
  const branch = `agent/${safeSlug}`
  if (!existsSync(worktreePath)) {
    console.log(`[delegate] creating worktree ${worktreePath} on branch ${branch}`)
    // Branch off the CURRENT HEAD of the live checkout, not origin/main — the
    // caller decides what the work is based on, and may be stacking.
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim()
    execFileSync("git", ["worktree", "add", "-b", branch, worktreePath, head], {
      cwd: REPO, encoding: "utf8", stdio: "inherit",
    })
  } else {
    console.log(`[delegate] reusing existing worktree ${worktreePath}`)
  }
  WORKDIR = worktreePath
  /**
   * 🔴 The worktree is branched from HEAD, so it contains only COMMITTED files.
   * The prompts order the agent to read
   * `scripts/agent-daemon/MEDUSA_CONVENTIONS.md` before writing a route — and
   * while that file is uncommitted, or newer in the live checkout than at HEAD,
   * the worktree copy is missing or stale and the agent silently reads nothing.
   * An instruction to read a file that isn't there does not fail loudly; it just
   * produces an implementation that ignored every convention. Copy the live
   * version in on every run.
   */
  const conventions = join(HERE, "MEDUSA_CONVENTIONS.md")
  if (existsSync(conventions)) {
    const dest = join(worktreePath, "scripts", "agent-daemon")
    mkdirSync(dest, { recursive: true })
    copyFileSync(conventions, join(dest, "MEDUSA_CONVENTIONS.md"))
  }
  /**
   * 🔴 A git worktree gets the tracked files and NOTHING ELSE — no
   * `node_modules`. The implementer is told it may run `tsc` and `jest`; without
   * this, every one of those commands dies with "command not found", the agent
   * shrugs and reports success anyway, and the run LOOKS verified while nothing
   * was ever compiled or executed. Observed on the first implement run: the spec
   * it wrote had two unresolvable imports and could not even load.
   *
   * Symlink rather than install: an install per worktree is minutes and
   * gigabytes, and pnpm's store already lives under the root `node_modules`.
   */
  // Every workspace that HAS a node_modules in the live checkout gets one here.
  // Enumerated, not hardcoded: the first version listed only the root and
  // apps/backend, so a partner-ui task would have hit the same silent
  // "command not found" that made the first implement run's testing fake.
  const nmDirs = ["node_modules"]
  const appsDir = join(REPO, "apps")
  if (existsSync(appsDir)) {
    for (const app of readdirSync(appsDir)) {
      if (existsSync(join(appsDir, app, "node_modules")))
        nmDirs.push(join("apps", app, "node_modules"))
    }
  }
  for (const rel of nmDirs) {
    const src = join(REPO, rel)
    const dest = join(worktreePath, rel)
    if (existsSync(src) && !existsSync(dest)) {
      mkdirSync(dirname(dest), { recursive: true })
      try {
        symlinkSync(src, dest)
      } catch (e) {
        console.warn(`[delegate] could not link ${rel}: ${e.message} — the agent will NOT be able to run tsc/jest`)
      }
    }
  }
}

// ── git snapshot helpers (READ-ONLY git — safe alongside a running daemon) ──────
const git = (args) =>
  execFileSync("git", args, { cwd: WORKDIR, encoding: "utf8" }).trim()
const statusMap = () => {
  const m = new Map()
  // -uall lists individual untracked FILES (not the collapsed parent dir), so a
  // brand-new file shows as `src/slugify.ts`, not `src/`.
  for (const line of git(["status", "--porcelain", "-uall"]).split("\n")) {
    if (!line) continue
    // XY is exactly two columns, then a separator, then the path. Strip by
    // PATTERN, not by a fixed offset: a fixed `slice(3)` ate the first letter of
    // a path in one observed run and reported `pps/backend/...` — a file that
    // does not exist, printed with total confidence.
    const m2 = /^(..)\s+(.*)$/.exec(line)
    if (!m2) continue
    // A rename reads `R  old -> new`; the new path is what changed.
    const path = m2[2].includes(" -> ") ? m2[2].split(" -> ").pop() : m2[2]
    /**
     * 🔴 Status alone is NOT change. An UNTRACKED file that already existed
     * before the run keeps the status `??` no matter how much its content is
     * rewritten — so a second pass over a file the first pass created reported
     * `changed=0`, and because the trailer gate only fired when something
     * changed, the run exited 0 with no report AND no detected edits. Two
     * silences stacked: observed on the stage-3 fix run, which rewrote four
     * import paths and was reported as having done nothing.
     *
     * Hash the content so an edit is visible whatever the status says.
     */
    let digest = ""
    try {
      const abs = join(WORKDIR, path)
      if (existsSync(abs)) digest = createHash("sha1").update(readFileSync(abs)).digest("hex")
    } catch {
      // A directory or an unreadable path: fall back to status-only compare.
    }
    m.set(path.replace(/^"|"$/g, "").trim(), `${m2[1]}|${digest}`)
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

const auditPrompt = `You are "jyt-drafter", a backlog-AUDIT sub-agent inside the JYT codebase (Medusa 2.x e-commerce backend, TypeScript). A GitHub issue has been dumped to a local markdown file. Your job is to decide, FROM THE CODE, whether what that issue asks for exists today — and to prove it either way. A senior verifier will re-check every citation you make and will DISCARD your verdict if it hallucinates or if it closes something on weak evidence. Nothing you write is posted to GitHub by you.

HARD RULES:
- ${scopeClause} (this is normally ONE markdown verdict doc.)
- READ the issue file named in the task FIRST, in full. Then READ THE ACTUAL CODE with your read/grep/glob tools before writing a single line of verdict.
- git, gh, installs, and network are BLOCKED — you physically cannot run them. You cannot query production, run tests, or open the issue on GitHub. Reason ONLY from the issue dump and the source you read.
- Every factual claim MUST cite the source as a backticked FULL repo-relative path from the repo root — e.g. \`apps/backend/src/api/admin/quotes/route.ts:POST\` — NOT an abbreviated \`.../quotes/route.ts\` and NOT a bare \`route.ts\`. Use \`path:Symbol\`, \`path:lineNumber\`, or a route like \`POST /admin/...\`. A verifier greps every one of them.

🔴 THE THREE RULES THAT DECIDE WHETHER THIS AUDIT IS WORTH ANYTHING:

1. **A FAILED GREP IS NOT EVIDENCE OF ABSENCE.** Never write "this does not exist" because one search missed. Before claiming something is absent you must have searched at least THREE different ways — by symbol name, by the string that would appear in a route path or error message, and by the directory where it would live — and you must SAY which searches you ran. If you only searched one way, the verdict is \`NEEDS-PROD\` or \`UNCLEAR\`, not \`STILL-OPEN\`.

2. **A CAPABILITY THAT EXISTS AND IS NEVER CALLED IS STILL BROKEN.** This backlog's single most common defect — 7 of the last 22 issues — is a function, route, or flag that was fully built and then never wired to a caller, a screen, or a client type. So when you find the thing the issue asked for, DO NOT STOP. Grep for its call sites. If nothing imports or calls it, or no UI route reaches it, say so explicitly and mark the issue \`PARTIAL\`, never \`SHIPPED\`.

3. **THE ISSUE'S OWN DIAGNOSIS IS PROBABLY WRONG.** Lines in this backlog that name a cause are wrong more often than they are right. Verify the issue's stated cause against the code as a separate question from whether the symptom is fixed. If the issue blames X and the code shows the real cause is Y, that finding is the most valuable thing in your report — put it under **Correction**.

Write the verdict doc with EXACTLY these sections:

1. **Verdict** — one of: \`SHIPPED\` (the ask is fully implemented AND reachable from a real caller) · \`PARTIAL\` (built but unreachable, or only some slices done) · \`STILL-OPEN\` (not implemented) · \`NEEDS-PROD\` (cannot be settled from source alone — a prod probe or a test run is required) · \`UNCLEAR\` (the issue's ask is too vague to test). One sentence of justification.
2. **What the issue asks for** — the ask restated as a checklist of concrete, testable claims. One line each. If the issue has numbered slices, use them.
3. **What the code actually does** — walk each checklist item to its implementation or its absence, citing \`path:symbol\` on every line.
4. **Reachability** — for each thing you found: who calls it? Cite the call site. If nothing does, write \`NO CALLER FOUND\` and name the greps you ran.
5. **Correction** — anything the issue asserts that the code contradicts. Omit the section if there is none; do not pad it.
6. **Searches I ran** — the literal grep/glob patterns you used, one per line. This is how the verifier judges your absence claims.
7. **What I could NOT settle from source** — anything needing a prod probe, a test run, or a human decision. Be generous here; an honest gap is worth more than a confident guess.

- Write ONLY what you can ground in code you actually read. Mark anything you cannot verify as \`(unverified)\`. Inventing files, symbols, routes, or behaviour is the one unforgivable error.
- Do NOT modify any source file, do NOT modify scripts/agent-daemon/**, lockfiles, or config — only write the verdict doc.
- Do NOT recommend closing the issue unless your verdict is \`SHIPPED\` and section 4 names a real caller.

End your FINAL message with:
CHANGED: <the verdict doc path> — the verdict word, and how many claims it cites.

TASK:
${task}`
const implementPrompt = `You are "jyt-implementer", an implementation sub-agent inside the JYT codebase (Medusa 2.x e-commerce backend, TypeScript) working in an ISOLATED git worktree. You implement the task, you write the tests, and you RUN the tests you can run. A senior verifier then reviews your diff and decides whether it becomes a pull request — you do not open one, and nothing you write reaches the shared branch or production by any action of yours.

WHAT YOU CAN AND CANNOT RUN:
- ✅ You MAY run typecheck and per-file jest: \`pnpm exec tsc\`, \`npx jest\`, \`pnpm test:integration:http:shared -- <one spec>\`.
- ❌ git, gh, curl/wget, aws, docker, psql, installs, dev servers, and \`playwright test\` are DENIED at the permission layer. You cannot commit, push, open a PR, install a package, reach the network, or touch production. Do not attempt them; an unlisted command is denied outright, so a stray attempt just wastes a turn.
- 🔴 NEVER assume a dependency you need is installable. If the task needs a package that is not already in the relevant package.json, STOP and report it as a blocker instead of writing an import that cannot resolve.

HARD RULES:
- ${scopeClause}
- 🔴 **BEFORE YOU WRITE ANY ROUTE, VALIDATOR, MODEL, OR QUERY, READ \`scripts/agent-daemon/MEDUSA_CONVENTIONS.md\` IN FULL.** It is not style advice — every rule in it is a defect that already reached a branch or production in this repo. A verifier checks your diff against that file line by line and will reject it on any violation. The traps that catch people most often: a module-service route CANNOT resolve links (only \`query.graph\` can, and only from \`Link.entryPoint\`); \`updateX({id, ...})\` as one flat object is a SELECTOR, not an update; \`.optional()\` in zod over a NOT NULL column is a 500, not a 400; and a new partner route 401s until \`src/api/middlewares.ts\` names it.
- 🔴 **DO NOT WRITE OR GENERATE A DATABASE MIGRATION.** If your change needs a schema change, make the model change and report the migration you would need under \`NOT-DONE:\`. A generated migration here re-emits hand-written columns and its \`down\` drops another migration's columns.
- Match the surrounding file's style, imports and conventions, and follow .claude/CLAUDE.md: \`wrapSchema()\` for zod bodies, \`model.define()\` for models, services extend \`MedusaService\`, kebab-case filenames, import order external → internal → relative, \`MedusaError\` for errors.
- If the task is ambiguous, underspecified, or you cannot do it safely, write NOTHING and make your FINAL message exactly: DRAFT_BLOCKED: <one-line reason>.

🔴 HOW TESTS ARE RUN HERE — GETTING THIS WRONG WEDGES THE MACHINE:
1. **Integration specs run ONE FILE AT A TIME.** \`pnpm test:integration:http:shared -- <path-to-one-spec>\`. Jest's parallel workers exhaust Postgres locks when several integration files run together — this is a known, reproducible failure in this repo, not bad luck.
2. **Run jest from \`apps/backend\`.** The repo-root transform throws a bogus \`SyntaxError\` on \`import type\`.
3. **Unit specs are cheaper and safer than integration specs.** For pure logic — a pricer, a selector, a fold, a date rule — write a \`*.unit.spec.ts\` and run it with \`TEST_TYPE=unit\`. Reach for an integration spec only when the thing under test genuinely needs the HTTP boundary or the database.
4. **The test runner restores a DB snapshot before EVERY test.** Do not write a spec whose second case depends on state its first case created.

🔴 THE TEST TRAPS THAT HAVE ACTUALLY BITTEN THIS REPO — your spec must not repeat them:
- **A new test that passes on the OLD code proves nothing.** A test you did not watch FAIL is not evidence — it is a hope. See the mandatory red/green loop below.

🔴 **THE RED/GREEN LOOP IS MANDATORY. A SPEC YOU DID NOT RUN IS A PROPOSAL, NOT A TEST.**

You have \`node_modules\` and you CAN run jest. From \`apps/backend\`:
\`\`\`
TEST_TYPE=unit npx jest --testPathPattern="<your-spec-name>"
\`\`\`
For every spec you write, do ALL FOUR of these, in order, and report the real output of each:

1. **RUN IT.** Read the output. \`Tests: 0 total\` with a failed suite means the file did not even LOAD — usually a bad import path — and nothing was tested. That is a failure, not a pass.
2. **GET IT GREEN.** If it fails, fix it and run again. Repeat until it genuinely passes. Do not stop at a failing spec and describe the failure as if it were the deliverable; iterating until green is the job.
3. 🔴 **PROVE IT CAN FAIL.** Once green, TEMPORARILY neutralise the exact behaviour under test — comment out the call you added, or invert the condition — and RUN THE SPEC AGAIN. It MUST go red, and it must go red on the assertion you care about. If it stays green, that test does not test your change: fix the test, not the code.
4. **RESTORE** what you neutralised, and run once more to confirm green. Never leave step 3's edit behind.

⚠️ Watch for a test that passes for the wrong reason. If you make a call throw to check the failure path, you MUST also assert that the call actually HAPPENED (\`expect(theMock).toHaveBeenCalled()\`). Otherwise deleting the whole feature leaves the rejection unconsumed, the rest still passes, and your test proves nothing. This exact hole has shipped here.

⚠️ Ordering: \`invocationCallOrder\` proves which call STARTED first. It does NOT prove the first was awaited — a fire-and-forget also starts first. To prove an await, make the first call return a promise you control, assert the second has NOT been called yet, then resolve it.
- **A fixture tidier than reality certifies the wrong code.** If the real data has nulls, zero-quantity rows, fractional amounts or tax, put them in the fixture. A fixture with no tax makes a tax assertion vacuous.
- **\`0\` is not \`null\`, and \`Number(null)\` is \`0\`.** Assert \`> 0\` rather than \`!= null\`, and test the RAW field before anything coerces it.
- **Never put an \`expect()\` inside a mock body wrapped in try/catch** — the catch swallows the failure and the test passes. Assert AFTER the call, against \`mock.calls\`.
- **Do not write an assertion that an alternation (\`a|b|c\`) or a loose regex can satisfy by accident.** Assert the exact expected value.

E2E / UI (Playwright):
- You may AUTHOR Playwright specs under the repo's existing e2e directory, matching the neighbouring specs' structure, fixtures and selectors — read them first.
- ❌ You may NOT RUN them. The e2e job overwrites \`.env\`, and if another checkout is holding port 9000 the run silently grades a DIFFERENT server's build. The verifier runs e2e.
- Because you cannot run it, an e2e spec you write is a PROPOSAL. Prefer \`getByRole\`/\`getByTestId\` over text that a count badge or a status chip can perturb, and never assert on a URL pattern loose enough that an error page or the create page also matches it.

WHEN YOU ARE DONE, end your FINAL message with, in this order:
CHANGED: <comma-separated files you wrote> — then one short line per file on what it contains.
TESTS-RUN: <each command you actually ran, and its real result — PASS or FAIL with the failing assertion>. If you ran nothing, write \`TESTS-RUN: none\` and say why. Never report a test as passing unless you ran it and read the output.
RED-GREEN: <per new spec: the command you ran, the GREEN result, then what you neutralised in step 3, and the RED result it produced (name the assertion that failed). If a spec never went red, say so explicitly — that spec does not test your change.>
NOT-DONE: <anything in the task you did not finish, could not verify, or deliberately left out>. An honest gap here is worth more than a confident claim; the verifier will find the difference either way.

TASK:
${task}`
const reviewPrompt = `You are "jyt-drafter", acting as an ADVERSARIAL REVIEWER inside the JYT codebase (Medusa 2.x e-commerce backend, TypeScript). Another AI agent has just implemented a task in this working tree. Your job is to find what it got WRONG or left OUT — not to summarise what it did, and not to praise it.

🔴 **Assume the implementation is incomplete until you have proved otherwise.** An agent that reports "all tests pass" has told you what it ran, not what it covered. A reviewer whose report says "looks good" has not reviewed anything. If you genuinely find nothing after a real search, say so plainly and list what you checked — but that is the rare outcome, not the default.

WHAT YOU CAN AND CANNOT DO:
- You have READ, GREP and GLOB tools. Use them heavily. Read the changed files IN FULL, then read the files around them.
- git, gh, bash, installs and network are DENIED. You cannot run tests, diff against a base, or check CI. Reason from source.
- You write ONE markdown report. ${scopeClause}

🔴 READ \`scripts/agent-daemon/MEDUSA_CONVENTIONS.md\` IN FULL FIRST. It is the checklist. Every rule in it is a defect that already reached a branch or production here. Check the implementation against it line by line — that file is the single highest-yield source of findings in this repo.

HUNT SPECIFICALLY FOR THESE, IN THIS ORDER:

1. **A capability added and never called.** The most common defect in this codebase — 7 of the last 22 audited issues. For every new function, route, flag, field or option the implementation added: grep for its call sites. A new route must be reachable from a screen or a client; a new field must be read by something; a new flag must be typed on the client that sends it. If nothing calls it, that is a finding, and it is usually the most important one in the report.
2. **A validator or type that will reject the very field the change adds.** Medusa's zodValidator forces \`.strict()\`, so a field added to a screen but not to the validator is a 400 in production and silent everywhere else. Check both ends of every new field: validator, TypeScript client type, and the model/column.
3. **\`.optional()\` over a NOT NULL column** — a 500, not a 400, with an HTML body and no field name. If the change made something optional, verify the column is actually nullable and that a migration exists (or is honestly reported as missing).
4. **A new partner route with no entry in \`src/api/middlewares.ts\`** — it 401s forever, and tsc and the test suite are both silent about it.
5. **Tests that cannot fail.** For each new spec, ask: if the implementation were reverted, would this assertion fail? Look for fixtures tidier than reality (no nulls, no zero rows, no fractional amounts, no tax), for \`expect()\` inside a mock body wrapped in try/catch (the catch swallows it and the test passes), for loose regex or \`a|b|c\` alternations that a wrong value also satisfies, and for a test whose second case depends on state its first case created (the runner restores a DB snapshot before EVERY test).
6. **Guards that read a field the query never fetched** — dead code that always passes.
7. **Error handling** — bare \`throw new Error\` instead of \`MedusaError\`, a swallowed \`catch {}\`, or a caught error that returns a success shape.
8. **What the task asked for that simply is not there.** Re-read the task statement below and walk it item by item.

STRUCTURE THE REPORT EXACTLY LIKE THIS:

1. **Verdict** — one of \`SHIP-AFTER-FIXES\` · \`NEEDS-REWORK\` · \`LOOKS-COMPLETE\`. One sentence.
2. **Blocking gaps** — things that are wrong or missing and MUST be fixed. For each: what is wrong, the \`path:symbol\` where, why it fails, and a concrete failing scenario (specific inputs → specific wrong output). No finding without a failure scenario; a finding you cannot make fail is a guess, and belongs in section 4 instead.
3. **Convention violations** — each with the rule from MEDUSA_CONVENTIONS.md it breaks, and the \`path:line\`.
4. **Concerns I could not prove** — things that look wrong but which you could not confirm from source. Say what would settle each one.
5. **Coverage holes** — what the new tests do NOT cover, and specifically any assertion that would still pass on the OLD code.
6. **Searches I ran** — the literal grep/glob patterns, one per line. This is how the next reader judges your "nothing found" claims.

Every claim cites a backticked FULL repo-relative path (\`apps/backend/src/...\`) with \`:Symbol\` or \`:line\`. A verifier greps every one. Inventing a file, symbol or line is the one unforgivable error — mark anything you cannot ground as \`(unverified)\`.

Do NOT modify any source file. Do NOT fix what you find — report it. Do NOT touch scripts/agent-daemon/**, lockfiles, or config.

End your FINAL message with:
CHANGED: <the report path> — the verdict word, the number of blocking gaps, and the number of convention violations.

TASK THE IMPLEMENTER WAS GIVEN (review against this):
${task}`
const prompt =
  mode === "implement" ? implementPrompt
  : mode === "review" ? reviewPrompt
  : mode === "audit" ? auditPrompt
  : mode === "analysis" ? analysisPrompt
  : draftPrompt

// The implementer is the only agent allowed to run anything, so it gets its own
// config file and its own agent name. Everything else stays on the bash-denied
// drafter.
const AGENT = mode === "implement" ? "jyt-implementer" : "jyt-drafter"
const CONFIG = mode === "implement" ? CONFIG_IMPLEMENTER : CONFIG_DRAFTER

// ── run opencode (restricted agent, free model, headless) ──────────────────────
mkdirSync(LOG_DIR, { recursive: true })
const ts = git(["rev-parse", "--short", "HEAD"]).slice(0, 7) + "-" + process.pid
const logPath = join(LOG_DIR, `${ts}.log`)

console.log(`[delegate] mode=${mode} model=${model} agent=jyt-drafter scope=${scope.join("|") || "(task-named)"}`)
console.log(`[delegate] running opencode (free) — verifier owns correctness… (watchdog ${timeoutMin}m)`)

const run = spawnSync(
  "opencode",
  [
    "run",
    "--dir", WORKDIR,
    "--agent", AGENT,
    "--model", model,
    // No --dangerously-skip-permissions: each agent's explicit policy is enough to
    // run headless. jyt-drafter has bash fully denied; jyt-implementer allows ONLY
    // typecheck and per-file jest, with an unlisted command DENIED (never "ask",
    // which would hang a headless run). Approval gates are NOT globally disabled.
    prompt,
  ],
  {
    cwd: WORKDIR,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // The watchdog. SIGKILL, not the default SIGTERM: the runs that hang here
    // hang at 0.0% CPU and have already stopped responding to anything polite.
    timeout: timeoutMin * 60 * 1000,
    killSignal: "SIGKILL",
    env: {
      ...process.env,
      OPENCODE_CONFIG: CONFIG, // restricted agent lives here, not in the repo root
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
/**
 * A watchdog kill is its own outcome, not a failed run. `spawnSync` reports it
 * as `error.code === "ETIMEDOUT"` with `status === null`, which would otherwise
 * read as an ordinary non-zero exit and tell the caller nothing about WHY.
 * Whatever the agent had written by then is still in the workspace — the kill
 * ends the run, it does not undo the edits — so the diff below is still worth
 * reading, and may be a usable partial draft.
 */
const timedOut = run.error?.code === "ETIMEDOUT"
const ranClean = run.status === 0 && !blocked && !timedOut

/**
 * 🔴 In `implement` mode the required trailer is not paperwork — it is the only
 * account of what the agent actually RAN. The first implement run omitted it
 * entirely and exited 0, so the run read as verified while nothing had been
 * compiled or executed (the worktree had no node_modules and every command had
 * died "not found"). A missing trailer must fail the run, loudly, rather than
 * leave the caller to infer testing that never happened.
 */
const missingTrailer =
  mode === "implement"
    ? ["CHANGED:", "TESTS-RUN:", "RED-GREEN:", "NOT-DONE:"].filter(
        (t) => !new RegExp(`(^|\\n)\\s*${t}`).test(run.stdout || "")
      )
    : []

const ok = ranClean && outOfScope.length === 0 && missingTrailer.length === 0

const resultJson = JSON.stringify(
  { ok, mode, model, changed, out_of_scope: outOfScope, blocked, timed_out: timedOut, timeout_min: timeoutMin, missing_trailer: missingTrailer, log: logPath, status: run.status },
  null, 2
)
// `last-result.json` is a SHARED name: a second delegate running concurrently in
// this workspace overwrites it. Keep the convenience name for the single-run
// case, and always also write a per-run copy the caller can read unambiguously.
writeFileSync(join(LOG_DIR, "last-result.json"), resultJson)
writeFileSync(join(LOG_DIR, `result-${ts}.json`), resultJson)

console.log(`\n[delegate] ── result ───────────────────────────────`)
console.log(`[delegate] exit=${run.status} blocked=${blocked} changed=${changed.length} out_of_scope=${outOfScope.length}`)
if (timedOut)
  console.log(
    `[delegate] ⏱ TIMED OUT after ${timeoutMin}m and was KILLED. This is the 0.0%-CPU hang, not slow work.\n` +
    `[delegate]   Nothing it had already written was rolled back — the files below are a PARTIAL draft, and the\n` +
    `[delegate]   trailer is missing because the run never reached it, so NOTHING here was tested. Re-run, or\n` +
    `[delegate]   raise --timeout if the task genuinely needs longer.`
  )
if (missingTrailer.length)
  console.log(`[delegate] ⚠ MISSING REPORT SECTIONS: ${missingTrailer.join(" ")} — the agent did not say what it ran. Treat every claim of testing as UNPROVEN.`)
if (changed.length) {
  console.log(`[delegate] changed files:`)
  for (const p of changed) console.log(`  ${outOfScope.includes(p) ? "⚠ OUT-OF-SCOPE" : "•"} ${p}`)
}
if (changed.length) {
  console.log(`[delegate] per-file size (new files show total lines; modified show diffstat):`)
  for (const p of changed) {
    const st = after.get(p) || ""
    if (st.startsWith("??")) {
      const n = (spawnSync("wc", ["-l", join(WORKDIR, p)], { encoding: "utf8" }).stdout || "").trim().split(/\s+/)[0]
      console.log(`  + ${p} (new, ${n || "?"} lines)`)
    } else {
      const s = (spawnSync("git", ["diff", "--stat", "--", p], { cwd: WORKDIR, encoding: "utf8" }).stdout || "").trim()
      console.log(s ? "  " + s.replace(/\n/g, "\n  ") : `  ~ ${p}`)
    }
  }
}
console.log(`[delegate] full log: ${logPath}`)
console.log(`[delegate] ⇒ VERIFIER: review the diff, typecheck + run the per-file spec / Playwright, then keep or \`git checkout -- <files>\` to discard.`)

process.exit(ok ? 0 : 1)
