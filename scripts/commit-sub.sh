#!/usr/bin/env bash
#
# Commit + (optional) push helper for the storefront-starter submodule at
# apps/storefront-starter. The submodule is its own git repo with its own
# origin (git@github.com:Jaal-Yantra-Textiles/nextjs-starter-medusa.git),
# so this is deliberately independent of the parent jyt repo — nothing in
# here touches the parent. When you need the parent to reference an
# updated submodule SHA, commit that pointer bump separately with `git cm`
# in the parent.
#
# Installed as `git cm-sub` in this clone:
#   git config --local alias.cm-sub '!sh -c '"'"'"$(git rev-parse --show-toplevel)/scripts/commit-sub.sh" "$@"'"'"' -- '
#
# Usage:
#   git cm-sub "fix(seo): canonical tags"
#   git cm-sub --ai                # let Qwen draft the message
#   git cm-sub -m "msg" --push
#   git cm-sub --dry-run --yes -m "msg"
#
# Flags:
#   -m, --message <msg>   Commit message
#   --push                Push to upstream after commit (ff-safe)
#   --dry-run             Print the plan, don't modify anything
#   --yes, -y             Skip confirmation prompts
#   --no-untracked        Do NOT stage untracked files (on by default)
#   --ai                  Ask Qwen to draft a message from the diff
#   -h, --help            Show this help
#
# AI env vars (for --ai):
#   DASHSCOPE_API_KEY     required
#   DASHSCOPE_BASE_URL    default: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
#   DASHSCOPE_MODEL       default: qwen-plus

set -euo pipefail

JYT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUB_DIR="$JYT_ROOT/apps/storefront-starter"

MESSAGE=""
PUSH=0
DRY_RUN=0
INCLUDE_UNTRACKED=1
AI_SUGGEST=0
YES=0

DASHSCOPE_BASE_URL="${DASHSCOPE_BASE_URL:-https://dashscope-intl.aliyuncs.com/compatible-mode/v1}"
DASHSCOPE_MODEL="${DASHSCOPE_MODEL:-qwen-plus}"

c_info()  { printf "\033[1;34m==>\033[0m %s\n"    "$*" >&2; }
c_warn()  { printf "\033[1;33m!!\033[0m  %s\n"    "$*" >&2; }
c_err()   { printf "\033[1;31mERR\033[0m %s\n"    "$*" >&2; }
c_ok()    { printf "\033[1;32mOK\033[0m  %s\n"    "$*" >&2; }
c_dry()   { printf "\033[1;35m[dry]\033[0m %s\n"  "$*" >&2; }

die() { c_err "$*"; exit 1; }
usage() { sed -n '3,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

confirm() {
  if [[ "$YES" == "1" || "$DRY_RUN" == "1" ]]; then return 0; fi
  local prompt="$1"
  read -r -p "$prompt [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

has_changes() {
  (
    cd "$SUB_DIR"
    if ! git diff --quiet || ! git diff --cached --quiet; then return 0; fi
    if [[ "$INCLUDE_UNTRACKED" == "1" ]]; then
      [[ -n "$(git ls-files --others --exclude-standard)" ]] && return 0
    fi
    return 1
  )
}

check_repo_state() {
  local git_dir_rel git_dir
  git_dir_rel="$(cd "$SUB_DIR" && git rev-parse --git-dir)"
  git_dir="$SUB_DIR/$git_dir_rel"
  [[ "$git_dir_rel" = /* ]] && git_dir="$git_dir_rel"

  for marker in rebase-apply rebase-merge MERGE_HEAD CHERRY_PICK_HEAD BISECT_LOG; do
    if [[ -e "$git_dir/$marker" ]]; then
      die "submodule is in the middle of a $marker operation. Finish or abort it first."
    fi
  done

  if ! (cd "$SUB_DIR" && git symbolic-ref --short HEAD >/dev/null 2>&1); then
    die "submodule is in detached-HEAD state."
  fi
}

run_ai_suggest() {
  if [[ -z "${DASHSCOPE_API_KEY:-}" ]]; then
    c_warn "ai: DASHSCOPE_API_KEY not set — skipping"
    return 1
  fi
  command -v curl    >/dev/null 2>&1 || { c_warn "ai: curl missing";    return 1; }
  command -v python3 >/dev/null 2>&1 || { c_warn "ai: python3 missing"; return 1; }

  local files diff
  files="$(cd "$SUB_DIR" && {
    git diff --name-only HEAD 2>/dev/null
    [[ "$INCLUDE_UNTRACKED" == "1" ]] && git ls-files -o --exclude-standard 2>/dev/null
  } | sort -u | head -50)"
  diff="$(cd "$SUB_DIR" && git diff HEAD 2>/dev/null | head -c 6000)"

  if [[ -z "$files" && -z "$diff" ]]; then
    c_warn "ai: no changes to summarize"
    return 1
  fi

  local files_tmp diff_tmp payload
  files_tmp="$(mktemp -t jyt-ai-files.XXXXXX)"
  diff_tmp="$(mktemp -t jyt-ai-diff.XXXXXX)"
  printf '%s' "$files" >"$files_tmp"
  printf '%s' "$diff"  >"$diff_tmp"

  payload="$(python3 - "$DASHSCOPE_MODEL" "$files_tmp" "$diff_tmp" <<'PY'
import json, sys
model = sys.argv[1]
with open(sys.argv[2]) as f: files = f.read()
with open(sys.argv[3]) as f: diff  = f.read()
system = (
    "You write git commit messages for a Next.js storefront (Medusa.js starter). "
    "Respond with ONE line in conventional-commit format: "
    "type(scope): short imperative summary. "
    "Valid types: feat, fix, docs, style, refactor, perf, test, chore, ci, build. "
    "Keep under 72 chars. No quotes, no trailing period, no explanation."
)
user = f"Files changed:\n{files or '(none)'}\n\nDiff (may be truncated):\n{diff or '(empty)'}"
print(json.dumps({
    "model": model,
    "messages": [
        {"role": "system", "content": system},
        {"role": "user",   "content": user},
    ],
    "temperature": 0.2,
}))
PY
)"

  local resp
  resp="$(curl -sS --max-time 30 "$DASHSCOPE_BASE_URL/chat/completions" \
            -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
            -H "Content-Type: application/json" \
            -d "$payload" 2>/dev/null)" || {
    rm -f "$files_tmp" "$diff_tmp"; c_warn "ai: request failed"; return 1;
  }
  rm -f "$files_tmp" "$diff_tmp"

  local resp_tmp msg
  resp_tmp="$(mktemp -t jyt-ai-resp.XXXXXX)"
  printf '%s' "$resp" >"$resp_tmp"
  msg="$(python3 - "$resp_tmp" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f: d = json.load(f)
    content = d["choices"][0]["message"]["content"].strip()
    first = content.splitlines()[0].strip()
    for ch in ('"', "'", '`'):
        if first.startswith(ch) and first.endswith(ch): first = first[1:-1]
    print(first)
except Exception as e:
    sys.stderr.write(f"ai parse error: {e}\n"); sys.exit(1)
PY
)" || { rm -f "$resp_tmp"; c_warn "ai: couldn't parse response"; return 1; }
  rm -f "$resp_tmp"

  [[ -z "$msg" ]] && { c_warn "ai: empty message"; return 1; }
  printf '%s\n' "$msg"
}

ai_draft() {
  local __out="$1"
  [[ "$AI_SUGGEST" != "1" ]] && return 1
  c_info "ai: drafting message via $DASHSCOPE_MODEL..."
  local draft
  draft="$(run_ai_suggest)" || return 1
  [[ -z "$draft" ]] && return 1
  c_ok "ai: $draft"
  if [[ "$YES" == "1" ]]; then
    printf -v "$__out" '%s' "$draft"; return 0
  fi
  local reply
  read -r -p "Use this message? [Y/n/edit] " reply
  case "$reply" in
    ""|y|Y|yes|YES) printf -v "$__out" '%s' "$draft"; return 0 ;;
    e|E|edit)
      local edited
      echo "Current: $draft"
      read -r -p "Edit (empty = keep current)> " edited
      [[ -z "$edited" ]] && edited="$draft"
      printf -v "$__out" '%s' "$edited"
      return 0 ;;
    *) return 1 ;;
  esac
}

# --- parse args ----------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)        MESSAGE="$2"; shift 2 ;;
    --push)              PUSH=1; shift ;;
    --dry-run)           DRY_RUN=1; shift ;;
    --yes|-y)            YES=1; shift ;;
    --no-untracked)      INCLUDE_UNTRACKED=0; shift ;;
    --include-untracked) INCLUDE_UNTRACKED=1; shift ;;
    --ai)                AI_SUGGEST=1; shift ;;
    -h|--help)           usage ;;
    --)                  shift; break ;;
    -*)                  die "unknown flag: $1" ;;
    *)
      if [[ -z "$MESSAGE" ]]; then MESSAGE="$1"; shift
      else die "unexpected argument: $1"; fi
      ;;
  esac
done

# --- sanity --------------------------------------------------------------
[[ -d "$SUB_DIR/.git" || -f "$SUB_DIR/.git" ]] || die "$SUB_DIR is not a git repo (is the submodule initialized?)"
check_repo_state

# --- show status ---------------------------------------------------------
c_info "Submodule: apps/storefront-starter → $(cd "$SUB_DIR" && git remote get-url origin 2>/dev/null || echo '?')"
(cd "$SUB_DIR" && git status --short) >&2
echo >&2

if ! has_changes; then
  # No new changes, but maybe there are unpushed commits we can push.
  if [[ "$PUSH" != "1" ]]; then
    c_ok "Nothing to commit."
    exit 0
  fi
  c_info "No new changes — will try to push existing commits."
fi

# --- message + commit ----------------------------------------------------
if has_changes; then
  if [[ -z "$MESSAGE" ]]; then
    ai_draft MESSAGE || true
  fi
  if [[ -z "$MESSAGE" ]]; then
    if [[ "$YES" == "1" ]]; then
      die "commit message required (-m or positional) when --yes is set"
    fi
    echo "Enter commit message (single line, Ctrl-C to abort):"
    read -r MESSAGE
    [[ -n "$MESSAGE" ]] || die "empty commit message"
  fi

  confirm "Proceed with submodule commit?" || die "aborted"

  c_info "Committing in submodule..."
  if [[ "$DRY_RUN" == "1" ]]; then
    c_dry "cd $SUB_DIR && git add -u"
    [[ "$INCLUDE_UNTRACKED" == "1" ]] && c_dry "... and any untracked files"
    c_dry "git commit -m \"$MESSAGE\""
  else
    (
      cd "$SUB_DIR"
      git add -u
      if [[ "$INCLUDE_UNTRACKED" == "1" ]]; then
        untracked="$(git ls-files -o --exclude-standard)"
        if [[ -n "$untracked" ]]; then
          printf '%s\n' "$untracked" | xargs git add --
        fi
      fi
      if git diff --cached --quiet; then
        c_warn "submodule: nothing staged after add (skipped)"
        exit 0
      fi
      git commit -m "$(cat <<EOF
$MESSAGE

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
      c_ok "submodule → $(git rev-parse --short HEAD)"
    )
  fi
fi

# --- push ----------------------------------------------------------------
push_repo() {
  (
    cd "$SUB_DIR"
    local branch remote merge
    branch="$(git symbolic-ref --short HEAD 2>/dev/null)" \
      || die "submodule: detached HEAD, refusing to push"
    remote="$(git config --get "branch.$branch.remote" || true)"
    merge="$(git config --get "branch.$branch.merge" | sed 's#refs/heads/##' || true)"
    if [[ -z "$remote" || -z "$merge" ]]; then
      die "submodule: branch '$branch' has no upstream (git branch --set-upstream-to=<remote>/<branch>)"
    fi

    local url
    url="$(git remote get-url "$remote" 2>/dev/null || echo '?')"
    c_info "submodule: push $branch → $remote ($url)"

    git fetch --quiet "$remote" "$merge" || die "submodule: fetch from $remote failed"
    if ! git merge-base --is-ancestor "$remote/$merge" HEAD 2>/dev/null; then
      die "submodule: local $branch is behind $remote/$merge — pull/rebase first"
    fi
    local ahead
    ahead="$(git rev-list --count "$remote/$merge..HEAD")"
    if [[ "$ahead" == "0" ]]; then
      c_info "submodule: already up-to-date — nothing to push"
      return 0
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
      c_dry "submodule: would push $ahead commit(s) to $remote/$merge"
    else
      git push "$remote" "$branch"
      c_ok "submodule: pushed $ahead commit(s) to $remote/$merge"
    fi
  )
}

[[ "$PUSH" == "1" ]] && push_repo

c_ok "Done."
