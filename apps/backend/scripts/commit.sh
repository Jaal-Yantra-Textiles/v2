#!/bin/bash

# Interactive commit-message builder for the jyt monorepo.
#
# Usage:
#   bash apps/backend/scripts/commit.sh                 # interactive
#   bash apps/backend/scripts/commit.sh --ai            # let Qwen draft a one-line message
#   bash apps/backend/scripts/commit.sh --emoji         # prepend a type emoji
#   bash apps/backend/scripts/commit.sh --diff          # show staged diff before composing
#
# AI mode (--ai) reads the staged file list + diff and asks Qwen
# (Alibaba DashScope, OpenAI-compatible API) for a conventional-commit
# one-liner. Requires:
#   DASHSCOPE_API_KEY    (required)
#   DASHSCOPE_BASE_URL   (default: https://dashscope-intl.aliyuncs.com/compatible-mode/v1)
#   DASHSCOPE_MODEL      (default: qwen-plus)
#
# Pre-commit linting / type-checking / secret scanning are intentionally
# NOT run here — handle those via your editor, husky, or CI.

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
SHOW_DIFF=false
EMOJI_MODE=false
AI_SUGGEST=false

DASHSCOPE_BASE_URL="${DASHSCOPE_BASE_URL:-https://dashscope-intl.aliyuncs.com/compatible-mode/v1}"
DASHSCOPE_MODEL="${DASHSCOPE_MODEL:-qwen-plus}"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --diff)
            SHOW_DIFF=true
            shift
            ;;
        --emoji)
            EMOJI_MODE=true
            shift
            ;;
        --ai)
            AI_SUGGEST=true
            shift
            ;;
        --help|-h)
            echo "Usage: bash apps/backend/scripts/commit.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --ai      Draft the commit message via Qwen (DashScope) instead of prompting"
            echo "  --diff    Show staged diff before composing"
            echo "  --emoji   Prepend an emoji matching the commit type"
            echo "  --help    Show this help"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# --- AI draft (Qwen via DashScope) ---------------------------------------
# Writes a single-line conventional-commit message to stdout on success.
run_ai_suggest() {
    if [[ -z "${DASHSCOPE_API_KEY:-}" ]]; then
        echo -e "${YELLOW}ai: DASHSCOPE_API_KEY not set — skipping${NC}" >&2
        return 1
    fi
    command -v curl    >/dev/null 2>&1 || { echo -e "${YELLOW}ai: curl missing${NC}" >&2;    return 1; }
    command -v python3 >/dev/null 2>&1 || { echo -e "${YELLOW}ai: python3 missing${NC}" >&2; return 1; }

    local files diff
    files="$(git diff --cached --name-only 2>/dev/null | head -50)"
    diff="$(git diff --cached 2>/dev/null | head -c 6000)"

    if [[ -z "$files" && -z "$diff" ]]; then
        echo -e "${YELLOW}ai: nothing staged to summarize${NC}" >&2
        return 1
    fi

    local files_tmp diff_tmp resp_tmp payload_tmp
    files_tmp="$(mktemp -t jyt-ai-files.XXXXXX)"
    diff_tmp="$(mktemp -t jyt-ai-diff.XXXXXX)"
    resp_tmp="$(mktemp -t jyt-ai-resp.XXXXXX)"
    payload_tmp="$(mktemp -t jyt-ai-payload.XXXXXX)"
    trap "rm -f '$files_tmp' '$diff_tmp' '$resp_tmp' '$payload_tmp'" RETURN

    printf '%s' "$files" >"$files_tmp"
    printf '%s' "$diff"  >"$diff_tmp"

    python3 - "$DASHSCOPE_MODEL" "$files_tmp" "$diff_tmp" "$payload_tmp" <<'PY'
import json, sys
model = sys.argv[1]
with open(sys.argv[2], encoding="utf-8", errors="replace") as f: files = f.read()
with open(sys.argv[3], encoding="utf-8", errors="replace") as f: diff  = f.read()
system = (
    "You write git commit messages for the jyt Medusa e-commerce monorepo. "
    "Respond with ONE line in conventional-commit format: "
    "type(scope): short imperative summary. "
    "Valid types: feat, fix, docs, style, refactor, perf, test, chore, ci, build. "
    "Keep under 72 chars. No quotes, no trailing period, no explanation."
)
user = f"Files changed:\n{files or '(none)'}\n\nDiff (may be truncated):\n{diff or '(empty)'}"
with open(sys.argv[4], 'w', encoding="utf-8") as out:
    json.dump({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        "temperature": 0.2,
    }, out)
PY

    local http_code
    http_code="$(curl -sS --max-time 90 --retry 2 --retry-delay 1 \
        -o "$resp_tmp" -w "%{http_code}" \
        "$DASHSCOPE_BASE_URL/chat/completions" \
        -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
        -H "Content-Type: application/json" \
        -d "@$payload_tmp" 2>/dev/null)" || http_code="000"

    if [[ "$http_code" != "200" ]]; then
        echo -e "${YELLOW}ai: request failed (http $http_code)${NC}" >&2
        [[ -s "$resp_tmp" ]] && head -c 400 "$resp_tmp" >&2 && echo >&2
        return 1
    fi

    local msg
    msg="$(python3 - "$resp_tmp" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8", errors="replace") as f:
        raw = f.read()
    d = json.loads(raw)
except json.JSONDecodeError as e:
    sys.stderr.write(f"ai parse error: invalid json ({e})\n"); sys.exit(1)
except Exception as e:
    sys.stderr.write(f"ai parse error: {e}\n"); sys.exit(1)

if "choices" not in d:
    err = d.get("error") or d
    sys.stderr.write(f"ai api error: {json.dumps(err)[:300]}\n"); sys.exit(1)

try:
    content = d["choices"][0]["message"]["content"].strip()
except (KeyError, IndexError, TypeError) as e:
    sys.stderr.write(f"ai parse error: unexpected shape ({e})\n"); sys.exit(1)

first = content.splitlines()[0].strip() if content else ""
for ch in ('"', "'", '`'):
    if first.startswith(ch) and first.endswith(ch): first = first[1:-1]
print(first)
PY
)" || { echo -e "${YELLOW}ai: couldn't parse response${NC}" >&2; return 1; }

    [[ -z "$msg" ]] && { echo -e "${YELLOW}ai: empty message${NC}" >&2; return 1; }
    printf '%s\n' "$msg"
}

# --- Interactive Commit Builder ------------------------------------------

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

suggest_scope() {
    local changed_files=$(git diff --cached --name-only)
    local suggested_scope=""

    if echo "$changed_files" | grep -q "apps/backend/src/api/"; then
        suggested_scope="api"
    elif echo "$changed_files" | grep -q "apps/backend/src/admin/"; then
        suggested_scope="admin"
    elif echo "$changed_files" | grep -q "apps/backend/src/workflows/"; then
        suggested_scope="workflows"
    elif echo "$changed_files" | grep -q "apps/backend/src/modules/media"; then
        suggested_scope="media"
    elif echo "$changed_files" | grep -q "apps/backend/src/modules/social"; then
        suggested_scope="social"
    elif echo "$changed_files" | grep -q "apps/backend/src/modules/"; then
        suggested_scope="modules"
    elif echo "$changed_files" | grep -q "apps/backend/integration-tests/"; then
        suggested_scope="tests"
    elif echo "$changed_files" | grep -q "apps/storefront/"; then
        suggested_scope="storefront"
    elif echo "$changed_files" | grep -q "apps/storefront-mobile/"; then
        suggested_scope="mobile"
    elif echo "$changed_files" | grep -q "apps/partner-ui/"; then
        suggested_scope="partner-ui"
    elif echo "$changed_files" | grep -q "apps/analytics/"; then
        suggested_scope="analytics"
    elif echo "$changed_files" | grep -q "apps/docs/"; then
        suggested_scope="docs"
    elif echo "$changed_files" | grep -q "^\\.github/"; then
        suggested_scope="ci"
    elif echo "$changed_files" | grep -q "apps/backend/scripts/"; then
        suggested_scope="scripts"
    fi

    echo "$suggested_scope"
}

get_scope() {
    local suggested=$(suggest_scope)

    if [ -n "$suggested" ]; then
        echo -e "\n${BLUE}Enter scope (suggested: ${GREEN}$suggested${BLUE}, press enter to use):${NC}"
    else
        echo -e "\n${BLUE}Enter scope (optional, press enter to skip):${NC}"
    fi

    read scope

    if [ -z "$scope" ] && [ -n "$suggested" ]; then
        scope="$suggested"
        echo -e "${GREEN}Using suggested scope: $scope${NC}"
    fi
}

get_message() {
    echo -e "\n${BLUE}Enter commit message:${NC}"
    read message
}

get_breaking_change() {
    echo -e "\n${BLUE}Is this a breaking change? (y/N)${NC}"
    read -n 1 breaking
    echo
}

get_breaking_description() {
    echo -e "\n${BLUE}Enter breaking change description:${NC}"
    read breaking_desc
}

get_ticket() {
    echo -e "\n${BLUE}Related ticket/issue number (optional, e.g., #123):${NC}"
    read ticket
}

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

# --- Main ----------------------------------------------------------------

echo -e "\n${GREEN}--- Interactive Commit Message Builder ---${NC}"

# Stage check
staged_files=$(git diff --cached --name-only)
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

# Optional diff preview
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

# AI mode: try to draft, then confirm/edit
if [ "$AI_SUGGEST" = true ]; then
    echo -e "\n${BLUE}ai: drafting message via $DASHSCOPE_MODEL...${NC}"
    if draft="$(run_ai_suggest)" && [ -n "$draft" ]; then
        echo -e "${GREEN}ai: $draft${NC}"
        echo -e "${BLUE}Use this message? [Y/n/edit]${NC}"
        read reply
        case "$reply" in
            n|N|no|NO)
                AI_SUGGEST=false  # fall through to interactive
                ;;
            e|E|edit)
                echo -e "${BLUE}Edit (empty = keep current):${NC}"
                read edited
                [ -z "$edited" ] && edited="$draft"
                commit_msg="$edited"
                ;;
            *)
                commit_msg="$draft"
                ;;
        esac
    else
        echo -e "${YELLOW}ai: failed — falling back to interactive${NC}"
        AI_SUGGEST=false
    fi
fi

# Interactive build (when AI not used or rejected)
if [ "$AI_SUGGEST" != true ] && [ -z "${commit_msg:-}" ]; then
    select_type
    get_scope
    get_message
    get_breaking_change
    get_ticket
    get_coauthors

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

    if [ -n "$ticket" ]; then
        commit_msg="$commit_msg

Refs: $ticket"
    fi

    if [[ $breaking =~ ^[Yy]$ ]]; then
        get_breaking_description
        commit_msg="$commit_msg

BREAKING CHANGE: $breaking_desc"
    fi

    if [ ${#coauthors[@]} -gt 0 ]; then
        commit_msg="$commit_msg
"
        for coauthor in "${coauthors[@]}"; do
            commit_msg="$commit_msg
Co-authored-by: $coauthor"
        done
    fi
fi

# Confirm and commit
echo -e "\n${GREEN}--- Final commit message ---${NC}"
echo -e "${BLUE}$commit_msg${NC}"
echo

echo -e "${BLUE}Proceed with commit? (Y/n)${NC}"
read -n 1 proceed
echo

if [[ $proceed =~ ^[Nn]$ ]]; then
    echo -e "${RED}Commit aborted${NC}"
    exit 0
fi

git commit -m "$commit_msg"

echo -e "\n${GREEN}Commit successful!${NC}"
