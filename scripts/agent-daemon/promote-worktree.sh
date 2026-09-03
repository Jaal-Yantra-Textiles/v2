#!/usr/bin/env bash
# promote-worktree.sh — turn a VERIFIED agent worktree into a DRAFT pull request.
#
#   bash scripts/agent-daemon/promote-worktree.sh <slug> "<pr title>" [pr-body-file]
#
# 🔴 Why this is a separate script the agent cannot run
#
# The implementer agent has git and gh DENIED at the permission layer. Branch,
# commit, push and PR happen HERE, run by a human or by the verifying agent,
# AFTER the diff has been read. Three repo-specific reasons this is not
# paranoia:
#
#   1. `gh pr merge --auto` does NOT queue in this repo — it merges IMMEDIATELY,
#      over pending checks.
#   2. Production deploy is NOT gated on tests. A merge is a deploy.
#   3. A PR on GitHub is outward-facing and cannot be un-published.
#
# So: DRAFT PRs only, never a merge, and never from inside the model's turn.
set -euo pipefail

slug="${1:?usage: promote-worktree.sh <slug> \"<pr title>\" [pr-body-file]}"
title="${2:?a PR title is required}"
body_file="${3:-}"

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
wt="$(dirname "$repo_root")/jyt-wt-${slug}"
branch="agent/${slug}"

[ -d "$wt" ] || { echo "promote: no worktree at $wt"; exit 1; }

echo "== worktree: $wt"
echo "== branch:   $branch"
echo
echo "== files changed (this is what will be committed):"
git -C "$wt" status --porcelain -uall
echo

# Stage exactly what changed — never `git add -A` from a parent dir, and never
# `-A` at all: it would sweep in any untracked scratch the run left behind.
# Never stage the agent working dir: `.audit/` holds issue dumps and the
# reviewer's gap report, and `scripts/agent-daemon/` receives a copy of
# MEDUSA_CONVENTIONS.md on every run. Both are process artifacts, not the change.
git -C "$wt" add -u -- . ':(exclude).audit' ':(exclude)scripts/agent-daemon'
git -C "$wt" ls-files --others --exclude-standard -z -- . ':(exclude).audit' ':(exclude)scripts/agent-daemon' \
  | xargs -0 -r git -C "$wt" add --

if git -C "$wt" diff --cached --quiet; then
  echo "promote: nothing staged — the agent changed nothing. Not opening a PR."
  exit 1
fi

echo "== staged diffstat:"
git -C "$wt" diff --cached --stat

git -C "$wt" commit -m "$title" -m "Drafted by the opencode implementer agent; diff reviewed before push.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"

git -C "$wt" push -u origin "$branch"

if [ -n "$body_file" ] && [ -f "$body_file" ]; then
  gh pr create --draft --head "$branch" --title "$title" --body-file "$body_file"
else
  gh pr create --draft --head "$branch" --title "$title" \
    --body "Drafted by the opencode implementer agent in an isolated worktree, diff reviewed before push.

**Draft on purpose.** e2e specs in this branch were authored but NOT run by the agent (the e2e job overwrites \`.env\`, and a foreign process on :9000 would grade the wrong build). Run them before marking ready.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TLt1f38xqR8k2myCVxP8e4"
fi
