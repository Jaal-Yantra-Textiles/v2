# Agent-SDK PR daemon

Runs Claude Code chunks **headlessly**, each with a **fresh (cleared) context**,
continuing across chunks via the durable handoff. This is the "clear context
between chunks" mechanism `/loop` can't provide — `query()` starts empty every
call; continuity lives in GitHub #352/#459 + `.claude/SESSION_HANDOFF.md`.

> For an Anthropic-hosted version that runs with your laptop closed, use a
> **Routine** (`/schedule`). This is the local / programmable variant.

## Setup & run
```bash
cd scripts/agent-daemon && npm i          # installs the SDK (gitignored, ~215MB)
# Auth: leave ANTHROPIC_API_KEY unset → your Claude Code SUBSCRIPTION.
#       set it → Anthropic API pay-as-you-go billing.
bash scripts/agent-daemon/launch.sh        # long-term: 6 chunks / $12 cap / auto / no-merge
```

| Env | Default | Meaning |
|-----|---------|---------|
| `DAEMON_MAX_CHUNKS` | 6 | chunk ceiling |
| `DAEMON_BUDGET_USD` | 15 (launcher: 12) | stop once cumulative **est.** cost exceeds |
| `DAEMON_MAX_CONSEC_ERRORS` | 2 | stop after N consecutive chunk errors (also catches plan-limit-hit) |
| `DAEMON_MODE` | auto | `build` \| `analyze` \| `auto` |
| `DAEMON_AUTONOMOUS` | off (launcher: 1) | run shell/git/tests unattended |
| `DAEMON_MERGE` | off | allow `gh pr merge` (auto-deploys to prod) |
| `DAEMON_ISSUE` | — | pin a GitHub issue; omit → auto-pick from #352 queue |
| `DAEMON_TASK` | — | one-line focus override |

## Per chunk
resume from handoff → build-or-analyze → tests (per-file; **Playwright for UI**) →
PR (no merge unless `DAEMON_MERGE=1`) → **persist memory** + usage ledger → rewrite handoff.
Stops on `DAEMON_DONE`, budget cap, or N consecutive errors.

## Hard-won guards (baked into the prompt)
- **Never** `git clean -fdx`, `git reset --hard`, root `pnpm install`, or `git add -A` —
  they delete this daemon's own SDK/ledger (untracked) and break the loop. (`launch.sh`
  self-heals by reinstalling the SDK if it's missing.)
- Run integration specs **per-file** (the `@medusajs/index` CONCURRENTLY-vs-TRUNCATE
  boot/teardown deadlock). Prefer unit specs for pure executor logic.

## Task queue (appendable, idle-gated)
Instead of the one-shot `next-wave-task.txt` + `relaunch-when-idle.sh`, use the
**durable queue** so you can line up a *list* of tasks — and append more while a
wave is mid-flight. The runner picks them in lexical order, one at a time, never
running two daemons at once (waits for any live `run.mjs` to exit first), and
each wave is **PR-only** (`merge=0`) so Claude/you verify every PR before it lands.

```bash
# enqueue (auto-priorities to the END of the queue; lower NN- runs first):
./qadd.sh <slug> < task.txt        # or heredoc / pipe; ./qadd.sh --prio 05 <slug> to jump the line
# run the queue (background, survives this terminal):
nohup ./queue-runner.sh > queue/runner.log 2>&1 &
# stop gracefully after the current wave:
touch queue/STOP
```
Pending tasks live in `queue/*.txt`; finished ones move to `queue/done/` (timestamped, kept for audit).

## Files
`run.mjs` (orchestrator), `launch.sh` (launcher), `queue-runner.sh` + `qadd.sh` (task queue),
`BEST_PRACTICES.md` (daemon-learned), `usage-ledger.jsonl` (per-chunk telemetry, gitignored).
`node_modules/` and `queue/` gitignored.
