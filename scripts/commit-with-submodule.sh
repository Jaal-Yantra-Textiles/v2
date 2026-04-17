#!/usr/bin/env bash
#
# Commit + (optional) push helper that understands the `jyt` ↔
# `apps/storefront-starter` submodule split.
#
# Complements the existing `scripts/commit.sh` (which runs lint / secret
# scan / build checks on the parent repo) — use THIS script when your
# changes touch the storefront-starter submodule and you need both the
# submodule commit and the parent pointer bump in one step.
#
# What it does, in order:
#   1. Shows git status in parent AND submodule.
#   2. If the submodule has uncommitted tracked changes, commits them
#      with the message you supply.
#   3. If the parent now has an updated submodule pointer (or any other
#      tracked changes), commits those in the parent.
#   4. Optionally pushes both repos.
#
# Usage:
#   ./scripts/commit-with-submodule.sh "fix(seo): canonical tags"
#   ./scripts/commit-with-submodule.sh -m "msg" --push
#   ./scripts/commit-with-submodule.sh -m "msg" --dry-run
#   ./scripts/commit-with-submodule.sh                  # interactive
#
# Install as `git cm` in this clone (one-time setup):
#   git config --local alias.cm '!sh -c '"'"'"$(git rev-parse --show-toplevel)/scripts/commit-with-submodule.sh" "$@"'"'"' -- '
# Then:
#   git cm "my commit message"
#   git cm -m "msg" --push
#   git cm --dry-run --yes -m "msg"
#
# If you prefer a plain shell alias, add to ~/.zshrc or ~/.bashrc:
#   alias gcm='./scripts/commit-with-submodule.sh'
#
# Flags:
#   -m, --message <msg>   Commit message (shared by sub & parent by default)
#   --parent-message <m>  Override commit message for the parent repo
#   --push                Push both submodule and parent after committing
#   --dry-run             Show actions without modifying anything
#   --yes                 Skip confirmation prompts (needed for CI)
#   --no-untracked        Do NOT stage untracked files (on by default)
#   --include-untracked   (legacy no-op — untracked is on by default now)
#   --skip-lint           Skip eslint pre-check on staged files
#   --skip-build          Skip `tsc --noEmit` pre-check
#   --ai                  Ask Qwen (Alibaba DashScope, OpenAI-compatible)
#                         to draft a commit message from the staged diff.
#                         With --yes, the suggestion is used directly;
#                         otherwise you get [Y/edit] prompt.
#   -h, --help            Show this help
#
# AI env vars (for --ai):
#   DASHSCOPE_API_KEY     required — your Alibaba DashScope API key
#   DASHSCOPE_BASE_URL    default: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
#   DASHSCOPE_MODEL       default: qwen-plus  (e.g. qwen-turbo, qwen-max)
#
# Pre-commit checks (parent repo only):
#   - eslint --fix on staged .ts/.tsx/.js/.jsx (re-stages fixes)
#   - tsc --noEmit — fails fast on type errors
#   Both are prompt-to-continue on failure; use --skip-lint / --skip-build
#   to bypass entirely.
#
# Scope auto-detection:
#   If the message is a bare conventional-commit ("feat: add x", "fix: bug")
#   with no scope, a scope is inferred from the staged paths (api, admin,
#   workflows, scripts, …) and injected → "feat(api): add x".
#
# Safety:
#   - Never runs `git add -A`. Stages tracked modifications + submodule
#     pointer + untracked files (unless --no-untracked).
#   - Refuses to run if either repo is mid-rebase / merge / cherry-pick
#     or in detached-HEAD state.

set -euo pipefail

# --- constants -----------------------------------------------------------
JYT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBMODULE_PATH="apps/storefront-starter"
SUBMODULE_DIR="$JYT_ROOT/$SUBMODULE_PATH"

# --- flags ---------------------------------------------------------------
MESSAGE=""
PARENT_MESSAGE=""
PUSH=0
DRY_RUN=0
INCLUDE_UNTRACKED=1
SKIP_LINT=0
SKIP_BUILD=0
AI_SUGGEST=0
YES=0

# AI defaults (overridable via env).
DASHSCOPE_BASE_URL="${DASHSCOPE_BASE_URL:-https://dashscope-intl.aliyuncs.com/compatible-mode/v1}"
DASHSCOPE_MODEL="${DASHSCOPE_MODEL:-qwen-plus}"

# --- helpers -------------------------------------------------------------
c_info()  { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
c_warn()  { printf "\033[1;33m!!\033[0m  %s\n" "$*"; }
c_err()   { printf "\033[1;31mERR\033[0m %s\n" "$*" >&2; }
c_ok()    { printf "\033[1;32mOK\033[0m  %s\n" "$*"; }
c_dry()   { printf "\033[1;35m[dry]\033[0m %s\n" "$*"; }

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

# Returns 0 if the repo at $1 has staged OR unstaged tracked changes.
# Untracked files don't count unless INCLUDE_UNTRACKED=1.
has_changes() {
  local dir="$1"
  (
    cd "$dir"
    if ! git diff --quiet || ! git diff --cached --quiet; then
      return 0
    fi
    if [[ "$INCLUDE_UNTRACKED" == "1" ]]; then
      [[ -n "$(git ls-files --others --exclude-standard)" ]] && return 0
    fi
    return 1
  )
}

# Refuse to proceed if the repo is in rebase/merge/cherry-pick/bisect.
check_repo_state() {
  local dir="$1" name="$2"
  local git_dir_rel
  git_dir_rel="$(cd "$dir" && git rev-parse --git-dir)"
  local git_dir="$dir/$git_dir_rel"
  [[ "$git_dir_rel" = /* ]] && git_dir="$git_dir_rel"

  for marker in rebase-apply rebase-merge MERGE_HEAD CHERRY_PICK_HEAD BISECT_LOG; do
    if [[ -e "$git_dir/$marker" ]]; then
      die "$name is in the middle of a $marker operation. Finish or abort it first."
    fi
  done

  local branch
  branch="$(cd "$dir" && git rev-parse --abbrev-ref HEAD)"
  if [[ "$branch" == "HEAD" ]]; then
    die "$name is in detached-HEAD state."
  fi
}

# Suggest a conventional-commit scope based on currently-staged paths in
# the parent repo. Echoes a single scope token or empty string.
suggest_scope() {
  local files
  files="$(cd "$JYT_ROOT" && git diff --cached --name-only 2>/dev/null)"
  [[ -z "$files" ]] && return 0

  # Order matters — most-specific first.
  if   grep -q "^src/api/"                <<<"$files"; then echo "api"
  elif grep -q "^src/admin/"              <<<"$files"; then echo "admin"
  elif grep -q "^src/workflows/"          <<<"$files"; then echo "workflows"
  elif grep -q "^src/subscribers/"        <<<"$files"; then echo "subscribers"
  elif grep -q "^src/modules/payment"     <<<"$files"; then echo "payments"
  elif grep -q "^src/modules/media"       <<<"$files"; then echo "media"
  elif grep -q "^src/modules/social"      <<<"$files"; then echo "social"
  elif grep -q "^src/modules/"            <<<"$files"; then echo "modules"
  elif grep -q "^src/links/"              <<<"$files"; then echo "links"
  elif grep -q "^apps/partner-ui/"        <<<"$files"; then echo "partner-ui"
  elif grep -q "^apps/docs/"              <<<"$files"; then echo "docs"
  elif grep -q "^apps/"                   <<<"$files"; then echo "apps"
  elif grep -q "^jyt-plugins/"            <<<"$files"; then echo "plugins"
  elif grep -q "^integration-tests/"      <<<"$files"; then echo "tests"
  elif grep -q "^scripts/"                <<<"$files"; then echo "scripts"
  elif grep -q "^\\.github/"              <<<"$files"; then echo "ci"
  fi
}

# Inject an auto-detected scope into a conventional-commit message if it's
# missing one. "feat: add x" + scope "api" → "feat(api): add x".
# Leaves messages that already have a scope, or non-conventional messages,
# untouched.
inject_scope() {
  local msg="$1" scope="$2"
  [[ -z "$scope" ]] && { echo "$msg"; return; }
  # Already scoped?  "type(scope): ..."
  if [[ "$msg" =~ ^[a-zA-Z]+\(.+\):\  ]]; then
    echo "$msg"
    return
  fi
  # Bare type prefix?  "type: ..."
  if [[ "$msg" =~ ^([a-zA-Z]+):\ (.*)$ ]]; then
    echo "${BASH_REMATCH[1]}($scope): ${BASH_REMATCH[2]}"
    return
  fi
  echo "$msg"
}

# Run eslint --fix on staged ts/tsx/js/jsx files in the parent repo.
# Returns 0 on clean, 1 on issues (caller decides whether to abort).
run_lint() {
  local staged
  staged="$(cd "$JYT_ROOT" && git diff --cached --name-only --diff-filter=ACM \
              | grep -E '^(src|apps/partner-ui/src)/.*\.(ts|tsx|js|jsx)$' || true)"
  if [[ -z "$staged" ]]; then
    c_info "lint: no staged ts/js files — skipping"
    return 0
  fi

  if ! (cd "$JYT_ROOT" && command -v npx >/dev/null 2>&1); then
    c_warn "lint: npx not found — skipping"
    return 0
  fi

  c_info "lint: eslint --fix on $(wc -l <<<"$staged" | tr -d ' ') staged file(s)..."
  local ok=0
  (
    cd "$JYT_ROOT"
    # shellcheck disable=SC2086
    xargs npx eslint --fix <<<"$staged"
  ) || ok=$?

  if [[ "$ok" -ne 0 ]]; then
    c_warn "lint: issues remain after --fix"
    return 1
  fi
  # Re-stage anything eslint --fix may have rewritten.
  (cd "$JYT_ROOT" && xargs git add <<<"$staged") || true
  c_ok "lint: clean"
  return 0
}

# Fast type-check on the parent repo. Returns 0 on clean, 1 on errors.
run_build_check() {
  if ! (cd "$JYT_ROOT" && command -v npx >/dev/null 2>&1); then
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

# Ask Qwen (Alibaba DashScope, OpenAI-compatible) to draft a conventional
# commit message from the pending parent-repo changes. Writes the
# single-line message to stdout, diagnostics to stderr. Returns non-zero
# on any failure (missing key, missing tool, empty diff, bad response).
run_ai_suggest() {
  if [[ -z "${DASHSCOPE_API_KEY:-}" ]]; then
    c_warn "ai: DASHSCOPE_API_KEY not set — skipping"
    return 1
  fi
  if ! command -v curl    >/dev/null 2>&1; then c_warn "ai: curl missing";    return 1; fi
  if ! command -v python3 >/dev/null 2>&1; then c_warn "ai: python3 missing"; return 1; fi

  local files diff
  files="$(cd "$JYT_ROOT" && {
    git diff --name-only HEAD -- ":(exclude)$SUBMODULE_PATH" 2>/dev/null
    if [[ "$INCLUDE_UNTRACKED" == "1" ]]; then
      git ls-files -o --exclude-standard -- ":(exclude)$SUBMODULE_PATH" 2>/dev/null
    fi
  } | sort -u | head -50)"
  diff="$(cd "$JYT_ROOT" && git diff HEAD -- ":(exclude)$SUBMODULE_PATH" 2>/dev/null | head -c 6000)"

  if [[ -z "$files" && -z "$diff" ]]; then
    c_warn "ai: no parent-repo changes to summarize"
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
with open(sys.argv[3]) as f: diff = f.read()
system = (
    "You write git commit messages. Respond with ONE line in "
    "conventional-commit format: type(scope): short imperative summary. "
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
            -d "$payload" 2>/dev/null)" || { rm -f "$files_tmp" "$diff_tmp"; c_warn "ai: request failed"; return 1; }
  rm -f "$files_tmp" "$diff_tmp"

  local resp_tmp msg
  resp_tmp="$(mktemp -t jyt-ai-resp.XXXXXX)"
  printf '%s' "$resp" >"$resp_tmp"
  msg="$(python3 - "$resp_tmp" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    content = d["choices"][0]["message"]["content"].strip()
    first = content.splitlines()[0].strip()
    for ch in ('"', "'", '`'):
        if first.startswith(ch) and first.endswith(ch):
            first = first[1:-1]
    print(first)
except Exception as e:
    sys.stderr.write(f"ai parse error: {e}\n")
    sys.exit(1)
PY
)" || { rm -f "$resp_tmp"; c_warn "ai: couldn't parse response"; return 1; }
  rm -f "$resp_tmp"

  [[ -z "$msg" ]] && { c_warn "ai: empty message"; return 1; }
  printf '%s\n' "$msg"
}

# --- parse args ----------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)        MESSAGE="$2"; shift 2 ;;
    --parent-message)    PARENT_MESSAGE="$2"; shift 2 ;;
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
      if [[ -z "$MESSAGE" ]]; then
        MESSAGE="$1"; shift
      else
        die "unexpected argument: $1"
      fi
      ;;
  esac
done

# --- sanity --------------------------------------------------------------
[[ -d "$JYT_ROOT/.git" || -f "$JYT_ROOT/.git" ]] || die "$JYT_ROOT is not a git repo"
[[ -d "$SUBMODULE_DIR/.git" || -f "$SUBMODULE_DIR/.git" ]] || die "$SUBMODULE_DIR is not a submodule"

check_repo_state "$JYT_ROOT"      "jyt"
check_repo_state "$SUBMODULE_DIR" "storefront-starter"

# --- show status ---------------------------------------------------------
c_info "Submodule: $SUBMODULE_PATH"
(cd "$SUBMODULE_DIR" && git status --short)
echo

c_info "Parent repo: $JYT_ROOT"
(cd "$JYT_ROOT" && git status --short)
echo

SUB_HAS_CHANGES=0
PARENT_HAS_CHANGES=0
has_changes "$SUBMODULE_DIR" && SUB_HAS_CHANGES=1
has_changes "$JYT_ROOT"      && PARENT_HAS_CHANGES=1

# Detect if the ONLY parent change is (or will be) the submodule pointer.
PARENT_ONLY_SUBMODULE=0
if [[ "$PARENT_HAS_CHANGES" == "1" ]]; then
  non_sub="$(cd "$JYT_ROOT" && git diff --name-only HEAD -- ':(exclude)'"$SUBMODULE_PATH")"
  non_sub_cached="$(cd "$JYT_ROOT" && git diff --name-only --cached -- ':(exclude)'"$SUBMODULE_PATH")"
  if [[ -z "$non_sub" && -z "$non_sub_cached" ]]; then
    PARENT_ONLY_SUBMODULE=1
  fi
fi

if [[ "$SUB_HAS_CHANGES" == "0" && "$PARENT_HAS_CHANGES" == "0" ]]; then
  c_ok "Nothing to commit in either repo."
  exit 0
fi

# --- message -------------------------------------------------------------
if [[ -z "$MESSAGE" && "$AI_SUGGEST" == "1" ]]; then
  c_info "ai: asking $DASHSCOPE_MODEL for a commit message..."
  ai_msg="$(run_ai_suggest)" || ai_msg=""
  if [[ -n "$ai_msg" ]]; then
    c_ok "ai suggestion: $ai_msg"
    if [[ "$YES" == "1" ]]; then
      MESSAGE="$ai_msg"
    else
      read -r -p "Use this message? [Y/n/edit] " ai_reply
      case "$ai_reply" in
        ""|y|Y|yes|YES) MESSAGE="$ai_msg" ;;
        e|E|edit)
          echo "Edit commit message (single line):"
          read -r -e -i "$ai_msg" MESSAGE
          ;;
        *) : ;;  # fall through to manual prompt below
      esac
    fi
  fi
fi

if [[ -z "$MESSAGE" ]]; then
  if [[ "$YES" == "1" ]]; then
    die "commit message required (-m or positional) when --yes is set"
  fi
  echo "Enter commit message (single line, Ctrl-C to abort):"
  read -r MESSAGE
  [[ -n "$MESSAGE" ]] || die "empty commit message"
fi

if [[ -z "$PARENT_MESSAGE" ]]; then
  if [[ "$PARENT_ONLY_SUBMODULE" == "1" && "$SUB_HAS_CHANGES" == "1" ]]; then
    PARENT_MESSAGE="chore(deps): bump storefront-starter ($MESSAGE)"
  else
    PARENT_MESSAGE="$MESSAGE"
  fi
fi

confirm "Proceed with commits?" || die "aborted"

# --- 1. commit in the submodule -----------------------------------------
if [[ "$SUB_HAS_CHANGES" == "1" ]]; then
  c_info "Committing in submodule ($SUBMODULE_PATH)..."
  if [[ "$DRY_RUN" == "1" ]]; then
    c_dry "cd $SUBMODULE_DIR && git add -u"
    [[ "$INCLUDE_UNTRACKED" == "1" ]] && c_dry "... and any untracked tracked-by-user files"
    c_dry "git commit -m \"$MESSAGE\""
  else
    (
      cd "$SUBMODULE_DIR"
      git add -u
      if [[ "$INCLUDE_UNTRACKED" == "1" ]]; then
        untracked="$(git ls-files -o --exclude-standard)"
        if [[ -n "$untracked" ]]; then
          printf '%s\n' "$untracked" | xargs git add --
        fi
      fi
      git commit -m "$(cat <<EOF
$MESSAGE

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
    )
    c_ok "submodule → $(cd "$SUBMODULE_DIR" && git rev-parse --short HEAD)"
  fi
fi

# --- 2. commit in the parent --------------------------------------------
# Recompute — a submodule commit may have produced a pointer change.
if has_changes "$JYT_ROOT"; then
  c_info "Staging parent (jyt)..."
  if [[ "$DRY_RUN" == "1" ]]; then
    c_dry "cd $JYT_ROOT && git add -u && git add $SUBMODULE_PATH"
    [[ "$INCLUDE_UNTRACKED" == "1" ]] && c_dry "... and any untracked files"
    [[ "$SKIP_LINT"  == "0" ]] && c_dry "eslint --fix on staged files"
    [[ "$SKIP_BUILD" == "0" ]] && c_dry "tsc --noEmit"
    c_dry "git commit -m \"<scoped: $PARENT_MESSAGE>\""
  else
    (
      cd "$JYT_ROOT"
      git add -u
      # Always stage the submodule pointer explicitly — covers the rare
      # edge case where the pointer moved but `-u` didn't catch it.
      git add -- "$SUBMODULE_PATH" 2>/dev/null || true
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

      # Auto-inject scope based on staged paths.
      scope="$(suggest_scope)"
      if [[ -n "$scope" ]]; then
        new_msg="$(inject_scope "$PARENT_MESSAGE" "$scope")"
        if [[ "$new_msg" != "$PARENT_MESSAGE" ]]; then
          c_info "scope: injected '$scope' → $new_msg"
          PARENT_MESSAGE="$new_msg"
        fi
      fi

      # Pre-commit checks.
      if [[ "$SKIP_LINT" == "0" ]]; then
        if ! run_lint; then
          if ! confirm "Lint has issues. Commit anyway?"; then
            c_err "aborted by lint"; exit 1
          fi
        fi
      fi
      if [[ "$SKIP_BUILD" == "0" ]]; then
        if ! run_build_check; then
          if ! confirm "Type errors present. Commit anyway?"; then
            c_err "aborted by build check"; exit 1
          fi
        fi
      fi

      git commit -m "$(cat <<EOF
$PARENT_MESSAGE

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
      c_ok "parent → $(git rev-parse --short HEAD)"
    )
  fi
fi

# --- 3. optional push ----------------------------------------------------
if [[ "$PUSH" == "1" ]]; then
  c_info "Pushing submodule..."
  if [[ "$DRY_RUN" == "1" ]]; then
    c_dry "cd $SUBMODULE_DIR && git push"
  else
    (cd "$SUBMODULE_DIR" && git push)
  fi

  c_info "Pushing parent..."
  if [[ "$DRY_RUN" == "1" ]]; then
    c_dry "cd $JYT_ROOT && git push"
  else
    (cd "$JYT_ROOT" && git push)
  fi
fi

c_ok "Done."
