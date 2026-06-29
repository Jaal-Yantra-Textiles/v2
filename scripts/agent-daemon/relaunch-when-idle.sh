#!/usr/bin/env bash
# Wait for the currently-running PR daemon to finish, then auto-launch the next
# wave (launch-next.sh). Guarantees the two daemons never edit the workspace at
# the same time. One-shot: relaunches exactly once, then this process becomes the
# next daemon (via exec), so its completion notification = the next wave finishing.
set -uo pipefail
cd "$(dirname "$0")"

daemon_alive() {
  # The persistent `node run.mjs` process is the daemon's liveness signal
  # (it stays up across fresh-context chunks). Exclude this waiter + grep.
  ps aux | grep -E "[r]un\.mjs" | grep -v "relaunch-when-idle" >/dev/null 2>&1
}

echo "[relaunch] waiting for current daemon to finish…"
idle=0
for i in $(seq 1 240); do            # up to ~2h
  if daemon_alive; then
    idle=0
  else
    idle=$((idle + 1))
    echo "[relaunch] idle check ${idle}/2"
    if [ "$idle" -ge 2 ]; then        # ~60s of confirmed idle → safe to relaunch
      echo "[relaunch] current daemon done → launching next wave"
      exec bash launch-next.sh
    fi
  fi
  perl -e 'select(undef,undef,undef,30)'   # 30s (foreground sleep is blocked)
done
echo "[relaunch] timed out (~2h) waiting for the daemon to finish; NOT relaunching."
