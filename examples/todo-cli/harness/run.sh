#!/usr/bin/env bash
set -euo pipefail

# Two-Agent Harness Wrapper
# Auto-detects init vs execute mode based on filesystem state.
# Usage:
#   ./harness/run.sh "describe your project here"    # First run (init)
#   ./harness/run.sh                                  # Subsequent runs (execute)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Navigate to project root (parent of harness/) so all agent-relative
# paths (.claude-progress.txt, feature_list.json, ./init.sh) resolve
# correctly regardless of where the script was invoked from.
cd "$SCRIPT_DIR/.."

PROGRESS_FILE=".claude-progress.txt"

# ── DeepSeek API defaults (overridable via environment) ──
# Set these BEFORE running harness to override:
#   export DEEPSEEK_API_KEY="sk-..."
#   export DEEPSEEK_MODEL="deepseek-v4-pro"  # or deepseek-v4-flash
DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}"
DEEPSEEK_MODEL="${DEEPSEEK_MODEL:-deepseek-v4-flash}"

# Detect which CLI to use (prefer opencode)
MODEL_FLAG=""
if command -v opencode &> /dev/null; then
    CLI="opencode"
    # OpenCode model flag: --model provider/model (e.g., deepseek/deepseek-v4-flash)
    if [ -n "$DEEPSEEK_API_KEY" ]; then
        MODEL_FLAG="--model deepseek/$DEEPSEEK_MODEL"
    fi
elif command -v claude &> /dev/null; then
    CLI="claude"
    # Claude CLI via DeepSeek Anthropic-compatible endpoint
    if [ -n "$DEEPSEEK_API_KEY" ]; then
        export ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-https://api.deepseek.com/anthropic}"
        export ANTHROPIC_AUTH_TOKEN="${ANTHROPIC_AUTH_TOKEN:-$DEEPSEEK_API_KEY}"
        export ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-$DEEPSEEK_MODEL}"
        export ANTHROPIC_DEFAULT_OPUS_MODEL="${ANTHROPIC_DEFAULT_OPUS_MODEL:-$DEEPSEEK_MODEL}"
        export ANTHROPIC_DEFAULT_SONNET_MODEL="${ANTHROPIC_DEFAULT_SONNET_MODEL:-$DEEPSEEK_MODEL}"
        export ANTHROPIC_DEFAULT_HAIKU_MODEL="${ANTHROPIC_DEFAULT_HAIKU_MODEL:-$DEEPSEEK_MODEL}"
        export CLAUDE_CODE_SUBAGENT_MODEL="${CLAUDE_CODE_SUBAGENT_MODEL:-$DEEPSEEK_MODEL}"
        export CLAUDE_CODE_EFFORT_LEVEL="${CLAUDE_CODE_EFFORT_LEVEL:-max}"
    fi
else
    echo "Error: neither 'opencode' nor 'claude' CLI found in PATH" >&2
    echo "Install one of:" >&2
    echo "  - OpenCode CLI: https://opencode.ai" >&2
    echo "  - Claude CLI:   npm install -g @anthropic-ai/claude-code" >&2
    exit 1
fi

# Detect mode: init (first run) or execute (subsequent run)
if [ -f "$PROGRESS_FILE" ]; then
    MODE="execute"
    PROMPT_FILE="$SCRIPT_DIR/prompts/execute.md"
    PROMPT_CONTENT="$(cat "$PROMPT_FILE")"
    echo "[harness] Resuming — using Execute Agent ($CLI)"
    echo "[harness] Progress file found: $PROGRESS_FILE"
else
    MODE="init"
    PROMPT_FILE="$SCRIPT_DIR/prompts/init.md"
    PROMPT_CONTENT="$(cat "$PROMPT_FILE")"
    USER_ARGS="$*"
    if [ -z "$USER_ARGS" ]; then
        echo "Error: first run requires a project description" >&2
        echo "Usage: ./harness/run.sh \"describe your project\"" >&2
        exit 1
    fi
    echo "[harness] First run detected — using Initializer Agent ($CLI)"
    echo "[harness] Project: $USER_ARGS"
    PROMPT_CONTENT="$PROMPT_CONTENT

---
## User Project Description

$USER_ARGS

---
Begin by analyzing the project description above and creating the four mandatory outputs: feature_list.json, init.sh, .claude-progress.txt, and initial git commit."
fi

# Verify prompt file exists
if [ ! -f "$PROMPT_FILE" ]; then
    echo "Error: prompt file not found: $PROMPT_FILE" >&2
    exit 1
fi

# Execute
if [ "$CLI" = "opencode" ]; then
    exec opencode run $MODEL_FLAG "$PROMPT_CONTENT"
else
    exec claude -p "$PROMPT_CONTENT"
fi
