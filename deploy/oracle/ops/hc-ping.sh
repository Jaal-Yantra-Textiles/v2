#!/usr/bin/env bash
# Dead-man switch for the whole box (systemd jyt-hc-ping.timer, every 5 min).
# Pings healthchecks.io while the Medusa server answers /health, reports /fail
# when it doesn't. If the box dies, the pings stop and healthchecks.io alerts
# from the outside, which Gatus (running on this box) cannot do.
set -uo pipefail
URL=$(sed -n 's/^HC_PING_URL=//p' /opt/jyt-ops/.env)
[ -n "$URL" ] || exit 0
if body=$(curl -fsS -m 10 http://127.0.0.1:9000/health 2>&1); then
  curl -fsS -m 10 --retry 3 -o /dev/null "$URL"
else
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "server /health failed: $body" "$URL/fail"
fi
