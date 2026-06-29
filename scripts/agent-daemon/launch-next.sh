#!/usr/bin/env bash
# Relaunch the PR daemon on the NEXT backlog wave (after the current batch).
# Delegation ON, NO auto-merge (human review). Task text lives in
# next-wave-task.txt (read via cat to dodge shell-quoting). Invoked by
# relaunch-when-idle.sh once the prior daemon process has exited.
set -euo pipefail
cd "$(dirname "$0")"

export DAEMON_MAX_CHUNKS="${DAEMON_MAX_CHUNKS:-5}"
export DAEMON_BUDGET_USD="${DAEMON_BUDGET_USD:-25}"
export DAEMON_DELEGATE="${DAEMON_DELEGATE:-1}"
export DAEMON_CWD="${DAEMON_CWD:-/Users/saranshsharma/Developer/jyt}"
export DAEMON_AUTONOMOUS="${DAEMON_AUTONOMOUS:-1}"
export DAEMON_TASK="$(cat next-wave-task.txt)"

# Self-heal SDK if a prior destructive chunk nuked it.
if [ ! -d node_modules/@anthropic-ai/claude-agent-sdk ]; then
  echo "[launch-next] SDK missing — reinstalling…"
  npm i --silent
fi

echo "[launch-next] starting next-wave daemon (chunks=$DAEMON_MAX_CHUNKS budget=\$$DAEMON_BUDGET_USD delegate=$DAEMON_DELEGATE)"
exec node run.mjs
