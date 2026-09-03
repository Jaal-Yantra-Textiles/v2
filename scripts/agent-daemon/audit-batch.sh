#!/usr/bin/env bash
# audit-batch.sh — audit a batch of GitHub issues end to end, unattended.
#
#   bash scripts/agent-daemon/audit-batch.sh 1450 1444 1447
#
# For each issue, in order:
#   1. dump the issue (title + body + every comment) to .audit/issues/<N>.md
#   2. run the audit agent against the CODE, writing .audit/verdicts/<N>.md
#   3. mechanically verify every citation in that verdict
#   4. append one row to .audit/BATCH-REPORT.md
#
# 🔴 It never posts to GitHub and never writes to prod. The output is a local
# report a human reads. Posting a verdict is a separate, deliberate act — a
# wrong "SHIPPED" closes a live defect, and that must not be automatable.
#
# Sequential on purpose: two agents in one checkout each see the other's writes
# as OUT-OF-SCOPE, because the change detector snapshots one shared git status.
# Parallelism here needs a worktree per issue, which the issue dumps would then
# have to be copied into. Not worth it for a read-only pass.
set -uo pipefail   # NOT -e: one bad issue must not kill the batch

cd "$(dirname "$0")/../.."
MODEL="${AUDIT_MODEL:-cloudflare-workers-ai/@cf/zai-org/glm-5.3}"
REPORT=".audit/BATCH-REPORT.md"

mkdir -p .audit/issues .audit/verdicts
{
  echo "# Batch audit — $(date -u '+%Y-%m-%d %H:%M UTC')"
  echo
  echo "Model: \`$MODEL\`. Nothing here has been posted to GitHub."
  echo
  echo "| issue | verdict | citations | status |"
  echo "|---|---|---|---|"
} > "$REPORT"

for n in "$@"; do
  echo "════════ #$n ════════"

  if ! gh issue view "$n" --json number,title,state,labels,body,comments --jq \
      '"# #\(.number) \(.title)\n\nstate: \(.state) | labels: \(.labels|map(.name)|join(", "))\n\n## Body\n\n\(.body)\n\n## Comments\n\n" + (.comments|map("### \(.author.login) — \(.createdAt)\n\n\(.body)")|join("\n\n---\n\n"))' \
      > ".audit/issues/$n.md"; then
    echo "| #$n | — | — | ❌ could not fetch the issue |" >> "$REPORT"
    continue
  fi

  title="$(gh issue view "$n" --json title -q .title 2>/dev/null || echo "?")"
  echo "  $title"

  node scripts/agent-daemon/delegate.mjs --mode audit --model "$MODEL" \
    --files ".audit/verdicts/$n.md" \
    "Audit GitHub issue #$n. The full issue — title, body and every comment — is dumped at .audit/issues/$n.md. READ THAT FILE FIRST, in full. Its title is: $title. Work out from the title and body which areas of the codebase are involved, find them yourself, and read the actual code before writing anything. Write your verdict to .audit/verdicts/$n.md following the seven required sections exactly." \
    > ".audit/verdicts/$n.log" 2>&1
  rc=$?

  if [ ! -s ".audit/verdicts/$n.md" ]; then
    echo "| #$n | — | — | ❌ no verdict written (exit $rc, see \`.audit/verdicts/$n.log\`) |" >> "$REPORT"
    continue
  fi

  verdict="$(grep -oE '\*\*(SHIPPED|PARTIAL|STILL-OPEN|NEEDS-PROD|UNCLEAR)\*\*' ".audit/verdicts/$n.md" | head -1 | tr -d '*')"
  [ -n "$verdict" ] || verdict="(unparsed)"

  cites="$(node scripts/agent-daemon/verify-analysis.mjs ".audit/verdicts/$n.md" 2>&1 | grep -oE '✓ [0-9]+ +~ambiguous [0-9]+ +✗file [0-9]+' | head -1)"
  [ -n "$cites" ] || cites="(none found)"

  # 🔑 A hallucinated file is the one unforgivable error, so it decides the row.
  if node scripts/agent-daemon/verify-analysis.mjs ".audit/verdicts/$n.md" >/dev/null 2>&1; then
    status="✅ all cited files exist"
  else
    status="🔴 CITES A FILE THAT DOES NOT EXIST — do not trust this verdict"
  fi

  echo "| #$n | $verdict | $cites | $status |" >> "$REPORT"
done

{
  echo
  echo "## Next"
  echo
  echo "Read each \`.audit/verdicts/<N>.md\`. A verdict is a HYPOTHESIS until a human"
  echo "checks its section 6 (Searches I ran) against its absence claims, and its"
  echo "section 4 (Reachability) against any \`SHIPPED\`. Nothing here is posted."
} >> "$REPORT"

echo
cat "$REPORT"
