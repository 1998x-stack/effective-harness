# Effective Harness — Pi isolated evaluation

Focused long-running coding agent harness inspired by [Anthropic's Harness Design](https://www.anthropic.com/research/harness-design-long-running-apps).

**Architecture**: Planner and Generator Pi Sessions -> candidate Git commit -> isolated Docker checks (pytest, e2e, lint, typecheck) -> deterministic evidence/ regression verifier -> independent readonly LLM Judge -> fail-closed gate.

The root of this branch contains only this implementation. Earlier tutorial articles, Go todo examples, and shell harnesses remain on `main` and `backup` and in Git history. No PR or merge to main is performed.

## Runtime dependencies

- Node.js >=22.19 and Git, using Node built-ins for control-plane code.
- `@earendil-works/pi-coding-agent@1.4.0` is the **only runtime npm dependency**.
- Docker and a prebuilt Python/Playwright test image for independent checks.
- Pi model `iagent/iagent/standard` by default. Configure it in `~/.pi/agent/models.json` and verify with `pi auth check --provider iagent --model iagent/standard`.

```bash
cp .env.example .env
npm install
npm test
docker build -t effective-harness-tests:local -f docker/Dockerfile .
npm start -- run /absolute/path/to/clean/git/repository examples/task.json
npm start -- status <run-id>
npm start -- resume <run-id>
node scripts/long-eval.mjs all
```

The generic sample expects `tests/unit`, `tests/e2e`, and `src` inside your target repository. E2E should start the app and browser inside the container; outbound network is disabled. The three benchmark tasks in `examples/long-running/` use API integration checks instead of a browser. Build their smaller image with `docker build -t effective-harness-benchmark:local -f docker/Benchmark.Dockerfile .` before running them. The benchmark script creates isolated seed repositories under `.harness-data/benchmarks/`, caps the simple, medium, and complex runs at 30, 60, and 120 minutes, and records `run.log`, `timeline.jsonl`, run state, and Pi session transcripts. The durations are budgets, not guaranteed elapsed times.

The harder, cross-module suite lives in `examples/limits/`. Run it with `HARNESS_SUITE=limits node scripts/long-eval.mjs all <label>`. The optional `extreme` task extends a completed complex candidate: set `HARNESS_BASE_REPO` to that clean candidate worktree and run `HARNESS_SUITE=limits HARNESS_BASE_REPO=<candidate> node scripts/long-eval.mjs extreme <label>`. The observed results and failure analysis are in [docs/limits-eval-report.md](docs/limits-eval-report.md).

**Security boundary:** only *committed* candidate source is exported to an archive using `git archive`. The archive is copied into a container-private tmpfs. Docker runs with no network, read-only root, all capabilities dropped, nonroot UID, and CPU/RAM/PID/time limits. No secrets are intentionally mounted. Protected tests and configuration cannot be changed by the generator. This is defense in depth, not a secure multi-tenant sandbox; generator Pi tools still run on the host. Only run trusted repositories.

**Verifier:** each check output includes a Run ID, Commit SHA, contract hash, test command, exit code and digest. Hashes provide consistency, not cryptographic proof that a malicious host did not forge evidence. Prior-passing suites must not regress. Judge failure, missing results, skipped/zero pytest tests, timeout and incompatible evidence are all non-PASS.

**Limitations:** Real Docker, browser and model E2E require local credentials and runtime. CI covers deterministic unit tests and the actual package import. Planning/continuous-build/round-QA follows the second Anthropic iteration; Sprint Contract and interactive browser MCP are not yet implemented. Resume occurs at state boundaries and may repeat an interrupted agent step; untrusted workspaces need process isolation.
