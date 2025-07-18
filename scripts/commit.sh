#!/bin/bash

# Colors for better readability
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# --- Pre-Commit Checks ---

# 1. Check if gitleaks is installed
if ! command -v gitleaks &> /dev/null
then
    echo -e "${RED}gitleaks could not be found. Please install it to continue.${NC}"
    echo "Installation instructions: https://github.com/gitleaks/gitleaks#install"
    echo "(e.g., 'brew install gitleaks')"
    exit 1
fi

# 2. Scan for secrets in staged files
echo -e "${BLUE}Scanning for secrets with gitleaks...${NC}"
gitleaks protect --staged -v
if [ $? -ne 0 ]; then
    echo -e "${RED}Gitleaks found secrets. Commit aborted.${NC}"
    exit 1
fi
echo -e "${GREEN}No secrets found. Proceeding with commit.${NC}"

# --- Interactive Commit Builder ---

# Function to display commit type options
select_type() {
    echo -e "\n${BLUE}Select the type of change you're committing:${NC}"
    types=(
        "feat: A new feature"
        "fix: A bug fix"
        "docs: Documentation only changes"
        "style: Code style changes (formatting, etc)"
        "refactor: A code change that neither fixes a bug nor adds a feature"
        "perf: A code change that improves performance"
        "test: Adding missing or correcting existing tests"
        "chore: Changes to the build process or auxiliary tools"
        "ci: Changes to CI configuration files and scripts"
        "build: Changes that affect the build system or external dependencies"
        "revert: Revert a previous commit"
        "Quit"
    )
    
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
    echo -e "\n${BLUE}Enter scope (optional, press enter to skip):${NC}"
    read scope
}

# Function to get commit message
get_message() {
    echo -e "\n${BLUE}Enter commit message:${NC}"
    read message
}

# Function to ask about breaking changes
get_breaking_change() {
    echo -e "\n${BLUE}Is this a breaking change? (y/N)${NC}"
    read -n 1 breaking
    echo
}

# Function to get breaking change description
get_breaking_description() {
    echo -e "\n${BLUE}Enter breaking change description:${NC}"
    read breaking_desc
}

# --- Main Script Logic ---

echo -e "\n${GREEN}--- Interactive Commit Message Builder ---${NC}"

# Get the staged files
staged_files=$(git diff --cached --name-only)

# If no files are staged, ask to stage all
if [ -z "$staged_files" ]; then
    echo -e "\n${RED}No files are staged for commit.${NC}"
    echo -e "${BLUE}Would you like to stage all changes? (y/N)${NC}"
    read -n 1 stage_all
    echo
    if [[ $stage_all =~ ^[Yy]$ ]]; then
        git add .
        echo -e "${GREEN}All changes have been staged.${NC}"
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
echo -e "\n${GREEN}--- Final commit message ---${NC}"
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

echo -e "\n${GREEN}Commit successful!${NC}"
