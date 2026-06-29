#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Daemon TASK QUEUE runner.
#
# Supersedes the one-shot relaunch-when-idle.sh + single next-wave-task.txt.
# Instead of "run exactly one next wave", this is a *durable, appendable queue*:
#
#   - Pending tasks live as files in   queue/*.txt   (processed in lexical order,
#     so NN- prefixes give you priority: 10-foo.txt before 20-bar.txt).
#   - You can drop NEW task files into queue/ AT ANY TIME — even while a daemon
#     wave is mid-flight. The runner re-scans the queue every time it goes idle,
#     so a task added "at the end" gets picked up on the next idle.
#   - The runner NEVER runs two daemons at once: before each wave it waits for any
#     live `run.mjs` to exit (respects the shared-workspace collision rule).
#   - Each wave is PR-ONLY (delegation ON, auto-merge OFF) so Claude/you verify
#     every resulting PR before it lands. Override with DAEMON_MERGE=1 if desired.
#   - On completion a task file moves to queue/done/ (kept for audit).
#
# Enqueue with:  ./qadd.sh <slug> < path/to/task.txt    (or heredoc / pipe)
# Run with:      nohup ./queue-runner.sh > queue/runner.log 2>&1 &   (background)
# Stop with:     touch queue/STOP        (graceful — finishes current wave first)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")"

QUEUE_DIR="queue"
DONE_DIR="queue/done"
STOP_FILE="queue/STOP"
mkdir -p "$DONE_DIR"

# PR-only defaults for queued waves (you verify each PR). Override via env.
export DAEMON_DELEGATE="${DAEMON_DELEGATE:-1}"
export DAEMON_MERGE="${DAEMON_MERGE:-0}"
export DAEMON_AUTONOMOUS="${DAEMON_AUTONOMOUS:-1}"
export DAEMON_MAX_CHUNKS="${DAEMON_MAX_CHUNKS:-6}"
export DAEMON_BUDGET_USD="${DAEMON_BUDGET_USD:-30}"
export DAEMON_CWD="${DAEMON_CWD:-/Users/saranshsharma/Developer/jyt}"

daemon_alive() {
  # The persistent `node run.mjs` is the daemon's liveness signal (stays up
  # across fresh-context chunks). Exclude this runner + grep itself.
  ps aux | grep -E "[r]un\.mjs" | grep -v "queue-runner" >/dev/null 2>&1
}

wait_until_idle() {
  local idle=0
  while true; do
    if daemon_alive; then
      idle=0
    else
      idle=$((idle + 1))
      [ "$idle" -ge 2 ] && return 0   # ~60s confirmed idle → safe to launch
    fi
    perl -e 'select(undef,undef,undef,30)'   # 30s (foreground sleep is blocked)
  done
}

next_task() {
  # Lexically-lowest *.txt in the queue (NN- prefixes = priority). Empty if none.
  ls "$QUEUE_DIR"/*.txt 2>/dev/null | sort | head -n1
}

echo "[queue-runner] started — pid=$$  delegate=$DAEMON_DELEGATE merge=$DAEMON_MERGE chunks=$DAEMON_MAX_CHUNKS budget=\$$DAEMON_BUDGET_USD"

while true; do
  if [ -f "$STOP_FILE" ]; then
    echo "[queue-runner] STOP file present → exiting."; rm -f "$STOP_FILE"; exit 0
  fi

  task_file="$(next_task)"
  if [ -z "${task_file:-}" ]; then
    # Queue empty — poll so tasks appended later are still picked up.
    perl -e 'select(undef,undef,undef,30)'
    continue
  fi

  echo "[queue-runner] next task: $task_file — waiting for any live daemon to finish…"
  wait_until_idle

  # Re-check the file still exists (could've been pulled) and STOP wasn't set.
  [ -f "$STOP_FILE" ] && continue
  [ -f "$task_file" ] || continue

  # Self-heal SDK if a prior destructive chunk nuked it.
  if [ ! -d node_modules/@anthropic-ai/claude-agent-sdk ]; then
    echo "[queue-runner] SDK missing — reinstalling…"; npm i --silent
  fi

  export DAEMON_TASK="$(cat "$task_file")"
  base="$(basename "$task_file")"
  echo "[queue-runner] ▶ launching wave for: $base  ($(date '+%Y-%m-%d %H:%M:%S'))"

  # Foreground so we know exactly when this wave ends, then move on.
  node run.mjs
  rc=$?

  ts="$(date '+%Y%m%dT%H%M%S')"
  mv "$task_file" "$DONE_DIR/${ts}-${base}" 2>/dev/null || true
  echo "[queue-runner] ✔ wave done rc=$rc → archived to $DONE_DIR/${ts}-${base}"
done
