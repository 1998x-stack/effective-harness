# Gotchas & Known Issues

> Found during development, testing, and live run of the two-agent harness.
> Last updated: 2026-05-20

---

## Fixed (pre-release)

### 1. `--model` flag computed but never passed to CLI

**Severity**: CRITICAL  
**Status**: ✅ Fixed

The `CLI_CMD` variable was built with the `--model` flag but the final `exec` lines hardcoded bare `opencode run` / `claude -p`, silently dropping the model configuration. Kept `MODEL_FLAG` as a separate variable passed directly to `exec`.

```bash
# BEFORE (broken)
CLI_CMD="opencode run --model \"$OPENCODE_MODEL_URI\""
# ... later ...
exec opencode run "$PROMPT_CONTENT"  # model flag lost!

# AFTER (fixed)
MODEL_FLAG="--model deepseek/$DEEPSEEK_MODEL"
exec opencode run $MODEL_FLAG "$PROMPT_CONTENT"
```

---

### 2. Duplicate priority values — no tie-breaking rule

**Severity**: HIGH  
**Status**: ✅ Fixed

Two features with the same `priority` (e.g., F003 and F004 both priority 3) caused non-deterministic feature selection. The execute agent had no rule for which to pick. Added tie-breaking: pick the **lowest `id`** (lexicographic: F003 before F004).

---

### 3. Empty `init.sh` template — false smoke test pass

**Severity**: HIGH  
**Status**: ✅ Fixed

The init prompt provided a template `init.sh` with only `#!/usr/bin/env bash` and `set -e`. If the init agent left the placeholder unfilled, the script exited 0 vacuously — giving execute agents false confidence the project was healthy. Added an explicit constraint: `init.sh` MUST contain at least one actual verification command.

---

### 4. CWD dependency — silent footgun

**Severity**: HIGH  
**Status**: ✅ Fixed

`run.sh` didn't `cd` to the project root. All agent-relative paths (`.claude-progress.txt`, `feature_list.json`, `./init.sh`) depended on the user's current directory. If the script was invoked from a subdirectory, all agent operations failed with confusing errors. Fixed by adding `cd "$SCRIPT_DIR/.."` before any path resolution.

---

### 5. `opencode --model` format: URI vs provider/model

**Severity**: HIGH  
**Status**: ✅ Fixed

The URIs format `https://api.deepseek.com;deepseek-v4-flash;$API_KEY` was passed to `opencode --model`, but the CLI expects `provider/model` format (e.g., `deepseek/deepseek-v4-flash`). Verified by live run — the URI format caused `ProviderModelNotFoundError`. Changed to `deepseek/$DEEPSEEK_MODEL`.

---

## Known / Noted

### 6. Missing `"features"` key in JSON — premature completion

**Severity**: MEDIUM  
**Status**: Noted (prompt handles it)

If `feature_list.json` is missing the `"features"` key (empty object `{}`), the execute agent sees 0 features and may prematurely declare the project done. The startup sequence's error handling catches this for completely missing files, but not for malformed JSON with wrong structure. Mitigation: execute prompt says to validate JSON structure.

---

### 7. Execute agent may fail `rm` commands due to tool permissions

**Severity**: MEDIUM  
**Status**: Noted (environment config issue)

During the live run, the agent was blocked by `rm -f` auto-rejection. The harness itself doesn't require `rm` — this is a CLI-level permission configuration. Projects that need cleanup should configure tool permissions to allow safe file removal.

---

### 8. `./init.sh` hardcoded — cannot rename init script

**Severity**: LOW  
**Status**: By design

The execute prompt hardcodes `./init.sh` as the startup script path. If a project renames this file, the execute agent's startup sequence breaks. This is by design — `init.sh` is the canonical name from the spec, analogous to `Makefile` or `package.json`. Renaming it would break the convention.

---

### 9. `exec` replaces shell process — no post-hook possible

**Severity**: LOW  
**Status**: By design

The script uses `exec` to replace itself with the agent CLI. This is intentional: it preserves exported environment variables and avoids an extra process. The tradeoff is that no post-execution cleanup or hooks can run. If you need post-hooks, wrap `run.sh` instead.

---

### 10. PROMPT_CONTENT may exceed OS argument limit

**Severity**: LOW  
**Status**: Noted (unlikely for current prompt sizes)

The full prompt content is passed as a single CLI argument. POSIX ARG_MAX is typically 256KB+. Current prompt files are ~6KB, so this is theoretical. If prompts grow significantly (e.g., appended project context), consider piping via stdin or a temp file.

---

### 11. Priority assignment is manual — dependency ordering not enforced

**Severity**: LOW  
**Status**: Noted

The init agent assigns feature priorities manually based on dependency reasoning. There's no automated dependency graph or topological sort. For complex projects, the init agent may misorder features, causing the execute agent to work on features that depend on unimplemented ones. Mitigation: the startup sequence's smoke test catches this when `init.sh` fails.

---

### 12. No formal session ID — progress tracking is implicit

**Severity**: NOTE  
**Status**: By design (Anthropic convention)

Session entries in `.claude-progress.txt` are timestamped but not ID'd. If two sessions happen at the same second (rare but possible with fast agents), entries collide. The Anthropic article uses the same implicit approach — sessions are sequential by convention, not by ID.

---

## Not a Gotcha (verified safe)

- **Symlinks**: `[ -f .claude-progress.txt ]` correctly follows symlinks — no false negatives
- **Special chars in prompt**: Backticks, quotes, and newlines survive bash variable expansion correctly
- **DeepSeek API key in URI**: The `\$$DEEPSEEK_API_KEY` pattern in `${VAR:-default}` correctly interpolates the key value
- **Multiple CLIs**: `run.sh` correctly detects and prefers `opencode` over `claude`; errors cleanly if neither found
- **No args on first run**: Errors with clear usage message before invoking any agent
