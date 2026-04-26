#!/bin/bash

# Improved Push Script with Better Error Handling
# Fixes: Explicit remote specification, conflict handling, pre-push checks

# Colors for better readability
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DRY_RUN=false
RUN_TESTS=false
FORCE_PUSH=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --test)
            RUN_TESTS=true
            shift
            ;;
        --force)
            FORCE_PUSH=true
            shift
            ;;
        --help)
            echo "Usage: ./push.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --dry-run    Show what would be pushed without actually pushing"
            echo "  --test       Run tests before pushing"
            echo "  --force      Force push (use with caution!)"
            echo "  --help       Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Get current branch
current_branch=$(git branch --show-current)

if [ -z "$current_branch" ]; then
    echo -e "${RED}Not on any branch. Please checkout a branch first.${NC}"
    exit 1
fi

echo -e "\n${GREEN}=== Git Push Script ===${NC}"
echo -e "${BLUE}Current branch: ${GREEN}$current_branch${NC}"

# Check if remote exists
if ! git remote | grep -q "origin"; then
    echo -e "${RED}No 'origin' remote found. Please add a remote first.${NC}"
    exit 1
fi

# Fetch latest changes from remote
echo -e "\n${BLUE}Fetching latest changes from remote...${NC}"
git fetch origin

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to fetch from remote.${NC}"
    exit 1
fi

# Check if remote branch exists
if ! git rev-parse --verify "origin/$current_branch" &>/dev/null; then
    echo -e "${YELLOW}Remote branch 'origin/$current_branch' doesn't exist.${NC}"
    echo -e "${BLUE}This will create a new remote branch.${NC}"
    FIRST_PUSH=true
else
    FIRST_PUSH=false
    
    # Check for divergence
    LOCAL=$(git rev-parse @)
    REMOTE=$(git rev-parse @{u} 2>/dev/null || git rev-parse "origin/$current_branch")
    BASE=$(git merge-base @ "origin/$current_branch" 2>/dev/null)
    
    if [ "$LOCAL" = "$REMOTE" ]; then
        echo -e "${GREEN}Already up to date with remote.${NC}"
        exit 0
    elif [ "$LOCAL" = "$BASE" ]; then
        echo -e "${YELLOW}Remote has new commits. Need to pull first.${NC}"
        NEED_PULL=true
    elif [ "$REMOTE" = "$BASE" ]; then
        echo -e "${GREEN}Local is ahead of remote.${NC}"
        NEED_PULL=false
    else
        echo -e "${YELLOW}Branches have diverged!${NC}"
        NEED_PULL=true
        DIVERGED=true
    fi
fi

# Show remote changes if we need to pull
if [ "$NEED_PULL" = true ]; then
    echo -e "\n${BLUE}Remote changes:${NC}"
    git log HEAD..origin/$current_branch --oneline --color=always | head -10
    
    if [ "$DIVERGED" = true ]; then
        echo -e "\n${YELLOW}Your local changes:${NC}"
        git log origin/$current_branch..HEAD --oneline --color=always | head -10
    fi
    
    echo -e "\n${BLUE}Rebasing with remote changes...${NC}"
    git pull --rebase origin "$current_branch"
    
    if [ $? -ne 0 ]; then
        echo -e "\n${RED}Rebase failed!${NC}"
        echo -e "${YELLOW}Conflict resolution steps:${NC}"
        echo -e "  1. Resolve conflicts in the files listed above"
        echo -e "  2. Stage resolved files: ${GREEN}git add <file>${NC}"
        echo -e "  3. Continue rebase: ${GREEN}git rebase --continue${NC}"
        echo -e "  4. Or abort rebase: ${GREEN}git rebase --abort${NC}"
        echo -e "  5. Then run this script again"
        exit 1
    fi
    
    echo -e "${GREEN}Successfully rebased with remote changes.${NC}"
fi

# Check for unpushed commits
if [ "$FIRST_PUSH" = true ]; then
    unpushed_commits=$(git log --oneline)
    commit_count=$(git rev-list --count HEAD)
else
    unpushed_commits=$(git log origin/$current_branch..HEAD --oneline 2>/dev/null)
    commit_count=$(git rev-list --count origin/$current_branch..HEAD 2>/dev/null || echo "0")
fi

if [ -z "$unpushed_commits" ] || [ "$commit_count" -eq 0 ]; then
    echo -e "\n${GREEN}No unpushed commits.${NC}"
    exit 0
fi

# Show unpushed commits
echo -e "\n${BLUE}Commits to push:${NC}"
echo -e "${GREEN}$unpushed_commits${NC}"
echo -e "\n${BLUE}Total commits: ${GREEN}$commit_count${NC}"

# Run tests if requested
if [ "$RUN_TESTS" = true ]; then
    echo -e "\n${BLUE}Running tests...${NC}"
    yarn test
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Tests failed! Push aborted.${NC}"
        echo -e "${YELLOW}Fix the tests or use --no-test to skip testing.${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}Tests passed!${NC}"
fi

# Dry run mode
if [ "$DRY_RUN" = true ]; then
    echo -e "\n${YELLOW}DRY RUN MODE - No changes will be pushed${NC}"
    echo -e "${BLUE}Would push to: ${GREEN}origin/$current_branch${NC}"
    exit 0
fi

# Warn about force push
if [ "$FORCE_PUSH" = true ]; then
    echo -e "\n${RED}⚠️  WARNING: Force push will overwrite remote history!${NC}"
    echo -e "${YELLOW}This can cause problems for other developers.${NC}"
    echo -e "${BLUE}Are you absolutely sure? (type 'yes' to confirm)${NC}"
    read confirm
    
    if [ "$confirm" != "yes" ]; then
        echo -e "${RED}Force push cancelled.${NC}"
        exit 0
    fi
fi

# Ask for confirmation
echo -e "\n${BLUE}Push these commits to origin/$current_branch? (Y/n)${NC}"
read -n 1 confirm
echo

if [[ $confirm =~ ^[Nn]$ ]]; then
    echo -e "${RED}Push cancelled.${NC}"
    exit 0
fi

# Push changes
echo -e "\n${BLUE}Pushing changes...${NC}"

if [ "$FORCE_PUSH" = true ]; then
    git push --force-with-lease origin "$current_branch"
else
    git push origin "$current_branch"
fi

if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}✅ Successfully pushed to origin/$current_branch${NC}"
    
    # Show push summary
    if [ "$FIRST_PUSH" = false ]; then
        echo -e "\n${BLUE}Push summary:${NC}"
        echo -e "  Branch: ${GREEN}$current_branch${NC}"
        echo -e "  Commits: ${GREEN}$commit_count${NC}"
        echo -e "  Remote: ${GREEN}origin/$current_branch${NC}"
    fi
else
    echo -e "\n${RED}❌ Push failed!${NC}"
    echo -e "${YELLOW}Possible reasons:${NC}"
    echo -e "  1. Network issues"
    echo -e "  2. Permission denied"
    echo -e "  3. Remote has new commits (run script again)"
    echo -e "  4. Branch protection rules"
    exit 1
fi
