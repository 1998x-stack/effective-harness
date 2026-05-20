# 长运行AI Agent的根本困境

> 原文出处：[Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — Anthropic Engineering Blog

---

## 一、问题的提出

随着AI Agent能力的不断提升，开发者越来越希望将复杂任务——耗时数小时甚至数天的工程工作——交给Agent完成。然而，让Agent在跨越多个上下文窗口（context window）时保持一致的进展，至今仍是一个未解决的开放问题。

Anthropic 在其工程博客中一针见血地指出了这个问题的本质：

> "The core challenge of long-running agents is that they must work in discrete sessions, and each new session begins with no memory of what came before."

翻译过来就是：**长运行Agent的核心挑战在于，它们必须在离散的会话中工作，而每一次新会话开始时，对之前发生的事情毫无记忆。**

## 二、换班工程师：一个精准的类比

Anthropic 用一个极其形象的类比来描述这一困境：

> "Imagine a software project staffed by engineers working in shifts, where each new engineer arrives with no memory of what happened on the previous shift."

想象一个软件项目由轮班工程师负责，**每一个新工程师到岗时，对上一班发生了什么一无所知**。没有交接文档，没有工单系统，没有进度同步——他只能翻看代码仓库，试图从零散的提交记录中拼凑出"现在到底做到哪了"。

这正是当前AI Agent在多会话场景下的真实处境。上下文窗口（context window）有限，而大多数复杂项目无法在单个窗口内完成。Agent 需要在会话之间架起一座桥梁。

对于这个问题链条的更深层结构，原文写道：

> "Because context windows are limited, and because most complex projects cannot be completed within a single window, agents need a way to bridge the gap between coding sessions."

## 三、压缩上下文是不够的

有人可能会问：Claude Agent SDK 不是已经有 **compaction**（压缩）功能了吗？压缩可以将长对话历史浓缩，让 Agent 在上下文中持续工作而不至于被窗口限制挡住。理论上，有了 compaction，一个 Agent 应该能无限期地持续产出有效工作。

但 Anthropic 的实践结论是明确的反面：

> "However, compaction isn't sufficient. Out of the box, even a frontier coding model like Opus 4.5 running on the Claude Agent SDK in a loop across multiple context windows will fall short of building a production-quality web app if it's only given a high-level prompt, such as 'build a clone of claude.ai.'"

**光靠压缩是不够的。** 即使使用最前沿的编码模型 Opus 4.5，在 Claude Agent SDK 的循环中跨越多个上下文窗口，如果只给它一个高层级的 prompt（比如"构建一个 claude.ai 的克隆"），它仍然**无法构建出一个生产质量的 Web 应用**。

这个结论极为关键。它说明：

1. **Compaction 解决的是"记忆压缩"问题，而非"记忆传递"问题。** 压缩后的信息可能丢失关键细节、隐含假设或未完成的半成品状态。
2. **问题的本质不是模型能力不足**——Opus 4.5 已经是顶尖模型——**而是工程管道（engineering pipeline）的设计缺陷**。单靠一个强大的模型，没有配套的脚手架（scaffolding），长任务必然失败。

## 四、Claude的两大失败模式

在 Anthropic 的内部实验中，Claude 在长运行任务中的失败表现为两种典型模式：

### 失败模式一：试图一次做完所有事（One-shot Everything）

> "First, the agent tended to try to do too much at once — essentially to attempt to one-shot the app. Often, this led to the model running out of context in the middle of its implementation, leaving the next session to start with a feature half-implemented and undocumented. The agent would then have to guess at what had happened, and spend substantial time trying to get the basic app working again."

Agent 倾向于**一次性完成整个应用**。这往往导致模型在实现中途就耗尽了上下文窗口，把下一个会话扔给一个**功能实现了一半、没有文档**的烂摊子。

更致命的是，下一个 Agent 实例只能**猜测**之前发生了什么，花大量时间试图让基础应用重新跑起来，而不是继续推进新功能。

> "This happens even with compaction, which doesn't always pass perfectly clear instructions to the next agent."

**Compaction 并不能总是传递完美的清晰指令给下一个 Agent。** 压缩后的"摘要"就像一份写得含糊的交接文档——关键信息可能已经丢失了。

### 失败模式二：过早宣告胜利（Premature Declaration of Success）

> "A second failure mode would often occur later in a project. After some features had already been built, a later agent instance would look around, see that progress had been made, and declare the job done."

在项目后期出现第二种经典失败：一个后来的 Agent 实例环顾四周，看到一些进展已经完成，就**宣告任务完成了**。

这听起来荒谬——一个只有部分功能的 App 怎么能算"完成"？但 Agent 缺乏的是对"完整规格"的清晰认知。它看到的是"有东西可以跑"，而不知道"还有 150 个特性尚未实现"。

## 五、问题的分解

基于这两种失败模式，Anthropic 将问题分解为两个子问题：

> "First, we need to set up an initial environment that lays the foundation for *all* the features that a given prompt requires, which sets up the agent to work step-by-step and feature-by-feature. Second, we should prompt each agent to make incremental progress towards its goal while also leaving the environment in a clean state at the end of a session."

1. **首先**，我们需要搭建一个初始环境，奠定 prompt 所需**全部特性**的基础。这个环境要让 Agent 能够**一步一步、一个特性一个特性地**工作。
2. **其次**，我们应该提示每一个 Agent 做出增量进展，同时在会话结束时将环境**留在干净的状态**。

什么叫"干净的状态"（clean state）？Anthropic 给出了一个非常工程化的定义：

> "By 'clean state' we mean the kind of code that would be appropriate for merging to a main branch: there are no major bugs, the code is orderly and well-documented, and in general, a developer could easily begin work on a new feature without first having to clean up an unrelated mess."

**干净状态 = 可以合并到主分支的代码质量**：没有重大 bug、代码有序且文档齐全、一个新开发者可以直接开始新功能开发，而不必先清理上一个开发者留下的烂摊子。

这个定义本身就揭示了问题的严重性——在默认情况下，Agent 在会话结束时留下的代码状态，离"主分支可合并"差得太远。

## 六、解决方案的两根支柱

针对上述两个子问题，Anthropic 设计了一个两部分的解决方案：

> 1. **Initializer agent**: The very first agent session uses a specialized prompt that asks the model to set up the initial environment: an `init.sh` script, a `claude-progress.txt` file that keeps a log of what agents have done, and an initial git commit that shows what files were added.
> 2. **Coding agent**: Every subsequent session asks the model to make incremental progress, then leave structured updates.

| 角色 | 职责 | 产出物 |
|------|------|--------|
| **初始化Agent** | 首次会话，搭建环境地基 | `init.sh`、`claude-progress.txt`、初始 git commit |
| **编码Agent** | 每次后续会话，增量推进 | 代码变更 + 结构化进度更新 |

这里的核心洞察在于：

> "The key insight here was finding a way for agents to quickly understand the state of work when starting with a fresh context window, which is accomplished with the `claude-progress.txt` file alongside the git history."

**让 Agent 在全新的上下文窗口中快速理解工作状态**——这是整个方案的关键。而实现这一点的工具，是一个朴素的进度文本文件（`claude-progress.txt`）加上 git 历史。

> "Inspiration for these practices came from knowing what effective software engineers do every day."

**这些实践的灵感来源于"高效软件工程师每天都在做什么"。** 不是什么高深的理论，就是把人类的优秀工程实践搬到了 Agent 的工作流中。

## 七、总结

长运行 Agent 面临的根本困境不是模型不够聪明，而是**工程管道缺乏连续性保障**。核心矛盾可以归结为：

1. **记忆断层**：每个新会话从零开始，Compaction 无法完美传递上下文
2. **规模失控**：Agent 倾向于一次做太多，导致上下文耗尽、半途而废
3. **目标模糊**：Agent 看到部分进展就以为任务完成，因为缺乏完整的规格认知
4. **状态污染**：会话结束时代码处于不可合并状态，下一班必须"先打扫再开工"

后续文章中，我们将逐一拆解 Anthropic 针对每个子问题的具体解决方案——从**初始化 Agent 的环境脚手架设计**，到**编码 Agent 的增量工作协议**，再到**特性列表、Git 工作流与端到端测试**的具体工程实践。

---

*下一篇：[双Agent模式——初始化器与编码器的分工艺术](./02-双Agent模式——初始化器与编码器的分工艺术.md)*
