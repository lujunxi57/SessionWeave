# 对话记录：检索多Harness编排项目

- 来源：[ChatGPT 分享链接](https://chatgpt.com/share/6ab0b488-d28c-83ea-9c3b-165cbe2e612c)
- 内容：分享页可见的全部用户与 ChatGPT 文本消息，共 17 条，按原顺序。

---

## 01｜用户

很多时候我们需要多harness之间有一个承接关系

所以可以考虑把opencode和codex用网页联系起来

编排,A的输出 自动作为B的输入

可以串联,可以并列,可以写个长期loop 指定模型,effort等级

我举个我现在脑海中的画面

比方说codex中有个A对话, 担任的角色是PI, 做头脑风暴, 里面是对于一个实验的方案设计

B对话是一个执行A提出实验方案的对话

正常工作流, 我们需要等待A输出完, 把A的结果复制粘贴到B 输入栏, 然后再额外加上一点提示词

有没有类似的项目, 可以识别多个harness的对话（包括ssh）

然后认为手动编排各自输入输出, 实现串联 并联的效果

甚至可以做loop 定时任务都很合理

你检索下有没有类似开源项目

---

## 02｜ChatGPT

我会按你描述的“**已有 harness 会话之间做 I/O 编排**”来找，而不是泛泛找 AutoGen/CrewAI 这类“框架内部多 Agent”。重点看 4 点：能否接管 Codex/OpenCode 现有会话、能否跨 SSH、能否串/并联、能否 loop/定时。

---

## 03｜ChatGPT

已经找到一类非常贴近的项目了：**不是重新实现 Agent，而是把 Claude/Codex/Gemini/OpenCode 当成“黑盒终端进程”，通过 tmux/PTY 抓输出、发输入**。这个方向天然适合你说的 `A 输出 → 包装提示词 → B 输入`，而且 SSH 也能覆盖。接下来我重点确认哪些已经做到“承接/编排”，哪些只是多会话看板。

---

## 04｜ChatGPT

有一个关键结论已经比较明确：你脑海里的产品形态，社区里**已经出现了 3 个层级的实现**——底层“会话控制总线”、中层“多 harness 控制台”、上层“固定/半固定工作流编排”。但我暂时没看到一个成熟项目把你说的 **网页节点图 + 任意已有会话 + SSH + 串/并联 + loop/cron** 全部一次做齐。

---

## 05｜ChatGPT

有，而且你这个想法现在已经不是空白区了。我检索了一圈截至 **2026-09-21** 的开源项目后，发现社区已经在往你说的方向收敛：

> **把 Codex / OpenCode / Claude Code / Gemini 这些 harness 当成独立的“长期会话进程”，在它们上面再加一层 orchestration/control plane。**

你设想的本质上可以理解成 **“n8n / Airflow for coding-agent harness sessions”**：

```text
Codex PI Session A
       │
       │ output
       ▼
 [Prompt Transformer]
       │
       ├─────────────┐
       ▼             ▼
OpenCode Exp B    Codex Reviewer C
       │             │
       └──────┬──────┘
              ▼
        Codex PI Session A
              │
              └── loop
```

我找到的项目里，下面几个最值得你看。

| 项目 | 和你需求的贴合度 | 最值得看的部分 | 主要缺口 |
|---|---|---|---|
| **tmux-agents** | ★★★★★ 底层能力非常贴 | 识别已有 tmux Agent、抓输出、发输入、SSH 跨机器、MCP/HTTP | 没有成熟的可视化 DAG 编排器，OpenCode 需补适配 |
| **Agent Deck** | ★★★★★ 产品形态很接近 | Codex/OpenCode/Claude/Gemini、多会话、Conductor、Web Command Center、会话发送/输出 | 偏“智能主管”，还不是任意节点图工作流 |
| **adelost/agentmux** | ★★★★★ 编排语义最接近 | Agent→Agent delegation、fan-out、durable queue、长期运行、Codex/Claude existing session | 暂无 OpenCode；没有你想要的 Web DAG |
| **markuswondrak/AgentMux** | ★★★★☆ | Codex/OpenCode/Gemini/Claude 混用、确定性状态机、自动 prompt 注入 | 流程较固定，不是任意 session graph |
| **codex-webui** | ★★★★☆ UI底座合适 | Web 管 Codex/OpenCode/Claude，tmux session 持久化 | 基本没有 Agent→Agent 编排 |
| **omux** | ★★★☆☆ | loop、自动继续、并行 Agent、跨 session memory | 更偏 autonomous coding，不是通用 harness router |
| **OpenChamber** | ★★★☆☆ | Web/mobile、Session Goals、Multi-run、Fusion | 本质仍然是 OpenCode-centric |

下面几个我认为尤其值得拆开讲。

### 1. `tmux-agents`：几乎就是你需要的“Harness I/O 总线”

[GitHub - mattmight/tmux-agents: a CLI and MCP for managing agents wrapped around tmux · GitHub](<https://github.com/mattmight/tmux-agents>)

这个项目和你脑海中的底层实现高度重合。

它不是自己实现 Agent，而是去发现运行在 tmux 中的 Claude Code / Codex / Gemini，然后提供统一操作：

```bash
tmux-agents list

tmux-agents capture --pane %0
tmux-agents delta --pane %0 --after-seq 123

tmux-agents send-text --pane %1 --text "继续执行下面实验..."
tmux-agents send-keys --pane %1 Enter

tmux-agents wait --pane %1 --pattern "..."
```

更重要的是，它已经支持：

```text
local machine
     │
     ├── tmux pane → Codex A
     ├── tmux pane → Claude B
     │
SSH
     ▼
remote GPU server
     ├── tmux pane → Codex C
     └── tmux pane → Gemini D
```

它会读取 `~/.ssh/config` 中的 Host alias，远程 discover/capture/send 都已经抽象出来；同时暴露 CLI、MCP stdio 和 MCP HTTP。它还能向已有 tmux session/window/split 中启动 Agent，而不是只能创建一个全新的封闭 Runtime。[(\[GitHub\](https://github.com/mattmight/tmux-agents?utm_source=chatgpt.com))](<https://github.com/mattmight/tmux-agents>)

这意味着你想做：

```python
A = session("mac:codex-pi")
B = session("gpu-server:opencode-exp")

result = await A.wait_until_done()
await B.send(
    EXPERIMENT_TEMPLATE.format(plan=result.output)
)
```

底层最麻烦的：

- session discovery
- SSH
- terminal capture
- 增量读取
- send text
- Enter
- waiting
- pane addressing

基本已经有人帮你做了。

唯一明显问题是它目前 README 明确列出的检测对象是 **Claude/Codex/Gemini**，不是 OpenCode。[(\[GitHub\](https://github.com/mattmight/tmux-agents?utm_source=chatgpt.com))](<https://github.com/mattmight/tmux-agents>)

不过从架构上看，补一个 OpenCode detector 应该比自己重新造 PTY/SSH 控制层简单得多。

---

### 2. `Agent Deck`：目前我认为最接近你设想的“产品层”

[GitHub - asheshgoplani/agent-deck: Terminal session manager for AI coding agents. One TUI for Claude, Gemini, OpenCode, Codex, and more. · GitHub](<https://github.com/asheshgoplani/agent-deck>)

这个项目值得你认真看。

它不是那个只看 token 的同名 Agent Deck，而是 `asheshgoplani/agent-deck`。

目前 GitHub 大约 **929 stars**，而且 2026 年 9 月仍在高频发布。[github.com](<https://github.com/asheshgoplani/agent-deck>) / [github.com](<https://github.com/asheshgoplani/agent-deck/releases>)

它已经统一支持：

- Claude Code
- Gemini CLI
- OpenCode
- Codex
- Copilot
- 其他 terminal agent

并且已经有 **Conductor** 这个概念。

Conductor 是一个长期存在的 Agent session，它可以监视其他 session：

```text
                Conductor
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
    Codex A      OpenCode B   Claude C
```

甚至已经提供：

```bash
agent-deck session send conductor-work "status?"
agent-deck session output conductor-work
```

Conductor 可以用 Claude，也可以直接用 Codex：

```bash
agent-deck conductor setup review \
  --agent codex \
  --description "Codex reviewer"
```

它会持续监视其他 session，发现 waiting/error，自动决定是否回复或者升级给人。[github.com](<https://github.com/asheshgoplani/agent-deck>) / [github.com](<https://github.com/asheshgoplani/agent-deck/blob/main/docs/conductor/README.md>)

这个设计和你之前跟我讲的：

> A 对话担任 PI  
> B 对话担任 Experiment Engineer  
> A 审查 B 实验结果  
> 再反馈 B 做下一轮

已经相当接近。

而且现在它还有 Browser Command Center，不只是 TUI。[(\[GitHub\](https://github.com/asheshgoplani/agent-deck?utm_source=chatgpt.com))](<https://github.com/asheshgoplani/agent-deck>)

一个非常有意思的新功能是：2026 年 9 月的 release 甚至已经加入：

> switch a session's account or harness with the conversation carried over

也就是“切换 harness，同时把 conversation 带过去”。[(\[GitHub\](https://github.com/asheshgoplani/agent-deck/releases?utm_source=chatgpt.com))](<https://github.com/asheshgoplani/agent-deck/releases>)

这说明社区其实已经在走你说的 **“conversation 本身是一等公民，而不是绑定到某一个 harness”** 这条路线了。

不过它的“编排”目前主要还是：

> 一个智能 Conductor 去管理 workers。

而你的设想更像：

> 一个确定性的 Workflow Engine 去连接多个长期 Session。

二者还不完全相同。

---

### 3. `adelost/agentmux`：你的 `A → B → A` 逻辑，在这里已经出现

[GitHub - adelost/agentmux: Multi-agent orchestration for Claude Code and Codex using tmux, Discord ChatOps, and the amux CLI · GitHub](<https://github.com/adelost/agentmux>)

这个项目虽然知名度不算特别高，但我觉得**技术思想跟你最像**。

它明确提供：

```bash
amux api -p 1 "run backend tests"
amux frontend -p 1 "audit the dashboard layout"

amux wait api -p 1
amux wait frontend -p 1

amux log api -p 1
amux log frontend -p 1
```

而且 Agent 自己可以调用 `amux`，所以：

```text
PI Agent
   │
   ├── amux exp1 "运行实验1"
   ├── amux exp2 "运行实验2"
   │
   ├── wait exp1
   ├── wait exp2
   │
   └── read results
```

就是原生能力。它明确支持 **Agent-to-Agent Delegation** 和 parallel fan-out。[(\[GitHub\](https://github.com/adelost/agentmux?utm_source=chatgpt.com))](<https://github.com/adelost/agentmux>)

我尤其喜欢它的一点，是它没有简单粗暴地：

```text
tmux send-keys
sleep 3
tmux capture-pane
```

而是做了 **durable per-agent queue**：

```text
pending
   ↓
pasting
   ↓
drafted
   ↓
submitted
   ↓
acknowledged
```

甚至会通过 Codex / Claude 的 JSONL history 去确认这个 prompt 是否真的进入 conversation，避免因为 TUI repaint、网络抖动等问题重复发送。[(\[GitHub\](https://github.com/adelost/agentmux?utm_source=chatgpt.com))](<https://github.com/adelost/agentmux>)

对于你想跑：

> PI → Experiment Engineer → PI → Engineer → PI

这种可能持续几小时甚至几天的科研 loop，这种 delivery semantics 非常重要。

它还已经有：

- loop detection
- long-running sessions
- auto compact
- reminders
- cron 风格 maintenance
- structured logs
- session recovery
- existing native session adoption

甚至配置里可以指定 Codex：

```yaml
codexModel: gpt-5.6-sol
effort: high
```

并绑定已有 native session ID。[(\[GitHub\](https://github.com/adelost/agentmux?utm_source=chatgpt.com))](<https://github.com/adelost/agentmux>)

缺点也非常明显：

**目前重点支持 Claude Code + Codex，OpenCode 不是一等公民。**

---

### 4. `markuswondrak/AgentMux`：已经实现“串联工作流”

[GitHub - markuswondrak/AgentMux: Deterministic multi-agent pipeline for end-to-end software development, orchestrating CLI-based AI tools (e.g. Gemini, Claude, Codex) through tmux-controlled sessions. · GitHub](<https://github.com/markuswondrak/AgentMux>)

这个甚至已经把你描述的东西直接做成状态机：

```text
PM
 ↓
Architect
 ↓
Plan
 ↓
Code
 ↓
Review
 ↓
Done
```

每个 role 都可以独立指定：

```yaml
roles:
  architect:
    provider: claude
    model: opus

  coder:
    provider: codex

  reviewer:
    provider: gemini
```

它支持：

- Claude
- Codex
- Gemini
- OpenCode
- Copilot
- Qwen

而且不是 API 调用，是真的把 prompt 注入相应 CLI/tmux pane。[(\[GitHub\](https://github.com/markuswondrak/AgentMux?utm_source=chatgpt.com))](<https://github.com/markuswondrak/AgentMux>)

Agent 之间通过共享 artifact/file protocol 传递状态，orchestrator 负责：

```text
发现 A 完成
     ↓
读取 artifact
     ↓
生成下一阶段 prompt
     ↓
注入 B pane
```

这其实已经完成了你要的：

> A 输出自动作为 B 输入。

只是它的 pipeline 是为软件开发写死/半写死的，而你希望的是：

```text
任意 Node
任意 Edge
任意 Prompt Transform
任意 Branch
任意 Loop
```

所以我更建议把它当做**编排状态机实现的参考项目**，而不是直接拿来用。

---

### 5. `codex-webui`：如果你想自己做网页，这个可以当 UI/PTY 底座

[GitHub - hydracz/codex-webui: A minimal Codex Web UI that wraps the local Codex CLI. · GitHub](<https://github.com/hydracz/codex-webui>)

名字叫 codex-webui，但现在其实支持：

- Codex
- OpenCode
- Claude Code
- Copilot

每个 session 都放在 tmux 里，Browser terminal 通过 PTY attach，而且 Web 服务重启后还能重新发现已有 tmux session。[(\[GitHub\](https://github.com/hydracz/codex-webui?utm_source=chatgpt.com))](<https://github.com/hydracz/codex-webui>)

所以它已经实现了：

```text
Browser
   │
WebSocket
   │
node-pty
   │
tmux
   │
Codex / OpenCode / Claude
```

它缺的其实正是你想做的那层：

```text
Workflow Engine
```

因此如果你想自己 fork 一个项目来改，**codex-webui + tmux-agents 的组合非常合理**。

---

## 还有一个比较有意思的方向：omux

[GitHub - Happenmass/omux: Orchestrate AI coding agents (Claude Code, Codex) as parallel subagents over tmux — a loop-engineering runtime with auto-continue, execute-then-review, and cross-session memory. · GitHub](<https://github.com/Happenmass/omux>)

它目前大约 **98 stars**，核心卖点已经写得很直接：

> parallel subagents over tmux  
> loop-engineering runtime  
> auto-continue  
> execute-then-review  
> cross-session memory

[(\[GitHub\](https://github.com/Happenmass/omux?utm_source=chatgpt.com))](<https://github.com/Happenmass/omux>)

所以如果你重点研究：

```text
while not solved:
    plan()
    execute()
    review()
```

这种长循环，它也值得看。

但它偏向：

> 自动完成 coding task

而不是：

> 通用 Harness Workflow Designer。

---

# 如果把你的产品具体化

我觉得你真正想要的其实不是“多 Agent”。

而是：

## Harness Session Orchestrator

系统里的核心对象不应该是：

```text
Agent
```

而应该是：

```text
HarnessSession
```

例如：

```yaml
sessions:

  pi:
    host: mac
    harness: codex
    conversation: 01992f...
    model: gpt-5.6-sol
    effort: high

  experiment:
    host: gpu01
    harness: opencode
    conversation: abc123
    model: gemini
    effort: max

  reviewer:
    host: mac
    harness: codex
    model: gpt-5.6-sol
    effort: high
```

然后编排：

```yaml
workflow:

  - id: brainstorm
    session: pi

  - id: execute
    session: experiment
    input:
      from: brainstorm
      template: |
        PI 给出的实验方案如下：

        {{ output }}

        请执行实验。
        不要自行改变研究问题。

  - id: review
    session: pi
    input:
      from: execute
      template: |
        Experiment Engineer 返回了实验结果：

        {{ output }}

        请分析结果并设计下一轮实验。

  - loop:
      nodes:
        - execute
        - review

      until:
        session: pi
        condition: EXPERIMENT_COMPLETE
```

再往后就是：

```text
             ┌───────────────┐
             │  PI / Codex   │
             └───────┬───────┘
                     │
                 experiment
                     │
           ┌─────────┴─────────┐
           ▼                   ▼
   OpenCode GPU-1       OpenCode GPU-2
           │                   │
           └─────────┬─────────┘
                     ▼
               Reviewer
                     │
                     ▼
                  PI
                     │
                  repeat
```

这才真正解决你现在每天人工：

> 等 A → copy → 切窗口 → paste B → 加 prompt → 等 B → copy → 回 A

的问题。

---

# 我会怎么利用现有项目

如果你的目标是**现在就实验，而不是先开发半年**，我会把社区项目拆成三层：

```text
┌────────────────────────────────────┐
│ Web Workflow UI                    │
│ React Flow / node editor           │
│ A → B → [C,D] → A                  │
├────────────────────────────────────┤
│ Orchestrator                       │
│ DAG / queue / loop / cron          │
│ prompt transform / condition       │
├────────────────────────────────────┤
│ Harness Control Plane              │
│ tmux-agents / agent-deck primitives│
├────────────────────────────────────┤
│ tmux / SSH / PTY                   │
├─────────────┬─────────────┬────────┤
│ Codex       │ OpenCode    │ Claude │
│ Session A   │ Session B   │ C      │
└─────────────┴─────────────┴────────┘
```

其中我认为最值得直接借鉴的是：

**`tmux-agents` 的 Remote/PTY abstraction + `adelost/agentmux` 的 durable message queue + `Agent Deck` 的 session/conductor/browser UX + `AgentMux` 的 state machine。**

这四个拼起来，几乎就是你刚才描述的系统。

而且有一点我觉得很重要：**不要让 A 和 B 必须知道彼此的存在。**

更稳的设计应该是：

```text
A → Orchestrator → B
```

而不是：

```text
A → 操纵 B
```

这样 PI 的 Codex conversation 仍然只是一个正常 Codex 对话；Experiment Engineer 也只是一个正常 OpenCode 对话。

中间的 orchestrator 做：

```text
capture output
↓
normalize
↓
store
↓
template
↓
route
↓
send
```

那么以后你甚至可以临时把：

```text
B = OpenCode
```

换成：

```text
B = Claude Code
```

而整个 PI workflow 不需要改。

**所以答案是：有类似项目，而且已经足够成熟到可以不从零开始。** 但我目前没找到一个项目完整实现你描述的“**Web 可视化 DAG + 任意已有 Codex/OpenCode session + SSH + 串并联 + loop + cron**”。这个组合本身反而是一个相当明确的产品空位。

---

## 06｜用户

我这里看完你的调研了， 我谈谈我的想法

首先，我想做的是一个纯UI界面，可以通过类似框图拖拽的方式，像搭积木一样调整工作流
比方说左侧是harness的对话列表，拖出来就是一个带有信息的矩形，然后我可以指定这个的输出，再拖拽一个对话，将上一个输出作为提示词

我想了下，类似于coze智能体，但我这个是可以真正联动harness、skill的
现在我希望你grill me，逐渐完善这个项目的功能、意图

---

## 07｜ChatGPT

可以。先不急着补功能，我更想先把这个项目的“物种”定义清楚，因为你现在这个想法很容易同时滑向 **n8n、Coze、Agent Deck、IDE、远程终端管理器、multi-agent framework**，最后每样都有一点，但核心价值反而模糊。

我先给你一个我目前理解的定义，然后第一轮只 grill 最关键的 6 个问题。

你现在想做的不是“创建 Agent”，而是一个：

> **面向现有 Harness Conversation 的可视化 Workflow Orchestrator。**

左侧不是传统的“模型列表”，而是现实中已经存在的资源：

```text
Harnesses
├── Codex
│   ├── PI / remote-sensing-SR
│   ├── Experiment Engineer
│   └── Code Reviewer
│
├── OpenCode @ gpu01
│   ├── KITTI reproduction
│   └── ablation-01
│
└── Claude Code
    └── literature-review
```

把一个 conversation 拖到画布上：

```text
┌──────────────────────────────┐
│ Codex                        │
│ PI / remote-sensing-SR       │
│                              │
│ Model: GPT-5.6 Sol           │
│ Effort: High                 │
│ Host: Mac                    │
│                              │
│    ○ Input        Output ○   │
└──────────────────────────────┘
```

然后：

```text
┌──────── PI ────────┐
│ 实验设计            │
└──────────●─────────┘
           │
           │ output
           ▼
┌──── Prompt Adapter ────┐
│ "根据 PI 的方案执行："   │
│ {{ PI.output }}         │
└──────────●──────────────┘
           │
           ▼
┌── Experiment Engineer ─┐
│ OpenCode @ GPU          │
└─────────────────────────┘
```

**Coze 搭的是 Agent 能力，你搭的是已经活着的 Agent/Harness 会话之间的神经连接。**

我认为这个区别非常重要。

---

## 第一刀：你到底是在“操纵已有对话”，还是“创建工作流专用对话”？

比如你已经有一个 Codex PI 对话，里面聊了两周：

```text
PI / SR Project
conversation_id = ABC
```

你把它拖入 workflow。

Workflow 跑起来以后，它真的向 **ABC 这个已有 conversation** 发消息吗？

还是：

```text
读取 ABC 的上下文
↓
复制/branch
↓
创建 workflow-specific PI session
```

这两种产品完全不同。

### A. 真正控制已有 Session

```text
你手动和 PI 聊天
        ↓
同一个 conversation
        ↑
Workflow 也给它发消息
```

优点是极其符合你现在的工作方式。

但马上会出现非常棘手的问题：

你正在 PI 对话里手动讨论问题，这时候 workflow 突然塞进来：

> Experiment B 已完成，请分析结果。

那这个 conversation 到底属于谁？

**人和 orchestrator 会争夺同一条时间线。**

---

### B. Conversation 是模板/角色，workflow 创建实例

类似：

```text
PI Definition
    │
    ├── Run #41 PI Session
    ├── Run #42 PI Session
    └── Run #43 PI Session
```

干净很多，但它又变得越来越像 Coze / LangGraph。

---

所以第一个问题我希望你不要凭“哪个好实现”回答，而是凭**你真正想怎么工作**回答：

> **Q1：你最想解决的场景，是“让 Workflow 接管我目前正在使用的真实 Codex/OpenCode 对话”，还是“利用这些对话/配置生成自动化 workflow session”？**

我目前根据你的描述判断，你真正想要的是前者。

而且如果不是前者，这个项目对你的独特价值会下降很多。

---

# 第二刀：什么叫一个 Node 的“输出”？

这是整个产品里非常容易被低估的问题。

假设 PI 输出：

```text
我们做三个实验：

1. baseline
2. 加 semantic prior
3. 再做一个 ablation

实验 1 和 2 可以并行。
实验 3 必须等 2 完成以后决定具体参数。

另外先检查数据集。
```

什么叫：

```text
PI.output
```

是：

### A. 最后一条 assistant message？

```text
output = assistant.last_message
```

简单。

但 Codex 经常可能：

```text
Thinking
→ tool call
→ command
→ tool result
→ reasoning
→ assistant
→ 又执行
→ assistant
```

甚至 PI 可能输出 markdown、文件、修改 repo。

---

### B. 从 conversation 中提取一个结构化字段？

比如 Node 可以定义：

```text
Output schema

experiment_plan: markdown
commands: string[]
artifacts: file[]
status:
  enum:
    - continue
    - done
    - blocked
```

于是 downstream 不是：

```text
{{PI.output}}
```

而是：

```text
{{PI.experiment_plan}}
```

这一下整个系统可靠性会提高非常多。

但同时你的 UI 开始从：

> Harness wiring

变成：

> Harness + structured protocol。

---

所以：

> **Q2：你希望第一版的 Edge 传输的是“自然语言消息”，还是从一开始就允许 Node 暴露结构化输出？**

我个人认为这里千万不要走极端。

V1 可以默认：

```text
Last Response
```

但高级模式一定得有：

```text
Output Extractor
```

例如：

```text
PI
 │
 ├── Full response
 ├── JSON field: experiments
 ├── File: experiment_plan.md
 └── Regex/LLM extracted: NEXT_ACTION
```

否则长期 loop 很快会变得不可控。

---

# 第三刀：你画的 Edge 是“数据流”，还是“控制流”？

表面都是：

```text
A → B
```

但其实有至少四种完全不同的意义。

### ① Output passing

```text
A 输出
 ↓
作为 B prompt
```

### ② Completion dependency

```text
等 A 真正完成
 ↓
启动 B
```

### ③ Trigger

```text
A 出现某个事件
 ↓
启动 B
```

例如：

```text
A message contains:
EXPERIMENT_READY
```

### ④ Continuous subscription

```text
A 每产生一个符合条件的新输出
 ↓
B 都收到
```

例如：

```text
PI
 │
 ├─ experiment #1 → Engineer
 │
 ├─ experiment #2 → Engineer
 │
 └─ experiment #3 → Engineer
```

这就已经不是普通 DAG 了。

而是 event graph。

所以我要 grill 你：

> **Q3：你脑海里的连线，默认应该是什么语义？**

我建议最朴素的默认不是“监听所有消息”，而是：

```text
Node Run
  ↓
等待 Harness 回到 Idle
  ↓
取 Final Output
  ↓
Edge Transform
  ↓
触发下一个 Node Run
```

也就是说：

> **Conversation 是长期存在的，Node Run 是一次性的。**

这是我认为目前整个设计中非常关键的抽象。

UI 上一个矩形看起来是：

```text
PI Conversation
```

但真正执行的是：

```text
PI Conversation
Run #37
```

这两个最好不要混淆。

---

# 第四刀：Loop 到底是谁决定停止？

你前面提到：

> 可以写个长期 loop。

这件事如果只设计一个：

```text
Repeat
```

马上会出灾难。

例如：

```text
PI → Engineer → PI → Engineer → ...
```

什么情况下停止？

至少有：

```text
次数：
max_iterations = 10

状态：
PI.status == DONE

LLM 判断：
"研究目标是否已经完成？"

人工：
等待我审批

时间：
运行 6 小时

资源：
花费达到 $20

异常：
连续 3 次实验失败
```

所以你的 Loop 其实不是装饰性的 arrow：

```text
↻
```

而是应该成为一个真正的一等节点：

```text
          ┌─────────────┐
          │ Loop Control │
          │              │
          │ max: 10      │
          │ until: DONE  │
          │ timeout: 6h  │
          └─────────────┘
```

所以：

> **Q4：你希望 loop 的退出决策主要掌握在 Harness 手里，还是 Workflow Engine 手里？**

这决定你到底是在做：

```text
Agent-driven orchestration
```

还是：

```text
Deterministic orchestration
```

我更偏向：

> **Engine 掌握硬边界，Agent 提供软判断。**

例如：

```text
Agent says: DONE
       +
max iteration 10
       +
human approval before final
```

三个一起存在。

---

# 第五刀：Skill 在你的产品里到底是什么？

你专门说了一句：

> 真正联动 harness、skill。

这个地方我想追问，因为它可能是你和现有项目最大的差异之一。

比如一个 Skill：

```text
literature-review
```

究竟是：

### A. Harness 的属性

```text
Codex PI
Skills:
- scientific-review
- paper-search
```

拖出来的还是 PI Node。

---

### B. 独立 Workflow Node

```text
PI
 ↓
[Paper Search Skill]
 ↓
[PDF Analysis Skill]
 ↓
PI
```

---

### C. Edge 上的 Transform

```text
PI.output
    ↓
[Summarization Skill]
    ↓
Engineer.input
```

---

我认为答案很可能是：

**三种都需要，但不是第一版都做。**

否则 UI 会非常复杂：

```text
Harness
Skill
Tool
Prompt
Condition
Router
Loop
File
SSH
Human approval
Memory
...
```

左侧直接变成 Unreal Engine 蓝图。

所以：

> **Q5：在你当前脑海里，“Skill”最重要的用途是哪一种？**

举你现在科研场景来说，我猜你真正需要的是：

```text
PI conversation
     │
     ▼
[Experiment Plan Validator Skill]
     │
     ▼
Experiment Engineer
```

也就是 **Skill 自身可以是一个可执行节点**。

---

# 第六刀，也是我认为最关键的一刀：你希望用户“看到 Agent”，还是“看到工作”？

这是 UI 哲学。

方案一，Harness-centric：

```text
[Codex PI] → [OpenCode Engineer] → [Codex PI]
```

你现在描述的是这种。

但真实使用一段时间以后，你可能更关心：

```text
[Design Experiment]
        ↓
[Execute Experiment]
        ↓
[Analyze Result]
        ↓
[Decide Next Step]
```

点开节点以后才看到：

```text
Executor:
Codex / PI conversation
```

这叫 Task-centric。

区别非常大。

比如以后：

```text
Execute Experiment
```

可以从：

```text
OpenCode A
```

换成：

```text
OpenCode B
```

工作流概念本身不发生变化。

因此：

> **Q6：你认为画布上的一等公民应该是“Conversation”，还是“Task”？**

你的第一直觉明显是 Conversation。

但我要挑战你一下：

**Conversation 适合做左侧资源，Task 可能更适合做画布节点。**

即：

```text
左侧 Resource Pool

Codex
 ├── PI
 └── Reviewer

OpenCode
 └── Engineer


             ↓ drag


画布

┌─────────────────────────┐
│ Analyze Experiment      │
│                         │
│ Executor                │
│ Codex / PI              │
│                         │
│ Input                   │
│ {{experiment.results}}  │
└─────────────────────────┘
```

你仍然是在拖 Conversation。

但拖进去以后生成的是：

> **一个绑定了某 Conversation 的 Task Node。**

我现在其实很倾向这个模型。

因为它同时满足你的：

> 像搭积木一样拖已有 conversation

又避免以后出现：

> 同一个 PI 对话在图里出现 4 次，到底四个框是什么？

这个语义问题。

---

所以第一轮我希望你直接回答这 **6 个问题**，不需要写长：

1. **已有真实 Conversation vs workflow 创建的新 Conversation？**
2. **默认传整段自然语言，还是希望很快支持结构化 Output？**
3. **A→B 默认意味着“一次运行完成后传递”，还是持续监听？**
4. **Loop 主要由 Agent 判断结束，还是 Engine 规则判断结束？**
5. **Skill 你最希望是 Harness 属性、独立 Node，还是 Edge Transform？**
6. **画布核心 Node 是 Conversation，还是 Task + Conversation binding？**

我会根据你的答案继续第二轮 grill。下一轮我会专门攻击几个很容易把这个项目搞崩的地方：**并发写同一 conversation、如何判断 harness 真正 idle、SSH 掉线/页面刷新后的恢复、人工插入对话后 workflow 如何继续、以及“拖一条线”到底该自动生成多少 prompt glue。** 

---

## 08｜用户

1、真正控制已有session，这个项目更多的是提前规划好人的行为，不需要在电脑前傻傻等待了
2、先复制除了工具调用外的文本输出吧
3、Completion dependency
4、Loop先不考虑，后面再搭建loop
5、skill我的想法是模仿harness实际终端，比方说codex里/ 可以指定skill，@是指定文件，这个一定要原生态保留
6、用户看到对话名称，然后画布上实时显示进度

---

## 09｜ChatGPT

这 6 个答案已经把项目的边界收得很清楚了。它不是“多 Agent 平台”，也不是“自动生成 Agent 的 Coze”，而更像：

> **一个针对已有 Harness Session 的可视化任务接力器。**  
> 人提前把本来需要守在电脑前完成的「等待 → 复制 → 切换对话 → 补提示词 → 发送」动作编排好，然后离开电脑。

我会暂时给它一个内部抽象：**Session Workflow Canvas**。

你的核心执行语义现在可以非常简单：

```text
已有 Codex Session A
        │
        │ 等待本轮完成
        ▼
捕获本轮 Assistant 文本
（排除 tool call / tool output）
        │
        ▼
Edge Prompt Template
        │
        ▼
已有 OpenCode Session B
        │
        │ 原生输入
        │ /skill
        │ @file
        │ 普通文本
        ▼
等待 B 完成
```

尤其是你对 Skill 的回答，我觉得非常重要：**不要抽象 Skill。**

不要把：

```text
/experiment-review
@results/exp01.md
```

变成你系统自己的：

```yaml
skills:
  - experiment-review

files:
  - results/exp01.md
```

至少第一阶段绝对不要。

你的系统应该像一个非常聪明的“人类键盘”，尽量保持各 Harness 的原生能力：

```text
Codex 输入框里人能输入什么
Workflow 就能输入什么
```

这能极大降低项目复杂度。

---

现在进入第二轮。我认为下面这些问题会真正决定这个东西是否稳定可用。

1. **Workflow 跑起来以后，这个 Session 还允许人手动插话吗？**

例如：

```text
A → B → C
```

现在 B 正在执行。

你突然从手机打开 Codex/OpenCode，觉得 B 做错了，于是手动输入：

```text
先停一下，不要做这个实验。
```

这时系统怎么办？

一种方式是完全禁止：

```text
Workflow owns B
```

但这违背你“控制真实已有 Session”的初衷。

我更倾向一种 **soft ownership**：

```text
B running
   ↓
检测到非 Workflow 输入
   ↓
状态变成：

⚠ Human intervention detected
```

然后暂停：

```text
B → C
```

直到确认 B 新的本轮输出。

这里我要问你：

> **Q7：人在 Workflow 执行期间手动介入 Session 后，你希望 Workflow 自动把这次人工消息也视为当前 Run 的一部分继续跑，还是默认暂停后续节点？**

我目前更推荐**暂停后续节点**。因为否则很容易把一个你只是临时讨论的问题，当成正式实验结果传给 C。

---

2. **“完成”到底怎么判断？**

你选的是 Completion Dependency，这很好，但这是底层最难的问题之一。

人看终端很容易判断：

```text
Codex 写完了
出现输入框了
```

机器却未必容易。

例如 Codex：

```text
思考
↓
执行 command
↓
等待 30 秒
↓
输出结果
↓
继续分析
↓
最终回复
↓
回到输入状态
```

如果我们在第一个静默期就认为完成，会直接炸掉整个 workflow。

所以 Harness Adapter 至少需要：

```text
RUNNING
WAITING_TOOL
WAITING_USER
IDLE
ERROR
DISCONNECTED
```

我认为 UI 上也应该直接表现出来：

```text
┌────────────────────────┐
│ PI / SR Research       │
│ Codex                  │
│                        │
│ ● Running              │
│ Running experiment...  │
│                        │
│ 02:41                  │
└────────────────────────┘
```

然后：

```text
● Waiting for user
● Completed
● Failed
● Disconnected
```

这里我的问题是：

> **Q8：如果系统无法 100% 判断 Harness 是否完成，你更倾向“宁可多等”，还是设置一个 timeout 后认为它结束？**

我非常倾向 **宁可多等，绝不靠静默 timeout 判断完成**。

Timeout 可以用于报警：

```text
⚠ A has been running for 45 minutes
```

但不能直接等价于：

```text
A completed
```

---

3. **你说“复制除了工具调用外的文本输出”，那么一轮输出边界怎么定义？**

我建议不是：

```text
取屏幕最后一段文字
```

而应该记录：

```text
Workflow 发出 message X
            ↓
记录 checkpoint
            ↓
Harness 开始工作
            ↓
直到重新进入 IDLE
            ↓
抓取 checkpoint 之后产生的
所有 assistant-facing text
            ↓
拼成 Run.output
```

比如 Codex 本轮：

```text
我先检查一下目录。
[tool]
[tool output]

数据结构没问题，我继续运行实验。
[tool]
[tool output]

实验完成，结果如下：
PSNR = ...
SSIM = ...
我建议下一步……
```

那么输出应该是：

```text
我先检查一下目录。

数据结构没问题，我继续运行实验。

实验完成，结果如下：
PSNR = ...
SSIM = ...
我建议下一步……
```

而不是只取最后一段。

这里我建议直接把这个规则固定下来，不需要再让用户配置。

---

4. **Edge 不应该只是箭头，它实际上应该是一个“小型输入编辑器”。**

比如：

```text
PI
 │
 │
 ▼
Engineer
```

点击这条线以后右侧出现：

```text
Send to: Experiment Engineer

┌────────────────────────────────────┐
│ /experiment-engineer               │
│                                    │
│ PI 已完成实验设计：                 │
│                                    │
│ {{ upstream.output }}              │
│                                    │
│ @EXPERIMENT_LOG.md                 │
│                                    │
│ 请按照方案执行，不要修改研究问题。  │
└────────────────────────────────────┘
```

这里 `/skill`、`@file` 都只是**原生字符**。

Orchestrator 不理解：

```text
/experiment-engineer
```

是什么意思。

Codex 理解。

这是一个非常漂亮的职责分离。

所以：

> **Q9：你是否认同 Edge 本质上就是“一个 Prompt Template”，其中 `{{upstream.output}}` 只是一个特殊变量？**

如果你认同，我觉得 V1 甚至不需要独立 Prompt Node。

整个 UI 会干净很多。

---

5. **一个 Session 是否允许在画布上出现多次？**

这是个非常实际的问题。

比如你的 PI：

```text
        ┌───────┐
        │  PI   │
        └───┬───┘
            ↓
        Engineer
            ↓
        ┌───────┐
        │  PI   │
        └───────┘
```

上下两个框其实是**同一个 Codex conversation**。

我认为这是必须允许的。

否则你没办法清晰表达：

```text
PI 设计
↓
Engineer 执行
↓
PI Review
```

所以画布 Node 应该实际上是：

```text
Session Reference
```

而不是 Session 本体。

例如：

```text
Node #1
Session: PI
Label: Design Experiment

Node #3
Session: PI
Label: Review Experiment
```

UI 默认大字依然显示：

```text
PI
```

下面小字：

```text
Design Experiment
```

这和你“用户看到对话名称”的要求并不冲突。

这里我要问：

> **Q10：同一个 Conversation 在 Workflow 中出现多次，你希望每个框允许有一个“本次用途名称”吗？**

例如：

```text
PI
Design experiment
```

和：

```text
PI
Review results
```

我强烈建议有，否则稍微复杂一点的图就会变得完全看不懂。

---

6. **并行之后，多个结果汇聚到同一个 Session 时怎么处理？**

虽然你暂时不做 Loop，但并行应该很快就会遇到：

```text
              ┌→ Experiment A ─┐
PI ───────────┤                 ├→ PI
              └→ Experiment B ─┘
```

右边 PI 应该：

```text
等 A 和 B 都完成
↓
一次性收到：

实验 A：
{{A.output}}

实验 B：
{{B.output}}
```

还是：

```text
A 完成就先发一次
B 完成再发一次
```

按照你选择的 **Completion Dependency**，我猜你真正想要的是第一种。

也就是说节点默认应该支持：

```text
Join: ALL
```

而未来再增加：

```text
Join: ANY
```

这里：

> **Q11：并联后的汇聚，你是不是默认希望“等待所有上游完成，再一次发送”？**

---

7. 最后一个是我觉得对产品体验影响最大的：**运行中的 Canvas 到底显示多少信息？**

我现在脑海里的节点不是一个静态框，而是：

```text
┌──────────────────────────────────┐
│ Codex                         ●  │
│ PI / Remote Sensing SR           │
│                                  │
│ Running                          │
│ ███████████░░░                   │
│                                  │
│ Executing baseline experiment... │
│                                  │
│ 4m 23s                           │
└──────────────────────────────────┘
```

但这里的“进度条”其实很危险。

LLM/Harness 工作没有真正的：

```text
63%
```

所以不应该造一个假进度百分比。

我更建议显示 **阶段状态 + 最近活动**：

```text
● Thinking
● Running tool
● Waiting command
● Responding
● Idle
```

以及：

```text
Last activity
python train.py ...
```

Canvas 就会真的有一种“控制室”的感觉：

```text
PI                Engineer A
✓ Completed       ● Running
3m 12s            python train.py

        Engineer B
        ● Running
        Evaluating checkpoint...
```

所以：

> **Q12：你说的“实时显示进度”，你期待的是这种状态/活动流，还是你希望看到类似终端最后几行的实时 mini-preview？**

我其实建议 **两者结合**：

正常状态只显示：

```text
● Running
Running evaluation...
12m
```

鼠标 hover / 点击后展开：

```text
最近 10 行 Harness 输出
```

而不是把每个节点直接变成迷你终端。

---

如果按照你目前的答案继续收敛，我觉得 **V1 已经可以很克制**：

```text
左侧：
已有 Harness Session 列表

画布：
Session Reference Nodes
Completion edges

节点：
Conversation 名称
Harness
运行状态
最近活动

Edge：
Prompt Template
{{upstream.output}}
原生 /skill
原生 @file

Runtime：
按依赖执行
捕获本轮纯文本输出
传递给下一 Session
失败则暂停

暂时没有：
Loop
复杂 Router
结构化 Output
自定义 Agent
Skill abstraction
Memory abstraction
```

我觉得这个 V1 已经足够形成一个非常明确、而且和现有 Agent 平台明显不同的产品了。

你下一条直接回答 **Q7–Q12** 就行。回答完以后，我下一轮会开始 grill **“用户真正如何创建和运行一个 workflow”**：包括拖拽后的默认行为、Run/Resume/Retry 从哪里发生、失败节点怎么重新执行、一个已执行一半的 workflow 修改连线会发生什么，以及 workflow 是否应该保存为可复用模板。这一轮会开始真正形成 UI 产品规格。

---

## 10｜用户

Q7 我初步想法是，给一个总的开关即可，关闭后就不再执行流程，但不会停止正在进行的对话，停止需要人工去harness里手动停止，或者页面里给个按钮

至于手动介入session我没太明白，是指我手动停止了？

Q8 宁可多等吧，但不要太久

UI上直接表现也是非常需要的

Q9 认可，我觉得这个形态作为初版，这个底座搭好了，后面扩展功能也方便

Q10 允许

Q11 等待所有上游完成，再一次发送

不需要百分比，简单显示在干什么即可

Q12 就是running 这类提示即可

---

## 11｜ChatGPT

明白了。你现在的回答已经把运行时哲学也定得很清楚了：

> Workflow 负责“继续往后送”，但**不强占 Harness，也不替用户管理 Harness 的生命状态**。

也就是说，总开关关闭后，系统只停止后续编排；当前正在跑的 Codex/OpenCode 对话继续自己跑。真正要停当前会话，要么去原 Harness 停，要么你的页面提供一个明确的“Stop current session”按钮。这个边界我认为很合理。

你问的“手动介入 session”不是指手动停止，而是比如 Workflow 正在让 B 执行：

```text
PI → Engineer B → Reviewer
```

B 还没完成时，你自己打开 B 的 Codex/OpenCode 对话，手动输入一句：

```text
先别跑 ablation，把 batch size 改成 8。
```

这就叫“人工介入”。我现在反而觉得 V1 不要过度处理它。最简单的规则可以是：

```text
Workflow 不阻止人工输入
Workflow 也不试图识别“这是人工消息还是自动消息”
只关注：
本轮什么时候重新进入 completed / idle
然后抓取这一轮最终文本输出
继续往下走
```

这样更符合你“这个工具只是替代人守着电脑复制粘贴”的定位。

现在进入下一轮，我专门 grill **Workflow 的创建和运行体验**。这一轮很关键，因为它决定这个东西到底像“画布工具”，还是像“任务控制台”。

1. **拖一个 Session 到画布后，它默认代表什么？** 我建议默认就是“等待这个 Session 下一次完成”，而不是立刻往它发送消息。否则用户只是把 PI 拖到画布上，就可能误触发一个真实对话。比如：

```text
[PI]
   ↓
[Engineer]
```

PI 节点可以有两种模式：

```text
Source Node
等待 PI 当前/下一轮输出

Triggered Node
收到上游内容后，向 PI 发 prompt
```

这两个语义最好自动区分：没有入边的节点默认是 Source，有入边的默认是 Triggered。

**Q13：你希望 workflow 的第一个节点是“监听已有对话下一次完成”，还是点击 Run 后也要主动给第一个节点发一个起始 prompt？**

我怀疑你其实两种都需要，但必须定义默认行为。

---

2. **Run 是整个 Workflow 的概念，还是节点级的概念？**

我建议整个图有：

```text
Run Workflow
Pause Workflow
Stop Scheduling
```

节点上只有：

```text
Retry
Skip
Open Session
Stop Session
```

不要每个节点都有一个巨大的 Run 按钮，不然状态很容易乱。

**Q14：你是否接受“全局 Run / Pause，节点只做 Retry、Skip、Open、Stop”这种层级？**

---

3. **失败以后，Retry 到底重跑什么？**

比如：

```text
A completed
↓
B failed
↓
C waiting
```

点 B 的 Retry，有两种可能：

```text
重新发送完全相同的 prompt 给 B
```

或者：

```text
重新读取 A 当前最新输出
重新生成 prompt
再发 B
```

我强烈建议第一种。

因为一个 Workflow Run 应该是可追溯的：

```text
A Run #12 output
↓
生成 B Run #13 prompt
↓
失败
↓
Retry B #13
```

而不是 retry 时偷偷换输入。

否则你以后很难 debug。

**Q15：Retry 是否应该默认使用当时已经生成好的 prompt，而不是重新读取 upstream？**

---

4. **已执行一半时，允许修改 Workflow 吗？**

这是非常容易踩坑的地方。

比如：

```text
A ✓
↓
B Running
↓
C Waiting
```

你这时候把：

```text
B → C
```

删掉，改成：

```text
B → D → C
```

当前 Run 怎么办？

我的建议非常明确：

> **允许编辑 Canvas，但当前 Run 使用启动时的 snapshot。**

也就是说：

```text
Workflow Definition v8
↓ Run
Runtime Snapshot #42
```

运行过程中你改成 v9：

```text
只影响下一次 Run
```

这样整个系统会稳定很多。

**Q16：你是否接受“运行中的 Workflow 冻结执行图，编辑只影响下一次运行”？**

---

5. **Workflow 要不要是可复用模板？**

我觉得这里要区分两种东西：

```text
Workflow
绑定真实 Session

Template
只保留结构和 prompt
```

例如你科研里可能长期有：

```text
PI
↓
Experiment Engineer A
↓
PI Review
```

你换一个项目后，也想复用这个流程，但 Session 已经不同。

如果一开始不做 Template，也没问题。

V1 可以只支持：

```text
Save Workflow
```

里面直接保存：

```text
session_id
node position
edge prompt
```

以后再加：

```text
Save as Template
```

**Q17：第一版你是只需要“保存当前这套真实 Session 编排”，还是你已经很希望能复用为模板？**

---

6. **一个 Workflow Run 的历史，你希望保留到什么程度？**

这个我觉得不能省。

至少应该能回看：

```text
Run #18
Started 10:42

PI
✓ 10:42–10:47
Output: ...

Engineer
✓ 10:47–11:26
Prompt sent: ...
Output: ...

Reviewer
Failed 11:26
Reason: disconnected
```

否则你这个工具一旦真正跑几个小时，第二天回来根本不知道发生了什么。

但我不建议 V1 做复杂 observability。

只要保留：

```text
每个 Node：
输入 prompt
开始时间
结束时间
状态
输出文本
错误信息
```

就已经足够。

**Q18：你是否希望每次 Workflow Run 都自动生成一份完整执行记录，可以点开某个节点查看“当时发了什么、返回了什么”？**

---

基于你现在的答案，我觉得这个项目的 V1 已经越来越像一个很清晰的东西：

```text
不是：
Agent Builder

不是：
Multi-Agent Framework

而是：
Visual Session Relay
```

核心就是把人平时做的：

```text
等
↓
看结果
↓
复制
↓
补一句 prompt
↓
切另一个 Harness
↓
发送
```

变成：

```text
Canvas
↓
Run
↓
离开电脑
```

你下一条回答 **Q13–Q18** 就可以。回答完这轮，我会继续 grill 最后一个非常关键的层面：**左侧 Session 是怎么被发现、识别和绑定的**，也就是 Codex/OpenCode/tmux/SSH 这一层到底怎么让用户感觉“零配置”。

---

## 12｜用户

1、两种都需要
2、开关是整体的，但会显示每个节点的状态
3、重新读取 upstream
4、正在等待的流程可以拖动
5、可以保留为可复用模版
6、我觉得你看情况吧，都可以

---

## 13｜ChatGPT

这轮答案把产品又推进了一步，而且有两个地方我想稍微“拧紧”一下，不然以后会出现语义混乱。

首先，**入口节点支持两种模式**已经可以确定：

```text
模式 A：Listen
等待已有 Session 的下一次完成
→ 捕获输出
→ 继续流程

模式 B：Kickoff
Workflow 主动向第一个 Session 发起始 Prompt
→ 等待完成
→ 继续流程
```

这很好。这样既能满足“我已经在 PI 里聊完了，后面自动接力”，也能满足“我提前搭好流程，点 Run 后全部自动开始”。

第二，你对 Retry 的选择很重要：**重新读取 upstream 最新输出**。这意味着你想要的 Retry 实际上不是传统意义上的“重放”，而是：

```text
Re-run with latest context
```

例如：

```text
A 第一次输出 v1
↓
B 失败

此时我又人工让 A 补充了一句
A 现在输出 v2

Retry B
↓
重新读取 A
↓
用 v2 构造 B 的 prompt
```

这个很符合你“真实 Session 是活的”这个哲学。

所以以后按钮名字我甚至不建议写 `Retry`，而可以区分：

```text
Retry
重新读取最新上游并执行

Replay
用上一次完全相同的 Prompt 再执行
```

V1 只做前者即可。

还有你第 4 个回答，我想帮你拆清楚：

> “正在等待的流程可以拖动”

这里有两个不同层面。

单纯把框从左边拖到右边：

```text
[x] → [y]

变成

       [x]
        ↓
       [y]
```

只是 **UI layout**，任何时候都可以改。

但如果是把：

```text
A → B → C
```

在 B 还没开始的时候改成：

```text
A → D → B → C
```

这属于 **修改当前 Run 的拓扑**。

我感觉你的产品哲学其实会倾向于：

> **已经完成 / 正在运行的节点冻结；尚未执行的部分允许重新编排。**

这个比“Run 启动时整张图冻结”更灵活，也更符合你这个东西是在提前规划“人的下一步动作”。

我们下一轮专门把这一点搞定。

---

# 下一轮：Session 到底怎么进入左侧列表

这是整个产品体验的地基。

如果这一层做得不好，用户每天都要：

```text
Add session
Paste ID
Select host
Select tmux pane
Select harness
...
```

那就完全失去你想要的感觉了。

我理想中的体验应该是打开网页以后，左边直接出现：

```text
LOCAL

Codex
  ● Remote Sensing PI
  ● Experiment Engineer
  ○ Old KITTI Test

OpenCode
  ● SR Reproduction
  ● Ablation


gpu01
  OpenCode
    ● Training
    ● Evaluation

lab-server
  Codex
    ● Reviewer
```

用户不应该先理解 tmux pane、PID、conversation id。

---

## Q19：左侧到底显示“正在运行的 Session”，还是所有历史 Conversation？

这是第一个必须定的。

### 方案 A：只显示 currently alive

```text
● PI
● Engineer
● Reviewer
```

非常干净。

但你关闭 Codex CLI 后：

```text
PI 消失
```

下次想把这个 conversation 放进 Workflow，还得先手动 resume。

---

### 方案 B：同时显示历史 Conversation

```text
RECENT

● PI                  Running
○ Literature Review   Stopped
○ Old Experiment      Stopped
```

然后把 `Stopped` 的 conversation 拖进去以后，Workflow 可以在需要执行它的时候自动：

```text
codex resume <conversation>
```

这个体验强很多。

所以：

> **Q19：你希望左侧包含“历史但当前没有运行的 conversation”吗？**

我个人非常建议 **包含**。

因为你的核心对象应该是：

```text
Conversation
```

而不是：

```text
Terminal process
```

---

# Q20：拖一个已经停止的 Conversation 进流程，运行到它时怎么办？

假设：

```text
PI ● Running
↓
Reviewer ○ Stopped
```

Workflow 跑到 Reviewer。

我认为理想行为应该是：

```text
发现 Reviewer 不在线
↓
自动启动对应 Harness
↓
resume conversation
↓
等待 ready
↓
发送 prompt
```

用户不应该提前把所有 CLI 都开好。

但这意味着你的系统会从：

> “给已有 Terminal 输入文字”

升级成：

> “管理 Harness 生命周期”。

所以问题是：

> **Q20：你愿不愿意让系统自动启动 / resume 一个当前没有运行的已有 Session？**

如果答案是愿意，这个产品会强很多。

---

# Q21：Session 的真实身份到底是什么？

这个是技术架构里最关键的问题之一。

比如一个 PI：

```text
Codex Conversation ID:
019a23...

当前运行位置：
tmux pane %17
```

第二天：

```text
conversation_id 还是 019a23...
tmux pane 变成 %42
```

那么系统不能把：

```text
%17
```

当成这个 Session 的身份。

正确的应该是：

```text
Conversation Identity
        │
        ├── harness = codex
        ├── conversation_id = xxx
        ├── host = mac
        │
        └── runtime attachment
                └── tmux pane %42
```

也就是说 **Conversation 是稳定身份，Terminal 只是当前连接方式**。

> **Q21：你是否认同这一点？**

这看起来像技术细节，其实会直接决定这个产品能不能可靠运行几天甚至几周。

---

# Q22：SSH 应该是“Host”，还是“Session 的属性”？

我强烈建议左侧不是：

```text
SSH Sessions
```

而是：

```text
Mac
 ├ Codex
 └ OpenCode

gpu01
 ├ OpenCode
 └ Codex

gpu02
 └ OpenCode
```

Host 只是一个容器。

用户先添加一次：

```text
gpu01
lab-server
3090-server
```

以后自动扫描。

而且如果本机已经有：

```text
~/.ssh/config
```

应该直接读：

```text
Host gpu01
Host lab
Host a100
```

然后让用户勾选：

```text
☑ gpu01
☑ lab
☐ old-server
```

而不是重新填写 IP、用户名、私钥。

> **Q22：SSH 这一层你是不是希望完全“主机化”，添加 Host 后自动发现里面的 Harness Session？**

我觉得这是最自然的。

---

# Q23：如果网页或者 orchestrator 自己重启了怎么办？

这个产品有个非常特殊的要求：

你搭好：

```text
PI
↓
Engineer
↓
Reviewer
```

然后去睡觉。

凌晨 2 点：

```text
网页关了
或者
orchestrator process 重启
```

但是 Engineer 的 Codex 还在服务器里跑。

第二天应该不能看到：

```text
Workflow failed
```

理想状态应该是：

```text
Orchestrator Restart
↓
读取 Runtime 状态
↓
重新发现 Conversation
↓
重新 attach
↓
发现 Engineer 仍 Running
↓
继续等待
```

所以你的 Workflow Run 本身必须 persistent。

> **Q23：这个是不是你认为必须有的？**

我个人觉得这不是高级功能，而是 V1 必须保证的核心可靠性。

因为你的核心卖点就是：

> **人不需要守着电脑。**

如果 orchestrator 必须一直保持浏览器页面开着，那产品意义会大幅下降。

---

# Q24：左侧 Session 的状态应该做到多细？

我建议先极其克制：

```text
● Running
◉ Idle
○ Offline
⚠ Error
```

不要试图统一 Codex/OpenCode 所有内部状态。

Canvas 上也是：

```text
PI
✓ Completed

Engineer
● Running

Reviewer
○ Waiting
```

只有点进去以后，再显示：

```text
Host: gpu01
Harness: OpenCode
Conversation: ...
Started: 11:03
Last activity: 11:17
```

> **Q24：这四个 Session-level 状态对你来说够不够？**

这里注意：

`Waiting` 是 Workflow Node 状态。

`Idle` 是 Harness Session 状态。

两者最好严格区分。

---

# Q25：关于 `/skill` 和 `@file`，要做到什么程度？

你之前说一定保留原生体验，我认同。

初版最简单可以只是：

```text
┌ Prompt ──────────────────────────┐
│ /research-review                 │
│                                  │
│ 请分析：                          │
│ {{ upstream.output }}            │
│                                  │
│ @experiment_results.md           │
└──────────────────────────────────┘
```

系统完全不解析：

```text
/research-review
@experiment_results.md
```

直接原样发进去。

但后面可以升级成真正的 Harness-aware editor：

输入：

```text
/
```

自动显示 Codex 当前支持的：

```text
/research-review
/plan
/...
```

输入：

```text
@
```

显示当前 workspace 文件。

这就会非常爽。

但我建议：

```text
V1
raw native pass-through

V2
native autocomplete
```

> **Q25：你认同这个优先级吗？**

---

# 最后我想再 grill 一个你刚刚隐含提出的很重要能力

你说：

> 正在等待的流程可以拖动。

我想把它进一步变成一个产品原则：

### Workflow 不是一次性 DAG，而是一张“活的执行计划”

例如当前：

```text
A ✓
↓
B ● Running
↓
C ○ Waiting
↓
D ○ Waiting
```

人看到 B 的情况以后，在 C 还没执行之前修改：

```text
A ✓
↓
B ● Running
↓
E ○ Waiting
↓
C ○ Waiting
↓
D ○ Waiting
```

只要 E、C、D 都还没启动，这次修改可以直接作用于**当前 Run**。

这其实非常符合科研：

> 我不用重新开一个 Workflow，只是在还没发生的未来步骤里插一个实验。

所以这里我正式把它变成：

> **Q26：你是不是希望“过去不可修改、未来可以重排”？**

也就是：

```text
Completed     🔒
Running       🔒
Pending       ✎ 可编辑
```

如果你回答“是”，我觉得这是这个产品一个非常有特点的设计。

因为普通 DAG 工具通常是：

> 配置 → Run → 整体冻结。

而你的系统更像：

> **可实时修改未来计划的 Agent execution timeline。**

这其实比“拖拽 UI”本身更有意思。

---

## 14｜用户

Q19 方案B吧 
Q20  肯定愿意，这个框架具备启动已有对话和创建新对话的能力
Q21 认同
Q22 认同
Q23是的
Q24 这个状态后面可以参考已有项目的情况 借鉴一下
Q25 认同
Q26 认可

---

## 15｜ChatGPT

很好，到了这里我觉得项目的“骨架”已经基本定型了，而且开始出现几个比较鲜明的设计原则。

目前可以先把它定义成：

> **一个面向真实 Harness Conversation 的可视化执行编排层。**  
> Conversation 是长期存在的资源，Workflow 是可编辑的未来行动计划；系统负责启动/恢复会话、等待完成、提取文本输出、拼接 Prompt、继续下一步，但尽量不重新抽象 Harness 原生能力。

目前已经确定的几个原则我会先固定下来：

```text
Conversation = 稳定身份
Terminal/tmux/PTY = 当前运行载体

Workflow Node = Conversation 在某一步中的引用
同一个 Conversation 可以出现多次

Edge = Prompt Template
{{ upstream.output }}
/skill
@file
全部原样进入 Harness

Completed / Running = 锁定
Pending = 当前 Run 中仍可重新编排

Workflow Pause = 不再触发新的节点
不会擅自杀掉正在运行的 Harness

Browser / Orchestrator 重启
≠ Workflow 丢失
必须可以重新 attach 并继续
```

这已经和 Coze、n8n、Agent Deck 有明显区别了。

下一轮我要开始攻击几个**不解决就一定会出事故**的问题。

---

## Q27：同一个 Conversation 绝对不能同时执行两个 Node，对吗？

这是我现在最想确认的。

比如你画：

```text
                 ┌→ Reviewer A ─┐
PI ─→ Engineer ──┤               ├→ PI
                 └→ Reviewer B ─┘
```

但 Reviewer A 和 Reviewer B 实际绑定的是**同一个 Codex Conversation**。

理论上的 DAG 是并行：

```text
Reviewer A
Reviewer B
```

现实中却只有一条 Conversation 时间线。

如果系统同时向它发送：

```text
Prompt A
Prompt B
```

整个状态就乱了。

所以我建议建立一个非常强的底层规则：

> **Conversation 是单线程资源。**

一个 Conversation 任意时刻只能被一个 Workflow Node 占用。

于是：

```text
Reviewer A ● Running
Reviewer B ○ Waiting for session
```

A 完成后：

```text
Reviewer A ✓
Reviewer B ● Running
```

这不仅解决同一 Workflow，也解决两个 Workflow 同时抢一个 PI 对话。

**Q27：你认不认可“一条 Conversation 全局单线程，多个 Node 自动排队”？**

我认为这个最好不要给用户配置。

---

## Q28：多个 Workflow 抢同一个 Session 时，谁优先？

例如：

```text
Workflow 1
Experiment → PI

Workflow 2
Literature Review → PI
```

都绑定同一个：

```text
Codex / PI
```

PI 当前空闲，然后两个 workflow 几乎同时到达。

最简单就是 FIFO：

```text
先到先执行
```

节点上显示：

```text
○ Queued
Waiting for PI
```

我不建议 V1 做 priority、preemption 之类的东西。

所以这里我倾向直接定死：

> **全局 Conversation Queue，FIFO。**

除非你认为科研场景里很快就需要优先级。

---

# Q29：创建“新 Conversation”时，用户到底需要配置什么？

你明确说框架既能 resume 旧对话，也能创建新对话。

那么左侧应该有：

```text
+ New Conversation
```

点以后我认为真正需要的字段可能只有：

```text
Harness
  Codex / OpenCode / Claude ...

Host
  Local / gpu01 / ...

Working Directory
  ~/projects/sr

Model
  默认 / gpt-...

Effort
  默认 / high / ...

Initial prompt
  可选
```

而：

```text
Skill
Files
```

依然不要做成配置项，留在原生 Prompt 里。

这里有一个产品问题：

### 创建后立即是真实 Conversation

```text
+ New Conversation
↓
创建 Codex session
↓
出现在左侧
↓
以后它和普通历史 Session 没区别
```

我认为应该如此。

而不是创建一种：

```text
Workflow-only virtual agent
```

**Q29：是不是这个意思？**

也就是系统不会存在什么“Agent Definition”，只有真正存在于 Harness 里的 Conversation。

---

# Q30：已有 Conversation 的 model / effort，Workflow 应不应该覆盖？

这是个隐蔽但非常重要的问题。

比如左侧：

```text
PI
Codex
GPT-5.6 Sol / High
```

把它拖进 Node。

Node 设置里如果允许：

```text
Model: Luna
Effort: Low
```

那么这个 Node 会不会临时修改真实 Conversation 的运行配置？

我反而不建议这么做。

因为你强调的是：

> 原生态 Harness Session。

所以已有 Conversation 我倾向：

```text
Conversation 当前用什么
Workflow 就用什么
```

如果用户想改：

```text
Open Session
→ 在 Harness 里改
```

或者提供一个显式的：

```text
Edit Session Settings
```

但它修改的是 Conversation 本身，不是这个 Node 私有的参数。

对于新 Conversation，则创建时可以指定 model / effort。

**Q30：你认同吗？**

这个决定能避免：

```text
同一个 PI 节点第一次用 High
第二次突然变成 Low
```

最后用户都不知道真实对话现在是什么配置。

---

# Q31：工作目录 `cwd` 是不是 Conversation 的核心属性？

我认为是。

尤其 OpenCode / Codex：

```text
Conversation
├── Harness
├── Host
├── Conversation ID
└── Working Directory
```

比如：

```text
PI
~/projects/remote-sr

Engineer
/data/project/remote-sr
```

那么用户在 Edge 里写：

```text
@results/latest.md
```

它应该自然由目标 Harness 在**目标 Conversation 的 cwd** 下解释。

Orchestrator 完全不应该尝试替用户解析这个路径。

这和你 `/skill` 的哲学是一致的：

> 编排器传字符串，Harness 理解语义。

---

# Q32：等待“不要太久”具体应该怎么表现？

你 Q8 的答案其实很好：

> 宁可多等，但不要太久。

我觉得这里不能用 timeout 自动判定 Completed，但可以做：

```text
Running 18m
```

超过一个用户设定的阈值：

```text
⚠ Running longer than expected
35m
```

然后给用户三个操作：

```text
Open Session
Stop Session
Mark Completed
```

其中 `Mark Completed` 很重要。

因为总会有 Adapter 判断失灵的时候：

```text
Codex 明明已经结束
系统还认为 running
```

用户应该能人工告诉 Workflow：

> 这一轮算完成，取当前已有文本，继续。

所以我的建议是：

```text
soft timeout = UI warning
hard timeout = 没有
```

V1 默认可能：

```text
15 min → long-running indicator
```

但只是视觉提示。

**Q32：你是否希望有 `Mark Completed` 这种人工兜底？**

我觉得这是必须的。

---

# Q33：Node 的结果到底保存“快照”，还是永远指向 Session 最新输出？

你之前说 Retry 要重新读取 upstream，这说明你很重视真实 Session 的最新状态。

但是 Workflow 历史还是必须有快照。

例如：

```text
PI Node #1
Completed 10:30
Output Snapshot:
"运行实验 A..."
```

11:00 你又和 PI 聊了别的。

Node #1 不能变成：

```text
"刚刚我们讨论了论文 B..."
```

所以我建议同时存在两个概念：

```text
Node.output
= 当时运行完成时的固定快照

Session.latest
= Conversation 当前最新的一轮输出
```

然后你说的 Retry：

```text
默认重新读取 upstream
```

实际上应该让用户知道它到底读：

```text
upstream Node snapshot
```

还是：

```text
upstream Session latest
```

你前面的意思更接近后者。

所以我甚至建议未来 Edge 支持：

```text
{{ upstream.output }}          # 本次 Node 的快照
{{ upstream.session.latest }}  # 当前 Conversation 最新
```

但 V1 不一定暴露两套。

这里我想挑战一下：

**正常执行必须使用 Node 的固定 output snapshot。**

否则 A 完成以后，人又和 A 聊了一句，B 还没开始：

```text
A ✓
    人工新聊一句
B ○
```

如果 B 启动时读取 `Session latest`，它得到的已经不是 A 节点产生的输出了。

所以我建议：

```text
正常执行：
固定 upstream Node snapshot

手动 Retry：
可以选择 Refresh from session
```

这比所有时候都“重新读取当前 upstream”可靠。

**Q33：你能接受这种区别吗？**

我觉得这里值得修改一下你之前 Q15 的选择。

---

# Q34：Source Node 的 Listen 到底监听什么？

你说第一节点两种都需要：

### Kickoff

很好理解：

```text
Send Prompt
↓
Wait Completion
```

### Listen

就稍微复杂。

例如你已经在 PI Conversation 里输入了：

```text
帮我设计下一轮实验
```

然后打开 Workflow，点 Run。

此时 PI 正在运行。

那么 Listen Node 应该：

```text
attach 当前正在进行的一轮
↓
等它完成
↓
捕获这一轮输出
```

如果 PI 当前已经 Idle：

```text
等待下一次新的 user→assistant round
```

我认为这应该是默认语义。

也就是：

```text
Running Session
→ attach current turn

Idle Session
→ wait next turn
```

**Q34：符合你的直觉吗？**

---

## 我现在已经能看见左侧 UI 了

大概不是传统“组件面板”，而更像资源浏览器：

```text
┌ Conversations ─────────────────────┐
│                                    │
│ LOCAL                              │
│                                    │
│ Codex                              │
│ ● PI / Remote SR              Idle │
│ ● Reviewer                 Running │
│ ○ Literature Review        Offline │
│                                    │
│ OpenCode                           │
│ ● Experiment Engineer         Idle │
│                                    │
│ gpu01                              │
│                                    │
│ OpenCode                           │
│ ● KITTI Training            Running│
│ ○ Old Ablation             Offline │
│                                    │
│ + New Conversation                 │
└────────────────────────────────────┘
```

拖进去：

```text
┌───────────────────────┐
│ PI / Remote SR        │
│ Codex · Local         │
│                       │
│ ✓ Completed           │
└──────────┬────────────┘
           │
           │
   ┌───────▼────────┐
   │ Edge Prompt     │
   │ /exp            │
   │ {{output}}      │
   └───────┬────────┘
           │
┌──────────▼────────────┐
│ Experiment Engineer   │
│ OpenCode · gpu01      │
│                       │
│ ● Running             │
└───────────────────────┘
```

到这里，我觉得**不要再加功能了**。先把核心 runtime 语义彻底敲死。

你下一条回答 **Q27、Q29、Q30、Q32、Q33、Q34** 就够了。Q28 和 Q31 如果你没异议，我建议直接按 **Conversation 全局 FIFO + cwd 属于 Conversation** 定下来。

回答完这一轮，我下一步不会继续无休止问需求了。我会帮你把前面所有讨论压缩成一份 **V0.1 产品定义**：核心对象、状态机、画布行为、运行语义、明确不做什么，以及一个最小可实现架构。这样我们就能判断这个项目到底应该基于 `tmux-agents / Agent Deck / codex-webui` 哪一类底座开始搭。

---

## 16｜用户

Q27 我认为可以，但是这样需要重复拖拽，你觉得合理吗？
Q28 首先，我认为同一个session可以在不同workflow中出现
Q29是的 
Q30 我认为是这样，已有对话默认使用之前的模型和effort，新建对话的功能也设置为拖拽，但可以选择这些初始化选项，模型 effort之类的
Q31 是
Q32  15min吧，正常不会有这种情况
Q33 快照吧
Q34 可以

---

## 17｜ChatGPT

可以，这一轮我觉得已经足够收口成 V0.1 了。

你 Q27 提到的“同一个 Session 多次出现，需要重复拖拽”确实是个 UX 问题，但我不建议因此让一个节点承担多次执行。**视觉上每一次执行仍然应该是独立 Node**，否则执行历史、状态和连线都会变得模糊。

更好的方式是：第一次从左侧拖 `PI` 到画布，之后可以直接复制这个节点，或者右键选择“再次使用此 Session”。例如：

```text
左侧资源：

Codex
└── PI / Remote SR

第一次拖入：

┌──────────────────┐
│ PI / Remote SR   │
│ Design Experiment│
└──────────────────┘

⌥ Drag / Ctrl+D

┌──────────────────┐
│ PI / Remote SR   │
│ Review Results   │
└──────────────────┘
```

两个框绑定同一个 Conversation，但代表两个不同的执行步骤。

这样既保留：

> Conversation 全局单线程

又不会让用户每次跑回左侧重新寻找 Session。

而你对 Q28 的回答，反而进一步确认了这个设计：**Session 是全局资源，Node 只是引用。** 同一个 Session 可以出现在多个 Workflow、同一个 Workflow 的多个位置，但同一时间只能有一个 Node 真正向它发送任务。发生冲突时进入全局 Session Queue 即可。

---

# V0.1 产品定义

我现在会把这个项目定义成：

> **Visual Harness Workflow Orchestrator**
>
> 一个直接编排真实 Codex、OpenCode 等 Harness Conversation 的可视化工作流界面。用户提前定义原本需要人工完成的“等待 → 复制输出 → 拼接提示词 → 切换对话 → 发送”过程，然后让系统自动接力执行。

核心不是创建 Agent，而是**编排已经存在的 Conversation**。

---

## 1. 三个最核心的对象

### Conversation

这是长期稳定存在的真实资源：

```text
Conversation
├── harness: Codex
├── conversation_id: xxx
├── host: local / gpu01
├── cwd: ~/projects/remote-sr
├── model: 当前 Harness 配置
├── effort: 当前 Harness 配置
└── runtime:
      tmux / PTY / process / offline
```

最重要的原则是：

```text
Conversation ID ≠ tmux pane
Conversation ID ≠ process
```

终端可以关闭、重新启动，Conversation 本身身份不变。

---

### Node

Node 是：

> **某个 Conversation 在 Workflow 某一步中的一次引用。**

例如同一个 PI：

```text
        PI
Design Experiment
        │
        ▼
    Engineer
        │
        ▼
        PI
 Review Results
```

两个 PI Node：

```text
node_id 不同
conversation_id 相同
```

每个 Node 可以有自己的用途名称：

```text
PI / Remote SR
Design Experiment
```

但大标题始终是用户熟悉的 Conversation 名称。

---

### Edge

V0.1 中 Edge 就是一件事：

> **Prompt Template**

例如：

```text
/experiment-engineer

PI 已经完成实验设计：

{{ upstream.output }}

@EXPERIMENT_LOG.md

请按照方案执行实验。
```

Orchestrator 只理解：

```text
{{ upstream.output }}
```

至于：

```text
/experiment-engineer
@EXPERIMENT_LOG.md
```

完全不解析，原样交给 Codex/OpenCode。

这个边界非常重要。

---

# 2. Workflow 的核心语义

默认：

```text
A
│
│ 等待 A 完成
│
▼
捕获 A 本轮文本输出
│
│ 渲染 Edge Prompt Template
│
▼
B
│
│ 发送
│
▼
等待 B 完成
```

输出定义先保持简单：

> 捕获当前 Node 这一轮中 Assistant 产生的文本内容，排除 tool call / tool output。

完成时保存：

```text
Node.output_snapshot
```

后续正常执行永远使用这个快照，而不是偷偷读取 Conversation 当前最新内容。

这是你 Q33 最终确定的规则。

---

# 3. 两种入口模式

Source Node 支持：

```text
Listen
```

和：

```text
Kickoff
```

Kickoff：

```text
Workflow Run
↓
主动给第一个 Conversation 发 Prompt
↓
等待完成
```

Listen：

如果 Conversation 正在执行：

```text
attach 当前 turn
↓
等待完成
```

如果目前 Idle：

```text
等待下一次真实 turn
↓
捕获结果
```

所以可以支持你的两种典型工作方式。

一种是：

> 我已经自己在 PI 里问完问题了，后面的流程你帮我接。

另一种是：

> 我晚上搭好，点 Run，从 PI 开始一路自动跑。

---

# 4. Session 是全局单线程资源

这是一个应该写进底层 runtime 的硬规则：

```text
一个 Conversation
任意时刻
只允许一个 Node 占用
```

例如：

```text
Workflow A → PI
Workflow B → PI
```

同时到达：

```text
Workflow A / PI    ● Running
Workflow B / PI    ○ Queued
```

V0.1 直接 FIFO 就够了。

不做 priority，不做抢占。

因为如果允许两条 Prompt 同时写进同一 Conversation，后面所有状态推断都会变得不可信。

---

# 5. Canvas 是一张“活的未来计划”

这个可能会成为你这个产品非常有辨识度的地方。

普通工作流系统：

```text
配置
↓
Run
↓
整张 DAG 冻结
```

你的系统：

```text
过去           现在          未来

A ✓  ─────── B ● ─────── C ○ ───── D ○
🔒             🔒             ✎         ✎
```

规则：

```text
Completed   不允许改变执行语义
Running     不允许改变执行语义
Pending     可以重新连线、插入、删除
```

但所有 Node 位置随时都可以移动，因为那只是 UI layout。

所以科研过程中：

```text
PI ✓
↓
Experiment ●
↓
PI Review ○
```

看到实验跑到一半后，你觉得应该加入一个 sanity check。

可以直接：

```text
PI ✓
↓
Experiment ●
↓
Sanity Check ○
↓
PI Review ○
```

这次修改直接影响当前 Run 尚未发生的未来。

这个设计我认为值得保留。

---

# 6. Pause 和 Stop 的定义

顶部一个总开关即可。

例如：

```text
Workflow     ON ●
```

关掉以后：

```text
不再触发新的 Pending Node
```

但：

```text
当前正在运行的 Harness
继续运行
```

不会偷偷 kill。

Node 上可以提供：

```text
Open Session
Stop Session
```

`Stop Session` 本质上还是调用 Harness 自己的停止能力。

这和你的核心定位完全一致：

> Orchestrator 负责接力，不负责霸占 Harness。

---

# 7. 运行状态

V0.1 不需要假进度条。

Conversation 层：

```text
Running
Idle
Offline
Error
```

Workflow Node 层：

```text
Waiting
Queued
Running
Completed
Failed
Paused
```

Canvas 正常只显示简单状态：

```text
┌────────────────────────┐
│ Experiment Engineer    │
│ OpenCode · gpu01       │
│                        │
│ ● Running              │
└────────────────────────┘
```

不用显示：

```text
63%
```

也不需要塞一个小终端进去。

点开 Node 再看详细信息。

---

# 8. 15 分钟是 Soft Timeout

你现在定的逻辑可以写成：

```text
Running < 15min
● Running
```

超过 15 分钟：

```text
⚠ Running for 18m
```

但 **不能自动判 Completed**。

可以提供人工操作：

```text
Open Session
Stop Session
Mark Completed
```

尤其 `Mark Completed` 是一个很好的 Adapter 故障兜底。

真正长期跑训练之类的场景，以后可以允许 Node 修改 warning threshold。

---

# 9. Conversation Browser

左侧不是“组件库”，而是**真实资源浏览器**。

例如：

```text
Conversations

LOCAL

Codex
● PI / Remote SR             Idle
● Reviewer                Running
○ Old Literature Review   Offline

OpenCode
● Experiment Engineer        Idle


GPU01

OpenCode
● Training                Running
○ KITTI Experiment        Offline


+ New Conversation
```

其中：

```text
● = 当前有 runtime
○ = 历史 Conversation
```

历史 Conversation 一样可以拖进 Canvas。

运行到这个节点时：

```text
发现 Offline
↓
自动启动 Harness
↓
resume Conversation
↓
等待 Ready
↓
发送 Prompt
```

用户不用提前开几十个 CLI。

---

# 10. 新建 Conversation 也采用拖拽

这个是你刚刚 Q30 的一个很好设计。

左侧可以有：

```text
+ New Codex
+ New OpenCode
```

或者一个：

```text
+ New Conversation
```

拖到画布以后出现初始化面板：

```text
Harness
Codex

Host
gpu01

Working Directory
~/projects/sr

Model
GPT-5.6 Sol

Effort
High

Name
Experiment Reviewer
```

确认后：

```text
真正创建 Harness Conversation
↓
获得 conversation_id
↓
它以后就是普通 Conversation
↓
自动出现在左侧
```

不存在所谓：

```text
Workflow Virtual Agent
```

这一套额外概念。

我非常赞成这个取舍。

---

# 11. Model / Effort 属于 Conversation

已有 Conversation：

```text
PI
GPT-5.6 Sol
High
```

拖到任何 Workflow 都继承它当前真实配置。

Node 不偷偷覆盖：

```text
model
effort
```

新建 Conversation 时才可以指定。

如果以后允许修改，也是在：

```text
Conversation Settings
```

修改，而不是在某一个 Node 上修改。

---

# 12. cwd 同样属于 Conversation

例如：

```text
Experiment Engineer

Host:
gpu01

cwd:
/data/remote-sr
```

所以 Edge 写：

```text
@results/latest.md
```

Orchestrator 不需要知道：

```text
/data/remote-sr/results/latest.md
```

让目标 Harness 自己解析。

这也是为什么你现在选择“原生 pass-through”是非常正确的。

---

# 13. Workflow 必须持久化

这一条属于 V0.1 基础能力，不是高级功能。

浏览器关闭：

```text
Workflow 继续
```

Orchestrator 服务重启：

```text
恢复数据库
↓
重新扫描 Hosts
↓
重新发现 Conversation runtime
↓
重新 attach
↓
继续等待当前 Node
```

例如：

```text
02:00 Engineer Running

02:13 orchestrator restart

02:14
重新 attach Engineer
发现仍在 Running
继续等待
```

这才真正满足：

> 不需要人在电脑前傻等。

---

# 14. Run History 保留，但不用复杂化

你 Q18 没有特别强调，所以 V0.1 做最低限度即可。

每个 Node Run 保存：

```text
Node
Conversation
Prompt sent
Started at
Completed at
Output snapshot
Status
Error
```

点一下节点能看到：

```text
Input
Output
Runtime
```

足够 debug。

暂时不需要：

```text
Token analytics
Cost dashboards
Trace graph
Distributed telemetry
```

那些以后再说。

---

# 15. Template

Workflow 可以：

```text
Save
```

保存真实绑定：

```text
PI → Engineer → PI
```

也可以：

```text
Save as Template
```

Template 保留：

```text
拓扑
Edge Prompt
Node Purpose
配置结构
```

但把真实 conversation binding 变成槽位：

```text
[PI Session]
↓
[Experiment Session]
↓
[PI Session]
```

以后重新绑定即可。

这个可以不是第一周实现，但数据模型最好一开始预留。

---

# V0.1 明确“不做”的东西

现在尤其重要的是克制。

V0.1 不需要做：

- Loop。
- Router / Condition。
- Agent Definition。
- 自己的 Skill 系统。
- 自己的 File 引用系统。
- Memory。
- 结构化 Output schema。
- LLM 自动决定 Workflow。
- 百分比进度。
-复杂优先级调度。
- Harness 内部 Tool 抽象。

本质上第一版只需要证明一件事情：

```text
真实 Session A
完成
↓
正确抓取文本
↓
按照模板拼 Prompt
↓
发送给真实 Session B
↓
B 完成
↓
继续
```

而且：

```text
跨 SSH
可以 resume
网页关闭没关系
过程中能看到状态
```

如果这个闭环足够稳定，这个项目就已经有价值。

---

## 最后回到你 Q27 的问题

**是的，同一个 Conversation 多次参与 Workflow 时，视觉上应该存在多个 Node。**

但不应该要求用户反复跑回左侧拖。

我建议 V0.1 至少支持：

```text
Ctrl/Cmd + D
Duplicate Node

Option/Alt + Drag
Duplicate

右键：
Use this session again
```

复制出来：

```text
conversation binding 保持不变
purpose 清空/自动编号
Edge 独立
Node state 独立
```

这样用户会非常自然地搭：

```text
PI
↓
Engineer
↓
PI [duplicate]
↓
Reviewer
↓
PI [duplicate]
```

**Conversation 是资源，Node 是步骤。**

我觉得这是目前整个产品模型里最值得固定下来的一句话。

---

If you want, I can:

- 
- 
- 

分享页后续建议：
- 继续讨论Q27单线程限制实现细节
- 明确Q28抢占与排队机制需求
- 继续完善Q29新Conversation配置流程
