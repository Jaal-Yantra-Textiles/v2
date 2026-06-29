#!/usr/bin/env bash
# Stable launcher for the Agent-SDK PR daemon — pre-authorize with a single rule:
#   Bash(bash scripts/agent-daemon/launch.sh:*)
#
# Long-term defaults: up to 6 chunks, $12 est-budget cap, auto mode (build or
# analyze), self-healing, autonomous shell/git, BUILD + PR only (NO merge —
# PRs left for human review; set DAEMON_MERGE=1 to allow auto-merge→deploy).
# Override any DAEMON_* via env before calling.
set -euo pipefail
cd "$(dirname "$0")"

export DAEMON_CWD="${DAEMON_CWD:-/Users/saranshsharma/Developer/jyt}"
export DAEMON_MAX_CHUNKS="${DAEMON_MAX_CHUNKS:-10}"
export DAEMON_BUDGET_USD="${DAEMON_BUDGET_USD:-40}"
export DAEMON_MODE="${DAEMON_MODE:-auto}"
export DAEMON_AUTONOMOUS="${DAEMON_AUTONOMOUS:-1}"
# DAEMON_TASK empty → daemon auto-picks the next slice from the handoff.
export DAEMON_TASK="${DAEMON_TASK:-}"
# Free-model delegation (opencode drafter, verified by the daemon). On by default;
# set DAEMON_DELEGATE=0 to disable, or DAEMON_DELEGATE_MODEL to swap the free model.
export DAEMON_DELEGATE="${DAEMON_DELEGATE:-1}"
export DAEMON_DELEGATE_MODEL="${DAEMON_DELEGATE_MODEL:-opencode/deepseek-v4-flash-free}"

# Self-heal: ensure the SDK is present (a prior destructive chunk may have nuked it).
if [ ! -d node_modules/@anthropic-ai/claude-agent-sdk ]; then
  echo "[launch] SDK missing — reinstalling…"
  npm i --silent
fi

exec node run.mjs
