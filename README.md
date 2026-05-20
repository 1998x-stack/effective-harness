# Effective Harness

A lightweight, zero-config CLI wrapper that implements Anthropic's [two-agent pattern](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) for long-running AI coding sessions. One harness per project — copy it in, describe your project, and let agents make incremental progress across sessions.

## How It Works

```
┌─────────────────────────────────────────────────────┐
│                  ./harness/run.sh                    │
│                                                     │
│  Is .claude-progress.txt present?                   │
│    │                                                │
│    ├── NO  → First run                              │
│    │         Initializer Agent sets up:              │
│    │           • feature_list.json                   │
│    │           • init.sh (build + smoke test)        │
│    │           • .claude-progress.txt (handoff log)  │
│    │           • git init + initial commit           │
│    │                                                │
│    └── YES → Subsequent run                         │
│              Execute Agent:                          │
│                • Reads progress + feature list       │
│                • Verifies smoke test passes          │
│                • Implements ONE feature              │
│                • Commits, updates progress, leaves   │
│                  code merge-ready                    │
└─────────────────────────────────────────────────────┘
```

**One feature per session. Clean state every time. No memory between sessions — just filesystem artifacts.**

## Quick Start

### 1. Copy the harness into your project

```bash
cp -r harness/ your-project/
cd your-project
```

### 2. Set your API key (DeepSeek recommended)

```bash
export DEEPSEEK_API_KEY="sk-..."
```

Supports both [OpenCode](https://opencode.ai) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI.

### 3. First session — initialize the project

```bash
./harness/run.sh "build a REST API for a todo app with PostgreSQL and JWT auth"
```

The Initializer Agent will create:
- `feature_list.json` — 30-200+ detailed features, all marked as failing
- `init.sh` — starts your dev environment + runs a smoke test
- `.claude-progress.txt` — session handoff log
- Initial git commit

### 4. Subsequent sessions — incremental feature work

```bash
./harness/run.sh
```

The Execute Agent will:
1. Read progress and feature list to understand state
2. Verify the smoke test still passes
3. Pick the highest-priority unfinished feature
4. Implement it, verify it end-to-end
5. Commit, update progress, leave code merge-ready

Repeat until all features pass.

## Configuration

### CLI Detection

`run.sh` auto-detects your available CLI:

| Priority | CLI | How to install |
|----------|-----|---------------|
| 1 (preferred) | `opencode` | `brew install opencode` or [opencode.ai](https://opencode.ai) |
| 2 (fallback) | `claude` | `npm install -g @anthropic-ai/claude-code` |

### DeepSeek API (default)

```bash
export DEEPSEEK_API_KEY="sk-..."
export DEEPSEEK_MODEL="deepseek-v4-pro"   # optional, default: deepseek-v4-flash
```

The harness automatically configures both CLI backends:

**OpenCode**: `--model deepseek/$DEEPSEEK_MODEL`  
**Claude Code**: Sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and all model env vars for the DeepSeek Anthropic-compatible endpoint.

### Custom API provider

Skip `DEEPSEEK_API_KEY` and configure your CLI directly:

```bash
# OpenCode: configure via ~/.config/opencode/opencode.json
# Claude Code: set standard ANTHROPIC_* environment variables
./harness/run.sh "describe your project"
```

The harness only injects model flags when `DEEPSEEK_API_KEY` is set — otherwise it passes through to your existing CLI configuration.

## Project Structure

```
your-project/
├── harness/                       # ← Copy this directory in
│   ├── prompts/
│   │   ├── init.md                # Initializer Agent prompt
│   │   └── execute.md             # Execute Agent prompt
│   └── run.sh                     # Auto-detect wrapper
│
├── feature_list.json              # ← Created by Initializer Agent
├── init.sh                        # ← Created by Initializer Agent
├── .claude-progress.txt           # ← Created by Init, updated by Execute
└── ...your application code...    # ← Created by Execute Agent
```

## Feature List Format

```json
{
  "project": "Todo CLI",
  "created": "2026-05-20T15:00:00Z",
  "features": [
    {
      "id": "F001",
      "category": "setup",
      "priority": 1,
      "description": "Project scaffolding with build system and entry point",
      "steps": [
        "Run go build ./... and confirm exit code 0",
        "Run ./app --help and verify usage output"
      ],
      "passes": false
    }
  ]
}
```

**Critical rules:**
- Every feature starts `"passes": false` — guilty until proven working
- Execute Agent may ONLY toggle `passes: false → true` — never modify other fields
- `steps[]` are executable test instructions, not vague descriptions
- Priority 1 = highest, assigned by dependency order
- 30-100+ features for moderate projects, 200+ for complex ones

## Design Principles

Derived from [Anthropic's research](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents):

| Principle | Implementation |
|-----------|---------------|
| **Memory externalization** | State lives in filesystem (JSON, text, git), not agent context |
| **Immutable specification** | Feature list write-once; only `passes` can change |
| **Incremental contract** | One feature per session, merge-ready state every exit |
| **Verification before progression** | Smoke test every session before implementing new features |
| **Human tools as agent tools** | Git, JSON, shell scripts — no proprietary infrastructure |
| **Simplicity first** | Two prompt files, one script, zero configuration |

## Example

See [`examples/todo-cli/`](examples/todo-cli/) for a complete working example:

```
examples/todo-cli/
├── .claude-progress.txt    # 3 sessions logged (init + 2 execute)
├── feature_list.json        # 10 features, 2 passing, 8 pending
├── init.sh                  # Go build + smoke test
├── main.go                  # CLI entry point (created by execute agent)
├── internal/task.go         # Task data model (created by execute agent)
├── go.mod
└── harness/                 # Copy of the harness
```

Run the example:

```bash
cd examples/todo-cli
export DEEPSEEK_API_KEY="sk-..."
./harness/run.sh              # Execute Agent: picks up where F002 left off
```

## Documentation

- [`CONTEXT.md`](CONTEXT.md) — Domain glossary and terminology
- [`gotchas.md`](gotchas.md) — Known issues and edge cases
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — Design spec
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — Implementation plan
- [`articles/`](articles/) — Deep-dive analysis of the original Anthropic article

## Requirements

- **macOS** or **Linux** (uses bash, POSIX tools)
- **Git** installed and configured
- **OpenCode CLI** or **Claude Code CLI** installed
- **DeepSeek API key** (or your own API provider config)

## License

MIT

---

*Based on Anthropic's "Effective harnesses for long-running agents" — [read the original](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)*
