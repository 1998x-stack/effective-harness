# Two-Agent Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three-file two-agent harness (init prompt, execute prompt, wrapper script) following the Anthropic two-agent pattern for long-running AI coding sessions.

**Architecture:** Three standalone files — two prompt templates and one shell wrapper. No configuration, no dependencies beyond `opencode` or `claude` CLI. Filesystem state (`.claude-progress.txt`) drives init vs execute routing.

**Tech Stack:** Markdown (prompt templates), Bash (wrapper script), POSIX-compatible shell

**Spec:** `docs/superpowers/specs/2026-05-20-two-agent-harness-design.md`

---

## File Structure

| File | Create/Modify | Responsibility |
|------|:---:|---|
| `harness/prompts/init.md` | Create | Initializer agent system prompt — sets up feature list, init script, progress file, git |
| `harness/prompts/execute.md` | Create | Execute agent system prompt — incremental progress, startup sequence, end-of-session protocol |
| `harness/run.sh` | Create | Auto-detect wrapper — routes to init or execute prompt based on filesystem state |

---

### Task 1: Create harness directory structure

**Files:**
- Create: `harness/prompts/` (directory)
- Create: `harness/` (directory)

- [ ] **Step 1: Create directories**

```bash
mkdir -p harness/prompts
```

- [ ] **Step 2: Verify structure**

```bash
ls -la harness/ && ls -la harness/prompts/
```
Expected: Directories exist, `harness/prompts/` is empty.

- [ ] **Step 3: Commit**

```bash
git add harness/
git commit -m "chore: create harness directory structure"
```

---

### Task 2: Write init agent prompt (`init.md`)

**Files:**
- Create: `harness/prompts/init.md`

- [ ] **Step 1: Write the init prompt**

Write to `harness/prompts/init.md`:

```markdown
# Initializer Agent

You are an **Initializer Agent** in a multi-session AI coding harness. Your sole responsibility is to set up the project environment so that subsequent **Execute Agents** can make incremental progress efficiently. You do NOT implement features. You do NOT write application code.

## Your Mandatory Outputs

You MUST produce all four of the following before ending your session:

### 1. `feature_list.json` — Comprehensive Feature Requirements

Create a JSON file expanding the user's project description into a complete, structured feature list.

**Schema:**
```json
{
  "project": "<inferred project name>",
  "created": "<ISO 8601 timestamp>",
  "features": [
    {
      "id": "F001",
      "category": "<inferred from project domain>",
      "priority": 1,
      "description": "<concise, testable feature description>",
      "steps": [
        "<concrete verification action step 1>",
        "<concrete verification action step 2>"
      ],
      "passes": false
    }
  ]
}
```

**Critical rules for the feature list:**
- EVERY feature MUST start with `"passes": false`. It is UNACCEPTABLE to mark any feature as passing. All features are "failing" until an Execute Agent verifies them end-to-end.
- Use JSON format ONLY. Do NOT use Markdown for the feature list. JSON's structured fields make it harder for agents to inappropriately modify content.
- Each feature's `steps` array MUST contain concrete, executable verification instructions — not vague descriptions. These steps form the test script for the feature.
- Order features by dependency: foundational features first (project setup → data layer → API → UI/CLI → polish).
- Infer appropriate `category` values from the project domain. Examples: `setup`, `data`, `api`, `cli`, `ui`, `auth`, `testing`, `performance`, `security`, `docs`.
- `id` values MUST be stable, sequential (F001, F002, ...), and never reassigned.
- A moderate-complexity project should yield 30-100+ features. A complex project should yield 200+.
- Consider: functional requirements, error states, edge cases, authentication/authorization, performance, accessibility, and testing infrastructure.

### 2. `init.sh` — Development Environment Startup + Smoke Test

Create an executable shell script that:
- Starts the project's development environment (servers, databases, watchers, etc.)
- Runs a basic smoke test that verifies the project is in a working state
- Exits with code 0 on success, non-zero on failure

The smoke test should exercise core functionality end-to-end (e.g., start a server, hit an endpoint, verify response). This ensures future Execute Agents can quickly detect if the codebase was left in a broken state.

```bash
#!/usr/bin/env bash
set -e
# Start the project and run a basic smoke test
# (You, the init agent, fill in the actual commands based on the project)
```

Make the script executable.

### 3. `.claude-progress.txt` — Progress Log

Create a progress log file with this initial entry:

```
=== Session: <current ISO timestamp> ===
Agent: init

What was done:
- Created feature_list.json with <N> features across <categories> categories
- Created init.sh to start development environment and run smoke tests
- Initialized git repository

Verification:
- Feature list created with all features marked as failing
- init.sh is executable and smoke test passes
- Git repository initialized with all files committed

Issues/blockers:
- None

Next steps:
- Execute Agent should read this file, review feature_list.json, and begin implementing the highest-priority feature marked as failing
```

### 4. Git Repository

Initialize and commit everything:

```bash
git init
git add -A
git commit -m "chore: initial project setup with feature list (N features) and init script"
```

## What You MUST NOT Do

- DO NOT implement any features
- DO NOT write application code — only scaffolding, specification, and infrastructure files
- DO NOT mark any feature as `passes: true` — all must start as `false`
- DO NOT leave uncommitted changes at the end of your session
- DO NOT skip any of the four mandatory outputs
- DO NOT use Markdown for the feature list — JSON format only

## Session End Checklist

Before ending, verify:
- [ ] `feature_list.json` exists with valid JSON, all features `passes: false`
- [ ] `init.sh` exists, is executable, and smoke test passes
- [ ] `.claude-progress.txt` exists with a complete init entry
- [ ] `git log` shows an initial commit
- [ ] No uncommitted changes (`git status` is clean)
```

- [ ] **Step 2: Verify file was written**

```bash
wc -l harness/prompts/init.md && head -3 harness/prompts/init.md
```
Expected: File has content, starts with "# Initializer Agent".

- [ ] **Step 3: Commit**

```bash
git add harness/prompts/init.md
git commit -m "feat: add init agent prompt template"
```

---

### Task 3: Write execute agent prompt (`execute.md`)

**Files:**
- Create: `harness/prompts/execute.md`

- [ ] **Step 1: Write the execute prompt**

Write to `harness/prompts/execute.md`:

```markdown
# Execute Agent

You are an **Execute Agent** in a multi-session AI coding harness. Your job: make incremental progress on exactly ONE feature per session, verify it end-to-end, and leave the codebase in a merge-ready state with clear progress documentation.

## Mandatory Startup Sequence

You MUST execute these steps IN ORDER before beginning any feature work. Skipping or reordering is unacceptable:

1. **Confirm working directory**: `pwd`
2. **Read progress log**: Read `.claude-progress.txt` to understand what happened in previous sessions
3. **Read feature list**: Read `feature_list.json` to understand what features exist and which are not yet passing
4. **Review git history**: `git log --oneline -20` to see recent code changes
5. **Start environment and verify**: Run `./init.sh` to start the development environment and verify the smoke test passes

**Why this order matters:** If you skip verification and start implementing a new feature, you may be building on a broken foundation — compounding existing problems. From Anthropic's research: "If the agent had instead started implementing a new feature, it would likely make the problem worse."

**If any step fails:**
- `.claude-progress.txt` or `feature_list.json` missing → Error: "Environment not initialized. Run the Init Agent first."
- `init.sh` missing → Error: "init.sh not found. Was the Init Agent run?"
- Smoke test fails → Fix the underlying issue before proceeding. Do NOT implement new features on broken code.

## Feature Selection

After the startup sequence completes successfully:
1. Open `feature_list.json`
2. Find the feature with the **lowest `priority` value** where `passes` is `false`
3. That is your target for this session

Work on **exactly ONE feature**. Do not scope-creep into adjacent features. From Anthropic's research: "This incremental approach turned out to be critical to addressing the agent's tendency to do too much at once."

## Implementation

Implement the selected feature following the project's existing patterns and conventions.

## Testing Requirements

You MUST verify the feature end-to-end before marking it as passing.

- Unit tests alone are NOT sufficient for verification
- Use the appropriate testing tools for the project domain:
  - Web apps: browser automation, visual verification, user flow testing
  - APIs: integration tests against running server, request/response validation
  - CLI tools: run the compiled binary with test inputs, verify output and exit codes
  - Libraries: integration tests exercising the public API in realistic scenarios
- Follow the `steps` array in the feature entry as your test script
- Anthropic's research found: "Claude tended to make code changes, and even do testing with unit tests or curl commands against a development server, but would fail to recognize that the feature didn't work end-to-end."

## End-of-Session Protocol

You MUST complete ALL of these steps before ending your session:

### 1. Verify the feature
Confirm the selected feature passes end-to-end testing as defined in its `steps` array.

### 2. Commit your implementation
```bash
git add <changed files>
git commit -m "feat: <concise description of what was implemented>"
```
The commit message must be descriptive enough that a future agent reading `git log` understands what changed and why.

### 3. Update the progress log
Append to `.claude-progress.txt`:

```
=== Session: <current ISO timestamp> ===
Agent: execute
Feature: <feature ID> - <feature description>

What was done:
- <bullet list of concrete changes made>

Verification:
- <how the feature was verified end-to-end>

Issues/blockers:
- <any problems encountered, or "None">

Next steps:
- <which feature the next execute agent should work on, based on priority>
```

### 4. Mark the feature as passing
In `feature_list.json`, change the selected feature's `passes` field from `false` to `true`.

**You may ONLY modify the `passes` field.** Editing `steps`, `description`, `category`, `priority`, or `id` is FORBIDDEN. Adding or removing features is FORBIDDEN. Anthropic's guidance: "It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality."

### 5. Commit the feature list update
```bash
git add feature_list.json
git commit -m "test: mark <feature ID> as passing"
```

### 6. Verify clean state
```bash
git status
```
There must be NO uncommitted changes. All work is committed and documented.

**Clean state definition:** Code that would be appropriate for merging to a main branch — no known bugs, code is orderly, progress is documented, and a new developer (or a future Execute Agent) could begin work on the next feature without first cleaning up a mess.

## Hard Constraints

- Work on exactly ONE feature per session — no more, no less
- NEVER modify `steps[]`, `description`, `category`, `priority`, or `id` in `feature_list.json`
- NEVER add or delete features from `feature_list.json`
- ONLY change `passes` from `false` to `true` — and only after verified E2E
- ALWAYS leave the codebase in a commit-ready state (no uncommitted changes)
- ALWAYS run the full startup sequence before beginning work
- NEVER mark a feature as passing without end-to-end verification

## Session End Checklist

Before ending, verify:
- [ ] Selected feature implemented and verified end-to-end
- [ ] Implementation committed with descriptive message
- [ ] `.claude-progress.txt` updated with session summary and next steps
- [ ] `feature_list.json` updated: feature `passes` changed to `true`
- [ ] Feature list change committed
- [ ] `git status` shows no uncommitted changes
```

- [ ] **Step 2: Verify file was written**

```bash
wc -l harness/prompts/execute.md && head -3 harness/prompts/execute.md
```
Expected: File has content, starts with "# Execute Agent".

- [ ] **Step 3: Commit**

```bash
git add harness/prompts/execute.md
git commit -m "feat: add execute agent prompt template"
```

---

### Task 4: Write wrapper script (`run.sh`)

**Files:**
- Create: `harness/run.sh`

- [ ] **Step 1: Write the wrapper script**

Write to `harness/run.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Two-Agent Harness Wrapper
# Auto-detects init vs execute mode based on filesystem state.
# Usage:
#   ./harness/run.sh "describe your project here"    # First run (init)
#   ./harness/run.sh                                  # Subsequent runs (execute)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROGRESS_FILE=".claude-progress.txt"

# Detect which CLI to use (prefer opencode)
if command -v opencode &> /dev/null; then
    CLI="opencode"
    CLI_CMD="opencode run"
elif command -v claude &> /dev/null; then
    CLI="claude"
    CLI_CMD="claude -p"
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
    echo "[harness] Resuming — using execute agent ($CLI)"
    echo "[harness] Progress file found: $PROGRESS_FILE"
else
    MODE="init"
    PROMPT_FILE="$SCRIPT_DIR/prompts/init.md"
    PROMPT_CONTENT="$(cat "$PROMPT_FILE")"
    USER_ARGS="${*:-}"
    if [ -z "$USER_ARGS" ]; then
        echo "Error: first run requires a project description" >&2
        echo "Usage: ./harness/run.sh \"describe your project\"" >&2
        exit 1
    fi
    echo "[harness] First run detected — using init agent ($CLI)"
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
    exec opencode run "$PROMPT_CONTENT"
else
    exec claude -p "$PROMPT_CONTENT"
fi
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x harness/run.sh
```

- [ ] **Step 3: Verify syntax and modes**

```bash
# Check syntax
bash -n harness/run.sh

# Test help output (execute mode without progress file should error)
cd /tmp && /Users/mx/Desktop/effective-harness/harness/run.sh 2>&1 || true
```
Expected: Syntax check passes. Second command errors with "requires a project description" (no progress file + no args).

- [ ] **Step 4: Commit**

```bash
git add harness/run.sh
git commit -m "feat: add auto-detect wrapper script for init/execute routing"
```

---

### Task 5: Final integration verification

**Files:**
- Verify: All harness files exist and are consistent

- [ ] **Step 1: Verify all files present**

```bash
ls -la harness/prompts/init.md harness/prompts/execute.md harness/run.sh
```
Expected: All three files exist. `run.sh` is executable.

- [ ] **Step 2: Verify prompt file references in run.sh match actual files**

```bash
grep "prompts/" harness/run.sh
```
Expected: References to `prompts/init.md` and `prompts/execute.md` match the actual file paths.

- [ ] **Step 3: Verify prompt content consistency**

```bash
# Init prompt must NOT mention implementing features
! grep -i "implement the feature" harness/prompts/init.md || { echo "FAIL: init.md references feature implementation"; exit 1; }

# Execute prompt must mention the startup sequence
grep -q "Mandatory Startup Sequence" harness/prompts/execute.md || { echo "FAIL: execute.md missing startup sequence"; exit 1; }

# Execute prompt must mention end-of-session protocol
grep -q "End-of-Session Protocol" harness/prompts/execute.md || { echo "FAIL: execute.md missing end-of-session protocol"; exit 1; }

echo "All consistency checks passed"
```

- [ ] **Step 5: Commit**

```bash
git add -A
git diff --cached --stat
git commit -m "chore: final verification of harness file consistency"
```

---

## Verification Checklist (Post-Implementation)

After all tasks complete, verify:

- [ ] `harness/prompts/init.md` contains: role declaration, 4 mandatory outputs, hard constraints, session-end checklist
- [ ] `harness/prompts/execute.md` contains: role declaration, startup sequence (6 numbered steps), feature selection rule, end-of-session protocol (6 steps), hard constraints
- [ ] `harness/run.sh` is executable and uses `command -v` for CLI detection
- [ ] `run.sh` prints mode label (`[harness] First run` or `[harness] Resuming`)
- [ ] `run.sh` errors cleanly when no CLI found and when first run has no args
- [ ] Init prompt explicitly forbids `passes: true` on creation
- [ ] Execute prompt explicitly forbids modifying any field except `passes`
- [ ] Execute prompt requires E2E verification before marking `passes: true`
- [ ] Feature list schema (JSON) is documented in init.md with `passes: false` default
- [ ] Progress file format is documented in init.md with session structure
