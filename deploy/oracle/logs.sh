#!/usr/bin/env bash
# The `aws logs tail` of the A1 box: logcli against Loki through an SSH tunnel.
# Needs logcli on the laptop:  brew install logcli
#
#   deploy/oracle/logs.sh server                    last 1h of the Medusa server
#   deploy/oracle/logs.sh server -f                 follow (like aws logs tail --follow)
#   deploy/oracle/logs.sh worker --since 6h --grep 'error|failed'
#   deploy/oracle/logs.sh unit jyt-pg-backup.service --since 48h
#   deploy/oracle/logs.sh query '{project="jyt"} |= "payu"' --since 24h
#   deploy/oracle/logs.sh labels service            list label values
# Any extra flags go straight to logcli (--limit, --output raw|jsonl, --from/--to …).
set -euo pipefail
HOST="${LOGS_HOST:-ubuntu@130.61.141.163}"
PORT="${LOGS_PORT:-13100}"
command -v logcli >/dev/null || { echo "install logcli first: brew install logcli" >&2; exit 1; }
[ $# -ge 1 ] || { sed -n '2,12p' "$0"; exit 1; }

if ! nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
  ssh -fNT -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L "$PORT:127.0.0.1:3100" "$HOST"
fi
export LOKI_ADDR="http://127.0.0.1:$PORT"

what="$1"; shift
case "$what" in
  labels) exec logcli labels --quiet "$@" ;;
  query)  q="$1"; shift ;;
  unit)   q="{unit=\"$1\"}"; shift ;;
  *)      q="{project=\"jyt\", service=\"$what\"}" ;;
esac

args=(); since="1h"; limit=1000
while [ $# -gt 0 ]; do
  case "$1" in
    --grep) q="$q |~ \"(?i)$2\""; shift 2 ;;
    --since) since="$2"; shift 2 ;;
    --limit) limit="$2"; shift 2 ;;
    -f|--follow) args+=(--tail); shift ;;
    *) args+=("$1"); shift ;;
  esac
done
exec logcli query --quiet "$q" --since "$since" --limit "$limit" --forward --output raw ${args[@]+"${args[@]}"}
