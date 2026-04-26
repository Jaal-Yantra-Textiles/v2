#!/bin/bash

# Push the current branch, optionally creating a PR afterwards.
#
# Usage:
#   bash apps/backend/scripts/push.sh           # rebase + push
#   bash apps/backend/scripts/push.sh --pr      # rebase + push + open PR via gh
#
# When the current branch has no upstream yet (typically right after
# `git cm --new-branch`), this script skips the rebase step and pushes
# with --set-upstream so the first push wires the tracking branch
# automatically.

# Colors for better readability
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# --- Args ----------------------------------------------------------------
PR_MODE=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --pr)
            PR_MODE=true
            shift
            ;;
        --help|-h)
            echo "Usage: bash apps/backend/scripts/push.sh [--pr]"
            echo ""
            echo "  --pr   After pushing, open a PR via gh CLI (gh pr create --fill)"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# --- Branch + upstream detection -----------------------------------------
current_branch=$(git branch --show-current)
echo -e "${BLUE}Current branch: ${GREEN}$current_branch${NC}"

if [ -z "$current_branch" ]; then
    echo -e "${RED}Detached HEAD — nothing to push.${NC}"
    exit 1
fi

if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    HAS_UPSTREAM=true
else
    HAS_UPSTREAM=false
fi

# --- Sync + show what will go --------------------------------------------
if [ "$HAS_UPSTREAM" = true ]; then
    echo -e "\n${BLUE}Updating local branch with remote changes (rebase)...${NC}"
    if ! git pull --rebase; then
        echo -e "${RED}Rebase failed. Resolve conflicts and try again.${NC}"
        exit 1
    fi

    unpushed_commits=$(git log @{u}..HEAD --oneline 2>/dev/null)
    commit_count=$(echo "$unpushed_commits" | grep -c "^")

    if [ -z "$unpushed_commits" ]; then
        echo -e "\n${GREEN}No unpushed commits${NC}"
        exit 0
    fi

    echo -e "\n${BLUE}Unpushed commits:${NC}"
    echo -e "${GREEN}$unpushed_commits${NC}"
    echo -e "\n${BLUE}Total commits to push: ${GREEN}$commit_count${NC}"
else
    echo -e "\n${YELLOW}No upstream tracking branch — first push will set it via --set-upstream.${NC}"
    unpushed_commits=$(git log --oneline -10 2>/dev/null)
    if [ -z "$unpushed_commits" ]; then
        echo -e "${RED}No commits to push.${NC}"
        exit 1
    fi
    echo -e "\n${BLUE}Recent commits on this branch:${NC}"
    echo -e "${GREEN}$unpushed_commits${NC}"
fi

# --- Confirm + push ------------------------------------------------------
echo -e "\n${BLUE}Push to origin/$current_branch? (Y/n)${NC}"
read -n 1 confirm
echo

if [[ $confirm =~ ^[Nn]$ ]]; then
    echo -e "${RED}Push cancelled${NC}"
    exit 0
fi

echo -e "\n${BLUE}Pushing changes...${NC}"
if [ "$HAS_UPSTREAM" = true ]; then
    git push
else
    git push --set-upstream origin "$current_branch"
fi

push_status=$?
if [ $push_status -ne 0 ]; then
    echo -e "${RED}Push failed${NC}"
    exit 1
fi

echo -e "${GREEN}Successfully pushed to $current_branch${NC}"

# --- Optional PR ---------------------------------------------------------
if [ "$PR_MODE" = true ]; then
    if ! command -v gh >/dev/null 2>&1; then
        echo -e "${YELLOW}gh CLI not found — install via 'brew install gh' to use --pr${NC}"
        exit 1
    fi

    if [ "$current_branch" = "main" ]; then
        echo -e "${YELLOW}Refusing to open a PR from main into main.${NC}"
        exit 1
    fi

    # If a PR already exists for this branch, surface it instead of failing.
    existing_pr=$(gh pr view --json url,state -q '.state + " " + .url' 2>/dev/null || true)
    if [ -n "$existing_pr" ]; then
        echo -e "\n${BLUE}PR already exists:${NC} ${GREEN}$existing_pr${NC}"
        exit 0
    fi

    echo -e "\n${BLUE}Opening PR via gh...${NC}"
    # --fill seeds the title + body from the commits on the branch. The
    # user can amend interactively from the gh prompt or in the browser.
    gh pr create --fill --base main
fi
