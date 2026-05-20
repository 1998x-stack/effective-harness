# CONTEXT.md — Effective Harness

> Domain glossary for the two-agent long-running AI coding harness.
> Only include terms meaningful to domain experts. Do not couple to implementation details.
> Last updated: 2026-05-20

---

## Core Concepts

### Feature Spec
A JSON entry in `feature_list.json` describing desired application behavior. Contains `id`, `category`, `priority`, `description`, `steps[]`, and `passes`. Created by the Initializer Agent. Immutable except for the `passes` field, which only the Execute Agent may toggle from `false` to `true`.

### Feature Implementation
The application code, tests, and configuration that satisfies a Feature Spec. Written by the Execute Agent during a session. Distinct from the Feature Spec itself — the spec describes *what*, the implementation is *how*.

### Initializer Agent
The agent role that runs in the very first session of a project. Creates the Feature Spec list (`feature_list.json`), the startup script (`init.sh`), the progress log (`.claude-progress.txt`), and the initial git commit. Does NOT implement any features or write application code.

### Execute Agent
The agent role that runs in all subsequent sessions. Reads filesystem artifacts to understand project state, selects one pending Feature Spec, implements it, verifies it end-to-end, and leaves the codebase in a clean, merge-ready state. Equivalent to Anthropic's "Coding Agent" — renamed "Execute" for general-purpose scope.

### Session
A single run of either the Initializer Agent or Execute Agent through one CLI invocation (`opencode run` or `claude -p`). Each session operates in a fresh context window with no memory of prior sessions. Sessions communicate through filesystem artifacts (feature list, progress file, git history).

### Progress File
The `.claude-progress.txt` file that serves as the handoff document between sessions. Written by the Initializer Agent (first entry) and appended by the Execute Agent (one entry per session). Contains a structured log of what was done, verification results, issues, and next steps. The filename is inherited from Anthropic's research but the format is CLI-agnostic and works with any agent harness.

### Clean State
The condition the Execute Agent must leave the codebase in at session end: no known bugs, code is orderly, progress is documented, no uncommitted changes remain. Equivalent to "merge-ready" — a new developer could begin work on the next feature without first cleaning up a mess.

### Harness
The three-file wrapper system (`run.sh` + `prompts/init.md` + `prompts/execute.md`) that routes CLI invocations to the correct agent prompt. One harness per project — not shared across projects. Copy the `harness/` directory into each project root. No configuration files; customization is done by editing the prompt templates directly.


