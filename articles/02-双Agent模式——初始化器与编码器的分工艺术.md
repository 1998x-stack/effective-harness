# 双Agent模式——初始化器与编码器的分工艺术

> 原文出处：[Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — Anthropic Engineering Blog

---

## 一、为什么需要两个Agent？

在上一篇中我们分析了长运行Agent的四种核心困境：记忆断层、规模失控、目标模糊、状态污染。面对这些难题，Anthropic 的选择不是去训练更强的模型，而是在**工程层面引入了一种简洁的角色分离**。

> "When experimenting internally, we addressed these problems using a two-part solution:
>
> 1. **Initializer agent**: The very first agent session uses a specialized prompt that asks the model to set up the initial environment.
> 2. **Coding agent**: Every subsequent session asks the model to make incremental progress, then leave structured updates."

从工程视角来看，这不是两个不同的"模型"或"Agent系统"，而是**同一个Agent在不同阶段被赋予不同的 system prompt**：

> "We refer to these as separate agents in this context only because they have different initial user prompts. The system prompt, set of tools, and overall agent harness was otherwise identical."

系统提示词、工具集、Agent 基础设施完全一样，唯一不同的是**初始用户 prompt** 的差异——仅此而已。这个细节很重要：它说明这不是一个复杂的多Agent协调系统，而是一个**极简但精准的职责分界**。

## 二、初始化Agent：打地基的人

### 2.1 角色定位

初始化Agent 只在**首次会话**中执行，它的使命不是写业务代码，而是**搭建一个可以让后续所有编码Agent高效工作的环境地基**。

> "In the updated Claude 4 prompting guide, we shared some best practices for multi-context window workflows, including a harness structure that uses 'a different prompt for the very first context window.' This 'different prompt' requests that the initializer agent set up the environment with all the necessary context that future coding agents will need to work effectively."

这里的"不同的 prompt"并非什么魔法——它明确要求初始化Agent**为未来的编码Agent准备好一切必要的上下文**。

### 2.2 三大产出物

初始化Agent的具体产出物包括：

| 产出物 | 说明 | 作用 |
|--------|------|------|
| `init.sh` | 启动开发服务器的脚本 | 每个后续Agent无需自己摸索如何启动App |
| `claude-progress.txt` | 进度日志文件 | Agent间的"交接文档"，记录做了什么、做到哪了 |
| **初始 Git Commit** | 记录初始文件结构 | 提供版本回溯基准线 |

为什么是这三个？因为它们分别解决了后续Agent的三个核心问题：

1. **如何启动应用？** → `init.sh` 一次性解决，后续不用再摸索
2. **之前做了什么？** → `claude-progress.txt` 提供人类可读的进度摘要
3. **改了什么文件？** → `git log` 提供精确的代码变更历史

> "The key insight here was finding a way for agents to quickly understand the state of work when starting with a fresh context window, which is accomplished with the `claude-progress.txt` file alongside the git history."

这里的设计哲学非常朴实：**让Agent能从零上下文窗口在最短时间内恢复对整个项目状态的认知**。不是通过复杂的记忆系统或向量数据库，而是通过两个所有工程师都已经熟悉的工具——一个文本文件和 git 历史。

### 2.3 init.sh 的设计价值

`init.sh` 看似简单，但它解决的"启动摩擦"问题在实际实验中非常显著。在 claude.ai 克隆项目中：

> "It also helps to ask the initializer agent to write an `init.sh` script that can run the development server, and then run through a basic end-to-end test before implementing a new feature."

`init.sh` 不仅启动开发服务器，还**包含一个基本的端到端冒烟测试**——在实现新特性之前，先验证基础功能是否依然正常工作。这相当于每个班次的工程师在开工前先跑一遍回归测试，确保上一班没把环境搞坏。

## 三、编码Agent：迭代推进的人

### 3.1 角色定位

编码Agent 在所有后续会话中运行。它的设计围绕一个核心原则：**增量推进，干净离开**。

> "Given this initial environment scaffolding, the next iteration of the coding agent was then asked to work on only one feature at a time. This incremental approach turned out to be critical to addressing the agent's tendency to do too much at once."

**一次只做一个特性。** 这直接对抗了第一篇中提到的"失败模式一：试图一次做完所有事"。当 Agent 被强制聚焦于单一特性时，它就不会耗尽上下文去做一个永远完不成的宏伟大计。

### 3.2 会话结束协议：干净状态

编码Agent最关键的约束在**会话结束时**：

> "Once working incrementally, it's still essential that the model leaves the environment in a clean state after making a code change. In our experiments, we found that the best way to elicit this behavior was to ask the model to commit its progress to git with descriptive commit messages and to write summaries of its progress in a progress file."

让Agent在会话结束时留下"干净状态"的最佳方式：

1. **用描述性 commit message 提交代码**到 Git
2. **在进度文件中写入进度摘要**

为什么这两个行为如此有效？因为它们迫使 Agent 在结束前做一次"心理收尾"：

- **Commit** 意味着 Agent 必须确认代码是可编译、可运行的（否则提交无意义）
- **进度摘要** 意味着 Agent 必须清晰地表达"我做了什么、下一步该做什么"

> "This allowed the model to use git to revert bad code changes and recover working states of the code base."

Git 的另一个关键价值：当 Agent 自己搞砸了（这是会发生的），它可以用 `git revert` 回退到上一个干净状态，而不是让后续的 Agent 在错误的代码上越改越乱。

### 3.3 效率的提升

这一策略不仅解决了可靠性问题，还大幅提升了效率：

> "These approaches also increased efficiency, as they eliminated the need for an agent to have to guess at what had happened and spend its time trying to get the basic app working again."

**Agent 不再需要猜测之前发生了什么，也不再需要花时间让基础应用重新跑起来。** 它打开会话 → 读取进度 → 读取特性列表 → 选一个特性 → 开始干活。没有浪费时间在"考古"上。

## 四、角色分离的设计哲学

### 4.1 单一职责原则

初始化Agent 和 编码Agent 的分工，本质上是软件工程中**单一职责原则**（Single Responsibility Principle）在 Agent 设计中的应用：

| 职责 | 初始化Agent | 编码Agent |
|------|:---------:|:--------:|
| 理解需求、规划全局特性 | ✅ | — |
| 搭建环境、编写脚本 | ✅ | — |
| 增量实现单个特性 | — | ✅ |
| 测试验证、进度更新 | — | ✅ |

让一个Agent 既理解全局需求、又逐特性增量实现、还要维护环境——这个任务本身就要求同一时间处理太多不同的认知模式。分开之后，每个Agent的prompt 可以更聚焦、更精确。

### 4.2 为什么不是三个、五个、十个Agent？

你可能会问：为什么不引入测试Agent、代码审查Agent、清理Agent？原文中确实提到了这个方向：

> "It seems reasonable that specialized agents like a testing agent, a quality assurance agent, or a code cleanup agent, could do an even better job at sub-tasks across the software development lifecycle."

但作者同时承认这是一个开放问题：

> "Most notably, it's still unclear whether a single, general-purpose coding agent performs best across contexts, or if better performance can be achieved through a multi-agent architecture."

两Agent方案的价值恰恰在于它的**极简性**：

1. **足够简单**：只有两种 prompt，容易调试和维护
2. **职责清晰**：初始化 vs. 迭代，边界不模糊
3. **可验证**：产出物明确（文件、commit、进度记录），易于评估

工程实践中，能用两个解决的问题，不要引入第三个——直到数据证明你需要更多的复杂度。

## 五、总结

双Agent模式的核心不是"两个Agent比一个Agent好"，而是**通过角色分离，让不同的认知任务在不同的上下文中完成**。初始化Agent 在"俯视全局"的语境中搭建地基；编码Agent 在"聚焦单点"的语境中逐个突破特性。

这一模式的成功依赖于两个关键机制：

1. **环境脚手架（Environment Scaffolding）**：初始化Agent留下的 `init.sh`、`claude-progress.txt` 和 Git 历史，构成了后续Agent的"记忆外骨骼"
2. **结束协议（Session-End Protocol）**：编码Agent必须在结束时提交代码并更新进度——这不是建议，而是强制约束

在下一篇文章中，我们将深入剖析环境脚手架的核心组件——**特性列表的JSON设计**、**Git工作流的最佳实践**以及**进度文件的格式与使用**。

---

*上一篇：[长运行AI Agent的根本困境](./01-长运行AI-Agent的根本困境.md)*
*下一篇：[环境工程——特性列表、Git与进度追踪的设计哲学](./03-环境工程——特性列表、Git与进度追踪的设计哲学.md)*
