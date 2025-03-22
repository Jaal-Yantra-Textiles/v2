#!/bin/bash

# Colors for better readability
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to display commit type options
select_type() {
    echo -e "${BLUE}Select the type of change you're committing:${NC}"
    types=("feat: New feature" "fix: Bug fix" "docs: Documentation" "style: Code style" "ui: UI changes" "refactor: Code refactor" "perf: Performance" "test: Tests" "chore: Chores" "build: Build" "ci: CI" "revert: Revert" "Quit")
    
    select type in "${types[@]}"; do
        case $type in
            "Quit")
                echo -e "${RED}Commit aborted${NC}"
                exit 0
                ;;
            *)
                if [ -n "$type" ]; then
                    commit_type=$(echo $type | cut -d: -f1)
                    return
                fi
                ;;
        esac
    done
}

# Function to get scope (optional)
get_scope() {
    echo -e "${BLUE}Enter scope (optional, press enter to skip):${NC}"
    read scope
}

# Function to get commit message
get_message() {
    echo -e "${BLUE}Enter commit message:${NC}"
    read message
}

# Function to ask about breaking changes
get_breaking_change() {
    echo -e "${BLUE}Is this a breaking change? (y/N)${NC}"
    read -n 1 breaking
    echo
}

# Function to get breaking change description
get_breaking_description() {
    echo -e "${BLUE}Enter breaking change description:${NC}"
    read breaking_desc
}

# Main script
echo -e "${GREEN}Interactive Commit Message Builder${NC}"

# Get the staged files
staged_files=$(git diff --cached --name-only)

# If no files are staged, ask to stage all
if [ -z "$staged_files" ]; then
    echo -e "${RED}No files are staged for commit.${NC}"
    echo -e "${BLUE}Would you like to stage all changes? (y/N)${NC}"
    read -n 1 stage_all
    echo
    if [[ $stage_all =~ ^[Yy]$ ]]; then
        git add .
    else
        echo -e "${RED}Please stage files before committing.${NC}"
        exit 1
    fi
fi

# Get commit details
select_type
get_scope
get_message
get_breaking_change

# Build commit message
if [ -n "$scope" ]; then
    commit_msg="$commit_type($scope): $message"
else
    commit_msg="$commit_type: $message"
fi

# Add breaking change footer if necessary
if [[ $breaking =~ ^[Yy]$ ]]; then
    get_breaking_description
    commit_msg="$commit_msg

BREAKING CHANGE: $breaking_desc"
fi

# Show the final commit message
echo -e "\n${GREEN}Final commit message:${NC}"
echo -e "${BLUE}$commit_msg${NC}"
echo

# Confirm commit
echo -e "${BLUE}Proceed with commit? (Y/n)${NC}"
read -n 1 proceed
echo

if [[ $proceed =~ ^[Nn]$ ]]; then
    echo -e "${RED}Commit aborted${NC}"
    exit 0
fi

# Perform the commit
git commit -m "$commit_msg"

echo -e "${GREEN}Commit successful!${NC}"
