#!/usr/bin/env bash
#
# Commit + (optional) push helper for the jyt parent repo ONLY.
# Does NOT touch the apps/storefront-starter submodule — the submodule
# is a separate git repo with its own origin, and bundling its commits
# here was causing spurious CI builds from no-op pointer bumps. Use
# scripts/commit-sub.sh when you actually need to commit inside the
# storefront-starter submodule.
#
# What it does:
#   1. Stages tracked modifications (+ untracked files, unless --no-untracked).
#   2. Auto-injects a conventional-commit scope from staged paths.
#   3. Runs eslint --fix on staged ts/js files, then tsc --noEmit.
#   4. Commits.
#   5. Optionally pushes to the branch's configured upstream, with a
#      fetch + fast-forward check.
#
# Installed as `git cm` in this clone:
#   git config --local alias.cm '!sh -c '"'"'"$(git rev-parse --show-toplevel)/scripts/commit-parent.sh" "$@"'"'"' -- '
#
# Usage:
#   git cm "feat: my message"
#   git cm -m "msg" --push
#   git cm --ai                 # let Qwen draft the message
#   git cm --dry-run --yes -m "msg"
#
# Flags:
#   -m, --message <msg>   Commit message (conventional-commit form preferred)
#   --push                Push to upstream after committing (ff-safe)
#   --dry-run             Print the plan, don't modify anything
#   --yes, -y             Skip confirmation prompts (needed for CI)
#   --no-untracked        Do NOT stage untracked files (they're on by default)
#   --include-untracked   (legacy no-op — on by default now)
#   --skip-lint           Skip eslint pre-check
#   --skip-build          Skip tsc --noEmit pre-check
#   --ai                  Ask Qwen (Alibaba DashScope) to draft a message
#                         from the staged diff. With --yes the suggestion
#                         is used as-is; otherwise [Y/n/edit] prompt.
#   -h, --help            Show this help
#
# AI env vars (for --ai):
#   DASHSCOPE_API_KEY     required
#   DASHSCOPE_BASE_URL    default: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
#   DASHSCOPE_MODEL       default: qwen-plus  (e.g. qwen-turbo, qwen-max)
#
# Scope auto-detection:
#   Bare "feat: add x" + staged files under src/api/ → "feat(api): add x".
#   Existing scope or non-conventional messages are left alone.
#
# Safety:
#   - Never runs `git add -A`.
#   - Refuses to run if the repo is mid-rebase/merge/cherry-pick or
#     detached-HEAD.
#   - Push requires the current branch to be strictly ahead of its
#     configured upstream (no force, no non-ff).

set -euo pipefail

# --- constants -----------------------------------------------------------
JYT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- flags ---------------------------------------------------------------
MESSAGE=""
PUSH=0
DRY_RUN=0
INCLUDE_UNTRACKED=1
SKIP_LINT=0
SKIP_BUILD=0
AI_SUGGEST=0
YES=0

DASHSCOPE_BASE_URL="${DASHSCOPE_BASE_URL:-https://dashscope-intl.aliyuncs.com/compatible-mode/v1}"
DASHSCOPE_MODEL="${DASHSCOPE_MODEL:-qwen-plus}"

# --- helpers -------------------------------------------------------------
# All diagnostics go to stderr so stdout is free for captured output
# (e.g. run_ai_suggest emits the message on stdout).
c_info()  { printf "\033[1;34m==>\033[0m %s\n"    "$*" >&2; }
c_warn()  { printf "\033[1;33m!!\033[0m  %s\n"    "$*" >&2; }
c_err()   { printf "\033[1;31mERR\033[0m %s\n"    "$*" >&2; }
c_ok()    { printf "\033[1;32mOK\033[0m  %s\n"    "$*" >&2; }
c_dry()   { printf "\033[1;35m[dry]\033[0m %s\n"  "$*" >&2; }

die() { c_err "$*"; exit 1; }

usage() {
  sed -n '3,/^$/p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

confirm() {
  if [[ "$YES" == "1" || "$DRY_RUN" == "1" ]]; then return 0; fi
  local prompt="$1"
  read -r -p "$prompt [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

has_changes() {
  (
    cd "$JYT_ROOT"
    if ! git diff --quiet || ! git diff --cached --quiet; then
      return 0
    fi
    if [[ "$INCLUDE_UNTRACKED" == "1" ]]; then
      [[ -n "$(git ls-files --others --exclude-standard)" ]] && return 0
    fi
    return 1
  )
}

check_repo_state() {
  local git_dir_rel git_dir
  git_dir_rel="$(cd "$JYT_ROOT" && git rev-parse --git-dir)"
  git_dir="$JYT_ROOT/$git_dir_rel"
  [[ "$git_dir_rel" = /* ]] && git_dir="$git_dir_rel"

  for marker in rebase-apply rebase-merge MERGE_HEAD CHERRY_PICK_HEAD BISECT_LOG; do
    if [[ -e "$git_dir/$marker" ]]; then
      die "parent is in the middle of a $marker operation. Finish or abort it first."
    fi
  done

  if ! (cd "$JYT_ROOT" && git symbolic-ref --short HEAD >/dev/null 2>&1); then
    die "parent is in detached-HEAD state."
  fi
}

suggest_scope() {
  local files
  files="$(cd "$JYT_ROOT" && git diff --cached --name-only 2>/dev/null)"
  [[ -z "$files" ]] && return 0
  if   grep -q "^src/api/"           <<<"$files"; then echo "api"
  elif grep -q "^src/admin/"         <<<"$files"; then echo "admin"
  elif grep -q "^src/workflows/"     <<<"$files"; then echo "workflows"
  elif grep -q "^src/subscribers/"   <<<"$files"; then echo "subscribers"
  elif grep -q "^src/modules/payment" <<<"$files"; then echo "payments"
  elif grep -q "^src/modules/media"  <<<"$files"; then echo "media"
  elif grep -q "^src/modules/social" <<<"$files"; then echo "social"
  elif grep -q "^src/modules/"       <<<"$files"; then echo "modules"
  elif grep -q "^src/links/"         <<<"$files"; then echo "links"
  elif grep -q "^apps/partner-ui/"   <<<"$files"; then echo "partner-ui"
  elif grep -q "^apps/docs/"         <<<"$files"; then echo "docs"
  elif grep -q "^apps/"              <<<"$files"; then echo "apps"
  elif grep -q "^jyt-plugins/"       <<<"$files"; then echo "plugins"
  elif grep -q "^integration-tests/" <<<"$files"; then echo "tests"
  elif grep -q "^scripts/"           <<<"$files"; then echo "scripts"
  elif grep -q "^\\.github/"         <<<"$files"; then echo "ci"
  fi
}

inject_scope() {
  local msg="$1" scope="$2"
  [[ -z "$scope" ]] && { echo "$msg"; return; }
  if [[ "$msg" =~ ^[a-zA-Z]+\(.+\):\  ]]; then echo "$msg"; return; fi
  if [[ "$msg" =~ ^([a-zA-Z]+):\ (.*)$ ]]; then
    echo "${BASH_REMATCH[1]}($scope): ${BASH_REMATCH[2]}"; return
  fi
  echo "$msg"
}

run_lint() {
  local staged
  staged="$(cd "$JYT_ROOT" && git diff --cached --name-only --diff-filter=ACM \
              | grep -E '^(src|apps/partner-ui/src)/.*\.(ts|tsx|js|jsx)$' || true)"
  if [[ -z "$staged" ]]; then
    c_info "lint: no staged ts/js files — skipping"
    return 0
  fi
  if ! command -v npx >/dev/null 2>&1; then
    c_warn "lint: npx not found — skipping"
    return 0
  fi

  c_info "lint: eslint --fix on $(wc -l <<<"$staged" | tr -d ' ') staged file(s)..."
  local ok=0
  (cd "$JYT_ROOT" && xargs npx eslint --fix <<<"$staged") || ok=$?
  if [[ "$ok" -ne 0 ]]; then
    c_warn "lint: issues remain after --fix"
    return 1
  fi
  (cd "$JYT_ROOT" && xargs git add <<<"$staged") || true
  c_ok "lint: clean"
  return 0
}

run_build_check() {
  if ! command -v npx >/dev/null 2>&1; then
    c_warn "build: npx not found — skipping"
    return 0
  fi
  c_info "build: tsc --noEmit ..."
  local tmp
  tmp="$(mktemp -t jyt-tsc.XXXXXX)"
  (cd "$JYT_ROOT" && npx tsc --noEmit 2>&1 | grep -E "^src/" || true) >"$tmp"
  local errs
  errs="$(wc -l <"$tmp" | tr -d ' ')"
  if [[ "$errs" -gt 0 ]]; then
    c_warn "build: $errs type error(s):"
    head -15 "$tmp" >&2
    [[ "$errs" -gt 15 ]] && echo "  ... and $((errs - 15)) more" >&2
    rm -f "$tmp"
    return 1
  fi
  rm -f "$tmp"
  c_ok "build: clean"
  return 0
}

# Qwen/DashScope message draft. Writes message to stdout on success.
run_ai_suggest() {
  if [[ -z "${DASHSCOPE_API_KEY:-}" ]]; then
    c_warn "ai: DASHSCOPE_API_KEY not set — skipping"
    return 1
  fi
  command -v curl    >/dev/null 2>&1 || { c_warn "ai: curl missing";    return 1; }
  command -v python3 >/dev/null 2>&1 || { c_warn "ai: python3 missing"; return 1; }

  local files diff
  files="$(cd "$JYT_ROOT" && {
    git diff --name-only HEAD 2>/dev/null
    [[ "$INCLUDE_UNTRACKED" == "1" ]] && git ls-files -o --exclude-standard 2>/dev/null
  } | sort -u | head -50)"
  diff="$(cd "$JYT_ROOT" && git diff HEAD 2>/dev/null | head -c 6000)"

  if [[ -z "$files" && -z "$diff" ]]; then
    c_warn "ai: no changes to summarize"
    return 1
  fi

  local files_tmp diff_tmp
  files_tmp="$(mktemp -t jyt-ai-files.XXXXXX)"
  diff_tmp="$(mktemp -t jyt-ai-diff.XXXXXX)"
  printf '%s' "$files" >"$files_tmp"
  printf '%s' "$diff"  >"$diff_tmp"

  local payload
  payload="$(python3 - "$DASHSCOPE_MODEL" "$files_tmp" "$diff_tmp" <<'PY'
import json, sys
model = sys.argv[1]
with open(sys.argv[2]) as f: files = f.read()
with open(sys.argv[3]) as f: diff  = f.read()
system = (
    "You write git commit messages for the jyt Medusa e-commerce backend. "
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
    --include-untracked) INCLUDE_UNTRACKED=1; shift ;;
    --no-untracked)      INCLUDE_UNTRACKED=0; shift ;;
    --skip-lint)         SKIP_LINT=1; shift ;;
    --skip-build)        SKIP_BUILD=1; shift ;;
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
[[ -d "$JYT_ROOT/.git" || -f "$JYT_ROOT/.git" ]] || die "$JYT_ROOT is not a git repo"
check_repo_state

# --- show status ---------------------------------------------------------
c_info "Parent repo: $JYT_ROOT"
(cd "$JYT_ROOT" && git status --short) >&2
echo >&2

if ! has_changes; then
  c_ok "Nothing to commit."
  exit 0
fi

# --- message -------------------------------------------------------------
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

confirm "Proceed with commit?" || die "aborted"

# --- commit --------------------------------------------------------------
c_info "Staging parent (jyt)..."
if [[ "$DRY_RUN" == "1" ]]; then
  c_dry "cd $JYT_ROOT && git add -u"
  [[ "$INCLUDE_UNTRACKED" == "1" ]] && c_dry "... and any untracked files"
  [[ "$SKIP_LINT"  == "0" ]] && c_dry "eslint --fix on staged files"
  [[ "$SKIP_BUILD" == "0" ]] && c_dry "tsc --noEmit"
  c_dry "git commit -m \"<scoped: $MESSAGE>\""
else
  (
    cd "$JYT_ROOT"
    git add -u
    if [[ "$INCLUDE_UNTRACKED" == "1" ]]; then
      untracked="$(git ls-files -o --exclude-standard)"
      if [[ -n "$untracked" ]]; then
        printf '%s\n' "$untracked" | xargs git add --
      fi
    fi
    if git diff --cached --quiet; then
      c_warn "parent: nothing staged after add (skipped)"
      exit 0
    fi

    scope="$(suggest_scope)"
    if [[ -n "$scope" ]]; then
      new_msg="$(inject_scope "$MESSAGE" "$scope")"
      if [[ "$new_msg" != "$MESSAGE" ]]; then
        c_info "scope: injected '$scope' → $new_msg"
        MESSAGE="$new_msg"
      fi
    fi

    if [[ "$SKIP_LINT" == "0" ]]; then
      if ! run_lint; then
        confirm "Lint has issues. Commit anyway?" || { c_err "aborted by lint"; exit 1; }
      fi
    fi
    if [[ "$SKIP_BUILD" == "0" ]]; then
      if ! run_build_check; then
        confirm "Type errors present. Commit anyway?" || { c_err "aborted by build check"; exit 1; }
      fi
    fi

    git commit -m "$(cat <<EOF
$MESSAGE

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
    c_ok "parent → $(git rev-parse --short HEAD)"
  )
fi

# --- push ----------------------------------------------------------------
push_repo() {
  (
    cd "$JYT_ROOT"
    local branch remote merge
    branch="$(git symbolic-ref --short HEAD 2>/dev/null)" \
      || die "parent: detached HEAD, refusing to push"
    remote="$(git config --get "branch.$branch.remote" || true)"
    merge="$(git config --get "branch.$branch.merge" | sed 's#refs/heads/##' || true)"
    if [[ -z "$remote" || -z "$merge" ]]; then
      die "parent: branch '$branch' has no upstream (git branch --set-upstream-to=<remote>/<branch>)"
    fi

    local url
    url="$(git remote get-url "$remote" 2>/dev/null || echo '?')"
    c_info "parent: push $branch → $remote ($url)"

    git fetch --quiet "$remote" "$merge" || die "parent: fetch from $remote failed"
    if ! git merge-base --is-ancestor "$remote/$merge" HEAD 2>/dev/null; then
      die "parent: local $branch is behind $remote/$merge — pull/rebase first"
    fi
    local ahead
    ahead="$(git rev-list --count "$remote/$merge..HEAD")"
    if [[ "$ahead" == "0" ]]; then
      c_info "parent: already up-to-date — nothing to push"
      return 0
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
      c_dry "parent: would push $ahead commit(s) to $remote/$merge"
    else
      git push "$remote" "$branch"
      c_ok "parent: pushed $ahead commit(s) to $remote/$merge"
    fi
  )
}

[[ "$PUSH" == "1" ]] && push_repo

c_ok "Done."
