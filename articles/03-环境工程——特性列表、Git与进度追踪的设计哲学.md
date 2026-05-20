# 环境工程——特性列表、Git与进度追踪的设计哲学

> 原文出处：[Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — Anthropic Engineering Blog

---

## 一、环境脚手架的三个组件

初始化Agent搭建的环境地基由三个核心组件构成。它们各自解决"记忆断层"问题的不同侧面：

| 组件 | 解决的问题 | 本质 |
|------|-----------|------|
| **特性列表（Feature List）** | 目标模糊：Agent不知道"做完"是什么意思 | "什么是完整"的唯一定义 |
| **Git 工作流** | 状态污染：环境在会话间退化 | 代码质量的版本锚点 |
| **进度文件（Progress File）** | 记忆断层：新Agent不知道之前发生了什么 | Agent间的交接文档 |

这三个组件的共同设计目标可以用一句话概括——让一个全新的Agent实例在打开上下文窗口后的**前30秒内**，建立对项目状态和目标的完整认知。

## 二、特性列表（Feature List）：完整性的唯一定义

### 2.1 为什么需要特性列表？

回顾第一篇中提到的"失败模式二——过早宣告胜利"：Agent 环顾四周，看到部分功能在运行，就认为任务完成了。这个问题的根源在于：**Agent 和人类用户之间存在巨大的"规格鸿沟"（specification gap）**。

用户输入的是"构建一个 claude.ai 的克隆"，而"克隆"意味着什么？用户心里（甚至自己都未明确意识到的）有数百个隐含的功能假设。Agent 看到的只是代码能跑，但它不知道还有 150 个特性没实现。

> "To address the problem of the agent one-shotting an app or prematurely considering the project complete, we prompted the initializer agent to write a comprehensive file of feature requirements expanding on the user's initial prompt."

Anthropic 的解决方案是让初始化Agent **基于用户的简短 prompt 展开出一份详尽的特性需求文件**。在 claude.ai 克隆项目中，这意味着 **超过 200 个特性**。

### 2.2 JSON vs Markdown：格式选择的教训

特性列表的数据格式选择经历了实验迭代：

> "After some experimentation, we landed on using JSON for this, as the model is less likely to inappropriately change or overwrite JSON files compared to Markdown files."

**为什么选择 JSON 而不是 Markdown？** 这是一个非常实际的工程观察：

> "We use strongly-worded instructions like 'It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality.'"

即使给了强约束提示，Agent 在处理 Markdown 文件时仍有倾向去"重写"或"润色"其内容——这是语言模型在文本生成任务上的天性。而 JSON 的结构化特性使得 Agent 更倾向于**只修改特定字段**（如 `passes`），而非重写整个文件。

### 2.3 特性条目的数据结构

每个特性条目具有以下结构：

```json
{
  "category": "functional",
  "description": "New chat button creates a fresh conversation",
  "steps": [
    "Navigate to main interface",
    "Click the 'New Chat' button",
    "Verify a new conversation is created",
    "Check that chat area shows welcome state",
    "Verify conversation appears in sidebar"
  ],
  "passes": false
}
```

让我们逐一分析每个字段的设计意图：

| 字段 | 设计意图 |
|------|---------|
| `category` | 分类标记（functional / ui / api 等），用于优先级排序和分组 |
| `description` | 面向人类的特性描述，简洁明了 |
| `steps` | **可执行的具体验证步骤**——不是抽象需求，而是可操作的测试脚本 |
| `passes` | **唯一的可变状态**：所有特性初始为 `false`，只有通过验证才能改为 `true` |

最关键的设计决策是 **`passes` 字段的语义**：

> "These features were all initially marked as 'failing' so that later coding agents would have a clear outline of what full functionality looked like."

所有特性**默认标记为"失败"（failing）**，而不是"未开始"或"待定"。这个语义选择非常精妙——它建立了一种"有罪推定"：一个特性在被证明通过之前，都视为**不工作**。这直接对抗了 Agent "过早宣告胜利"的倾向。

### 2.4 编码Agent如何使用特性列表

编码Agent的交互被严格限制：

> "We prompt coding agents to edit this file only by changing the status of a `passes` field."

编码Agent **只能修改 `passes` 字段**，不能添加、删除或修改特性和验证步骤。这确保了：

1. 特性范围不会在迭代中被 Agent 缩减
2. 验证标准不会在实际操作中被"降级"
3. 任何时候都能准确知道"还有多少特性未完成"

## 三、Git工作流：代码质量的版本锚点

### 3.1 为什么 Git 是必须的

Git 在长运行Agent场景中承担了双重角色：**回溯工具**和**交接工具**。

作为回溯工具：

> "This allowed the model to use git to revert bad code changes and recover working states of the code base."

Agent 犯错是不可避免的。当 Agent 的某次实现引入 bug 甚至破坏了已有功能时，`git revert` 让后续 Agent 能够**一键回到上一个已知的干净状态**，而不是在错误的代码上"打补丁"。

作为交接工具：

> "We found that the best way to elicit this behavior was to ask the model to commit its progress to git with descriptive commit messages."

Git 的 commit message 本身就是一种**结构化的进度记录**。`git log --oneline -20` 让下一个 Agent 瞬间看到"最近20个会话做了什么"——不需要解析长篇文档。

### 3.2 干净状态的Git含义

前两篇中反复提到的"干净状态"，在Git层面对应的是：

- 每次会话结束时的代码必须能通过 `git commit`
- **不能有未处理的工作区变更**（否则等于把半成品留给下一班）
- Commit message 必须足够描述性，让后续 Agent 理解变更意图

这个约束听起来很简单，但在Agent场景中它改变了行为动力：Agent 不能在会话末尾说"差不多行了"，它必须**确认代码处于可提交状态**——这意味着它必须完成当前任务或至少确保代码不处于损坏状态。

### 3.3 Git 与特性列表的联动

理想情况下，一个编码Agent会话的标准流程是：

```
1. 读取 feature_list.json，选定一个 `passes: false` 的特性
2. 实现该特性
3. 通过验证测试
4. git commit -m "feat: implement [feature_description]"
5. 将 feature_list.json 中该特性的 `passes` 改为 `true`
6. git commit -m "test: mark [feature_description] as passing"
7. 更新 claude-progress.txt
8. git commit -m "docs: update progress log"
```

每一步都对应一个 Git commit，每一步都是可回溯的。这不是过度工程——这是确保下一个Agent能通过 `git log` 精确理解"发生了什么"的最低成本方案。

## 四、进度文件（Progress File）：Agent间的交接文档

### 4.1 格式与内容

`claude-progress.txt` 是 Agent 之间的直接对话通道。原文中并未给出其精确格式，但从上下文可以推断其关键要素：

- **当前会话的工作摘要**：实现了什么、遇到了什么问题
- **下一步行动**：下一个Agent应该做什么
- **已知问题**：当前存在的 bug 或未完成的事项
- **环境状态**：服务器是否需要重启、是否有配置变更

它本质上是一份 **Agent 写给 Agent 的交接笔记**，和工程师轮班的交接文档有完全相同的功能。

### 4.2 进度文件与 Git commit 的互补

你可能想：既然有 `git log`，为什么还需要 `claude-progress.txt`？

两者的信息密度和作用不同：

| | Git Commit Message | Progress File |
|------|-------------------|--------------|
| **粒度** | 单个变更 | 整个会话 |
| **受众** | 看懂代码的人 | 需要快速上手的人 |
| **内容** | 改了哪些文件、为什么 | 做到哪了、下一步、注意事项 |
| **意图** | 详细的代码变更记录 | 高层级的上下文传递 |

Git 告诉你"发生了什么变化"，进度文件告诉你"这意味着什么以及接下来该做什么"。两者结合，才构成完整的交接信息。

## 五、设计原则总结

回顾整个环境脚手架的设计，可以提炼出几条核心原则：

### 5.1 不可变优于可变

特性列表的字段结构是**不可变的**——Agent 只能改 `passes` 字段。这不是限制 Agent 的能力，而是防止它悄悄缩减范围或降低标准。

### 5.2 默认否定优于默认肯定

所有特性初始为 `passes: false`。"有罪推定"迫使 Agent 必须**证明**特性已实现，而不是假定它已实现。

### 5.3 人类工具优于专用系统

Anthropic 有意识地选择了 Git、文本文件、JSON 这些所有工程师已有的工具：

> "Inspiration for these practices came from knowing what effective software engineers do every day."

没有任何专有的"Agent记忆系统"——就是朴素的文件系统、版本控制和文本。这使得整个方案：
- **可调试**：工程师可以直接打开文件查看状态
- **可审计**：所有变更都有 Git 历史
- **可迁移**：不依赖任何特定的 Agent 框架

### 5.4 结构化优于非结构化

JSON（而非 Markdown）的选择体现了这一原则。结构化数据让 Agent 的行为更容易被约束——Agent 在 JSON 中"只要改 `passes` 字段"的指令比在 Markdown 中"不要删除测试"更容易遵循。

---

在下一篇中，我们将探讨长运行Agent中最容易被忽视但却最关键的一环——**测试与端到端验证**，以及 Anthropic 如何利用浏览器自动化工具让 Agent 真正"看到"它构建的应用是否工作。

---

*上一篇：[双Agent模式——初始化器与编码器的分工艺术](./02-双Agent模式——初始化器与编码器的分工艺术.md)*
*下一篇：[测试驱动Agent——浏览器自动化与端到端验证](./04-测试驱动Agent——浏览器自动化与端到端验证.md)*
