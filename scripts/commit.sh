#!/bin/bash

# Enhanced Commit Script with Pre-commit Hooks and Smart Suggestions

# Colors for better readability
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SKIP_SECRETS=false
SKIP_LINT=false
SHOW_DIFF=false
EMOJI_MODE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-secrets)
            SKIP_SECRETS=true
            shift
            ;;
        --skip-lint)
            SKIP_LINT=true
            shift
            ;;
        --diff)
            SHOW_DIFF=true
            shift
            ;;
        --emoji)
            EMOJI_MODE=true
            shift
            ;;
        --help)
            echo "Usage: ./commit.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --skip-secrets  Skip secret scanning"
            echo "  --skip-lint     Skip linting"
            echo "  --diff          Show diff before committing"
            echo "  --emoji         Add emoji to commit messages"
            echo "  --help          Show this help message"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# --- Pre-Commit Checks ---

# 1. Check if gitleaks is installed
if [ "$SKIP_SECRETS" = false ]; then
    if ! command -v gitleaks &> /dev/null
    then
        echo -e "${YELLOW}gitleaks not found. Skipping secret scan.${NC}"
        echo -e "${BLUE}Install with: brew install gitleaks${NC}"
    else
        # 2. Scan for secrets in staged files
        echo -e "${BLUE}Scanning for secrets with gitleaks...${NC}"
        gitleaks protect --staged -v
        if [ $? -ne 0 ]; then
            echo -e "${RED}Gitleaks found secrets. Commit aborted.${NC}"
            exit 1
        fi
        echo -e "${GREEN}No secrets found. Proceeding with commit.${NC}"
    fi
fi

# 3. Run linting on staged files
if [ "$SKIP_LINT" = false ]; then
    echo -e "\n${BLUE}Running linter on staged files...${NC}"
    
    # Get staged TypeScript/JavaScript files
    staged_files=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx)$')
    
    if [ -n "$staged_files" ]; then
        if command -v eslint &> /dev/null; then
            echo "$staged_files" | xargs eslint --fix
            
            if [ $? -ne 0 ]; then
                echo -e "${YELLOW}Linting issues found. Continue anyway? (y/N)${NC}"
                read -n 1 continue_lint
                echo
                
                if [[ ! $continue_lint =~ ^[Yy]$ ]]; then
                    echo -e "${RED}Commit aborted. Fix linting issues first.${NC}"
                    exit 1
                fi
            else
                echo -e "${GREEN}Linting passed!${NC}"
                # Re-stage files that were fixed
                echo "$staged_files" | xargs git add
            fi
        else
            echo -e "${YELLOW}ESLint not found. Skipping linting.${NC}"
        fi
    fi
fi

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

# Function to suggest scope based on changed files
suggest_scope() {
    local changed_files=$(git diff --cached --name-only)
    local suggested_scope=""
    
    # Analyze changed files to suggest scope
    if echo "$changed_files" | grep -q "src/api/"; then
        suggested_scope="api"
    elif echo "$changed_files" | grep -q "src/admin/"; then
        suggested_scope="admin"
    elif echo "$changed_files" | grep -q "src/workflows/"; then
        suggested_scope="workflows"
    elif echo "$changed_files" | grep -q "src/modules/media"; then
        suggested_scope="media"
    elif echo "$changed_files" | grep -q "src/modules/social"; then
        suggested_scope="social"
    elif echo "$changed_files" | grep -q "integration-tests/"; then
        suggested_scope="tests"
    elif echo "$changed_files" | grep -q "docs/"; then
        suggested_scope="docs"
    elif echo "$changed_files" | grep -q "scripts/"; then
        suggested_scope="scripts"
    fi
    
    echo "$suggested_scope"
}

# Function to get scope (optional)
get_scope() {
    local suggested=$(suggest_scope)
    
    if [ -n "$suggested" ]; then
        echo -e "\n${BLUE}Enter scope (suggested: ${GREEN}$suggested${BLUE}, press enter to use):${NC}"
    else
        echo -e "\n${BLUE}Enter scope (optional, press enter to skip):${NC}"
    fi
    
    read scope
    
    # Use suggested scope if user pressed enter
    if [ -z "$scope" ] && [ -n "$suggested" ]; then
        scope="$suggested"
        echo -e "${GREEN}Using suggested scope: $scope${NC}"
    fi
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

# Function to get ticket/issue number
get_ticket() {
    echo -e "\n${BLUE}Related ticket/issue number (optional, e.g., #123):${NC}"
    read ticket
}

# Function to get co-authors
get_coauthors() {
    echo -e "\n${BLUE}Add co-authors? (y/N)${NC}"
    read -n 1 add_coauthors
    echo
    
    if [[ $add_coauthors =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}Enter co-author (Name <email>), empty to finish:${NC}"
        coauthors=()
        while true; do
            read coauthor
            if [ -z "$coauthor" ]; then
                break
            fi
            coauthors+=("$coauthor")
            echo -e "${BLUE}Another co-author? (empty to finish):${NC}"
        done
    fi
}

# Function to get emoji for commit type
get_emoji() {
    case $1 in
        feat) echo "✨" ;;
        fix) echo "🐛" ;;
        docs) echo "📚" ;;
        style) echo "💎" ;;
        refactor) echo "♻️" ;;
        perf) echo "⚡" ;;
        test) echo "🧪" ;;
        chore) echo "🔧" ;;
        ci) echo "👷" ;;
        build) echo "📦" ;;
        revert) echo "⏪" ;;
        *) echo "" ;;
    esac
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

# Show diff if requested
if [ "$SHOW_DIFF" = true ]; then
    echo -e "\n${BLUE}=== Staged Changes ===${NC}"
    git diff --cached --stat
    echo -e "\n${BLUE}Show full diff? (y/N)${NC}"
    read -n 1 show_full
    echo
    
    if [[ $show_full =~ ^[Yy]$ ]]; then
        git diff --cached
    fi
fi

# Get commit details
select_type
get_scope
get_message
get_breaking_change
get_ticket
get_coauthors

# Build commit message with optional emoji
if [ "$EMOJI_MODE" = true ]; then
    emoji=$(get_emoji "$commit_type")
    if [ -n "$emoji" ]; then
        commit_prefix="$emoji "
    else
        commit_prefix=""
    fi
else
    commit_prefix=""
fi

if [ -n "$scope" ]; then
    commit_msg="${commit_prefix}$commit_type($scope): $message"
else
    commit_msg="${commit_prefix}$commit_type: $message"
fi

# Add ticket reference if provided
if [ -n "$ticket" ]; then
    commit_msg="$commit_msg

Refs: $ticket"
fi

# Add breaking change footer if necessary
if [[ $breaking =~ ^[Yy]$ ]]; then
    get_breaking_description
    commit_msg="$commit_msg

BREAKING CHANGE: $breaking_desc"
fi

# Add co-authors if provided
if [ ${#coauthors[@]} -gt 0 ]; then
    commit_msg="$commit_msg
"
    for coauthor in "${coauthors[@]}"; do
        commit_msg="$commit_msg
Co-authored-by: $coauthor"
    done
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
