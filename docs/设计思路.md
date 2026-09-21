# 检索多 Harness 编排项目：设计思路（V0.1）

> 本文根据项目讨论整理；已确认的方向与待确认事项分开列出。  
> 原始聊天记录：[ChatGPT对话记录](./ChatGPT对话记录-检索多Harness编排项目-6ab0b488.md)

## 1. 项目定位

这是一个面向真实 Harness 对话的可视化工作流编排器。它把原本需要人守着电脑完成的步骤接起来：

~~~text
等待 A 完成 → 复制助手文本 → 套用提示词 → 切换到 B → 发送 → 等待 B 完成
~~~

用户通过网页画布提前安排这些步骤，之后可以离开电脑。系统联动 Codex、OpenCode 等现有 Harness 会话，但不取代它们，也不要求用户先在本系统里重新创建一套 Agent。

## 2. 核心设计原则

- **真实 Conversation 是资源。** Conversation 有稳定身份；tmux pane、PTY 或进程只是当前运行和连接方式，断开后仍应能重新发现并接回原对话。
- **画布 Node 表示一个步骤。** Node 引用某个 Conversation，并可有自己的用途名称。同一 Conversation 可在同一或不同 Workflow 中被多次引用。
- **保留 Harness 原生能力。** /skill、@file 等内容按原样发送给目标 Harness；编排器只处理工作流变量，例如 {{ upstream.output }}。
- **只自动接力，不擅自接管。** 暂停 Workflow 会阻止后续节点启动，不会自动终止正在运行的对话；停止会话需由用户在 Harness 中操作，或通过明确的 Stop 控件。
- **可靠性优先于假进度。** 显示运行状态和最近活动，不显示没有依据的百分比；超时提醒不能等同于完成。
- **把执行计划做成可调整的未来。** 已完成和正在运行的步骤锁定；尚未执行的步骤可在当前运行中调整。

## 3. 核心对象

| 对象 | 含义 | 关键内容 |
|---|---|---|
| Host | 本地机器或 SSH 主机 | 主机别名、连接状态、可发现的 Harness 会话 |
| Conversation | Harness 中真实、长期存在的对话 | Harness、conversation ID、Host、工作目录、当前模型与 effort、运行时连接 |
| Workflow Node | Conversation 在流程中的一步引用 | Node ID、Conversation ID、用途名称、入口模式、运行状态 |
| Edge | 上游到下游的输入规则 | Prompt Template、上游输出变量、多个上游的汇合规则 |
| Node Run | 一次节点执行记录 | 输入 Prompt、时间、状态、输出快照、错误信息 |
| Workflow | 可保存、运行和复用的图 | 节点、连线、位置、运行记录及模板信息 |

Node 和 Conversation 是不同对象。例如“PI / 设计实验”和“PI / 审查结果”可以是两个 Node，但引用同一个 PI Conversation。

~~~mermaid
flowchart LR
  A["PI 对话<br/>设计实验"] -->|"Prompt Template<br/>{{ upstream.output }}"| B["Experiment Engineer<br/>执行实验"]
  B -->|"Prompt Template<br/>{{ upstream.output }}"| C["PI 对话<br/>审查结果"]
~~~

## 4. 画布与主要操作

### Conversation 资源列表

- 按本地 Host、SSH Host 和 Harness 分组，显示当前运行与历史会话。
- 离线的历史 Conversation 也能拖入画布；流程运行到该节点时，系统可启动 Harness 并恢复原对话。
- 提供“新建 Conversation”入口。新建时选择 Harness、Host、工作目录、初始 Prompt，以及模型和 effort；创建后它就成为普通 Conversation。
- 已有 Conversation 默认沿用自身当前的模型和 effort，Node 不另外覆盖。

### Workflow 画布

- 将 Conversation 拖到画布，形成显示对话名称、Harness、Host、用途和状态的矩形 Node。
- 同一 Conversation 可被多次引用。快捷复制或“再次使用此 Session”是候选交互，最终方式待定。
- 节点用途名称可区分“设计实验”“审查结果”等步骤。
- 节点显示简洁状态和正在做什么；点击后查看详细输入、输出和运行信息。

### Edge：Prompt Template

Edge 是轻量输入编辑器。除工作流变量外，其余文字原样传递，例如：

~~~text
/experiment-engineer

PI 的实验方案：
{{ upstream.output }}

@EXPERIMENT_LOG.md
请按方案执行，不要改变研究问题。
~~~

编排器不解释 skill、文件引用或 Harness 指令；@EXPERIMENT_LOG.md 由目标 Conversation 按自己的工作目录处理。

## 5. 节点运行语义

入口节点支持两种模式：

- **Kickoff：** 开始 Workflow 时，主动向第一个 Conversation 发送起始 Prompt。
- **Listen：** Conversation 正在运行时接入当前轮并等待完成；如果它空闲，则等待下一轮真实对话完成。

普通接力按完成依赖执行：

1. 等待上游 Conversation 的本轮运行完成。
2. 从本轮起点之后提取助手文本，排除工具调用和工具输出。
3. 将文本保存为该 Node Run 的固定输出快照。
4. 用 Edge Template 渲染下游 Prompt，并发送给目标 Conversation。
5. 等待目标完成，再继续后续节点。

正常执行使用上游 Node 的输出快照，避免人工后来更新 Conversation 后悄悄改变已确定的输入。多个上游汇合时，默认等**全部上游完成**，再一次性向下游发送。Loop 暂不纳入 V0.1。

## 6. Conversation、主机与 Harness

- **稳定身份：** Conversation ID 不依赖某个 tmux pane 或进程号；运行时连接可以变化并重新附着。
- **主机化管理：** 本机与 SSH 主机作为资源分组。优先利用用户现有的 SSH Host 配置，添加或选择 Host 后发现其中的 Harness 会话。
- **会话恢复与创建：** 支持历史会话启动和 resume；也支持从画布上的新建入口创建真正的 Harness 会话。
- **配置归属：** 工作目录、模型和 effort 属于 Conversation。已有对话按其当前设置运行，新对话可在创建时指定。
- **文件与 Skill：** 路径由目标 Harness 在自己的 cwd 中解释。V0.1 只做原生文本透传；按 /、@ 提供 Harness 原生自动补全可以留到后续。

## 7. 运行控制、状态与并发

### 全局控制

页面有一个 Workflow 级的运行开关，并同时显示每个 Node 的状态。关闭开关表示不再触发新的待执行节点；正在运行的 Harness 继续运行。需要停止当前会话时，由用户在 Harness 中停止，或主动调用明确的 Stop 操作。

### 状态与超时

画布显示简单状态和最近活动，不造百分比进度。Conversation 状态与 Node 状态应区分，例如：

- Conversation：Running、Idle、Offline、Error。
- Node：Waiting、Queued、Running、Completed、Failed、Paused。

具体词汇可参考现有项目再定。运行超过 **15 分钟**时显示长时间运行提醒，但不自动判定完成。“标记为完成”可作为故障兜底，是否纳入首版仍需确认。

### Conversation 并发

用户确认同一 Session 可以出现在不同 Workflow 中，也可在图中多次引用。为避免多条 Prompt 同时写入同一 Conversation，讨论中提出“单 Conversation 同时只由一个 Node 执行、其余排队”的规则。全局互斥和 FIFO 队列是候选方案，优先级与排队策略尚未最终确认。

## 8. 动态编辑、持久化与历史

- **运行中的未来可编辑：** Completed 和 Running 节点的执行语义锁定；Pending 节点可增删、改线和插入，修改影响本次运行尚未发生的部分。纯画布位置可随时调整。
- **服务重启可恢复：** Workflow 定义、运行状态和节点快照持久化。浏览器关闭不影响后台运行；编排服务重启后重新扫描 Host、发现 Conversation、重新 attach，并从当前节点继续。
- **运行历史：** 每个 Node Run 至少保存当时发送的 Prompt、开始/结束时间、状态、输出快照和错误信息，支持回看输入与输出。
- **可复用模板：** 支持保存 Workflow 并复用。候选做法是保留拓扑、用途名称和 Prompt Template，将真实 Conversation 绑定改为待重新选择的槽位；模板绑定规则还需定稿。

## 9. V0.1 验证范围

首版应先证明一个可靠闭环：

~~~text
真实 Session A 完成
→ 捕获本轮助手文本（排除工具调用/输出）
→ 按 Edge 模板拼接
→ 发送给真实 Session B
→ 等待完成并保存快照
~~~

首版还应覆盖本地与 SSH 会话、历史对话恢复、运行状态显示、全局暂停、服务重启恢复和基本运行记录。若这个闭环稳定，就能解决“等结果、复制、切 Harness、补提示词、发送”的核心痛点。

### 暂不做

- Loop、复杂 Router、条件分支和 Agent 自动决策。
- 自建 Agent Definition、Skill、文件或 Memory 抽象。
- 结构化 Output Schema、复杂解析器或模型驱动的结果提取。
- Harness 内部工具的统一抽象。
- 复杂优先级抢占、成本分析和分布式可观测性。

## 10. 建议的实现分层

~~~mermaid
flowchart TB
  UI["Web UI<br/>资源列表、画布、状态"] --> Engine["持久化 Orchestrator<br/>依赖、队列、快照、恢复"]
  Engine --> Adapter["Harness Adapters<br/>发现、启动、恢复、发送、完成检测、捕获文本"]
  Adapter --> Runtime["本机/SSH 运行时<br/>CLI、tmux、PTY 等"]
  Runtime --> H["Codex / OpenCode 等真实会话"]
~~~

将 Harness 能力放在 Adapter 中，将工作流状态和节点快照放在持久化 Orchestrator 中。先用 Codex 与 OpenCode 验证两个真实会话的接力，再决定具体技术底座。

讨论中提及的项目可作为参考方向，而非既定依赖：

- [tmux-agents](https://github.com/mattmight/tmux-agents)：会话发现、终端读写及远程主机控制思路。
- [Agent Deck](https://github.com/asheshgoplani/agent-deck)：多会话管理与控制台体验。
- [adelost/agentmux](https://github.com/adelost/agentmux)：会话队列、委派和长任务可靠性。
- [markuswondrak/AgentMux](https://github.com/markuswondrak/AgentMux)：确定性工作流状态机。
- [codex-webui](https://github.com/hydracz/codex-webui)：Web、PTY 和 tmux 会话管理。
- [omux](https://github.com/Happenmass/omux)：后续探索循环执行时可参考。

这些项目的功能状态应在选型时重新核实；当前讨论没有选定其中任何一个作为依赖。

## 11. 尚待确认的问题

1. **同一 Conversation 的全局互斥与排队：** 可以跨 Workflow 引用已明确；单线程资源与 FIFO 是候选机制，需确认。
2. **人工插话：** Workflow 执行期间手动向 Session 输入后，如何界定这轮输出是否应继续下游，讨论中尚未定规则。
3. **完成检测：** 各 Harness 如何可靠识别本轮结束；静默时长只用于提醒，不能当作完成信号。
4. **Retry 的输入：** 早期倾向 Retry 时重读上游；后续确认 Node 保存输出快照。需要区分“用原快照重试”和“刷新 Session 最新输出后重试”。
5. **失败恢复：** 节点断线或失败后是否自动暂停整个下游流程，以及 Retry、Skip、人工恢复的具体语义。
6. **手动完成兜底：** 是否在无法检测 Idle 时提供 Mark Completed。
7. **模板绑定：** 保存模板时哪些 Conversation 绑定保留，哪些改为可替换槽位。
8. **节点复制体验：** 快捷复制、重复拖拽或“再次使用此 Session”如何呈现。


