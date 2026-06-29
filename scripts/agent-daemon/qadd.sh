#!/usr/bin/env bash
# Enqueue a task for the daemon queue-runner.
#
#   ./qadd.sh <slug> < task.txt          # from a file
#   ./qadd.sh <slug> <<'EOF' … EOF       # heredoc
#   echo "task text" | ./qadd.sh <slug>  # pipe
#   ./qadd.sh --prio 05 <slug> < task.txt  # explicit NN- priority prefix
#
# Writes queue/<NN>-<slug>.txt. Lower NN runs first. Default NN auto-increments
# above the highest pending file so new tasks land at the END of the queue
# (which is exactly "supply a list of tasks at the end to pick").
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p queue

prio=""
if [ "${1:-}" = "--prio" ]; then prio="$2"; shift 2; fi

slug="${1:?usage: qadd.sh [--prio NN] <slug>  (task text on stdin)}"
slug="$(echo "$slug" | tr -c 'a-zA-Z0-9_-' '-' | sed -E 's/-+/-/g; s/^-|-$//g')"

if [ -z "$prio" ]; then
  # One above the current max pending prefix (default 50 if queue empty).
  max="$( (ls queue/*.txt 2>/dev/null | sed -E 's#.*/([0-9]+)-.*#\1#' | grep -E '^[0-9]+$' | sort -n | tail -1) || true )"
  prio="$(printf '%02d' $(( ${max:-40} + 10 )))"
fi

out="queue/${prio}-${slug}.txt"
cat > "$out"
[ -s "$out" ] || { echo "qadd: refusing to enqueue an empty task ($out)"; rm -f "$out"; exit 1; }
echo "queued → $out  ($(wc -l < "$out") lines)"
