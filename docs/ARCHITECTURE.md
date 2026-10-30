# Architecture / dependency policy

```text
CLI -> Workflow -> {GitWorkspace, StateStore, PiAgent, IsolatedRunner, IndependentEvaluator}
                                   |
                        Frozen Acceptance Contract
```

No circular imports. `contracts.mjs` defines the task schema; `process.mjs` runs bounded commands; `workspace.mjs` performs all Git operations; `runner.mjs` handles independent Docker only; `evaluator.mjs` contains deterministic checks + judge gate; `pi.mjs` is the sole SDK adapter. `workflow.mjs` orchestrates the stages but does not run commands itself.

## Boundaries

- A frozen acceptance contract is hashed before the initial attempt.
- A candidate SHA and all previously-passing checks are bound to evidence.
- Generator cannot edit tests, CI, runner policy, or acceptance contract; new candidates are checked against original base commit.
- Run state is durable on disk and atomic; lock files reject concurrent execution. Crash during an Agent call may repeat that call on resume.
- A fresh evaluator session receives test evidence and acceptance; it cannot write files and is not asked to execute checks.
- Enabling Docker socket access or exposing untrusted host paths would break the intended isolation.
- No database, queue, framework or logging dependency until a testable need justifies one.

## Verification matrix

CI: syntax, Pi package exports, unit and fake-runner end-to-end.
Operator: docker image build, real pytest/E2E/lint/typecheck, Pi model tool calls, interrupted run recovery.
