#!/bin/bash

# Colors for better readability
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get current branch
current_branch=$(git branch --show-current)

# Rebase with remote branch to avoid merge conflicts
echo -e "\n${BLUE}Updating local branch with remote changes (rebase)...${NC}"
git pull --rebase

if [ $? -ne 0 ]; then
    echo -e "${RED}Rebase failed. Please resolve conflicts and try again.${NC}"
    exit 1
fi

# Check for unpushed commits
unpushed_commits=$(git log @{u}..HEAD --oneline 2>/dev/null)
commit_count=$(echo "$unpushed_commits" | grep -c "^")

# Show status
echo -e "${BLUE}Current branch: ${GREEN}$current_branch${NC}"

if [ $? -eq 0 ] && [ -n "$unpushed_commits" ]; then
    echo -e "\n${BLUE}Unpushed commits:${NC}"
    echo -e "${GREEN}$unpushed_commits${NC}"
    echo -e "\n${BLUE}Total commits to push: ${GREEN}$commit_count${NC}"
else
    echo -e "\n${GREEN}No unpushed commits${NC}"
    exit 0
fi

# Ask for confirmation
echo -e "\n${BLUE}Do you want to push these commits? (Y/n)${NC}"
read -n 1 confirm
echo

if [[ $confirm =~ ^[Nn]$ ]]; then
    echo -e "${RED}Push cancelled${NC}"
    exit 0
fi

# Push changes
echo -e "\n${BLUE}Pushing changes...${NC}"
git push

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Successfully pushed to $current_branch${NC}"
else
    echo -e "${RED}Push failed${NC}"
    exit 1
fi
