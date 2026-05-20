# 测试驱动Agent——浏览器自动化与端到端验证

> 原文出处：[Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — Anthropic Engineering Blog

---

## 一、测试：长运行Agent最隐蔽的失败模式

前三篇讨论了记忆断层、目标模糊和状态污染。但即便这些问题都被解决，还有一个更隐蔽的失败模式潜伏在每个会话的终点。

> "One final major failure mode that we observed was Claude's tendency to mark a feature as complete without proper testing."

**Claude 倾向于在缺乏充分测试的情况下将特性标记为完成。**

更具体地说：

> "Absent explicit prompting, Claude tended to make code changes, and even do testing with unit tests or `curl` commands against a development server, but would fail recognize that the feature didn't work end-to-end."

在没有明确提示的情况下，Claude 会：
1. 做出代码变更
2. 运行单元测试或对开发服务器发送 `curl` 请求
3. **但这些测试通过了，就认为特性完成了——即使端到端流程根本不工作**

这是一个 "局部正确但全局错误" 的典型案例。Agent 查了零件（单元测试通过），但没有测试整台机器是否正常运转。

## 二、为什么不直接改Prompt就行？

你可能会问：如果问题是"Agent没有做端到端测试"，那直接在 prompt 里加一句"请做端到端测试"不就行了吗？

Anthropic 的实验表明，**光说是不够的**。Agent 需要的是**工具**，而不仅仅是指导。

> "In the case of building a web app, Claude mostly did well at verifying features end-to-end once explicitly prompted to use browser automation tools and do all testing as a human user would."

关键变化发生在两个维度上：

1. **工具层面**：提供了浏览器自动化工具（Puppeteer MCP Server）
2. **Prompt层面**：要求 Agent **像一个人类用户一样进行所有测试**

两者的组合——"正确的工具 + 正确的测试范式"——才让 Agent 的测试质量发生了质变。

## 三、Puppeteer MCP：给Agent装上一双眼睛

### 3.1 技术架构

Anthropic 的选择是为 Claude Agent SDK 集成 **Puppeteer MCP Server**。Puppeteer 是一个 Node.js 库，提供对 Chrome/Chromium 浏览器的高级 API 控制。通过 MCP（Model Context Protocol），Claude 可以：

- 打开浏览器页面，导航到指定 URL
- 点击按钮、填写表单、滚动页面
- **截取屏幕截图**，将视觉反馈传回模型
- 检查 DOM 元素的存在和状态

这在架构上制造了一个闭环：

```
Agent 编写代码 → 重启开发服务器 → Puppeteer 打开浏览器 → 
执行用户操作 → 截图反馈 → Agent 判断结果 → 通过/失败
```

### 3.2 截图反馈：视觉验证的力量

原文中最引人注目的细节是 Agent 通过 Puppeteer 截图进行自我验证：

> ![Screenshots taken by Claude through the Puppeteer MCP server as it tested the claude.ai clone.](图略)
>
> *Screenshots taken by Claude through the Puppeteer MCP server as it tested the claude.ai clone.*

这意味着 Agent 测试流程中包含了一个视觉判断环节：**Agent 看到浏览器截图，判断页面的视觉呈现是否符合预期。** 这不是简单的 HTTP 状态码检查——Agent 真正在像一个用户一样"看"应用。

> "Providing Claude with these kinds of testing tools dramatically improved performance, as the agent was able to identify and fix bugs that weren't obvious from the code alone."

性能提升的关键在于 Agent 能发现**仅从代码看不出来的 bug**——比如CSS布局错乱、元素重叠、响应式断点失效等视觉问题。

## 四、会话启动中的测试协议

在前面的文章中我们简要提到了 `init.sh` 的冒烟测试功能。这里深入分析整个**会话启动测试协议**。

### 4.1 为什么要先测试再开发？

> "In the case of the claude.ai clone, this meant that the agent always started the local development server and used the Puppeteer MCP to start a new chat, send a message, and receive a response. This ensured that Claude could quickly identify if the app had been left in a broken state, and immediately fix any existing bugs."

每个编码Agent打开会话后，**第一件事不是开始写代码，而是跑一遍冒烟测试**：

1. 启动开发服务器（通过 `init.sh`）
2. 用 Puppeteer 打开应用
3. 执行一个完整的"新聊天 → 输入 → 收到回复"流程
4. 确认核心功能正常

为什么这个顺序如此重要？

> "If the agent had instead started implementing a new feature, it would likely make the problem worse."

如果 Agent 跳过测试直接开发新特性，它可能**在一个已经被破坏的基础上继续堆代码**——让问题雪上加霜。

### 4.2 标准会话启动序列

结合前三篇的内容，一个完整的标准会话启动序列如下：

```
[Assistant] I'll start by getting my bearings and understanding the current state of the project.
[Tool Use] <bash - pwd>
[Tool Use] <read - claude-progress.txt>
[Tool Use] <read - feature_list.json>
[Assistant] Let me check the git log to see recent work.
[Tool Use] <bash - git log --oneline -20>
[Assistant] Now let me check if there's an init.sh script to restart the servers.
<Starts the development server>
[Assistant] Excellent! Now let me navigate to the application and verify that some fundamental features are still working.
<Tests basic functionality>
[Assistant] Based on my verification testing, I can see that the fundamental functionality is working well. The core chat features, theme switching, conversation loading, and error handling are all functioning correctly. Now let me review the tests.json file more comprehensively to understand what needs to be implemented next.
<Starts work on a new feature>
```

这个序列可以分解为三个明确的阶段：

| 阶段 | 步骤 | 目的 |
|------|------|------|
| **定位（Orient）** | `pwd` → `progress.txt` → `feature_list.json` → `git log` | 理解当前状态 |
| **验证（Verify）** | `init.sh` → 启动服务器 → 端到端测试 | 确认环境干净 |
| **行动（Act）** | 选定特性 → 实现 → 测试 → Commit → 更新进度 | 增量推进 |

> "This approach saves Claude some tokens in every session since it doesn't have to figure out how to test the code."

这个标准化的启动序列还有一个隐藏收益：**节省 tokens**。Agent 不需要每次自己琢磨"怎么测试这个应用"——测试流程已经固化在 `init.sh` 和启动序列中了。

## 五、工具局限与未解决的问题

### 5.1 视觉能力的边界

尽管浏览器自动化大大提升了测试质量，但仍有明显的局限：

> "Some issues remain, like limitations to Claude's vision and to browser automation tools making it difficult to identify every kind of bug. For example, Claude can't see browser-native alert modals through the Puppeteer MCP, and features relying on these modals tended to be buggier as a result."

具体来说：

| 局限 | 影响 |
|------|------|
| **浏览器原生模态框不可见** | Puppeteer 无法截图 `alert()` / `confirm()` 弹窗，Agent 认为功能正常，实际上弹窗卡住了整个页面 |
| **视觉模型精度有限** | 对细微的布局偏移、颜色差异、字体渲染异常可能不敏感 |
| **时序问题难捕获** | 截图的静态性质使其难以发现动画卡顿、竞态条件等动态 bug |

这些都是实际的工程限制，提醒我们**自动化测试工具还不能完全替代人类测试**——但它们在当前水平上已经能捕获 80% 以上的 bug。

### 5.2 测试工具的泛化问题

原文中提到的测试方案是针对 Web 应用高度优化的（Puppeteer + 截图回路）。对于其他类型的 Agent 任务——比如后端服务开发、数据处理管线、科学计算——"端到端测试"的含义完全不同，需要的工具链也不同。

这是一个隐含的工程挑战：**测试工具的可靠性与 Agent 的输出质量高度耦合**，而测试工具本身需要针对任务领域做定制化适配。

## 六、测试协议总结

综合全文，Anthropic 的 Agent 测试方法论包含三个层次：

```
第一层：自动化回归（init.sh 冒烟测试）
  └─ 每次会话启动时执行，确保已有功能未被破坏
         ↓
第二层：特性验证（Puppeteer 端到端测试）
  └─ 每个特性实现后执行，模拟人类用户操作流程
         ↓
第三层：视觉确认（截图回路）
  └─ Agent 查看浏览器截图，判断视觉呈现是否符合预期
         ↓
特性标记：passes: true（仅在三层全部通过后）
```

这也解释了为什么特性列表中的 `steps` 字段设计为可执行的具体步骤——它们不只是需求描述，**它们就是测试用例本身**。`steps` 中的每一步都对应一个 Puppeteer 操作：

```json
"steps": [
  "Navigate to main interface",           // page.goto(url)
  "Click the 'New Chat' button",          // page.click(selector)
  "Verify a new conversation is created", // page.screenshot() + 视觉判断
  "Check that chat area shows welcome state",
  "Verify conversation appears in sidebar"
]
```

需求即测试，测试即需求。两者不再分离——这是 Agent 场景下一种全新的开发范式。

---

在最后一篇中，我们将跳出 Web 开发的具体场景，探讨长运行Agent方案的**泛化前景与开放问题**——从多 Agent 架构的可能性，到科学研究和金融建模等新领域的应用。

---

*上一篇：[环境工程——特性列表、Git与进度追踪的设计哲学](./03-环境工程——特性列表、Git与进度追踪的设计哲学.md)*
*下一篇：[从Web开发到通用Agent——长运行Agent的未来](./05-从Web开发到通用Agent——长运行Agent的未来.md)*
