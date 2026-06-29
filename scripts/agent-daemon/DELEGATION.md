# Free-model delegation (opencode drafter)

The PR daemon can hand **well-scoped, low-risk subtasks** to a **free** opencode
model (`opencode/deepseek-v4-flash-free` by default) instead of spending Claude
subscription tokens. The free model is a **drafter**; the Claude daemon (or you,
interactively) is the **verifier** and owns correctness.

## Why
- The free model costs **$0** and does not touch the shared Claude daily/weekly
  limit — ideal for the mechanical 60% of a slice (boilerplate, test stubs,
  Playwright scripts, a small UI section from a precise spec).
- Claude stays focused on judgement: architecture, money/cost logic, migrations,
  security, and **verifying** the draft.

## How it's wired
| Piece | What it does |
|---|---|
| `opencode-drafter.json` | Defines the restricted **`jyt-drafter`** agent: `edit=allow`, **`bash=deny`**, **`webfetch=deny`**. git / installs / network are blocked at the permission layer — proven (a `git status` attempt returns `BLOCKED`, no hang). Lives here, not in the repo root (loaded via `OPENCODE_CONFIG`), so the daemon's git never sees it. |
| `delegate.mjs` | The wrapper. Snapshots `git status` (read-only), runs the drafter headless on the free model behind a guardrail prompt, then reports **exactly which files changed** and flags anything **out of `--files` scope**. Writes `delegate-logs/last-result.json`. |
| `run.mjs` `DELEGATE` block | Tells the daemon the drafter exists, when to use it, and that **it must verify** the output. Gated on `DAEMON_DELEGATE` (default on). |

## Use it (daemon or human)
```bash
node scripts/agent-daemon/delegate.mjs \
  --files "apps/backend/src/modules/x/foo.ts,apps/backend/src/modules/x/__tests__/foo.unit.spec.ts" \
  "Create foo.ts exporting pure fn ...; create the matching unit spec with N cases covering ..."
```
- `--files` (optional but recommended): the only paths the drafter may touch.
  Anything else it writes is reported as `⚠ OUT-OF-SCOPE` and fails the run.
- `--model <provider/model>`: override the free model
  (`opencode models | grep free` → `mimo-v2.5-free`, `north-mini-code-free`,
  `nemotron-3-ultra-free`).
- Exit `0` = ran clean **and** stayed in scope; `1` = errored, self-reported
  `DRAFT_BLOCKED`, or strayed out of scope.

## The verifier's job (always — a clean exit is NOT a correct result)
1. `cat scripts/agent-daemon/delegate-logs/last-result.json` → `changed[]` / `out_of_scope[]`.
2. `git diff -- <changed files>` — read every line; the free model is weak.
3. Typecheck the changed files (zero **new** errors); run the **per-file** spec
   (`pnpm test:integration:http:shared -- <one spec>`) or drive Playwright for UI.
4. **Keep** it (then the daemon commits/PRs as usual) or **discard**:
   `git checkout -- <file>` / `rm` the new file.

## Guardrails (defense in depth)
- **Permission layer** (hard): no git, no installs, no network — the drafter can
  only author files. It cannot commit, push, merge, or run tests/builds.
- **Prompt layer**: scope to named files; match conventions; emit `DRAFT_BLOCKED`
  if unsure; never touch `scripts/agent-daemon/**`, lockfiles, migrations.
- **Diff gate** (the real net): the draft is just working-tree edits that don't
  leave the machine until the verifier approves. Sequential by construction —
  the caller blocks on opencode, so there's no concurrent-edit collision with
  the daemon's own work in the shared workspace.

## Analysis mode — delegate per-module behaviour docs
`--mode analysis` turns the free model into a cheap **module-documentarian**: it
reads a module and writes a GROUNDED behaviour doc (Purpose / Entry points / Data
models / Key behaviours / Gotchas / Open questions). Because a weak model
hallucinates, the prompt forces **every claim to cite a backticked
`path/to/file.ts:Symbol`** (or a route), and to mark anything it can't ground as
`(unverified)`.

```bash
node scripts/agent-daemon/delegate.mjs --mode analysis \
  --files "apps/docs/notes/modules/visual-flows-behaviour.md" \
  "Document the visual_flows module: routes under src/api/admin/visual-flows, the operations registry, and the live executor. Cite path:symbol for every claim."
```
Then **verify per module mechanically** — the citation checker confirms every
cited file/symbol actually exists (a missing file = hallucination → exit 1):
```bash
node scripts/agent-daemon/verify-analysis.mjs apps/docs/notes/modules/visual-flows-behaviour.md
```
The verifier auto-catches invented files/symbols; you still spot-read the prose
and the routes (which aren't auto-checked) before keeping the doc. Same guardrails
as draft mode — the drafter only writes the one doc, can't run/commit anything.

## Don't delegate
Architecture decisions, money/cost/pricing logic, DB migrations, auth/security,
anything in `scripts/agent-daemon/`, or anything you can't fully specify in the
prompt. Do those yourself. For **analysis** specifically: the free model DRAFTS
the doc, but you own the truth — never trust an un-verified analysis doc.
