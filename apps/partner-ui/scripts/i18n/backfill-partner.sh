#!/usr/bin/env bash
#
# Backfill the `partner` section of every non-English locale using the
# DashScope (Qwen) translator. Writes a progress log to /tmp so you can
# tail it in a separate terminal.
#
# Usage:
#   ./scripts/i18n/backfill-partner.sh                                      # all locales, --force, full partner section
#   ./scripts/i18n/backfill-partner.sh hi ja de                             # just these locales
#   SUBSECTION=home,sharedFolders,content ./scripts/i18n/backfill-partner.sh # surgical — only these sub-sections
#   CONCURRENCY=4 ./scripts/i18n/backfill-partner.sh                        # override parallelism
#   MODE=--resume ./scripts/i18n/backfill-partner.sh                        # skip already-translated
#
# Env:
#   DASHSCOPE_API_KEY  Required. Sourced from the repo's .env if present.
#   MODEL              Optional — defaults to the script's DEFAULT_DASHSCOPE_MODEL (qwen-plus).
#   CONCURRENCY        Optional — parallel locales (default 3).
#   MODE               Optional — either "--force" (default) or "--resume".
#   SUBSECTION         Optional — comma-separated child keys within the partner
#                      section to translate surgically (deep-merged into target).
#                      Example: SUBSECTION=home,sharedFolders,content
#   LOG_PATH           Optional — override log destination (default /tmp/translate-backfill.log).

set -u

# -- Paths --------------------------------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Walk up: scripts/i18n -> scripts -> partner-ui -> apps -> jyt
PARTNER_UI_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
REPO_ROOT="$(cd -- "$PARTNER_UI_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
LOG_PATH="${LOG_PATH:-/tmp/translate-backfill.log}"

# -- Env ----------------------------------------------------------------------
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090,SC2046
  set -a
  # Ignore lines that aren't valid shell assignments (the .env has a few noisy ones)
  source "$ENV_FILE" 2>/dev/null || true
  set +a
fi

if [[ -z "${DASHSCOPE_API_KEY:-}" && -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "ERROR: DASHSCOPE_API_KEY (or OPENROUTER_API_KEY) is not set." >&2
  echo "       Expected it in $ENV_FILE" >&2
  exit 1
fi

# -- Config -------------------------------------------------------------------
CONCURRENCY="${CONCURRENCY:-3}"
MODE="${MODE:---force}"
SUBSECTION="${SUBSECTION:-}"

DEFAULT_LOCALES=(
  ar bg bs cs de el es fa fr he hi hu id it ja ko lt mk mn nl pl
  ptBR ptPT ro ru th tr uk vi zhCN
)

if [[ $# -gt 0 ]]; then
  LOCALES=("$@")
else
  LOCALES=("${DEFAULT_LOCALES[@]}")
fi

cd "$PARTNER_UI_DIR"

# Fresh log
: > "$LOG_PATH"

if [[ -n "$SUBSECTION" ]]; then
  echo "Backfilling partner.{${SUBSECTION}} across ${#LOCALES[@]} locale(s) — mode=$MODE concurrency=$CONCURRENCY"
else
  echo "Backfilling entire partner section across ${#LOCALES[@]} locale(s) — mode=$MODE concurrency=$CONCURRENCY"
fi
echo "Log: $LOG_PATH"
echo "Locales: ${LOCALES[*]}"
echo ""
echo "Tail with: tail -f $LOG_PATH"
echo "Progress:  grep -c 'Done. 1/1 sections' $LOG_PATH"
echo ""

# -- Run ---------------------------------------------------------------------
# Use xargs with -P for parallel workers. Prefix every output line with [locale]
# so the log is greppable.
printf '%s\n' "${LOCALES[@]}" | \
  xargs -P "$CONCURRENCY" -I {} bash -c '
    locale="$1"
    mode="$2"
    subsection_arg="$3"
    args=(--section=partner "$mode")
    if [[ -n "$subsection_arg" ]]; then
      args+=("--subsection=$subsection_arg")
    fi
    node scripts/i18n/translate.js "$locale" "${args[@]}" 2>&1 \
      | sed "s|^|[$locale] |"
  ' _ {} "$MODE" "$SUBSECTION" \
  >> "$LOG_PATH" 2>&1

# -- Final summary -----------------------------------------------------------
# The translate.js script prints one "Done. X/Y sections" line per locale.
#   X=1,Y=1  → translated successfully
#   X=0,Y=0  → everything was skipped (e.g. --resume with already-translated)
#   X=0,Y=1  → attempted but failed (network/API/validation)
DONE=$(grep -c "Done\. 1/1 sections" "$LOG_PATH" || true)
SKIP=$(grep -c "Done\. 0/0 sections" "$LOG_PATH" || true)
# Match the Done line only (not the startup Target line) to count real failures.
FAIL=$(grep -c "Done\. 0/1 sections" "$LOG_PATH" || true)

echo ""
echo "Finished."
echo "  translated: $DONE / ${#LOCALES[@]}"
echo "  skipped:    $SKIP (already translated; use MODE=--force to retranslate)"
echo "  failures:   $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "Failed locales:"
  grep "Done\. 0/1 sections" "$LOG_PATH" | grep -o "^\[[a-zA-Z]*\]" | sort -u
  echo ""
  echo "Error details:"
  grep "^\[[a-zA-Z]*\] FAIL" "$LOG_PATH" | head -10
fi
