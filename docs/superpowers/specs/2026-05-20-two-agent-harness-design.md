# Two-Agent Harness: Init + Execute Prompt Templates

**Status**: Design spec
**Date**: 2026-05-20
**Based on**: [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (Anthropic Engineering)

---

## 1. Overview

A set of CLI prompt templates and a wrapper script that implement Anthropic's two-agent pattern (Initializer + Coding Agent) for long-running AI agent tasks. The system works with both `opencode run` and `claude -p` CLI commands.

### 1.1 Design philosophy

This design follows the principles extracted from the Anthropic articles:

1. **Memory externalization**: State lives in filesystem (JSON, text files, git), not in agent context window
2. **Immutable specification**: Feature list structure is write-once; agents may only toggle `passes`
3. **Incremental contract**: Each session leaves a clean, merge-ready state
4. **Verification before progression**: Every session validates existing state before building new features
5. **Human tools as agent tools**: Git, JSON, shell scripts — no proprietary infrastructure
6. **Simplicity first**: Two files, one script, zero configuration

### 1.2 User requirements

| Requirement | Decision |
|-------------|----------|
| Deliverable form | Standalone CLI prompt templates |
| CLI usage | Auto-detect wrapper (init vs execute based on filesystem state) |
| Target scope | General-purpose (any coding stack) |
| Output phase | Spec only; implementation follows approval |

---

## 2. File Layout

```
effective-harness/
└── harness/
    ├── prompts/
    │   ├── init.md              # Initializer agent prompt
    │   └── execute.md           # Execute agent prompt
    └── run.sh                   # Auto-detect wrapper
```

### 2.1 Runtime-produced files (written by agents)

| File | Writer | Purpose |
|------|--------|---------|
| `feature_list.json` | Init agent | Structured feature requirements; all `passes: false` |
| `init.sh` | Init agent | Project startup script + basic smoke test |
| `.claude-progress.txt` | Init + Execute agents | Session-by-session progress log |
| Application code | Execute agent | Feature implementations |
| Git history | Both agents | Version tracking and recovery |

---

## 3. Wrapper Script (`run.sh`)

### 3.1 Detection logic

```
If .claude-progress.txt does not exist:
  → First run → use prompts/init.md
  → Forward all user CLI arguments to the prompt
If .claude-progress.txt exists:
  → Subsequent run → use prompts/execute.md
  → No additional arguments (agent reads from filesystem)
```

### 3.2 CLI detection and invocation

```bash
# Priority: opencode > claude
if command -v opencode &> /dev/null; then
    opencode run "$PROMPT_CONTENT"
elif command -v claude &> /dev/null; then
    claude -p "$PROMPT_CONTENT"
else
    echo "Error: neither opencode nor claude CLI found" >&2
    exit 1
fi
```

### 3.3 Requirements

- MUST print `[harness] First run detected — using init agent` or `[harness] Resuming — using execute agent` before execution
- MUST exit with non-zero code if neither CLI is found
- MUST forward all arguments to init prompt; no arguments for execute prompt
- MUST use the harness directory as the prompt source regardless of CWD
- MUST NOT require any configuration file
- MUST work on macOS and Linux

---

## 4. Init Agent Prompt (`prompts/init.md`)

### 4.1 Role

"You are an Initializer Agent. Your sole responsibility is to set up the project environment so that subsequent Execute Agents can make incremental progress efficiently. You do NOT implement features. You do NOT write application code."

### 4.2 Mandatory outputs

| Output | Requirements |
|--------|-------------|
| `feature_list.json` | Comprehensive feature list expanding the user's prompt. See Section 5 for schema. Every feature starts `passes: false`. |
| `init.sh` | Script that starts the development environment AND runs a basic smoke/regression test to verify the project is in a working state. |
| `.claude-progress.txt` | Log: what was set up, list of features created, environment state. End with: "Environment initialized. Ready for execute agent to begin feature work." |
| Git repository | `git init`, `git add -A`, `git commit -m "chore: initial project setup with feature list and init script"` |

### 4.3 Hard constraints

- DO NOT implement any features
- DO NOT mark any feature as `passes: true` — all must start as `false`
- DO NOT leave uncommitted changes — every session ends with a clean git state
- DO NOT write application code — only scaffolding and specification files
- DO NOT use Markdown for the feature list — JSON only (agents are less likely to inappropriately modify JSON)

### 4.4 Feature list generation guidance

- Infer feature categories from the user's project description — do not assume a specific tech stack
- Order features by dependency (foundational features first: e.g., project setup → data layer → API → UI)
- Each feature's `steps` field MUST contain concrete, executable verification instructions — not vague descriptions
- Aim for comprehensive coverage: a project of moderate complexity should yield 30-100+ features. A complex project (like a claude.ai clone) should yield 200+
- Consider: functional requirements, error states, edge cases, auth/security, performance, accessibility

---

## 5. Feature List Schema (`feature_list.json`)

### 5.1 JSON structure

```jsonc
{
  "project": "<inferred project name>",
  "created": "<ISO 8601 timestamp>",
  "features": [
    {
      "id": "F001",
      "category": "<domain-appropriate category>",
      "priority": 1,
      "description": "<concise, testable feature description>",
      "steps": [
        "<step 1: concrete verification action>",
        "<step 2: ...>",
        "<step N: ...>"
      ],
      "passes": false
    }
  ]
}
```

### 5.2 Schema rules

| Field | Rule |
|-------|------|
| `id` | Stable, unique, sequential (F001, F002, ...). Never reassigned or deleted. |
| `category` | Inferred from project domain. Examples: `functional`, `api`, `ui`, `data`, `auth`, `cli`, `performance`, `security`. |
| `priority` | 1 = highest. Assigned by init agent based on dependency order. |
| `description` | One sentence. Testable. "New chat button creates a fresh conversation" — not "Chat functionality". |
| `steps` | Array of executable verification actions. Form the test script for this feature. |
| `passes` | `false` on creation. ONLY the execute agent may toggle to `true` — only after verified E2E. |

### 5.3 Access control

| Actor | Read | Modify `passes` | Modify any other field | Add/delete features |
|-------|------|----------------|----------------------|-------------------|
| Init agent | — (creates) | Must NOT set `true` | Creator (writes all fields) | Creator |
| Execute agent | Yes | **Only permitted action** | **FORBIDDEN** | **FORBIDDEN** |

---

## 6. Execute Agent Prompt (`prompts/execute.md`)

### 6.1 Role

"You are an Execute Agent in a multi-session project. Your job: make incremental progress on exactly ONE feature per session, verify it end-to-end, and leave the codebase in a merge-ready state with clear progress documentation."

### 6.2 Mandatory startup sequence (MUST execute in order)

1. `pwd` — confirm working directory
2. Read `.claude-progress.txt` — understand what happened in previous sessions
3. Read `feature_list.json` — understand what features exist and what's remaining
4. `git log --oneline -20` — review recent code changes
5. Run `init.sh` — start the development environment and verify smoke test passes
6. **Only after steps 1-5 succeed**: select the highest-priority feature where `passes: false`

Rationale: This sequence ensures the agent understands current state before making changes. Adding code to a broken foundation compounds problems. From the article: "If the agent had instead started implementing a new feature, it would likely make the problem worse."

### 6.3 Feature selection and implementation

- Select exactly ONE feature: the highest-priority feature where `passes: false`
- Implement ONLY that feature — do not scope-creep into adjacent features
- After implementation, verify the feature end-to-end using available testing tools
- Unit tests alone are NOT sufficient for marking a feature as passing
- Use whatever testing tools are appropriate for the project domain (browser automation, API tests, CLI verification, etc.)

### 6.4 End-of-session protocol (MUST execute before ending)

1. **Verify**: The selected feature passes end-to-end testing
2. **Commit**: `git commit` with a descriptive message explaining what was implemented and why
3. **Update progress**: Append to `.claude-progress.txt`:
   - What feature was worked on
   - What was implemented
   - Verification results
   - Any issues or blockers encountered
   - Clear statement of what the next agent should work on
4. **Update feature list**: Set `passes: true` for the completed feature (ONLY if verified E2E)
5. **Commit feature list change**: `git commit -m "test: mark F0XX as passing"`
6. **Verify clean state**: No uncommitted changes remain. Code must be in a state appropriate for merging to main.

### 6.5 Clean state definition

"Clean state" means code that would be appropriate for merging to a main branch:
- No known bugs in implemented features
- Code is orderly and well-structured
- Progress is documented
- A new developer could begin work on the next feature without first cleaning up a mess

### 6.6 Hard constraints

- Work on exactly ONE feature per session — no more, no less
- NEVER modify `steps[]`, `description`, `category`, `priority`, or `id` fields in `feature_list.json`
- NEVER add or delete features from `feature_list.json`
- ONLY modify `passes: false → true` — and only after verified E2E
- ALWAYS leave code in a commit-ready state (no uncommitted changes)
- ALWAYS run the startup sequence before beginning any work
- NEVER mark a feature as passing without end-to-end verification

---

## 7. Progress File Format (`.claude-progress.txt`)

### 7.1 Structure

```
=== Session: <ISO timestamp> ===
Agent: <init | execute>
Feature: <feature ID or "environment setup">

What was done:
- <bullet list of concrete actions taken>

Verification:
- <how the work was verified>

Issues/blockers:
- <any problems encountered, or "none">

Next steps:
- <what the next execute agent should work on>
```

### 7.2 Requirements

- Init agent writes the first entry
- Execute agent appends one entry per session
- Must be human-readable (future agents parse it, but humans should be able to debug)
- Must end with clear "next steps" so the next agent doesn't need to re-analyze the feature list from scratch

---

## 8. Edge Cases

| Scenario | Behavior |
|----------|----------|
| First run (no progress file) | `run.sh` routes to init prompt with user args |
| Subsequent run (progress file exists) | `run.sh` routes to execute prompt (no args) |
| `feature_list.json` missing on execute run | Startup sequence detects, agent reports error: "Feature list not found. Was init run?" |
| `feature_list.json` malformed JSON | Agent reports parse error with details, halts |
| `init.sh` missing on execute run | Agent reports error, suggests re-running init |
| Git not installed | Agent reports error during startup sequence |
| No features remaining (all `passes: true`) | Agent reports: "All features complete. Project is done." |
| Execute agent exits without committing | Next agent's startup sequence detects dirty tree via `git status`, cleans up or reports |
| Init re-run (user deletes progress file) | By design: no progress file → init mode. Old files are overwritten. |
| Neither `opencode` nor `claude` installed | `run.sh` exits with error code 1 and clear message |
| Both `opencode` and `claude` installed | `run.sh` prefers `opencode` |

---

## 9. Success Criteria

### 9.1 Init agent success

- [ ] `feature_list.json` exists with valid JSON structure
- [ ] All features have `passes: false`
- [ ] All features have concrete `steps[]` arrays
- [ ] `init.sh` exists and is executable
- [ ] `init.sh` successfully starts the project and runs smoke test
- [ ] `.claude-progress.txt` exists with session 0 entry
- [ ] Git repository initialized with initial commit

### 9.2 Execute agent success (per session)

- [ ] One feature's `passes` changed from `false` to `true`
- [ ] Feature verified end-to-end (not just unit tests)
- [ ] Git commit with descriptive message for implementation
- [ ] Git commit for feature list update
- [ ] `.claude-progress.txt` updated with session entry
- [ ] No uncommitted changes remain

### 9.3 Harness success (multi-session)

- [ ] Agent makes consistent incremental progress across sessions
- [ ] Agent does NOT attempt to implement multiple features in one session
- [ ] Agent does NOT prematurely declare the project complete
- [ ] Codebase never left in a broken state between sessions
- [ ] Progress is always recoverable via git history

---

## 10. Non-Goals (Out of Scope)

- Automated testing agent or QA agent (single-agent pattern per article recommendation)
- Multi-agent orchestration (future work per article's open questions)
- Per-project configuration file (simplicity-first: filesystem state is config)
- Integration with specific CI/CD pipelines
- Parallel feature implementation (explicitly single-feature-per-session)
- Domain-specific optimizations (general-purpose design)
- Token budget management or compaction strategies (handled by `opencode` / `claude` CLI)
