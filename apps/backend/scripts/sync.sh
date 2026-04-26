#!/bin/bash

# Comprehensive Sync Script
# Combines staging, committing, and pushing with intelligent defaults

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
SKIP_TESTS=false
SKIP_SECRETS_CHECK=false
AUTO_STAGE=false
QUICK_MODE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --skip-secrets)
            SKIP_SECRETS_CHECK=true
            shift
            ;;
        --auto-stage)
            AUTO_STAGE=true
            shift
            ;;
        --quick|-q)
            QUICK_MODE=true
            AUTO_STAGE=true
            SKIP_TESTS=true
            shift
            ;;
        --help)
            echo "Usage: ./sync.sh [OPTIONS] [message]"
            echo ""
            echo "Options:"
            echo "  --skip-tests      Skip running tests"
            echo "  --skip-secrets    Skip secret scanning"
            echo "  --auto-stage      Automatically stage all changes"
            echo "  --quick, -q       Quick mode (auto-stage, skip tests)"
            echo "  --help            Show this help message"
            echo ""
            echo "Examples:"
            echo "  ./sync.sh 'fix: bug in media upload'"
            echo "  ./sync.sh --quick 'feat: new feature'"
            exit 0
            ;;
        *)
            COMMIT_MESSAGE="$1"
            shift
            ;;
    esac
done

echo -e "\n${GREEN}=== Git Sync Script ===${NC}"

# Get current branch
current_branch=$(git branch --show-current)
echo -e "${BLUE}Branch: ${GREEN}$current_branch${NC}"

# Check for uncommitted changes
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    HAS_CHANGES=true
else
    HAS_CHANGES=false
fi

# Check for untracked files
if [ -n "$(git ls-files --others --exclude-standard)" ]; then
    HAS_UNTRACKED=true
else
    HAS_UNTRACKED=false
fi

if [ "$HAS_CHANGES" = false ] && [ "$HAS_UNTRACKED" = false ]; then
    echo -e "${GREEN}No changes to commit.${NC}"
    
    # Check for unpushed commits
    unpushed=$(git log @{u}..HEAD --oneline 2>/dev/null)
    if [ -n "$unpushed" ]; then
        echo -e "\n${BLUE}Unpushed commits found:${NC}"
        echo -e "${GREEN}$unpushed${NC}"
        echo -e "\n${BLUE}Push these commits? (Y/n)${NC}"
        read -n 1 confirm
        echo
        
        if [[ ! $confirm =~ ^[Nn]$ ]]; then
            ./scripts/push-improved.sh
        fi
    else
        echo -e "${GREEN}Everything is up to date!${NC}"
    fi
    exit 0
fi

# Show status
echo -e "\n${BLUE}Changes:${NC}"
git status --short

# Auto-stage or ask
if [ "$AUTO_STAGE" = true ]; then
    echo -e "\n${BLUE}Auto-staging all changes...${NC}"
    git add .
elif [ "$QUICK_MODE" = false ]; then
    echo -e "\n${BLUE}Stage all changes? (Y/n)${NC}"
    read -n 1 stage_all
    echo
    
    if [[ ! $stage_all =~ ^[Nn]$ ]]; then
        git add .
    else
        echo -e "${YELLOW}Please stage files manually and run again.${NC}"
        exit 1
    fi
fi

# Secret scanning
if [ "$SKIP_SECRETS_CHECK" = false ]; then
    if command -v gitleaks &> /dev/null; then
        echo -e "\n${BLUE}Scanning for secrets...${NC}"
        gitleaks protect --staged -v
        
        if [ $? -ne 0 ]; then
            echo -e "${RED}Secrets detected! Commit aborted.${NC}"
            exit 1
        fi
        echo -e "${GREEN}No secrets found.${NC}"
    else
        echo -e "${YELLOW}gitleaks not installed. Skipping secret scan.${NC}"
    fi
fi

# Get commit message if not provided
if [ -z "$COMMIT_MESSAGE" ]; then
    # Suggest commit type based on changed files
    changed_files=$(git diff --cached --name-only)
    
    if echo "$changed_files" | grep -q "\.md$"; then
        suggested_type="docs"
    elif echo "$changed_files" | grep -q "test\|spec"; then
        suggested_type="test"
    elif echo "$changed_files" | grep -q "package\.json\|yarn\.lock"; then
        suggested_type="chore"
    else
        suggested_type="feat"
    fi
    
    echo -e "\n${BLUE}Commit type (suggested: ${GREEN}$suggested_type${BLUE}):${NC}"
    echo "1) feat     - New feature"
    echo "2) fix      - Bug fix"
    echo "3) docs     - Documentation"
    echo "4) style    - Code style"
    echo "5) refactor - Code refactoring"
    echo "6) test     - Tests"
    echo "7) chore    - Maintenance"
    read -p "Select (1-7) or press Enter for $suggested_type: " type_choice
    
    case $type_choice in
        1) commit_type="feat" ;;
        2) commit_type="fix" ;;
        3) commit_type="docs" ;;
        4) commit_type="style" ;;
        5) commit_type="refactor" ;;
        6) commit_type="test" ;;
        7) commit_type="chore" ;;
        *) commit_type="$suggested_type" ;;
    esac
    
    echo -e "\n${BLUE}Scope (optional, e.g., 'media', 'api'):${NC}"
    read scope
    
    echo -e "\n${BLUE}Commit message:${NC}"
    read message
    
    if [ -n "$scope" ]; then
        COMMIT_MESSAGE="$commit_type($scope): $message"
    else
        COMMIT_MESSAGE="$commit_type: $message"
    fi
fi

# Show final commit message
echo -e "\n${GREEN}Commit message:${NC}"
echo -e "${BLUE}$COMMIT_MESSAGE${NC}"

# Commit
echo -e "\n${BLUE}Committing...${NC}"
git commit -m "$COMMIT_MESSAGE"

if [ $? -ne 0 ]; then
    echo -e "${RED}Commit failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Committed successfully!${NC}"

# Run tests
if [ "$SKIP_TESTS" = false ]; then
    echo -e "\n${BLUE}Run tests before pushing? (y/N)${NC}"
    read -n 1 run_tests
    echo
    
    if [[ $run_tests =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}Running tests...${NC}"
        yarn test
        
        if [ $? -ne 0 ]; then
            echo -e "${RED}Tests failed!${NC}"
            echo -e "${YELLOW}Push anyway? (y/N)${NC}"
            read -n 1 push_anyway
            echo
            
            if [[ ! $push_anyway =~ ^[Yy]$ ]]; then
                echo -e "${RED}Push cancelled.${NC}"
                exit 1
            fi
        fi
    fi
fi

# Push
echo -e "\n${BLUE}Push to remote? (Y/n)${NC}"
read -n 1 do_push
echo

if [[ ! $do_push =~ ^[Nn]$ ]]; then
    ./scripts/push-improved.sh
else
    echo -e "${YELLOW}Changes committed but not pushed.${NC}"
    echo -e "${BLUE}Push later with: ${GREEN}./scripts/push-improved.sh${NC}"
fi

echo -e "\n${GREEN}✅ Sync complete!${NC}"
