# Pi iagent/standard 隔离评测观察记录

日期：2026-10-30（UTC）。分支：`feat/pi-long-running-isolated-eval`。模型：Pi provider `iagent`，model ID `iagent/standard`，thinking level `high`。凭据从本机 Pi 配置加载；运行日志未包含 API key。测试镜像：`effective-harness-benchmark:local`，镜像 ID `sha256:a4d38c734437878daaf5448a9a64b77a98a8e7004ab9c05132b9f7eef8dce62e`。

## 任务与结果

| 档位 | 目标 | 预算上限 | 首次运行 | 补强后运行 |
| --- | --- | ---: | --- | --- |
| 简单 | Unicode 名称规范化和导入去重 | 30 分钟 | `run-153e1ca51c544080`，70 秒，`BLOCKED` | `run-f64a0825173741f0`，88 秒，`VERIFIED_PASS` |
| 中等 | 事件流投影、幂等回放、序号冲突与删除历史 | 60 分钟 | `run-5d385dcc84934d5a`，125 秒，`VERIFIED_PASS` | `run-980761b11fc244a9`，73 秒，`VERIFIED_PASS` |
| 复杂 | 依赖感知的容量调度、优先级和无效图处理 | 120 分钟 | `run-f0fb8dff21854ec7`，144 秒，`BLOCKED` | `run-a1633d4e8cfe406c`，78 秒，`VERIFIED_PASS` |

补强后的三次运行均在第一轮生成后通过 unit、API 集成、ruff、mypy 和独立评估。任务定义见 `examples/long-running/*.json`；种子代码与受保护测试见 `examples/long-running/seed/`。所有运行使用独立 Git worktree；候选提交只存在于评测工作区。

**时间结论：**用户确认三档是 30/60/120 分钟的最长运行预算，并不是要求实际运行这么久。本轮全部在预算内完成。这组样例不能证明连续半小时、一小时或两小时运行时的稳定性，也不能把耗时当作难度校准结果。

## 过程中的问题

1. **评估证据不充分。**首次简单档的四类检查全部通过，但评估只看到 pytest 数量和退出码，无法把结果对应到验收条件，给出 `INCONCLUSIVE`。中档在同等证据下却被判 `PASS`，说明仅凭计数的 LLM 评估不稳定。修正后，评估同时收到受保护测试源码与对应的运行结果；简单和中档的复跑评语都逐项引用了断言。
2. **复杂档暴露测试覆盖缺口。**首次评估指出零容量、同优先级 ID 顺序和装不下作业时继续填充的情形未被测试。补齐这些受保护断言后，复跑的 unit、集成检查和评估通过。
3. **无效重试。**首次简单档在 `INCONCLUSIVE` 后让生成器再改代码，但源码已通过检查，第二轮没有改动而 `BLOCKED`。首次复杂档第二轮甚至尝试新增受保护测试文件，因保护规则被 `BLOCKED`。现在独立评估拒绝会直接结束为 `JUDGE_REJECTED`，保留反馈，避免把证据问题转给生成器。
4. **SDK 工具隔离。**`noTools: true` 仍允许本机扩展工具进入评估会话。改用 SDK 的 `noTools: 'all'`，离线测试确认活动工具列表为空。
5. **归档写入竞争。**一次单元测试发现 `git archive` 进程退出时 tar 文件尚未写完；现在同时等待写入流完成。归档文件改为容器非 root 用户可读，以供 Docker 挂载。
6. **评测镜像准备时间。**通用 Playwright 镜像拉取缓慢，因此这组三个仅需 Python API 集成的任务使用约 83 MB 的独立镜像。它们没有浏览器场景，不能充当浏览器 E2E 验证。

## 日志与复现

每次运行的 `run.log` 和 `timeline.jsonl` 位于 `.harness-data/benchmarks/<档位>[-verified]/`，完整状态和每项检查证据位于 `.harness-data/runs/<run-id>/state.json`，生成器工具调用记录位于同目录的 `sessions/generator/`。这些目录被 `.gitignore` 排除；首次失败日志和复跑日志均保留在本机。

```bash
npm install
npm test
docker build -t effective-harness-benchmark:local -f docker/Benchmark.Dockerfile .
node scripts/long-eval.mjs all <新标签>
```

本轮本地校验：15 项 Node 测试、`npm run check`、`node --check scripts/long-eval.mjs`、`git diff --check` 均通过。Pi SDK 还完成了一次真实 `iagent/standard` 规划调用。
