# Pi long-running agent 极限探索记录

日期：2026-10-30。分支：`feat/pi-long-running-isolated-eval`。模型：Pi `iagent/iagent/standard`，thinking `high`。执行环境：无网络、非 root、只读根文件系统的 Docker；镜像 `effective-harness-benchmark:local`。三档最长预算仍为 30/60/120 分钟，实际运行均提前结束。

## 难度升级与实测

| 任务 | 工作内容 | 最长预算 | 实测 | 轮次 | 结果 |
| --- | --- | ---: | ---: | ---: | --- |
| 简单增强版 | CSV 校验、Unicode 规范化、去重、原子 JSON 快照 | 30 分钟 | 177 秒 | 1 | `VERIFIED_PASS`，22 单测 + 1 集成 |
| 中等增强版 | SQLite 事件存储、乐观并发、幂等回放、快照恢复 | 60 分钟 | 117 秒 | 1 | `VERIFIED_PASS`，13 单测 + 1 集成 |
| 复杂增强版 | 事件存储 + 持久化 DAG、租约、重试、容量调度与恢复 | 120 分钟 | 219 秒 | 2 | `VERIFIED_PASS`，30 单测 + 2 集成 |
| 增量极限版 | 在约 800 行已有实现上加批量领取、续租、取消传播、审计迁移与并发检查 | 120 分钟 | 292 秒 | 2 | `VERIFIED_PASS`，41 单测 + 3 集成 |

最终简单任务是 `run-2f218cbe57964623`；中等任务是 `run-01fe7154f08b4575`；复杂任务是 `run-1d19f29857f94541`；增量极限任务是 `run-072ed1c4bfde4fdc`。每个运行的完整状态、每项测试输出和生成器会话在 `.harness-data/runs/<run-id>/`，阶段时间线和 CLI 输出在 `.harness-data/benchmarks/limits/<task>-<label>/`。这些运行产物由 `.gitignore` 排除。

复杂增强版第一轮仅有 mypy 错误，第二轮修复后通过。增量极限版第一轮在租约到期边界失败，第二轮修复后通过。两次都实际使用了失败检查的输出反馈；此前工作流只回传“某项检查失败”，现已将有界 stdout/stderr 一并回传。

## 留出测试揭示的边界

增量极限版的公开验收通过后，用未提供给生成器的两项测试检查“终态不能再取消”：`failed` 或 `blocked` 任务被取消时，原实现错误地改写状态并追加审计事件。留出测试结果为 **2 failed**。这表明公开测试全绿并不等于完整满足文字验收，尤其是状态机的未测转移。

将这两项反例加入受保护测试后，agent 在一次生成中修复，43 项单测和 3 项集成测试通过。独立评估仍给出 `INCONCLUSIVE`，因为“旧数据库缺少 history 表的迁移”和“取消/失败引发的 block 审计”尚无对应断言。补齐测试后，在修复候选上运行 45 项单测、3 项集成测试、ruff 与 mypy，均通过；基线直接验证为 `VERIFIED_PASS`，无需再改源码。对应运行分别为 `run-3cc97804fa994c3a` 和 `run-0e9ed07c7d33440d`。

**可观察的能力界限：**此模型在约 1,000 行目标代码、48 项功能检查和跨会话持久化场景内，仍能在两轮、约 5 分钟内完成并修复明确反例。未触及 120 分钟预算或 512K 上下文上限，不能据此声称其绝对能力极限。首个实际失败点是对未显式测试的终态转移推理不足；给出反例后可以修复。复杂增强版生成器累计约 57.6 万输入 token、2.9 万输出 token，单次最大输入约 5.1 万；增量极限版约 40.9 万输入、2.35 万输出，均仅统计生成器会话，不含规划和评估。

## 运行器问题与修复

1. **崩溃锁阻止恢复。**死进程留下 `lock` 后，`resume` 原先稳定报 `EEXIST`。加入 PID 存活检测与受控锁恢复；回归测试证明死锁可恢复、活进程锁不可抢占。
2. **预算到期不落终态。**5 秒受控复现中，旧包装脚本发送 `SIGTERM` 后，状态仍为 `RUNNING` 且锁文件存在。修复后同一场景得到 `TIME_BUDGET_EXCEEDED`、`DONE`，锁文件消失，并记录 `timedOut:true`。
3. **预算到期遗留资源。**受控复现发现两个 `/tmp/harness-archive-*` 目录残留。归档目录现在带 run ID，超时清理由该 run ID 精确定位归档和 Docker 容器；再次复现无残留归档或容器。
4. **已通过基线仍要求修改代码。**旧工作流会进入生成阶段，可能因“没有改动”错误结束。现在基线四类检查全过时直接交独立评估；回归测试和 45 项单测的真实复评均验证了 round 0 路径。
5. **验收证据不完整。**先前简单档和极限档的评估拒绝均指出真实的测试覆盖缺口。补足原子替换失败、旧库迁移及阻塞审计的测试后再复评，未通过改写评估提示绕过问题。

## 复现

```bash
npm install
npm test
docker build -t effective-harness-benchmark:local -f docker/Benchmark.Dockerfile .
HARNESS_SUITE=limits node scripts/long-eval.mjs all <新标签>
HARNESS_SUITE=limits HARNESS_BASE_REPO=<复杂档候选工作区> node scripts/long-eval.mjs extreme <新标签>
```

`HARNESS_BUDGET_MS` 可在本地缩短预算以验证超时清理；实际三档上限不会被它扩大。最终校验：19 项 Node 测试、语法检查、`git diff --check` 通过。完整的浏览器 E2E 和真正连续两小时的稳定性未在本轮覆盖。
