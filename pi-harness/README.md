# Pi Long-Running Harness — Isolated Runner + Independent Evaluator

Independent experiment inspired by [Anthropic's long-running application harness](https://www.anthropic.com/research/harness-design-long-running-apps). Powered by Pi Agent SDK and DeepSeek Flash.

## Trust boundary

- **Generator**: edits implementation in a disposable Git worktree (no shell tool).
- **Isolated test runner**: executes required `pytest`, `e2e`, `lint`, and `typecheck` checks in Docker with disabled network, readonly root, readonly source mount, dropped capabilities, CPU/RAM/PID limits and non-root UID. Test command arrays are passed as arguments rather than interpolated shell strings.
- **Independent evaluator**: verifies check identity, candidate commit SHA, contract hash, evidence SHA256, full suite status and previously-passing regression suites. A fresh readonly Pi Session performs skeptical LLM quality review.
- **Final gate**: all deterministic tests and the LLM judge must PASS; unknown, skipped, empty, truncated, or failed checks cannot PASS.

## Run

Requires Node.js 22+, Docker, Git, npm access and a valid DeepSeek API key.

```bash
cd pi-harness
cp .env.example .env
# Set DEEPSEEK_API_KEY in .env
npm install
npm test
docker build -t effective-harness-test:local -f docker/Dockerfile .
npm start -- run /absolute/path/to/clean/repository examples/task.json
npm start -- status <run-id>
npm start -- resume <run-id>
```

Customize `examples/task.json` for the target Python repo. The sample expects `tests/unit`, `tests/e2e`, and `src`. Browser E2E must launch and visit the app *inside* the container, usually on localhost; networking outside the container is disabled.

## Lifecycle

1. Freeze user acceptance contract and create a separate Git worktree.
2. Execute baseline suites; retain previously-passing checks for regression comparison.
3. Planner produces a high-level plan. Generator builds in a persisted Pi Session.
4. Snapshot each candidate as a Git commit. Block changes to tests/CI/contracts.
5. Run all four independent Docker checks and record evidence tied to candidate SHA.
6. Independent evaluator verifies test results, regressions and LLM rubric.
7. On failure feed structured QA results back to Generator; after budget limit stop.
8. Verified PASS only when both deterministic and independent quality gates succeed.

## Limits

This implements the *continuous build / round QA* style from Anthropic's second experiment, not Sprint Contract negotiation. Playwright is used via configured E2E tests, not interactive Playwright MCP. Current test environment lacks Docker and live DeepSeek credentials; the offline unit/integration suite uses injected fakes and cannot establish real sandbox or SDK integration success. Hashes check consistency, not worker authenticity. Docker security depends on host policy; pin immutable image digests in production. The Pi generator itself runs on the trusted host worktree, so **do not allow untrusted repositories or prompts**. Checkpoint recovery is at phase boundaries; hard-stop and stale-lock recovery require further work.
