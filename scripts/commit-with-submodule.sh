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
#   --include-untracked   Also stage untracked files (off by default)
#   -h, --help            Show this help
#
# Safety:
#   - Never runs `git add -A` / `git add .` — stages only tracked
#     modifications + the submodule pointer. Use --include-untracked if
#     you really want new files in.
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
INCLUDE_UNTRACKED=0
YES=0

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

# --- parse args ----------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)        MESSAGE="$2"; shift 2 ;;
    --parent-message)    PARENT_MESSAGE="$2"; shift 2 ;;
    --push)              PUSH=1; shift ;;
    --dry-run)           DRY_RUN=1; shift ;;
    --yes|-y)            YES=1; shift ;;
    --include-untracked) INCLUDE_UNTRACKED=1; shift ;;
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
  c_info "Committing in parent (jyt)..."
  if [[ "$DRY_RUN" == "1" ]]; then
    c_dry "cd $JYT_ROOT && git add -u && git add $SUBMODULE_PATH"
    [[ "$INCLUDE_UNTRACKED" == "1" ]] && c_dry "... and any untracked tracked-by-user files"
    c_dry "git commit -m \"$PARENT_MESSAGE\""
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
      else
        git commit -m "$(cat <<EOF
$PARENT_MESSAGE

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
        c_ok "parent → $(git rev-parse --short HEAD)"
      fi
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
