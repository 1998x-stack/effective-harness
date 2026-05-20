# 从Web开发到通用Agent——长运行Agent的未来

> 原文出处：[Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — Anthropic Engineering Blog

---

## 一、当前方案的成就与边界

前四篇文章系统梳理了 Anthropic 在长运行Agent领域的一套完整工程方案：

| 组件 | 解决的核心问题 |
|------|---------------|
| 双Agent架构 | 记忆断层 + 规模失控（初始化 vs. 迭代分离） |
| 特性列表 JSON | 目标模糊（完整的唯一定义） |
| Git 工作流 | 状态污染（可回溯的干净状态） |
| 进度文件 | 记忆断层（Agent间的交接文档） |
| init.sh + Puppeteer | 启动摩擦 + 测试不足（自动化验证回路） |

这套方案成功让 Claude Agent SDK 在 claude.ai 克隆这种高度复杂的全栈 Web 应用开发任务中，实现了跨越多个上下文窗口的稳定增量进展。但 Anthropic 自己也坦承：**这只是一个可能的解，而非唯一的解。**

> "This research demonstrates one possible set of solutions in a long-running agent harness to enable the model to make incremental progress across many context windows. However, there remain open questions."

本文探讨这些开放问题——它们指向了长运行Agent的下一个前沿。

## 二、开放问题一：单Agent还是多Agent？

### 2.1 当前方案的隐含假设

双Agent方案（初始化器 + 编码器）的一个隐含假设是：**一个足够强大的通用编码Agent，可以在所有后续会话中胜任所有类型的开发任务。** 编码Agent既要写代码、又要测试、还要维护进度记录——它是一个"全能型"角色。

但这是最优解吗？

> "Most notably, it's still unclear whether a single, general-purpose coding agent performs best across contexts, or if better performance can be achieved through a multi-agent architecture."

Anthropic 明确标记了这个问题为**尚未确定**。这对正在设计自己 Agent 系统的工程团队来说是一个重要信号：不要假设两Agent方案就是终点。

### 2.2 专业化Agent的可能性

> "It seems reasonable that specialized agents like a testing agent, a quality assurance agent, or a code cleanup agent, could do an even better job at sub-tasks across the software development lifecycle."

原文提出了一个自然的推演方向——按软件开发生命周期中的角色进行Agent专业化：

| 专业Agent | 对应的人类角色 | 潜在优势 |
|-----------|-------------|---------|
| **测试Agent** | QA工程师 | 专注于端到端测试、边界条件、回归验证 |
| **质量保证Agent** | 代码审查者 | 检查代码风格、性能、安全、架构一致性 |
| **代码清理Agent** | 重构工程师 | 消除技术债务、统一代码风格、优化依赖 |

专业化的优势在于：每个 Agent 的 prompt 可以更加精确，工具集可以更聚焦，质量评估标准可以更客观。

### 2.3 多Agent架构的隐性成本

但原文没有展开讨论的是多Agent架构的**隐性成本**：

1. **协调开销（Coordination Overhead）**：多个Agent之间的工作如何编排？如何避免冲突？——需要有调度层或协议层
2. **状态一致性（State Consistency）**：多个Agent共享同一个代码仓库时，如何处理并发修改？传统的 Git 分支/合并模式在 Agent 场景下是否依然适用？
3. **故障传播（Failure Propagation）**：一个Agent的错误可能被下游Agent放大。比如代码清理Agent删了"看似无用"但实际必要的代码，测试Agent却标记"通过"因为它只测了自己关心的路径
4. **调试复杂度**：当项目出错时，追踪是哪个Agent在何时引入了问题，比单Agent场景困难得多

两Agent方案的优雅之处正在于它**刚好够用，刚好不引入这些问题**。任何向多Agent架构的跃迁，都必须用实验数据证明收益超过这些新增成本。

## 三、开放问题二：从Web开发到通用领域

### 3.1 Web开发场景的特殊性

> "Additionally, this demo is optimized for full-stack web app development. A future direction is to generalize these findings to other fields."

当前方案针对的是**全栈 Web 应用开发**。这个场景有一些独特的属性，使得该方案特别有效：

| Web 开发的属性 | 对方案的影响 |
|------------|----------|
| 代码输出高度可见（浏览器可渲染） | Puppeteer 截图回路可以直接反馈视觉结果 |
| 开发-测试闭环短 | `init.sh` 启动服务器后几秒钟就能做端到端测试 |
| Git 天然适配 | Web 项目的文件/模块结构天然支持增量提交 |
| 特性列表可枚举 | "新聊天按钮"、"消息发送功能"——Web 应用的功能是离散可枚举的 |

但这些属性并非在所有领域都成立。

### 3.2 科学研究的Agent挑战

> "It's likely that some or all of these lessons can be applied to the types of long-running agentic tasks required in, for example, scientific research or financial modeling."

原文以科学研究和金融建模为例，但未展开。让我们模拟推演一下关键差异：

| | Web 应用开发 | 科学研究 |
|------|-----------|--------|
| **"完成"的定义** | 特性列表通过 = 完成 | 研究方向可能随实验结果改变，目标本身在漂移 |
| **测试反馈回路** | 浏览器截图，秒级 | 实验运行可能需要数小时到数天 |
| **代码与结果的关系** | 确定性 | 高度非确定性——相同代码可能产生不同实验结果 |
| **"干净状态"的含义** | 代码可编译、可运行 | 实验条件可复现（环境、数据、参数） |
| **失败的责任归属** | 代码bug | 可能是代码bug、实验设计缺陷、或统计噪声 |

对于科学研究Agent，特性列表可能需要转化为**可检验的假设列表**；进度文件可能需要记录为什么某个方向的实验被放弃了（负结果也是宝贵的科学知识）；"干净状态"可能意味着计算环境（Docker镜像等）的完整可复现性封装。

### 3.3 金融建模的Agent挑战

金融建模领域有自己独特的挑战：

- **时效性约束**：有些财务决策需要在特定时间窗口内完成
- **合规性要求**：Agent 的每个决策必须可审计——"为什么买了这支股票"需要比 Git commit message 更详细的决策记录
- **不确定性管理**：金融模型天然处理概率，Agent 需要能够表达"置信度"而不仅仅是"passes: true/false"
- **工具链差异**：不是 Puppeteer，而是 Excel、SQL、数据管道、API 集成

## 四、开放问题三：从两Agent到"Agent编排层"

回看整个方案的演进脉络，可以发现一条隐线：

```
单个通用Agent（失败）
    → 引入 Compaction（不够）
        → 两Agent 角色分离（有效）
            → 多Agent 专业化（未验证）
```

这引出了一个更深层的问题：**Agent 之间的编排逻辑应该放在哪里？**

当前方案中，初始化Agent和编码Agent的"编排"是隐式的——通过 `claude-progress.txt` 和 Git 历史构成一个被动的共享状态。没有任何"调度器"主动管理Agent的工作分配。

如果未来走向多Agent架构，这可能不够。一个可行的演进方向是引入**Agent编排层**：

```
                   ┌──────────────────┐
                   │  Agent Orchestrator│ ← 新增：任务分解、Agent调度、
                   └────────┬─────────┘       质量门控、状态管理
                            │
        ┌───────────┬──────┴───────┬───────────┐
        ▼           ▼              ▼           ▼
   ┌─────────┐ ┌─────────┐  ┌─────────┐ ┌─────────┐
   │Feature  │ │Coding   │  │Testing  │ │Cleanup  │
   │Designer │ │Agent    │  │Agent    │ │Agent    │
   └─────────┘ └─────────┘  └─────────┘ └─────────┘
```

但这又回到了同样的权衡：每加一层，就多一层复杂性。Anthropic 当前的极简方案能否支撑到多Agent阶段，仍然是一个需要实验才能回答的问题。

## 五、核心方法论：六条可迁移原则

尽管具体方案是针对 Web 开发的，但从中可以提炼出六条**跨领域通用的长运行Agent设计原则**：

### 原则一：记忆外化（Memory Externalization）

不要试图让Agent"记住"所有事情。把状态从Agent的上下文窗口**外化**到文件系统中——文本文件、Git 历史、结构化 JSON。

### 原则二：不可变规约（Immutable Specification）

Agent 的行为边界必须由不可变的规约定义。特性列表的 `steps` 和 `description` 字段不能被 Agent 修改——这防止了标准在迭代中滑落。

### 原则三：增量契约（Incremental Contract）

每个Agent会话必须在结束时留下**定义良好的完成状态**。"定义良好"意味着代码干净、进度可读、下一个Agent可以直接接手。这不是礼貌问题——这是系统可运作的前提。

### 原则四：验证优先于推进（Verification Before Progression）

每次会话的第一个动作不是向前推进，而是**向后验证**——确认已有功能没有被破坏。冒烟测试比新功能开发更优先。

### 原则五：人类工具即Agent工具（Human Tools as Agent Tools）

不要为Agent发明新的基础设施。Git、文本文件、JSON、Shell 脚本、浏览器自动化——这些都是人类工程师每天都在用的工具。Agent 应该使用相同的工具链，因为这意味着方案天然可调试、可审计、可理解。

### 原则六：简单至上（Simplicity First）

在实证数据证明收益之前，不要增加复杂度。两Agent足够，就不要引入第三个。格式化文本文件够用，就不要引入专用数据库。这条原则贯穿了整个方案的每个决策。

## 六、结语

Anthropic 的 "Effective harnesses for long-running agents" 不是一篇发布完美解决方案的论文，而是一份**来自前线的工程笔记**。它诚实记录了实验结果——什么有效（环境脚手架、增量迭代、浏览器测试）、什么不够（单独的 compaction）、什么还不清楚（多Agent架构、领域泛化）。

> "This work reflects the collective efforts of several teams across Anthropic who made it possible for Claude to safely do long-horizon autonomous software engineering."

对于正在构建Agent系统的工程团队来说，这篇博文最有价值的部分不是具体的 JSON 格式或 Puppeteer 配置，而是它展示的**方法论态度**：

1. **从观察失败模式开始**，而不是从理论架构开始
2. **从人类工程师的日常实践中提取灵感**，而不是发明全新范式
3. **保持方案极简**，只增加被数据证明必需的部分
4. **坦诚标记开放问题**，不假装一切已解决

这些态度本身，或许就是构建长运行Agent系统最重要的"元原则"。

---

*全系列完*

---

*上一篇：[测试驱动Agent——浏览器自动化与端到端验证](./04-测试驱动Agent——浏览器自动化与端到端验证.md)*

---

## 系列文章索引

1. [长运行AI Agent的根本困境](./01-长运行AI-Agent的根本困境.md)
2. [双Agent模式——初始化器与编码器的分工艺术](./02-双Agent模式——初始化器与编码器的分工艺术.md)
3. [环境工程——特性列表、Git与进度追踪的设计哲学](./03-环境工程——特性列表、Git与进度追踪的设计哲学.md)
4. [测试驱动Agent——浏览器自动化与端到端验证](./04-测试驱动Agent——浏览器自动化与端到端验证.md)
5. [从Web开发到通用Agent——长运行Agent的未来](./05-从Web开发到通用Agent——长运行Agent的未来.md)
