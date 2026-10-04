<p align="center">
  <img src=".github/assets/logo.svg" width="72" alt="SessionWeave 标识" />
</p>

<h1 align="center">SessionWeave</h1>

<p align="center"><strong>把已有 Codex 与 OpenCode 会话，编排成可执行的接力工作流。</strong></p>
<p align="center">跨步骤复用原生会话上下文，在会话间传递最终回答，并检查每一次交接。</p>

<p align="center">
  <strong>早期 Demo</strong> · Codex CLI + OpenCode TUI · 已在 Linux / Node.js 22 验证<br />
  <a href="README.md">English</a> · 简体中文<br />
  <a href="#核心机制">核心机制</a> · <a href="#快速开始">快速开始</a> · <a href="#当前边界与数据流">当前边界</a>
</p>

![SessionWeave 桌面网页实拍：原生会话列表、三步编排画布与自然语言计划面板](.github/assets/workbench.png)

<p align="center"><sub>桌面网页实拍：A、B 两条分支汇合到 C 审查步骤。展示流程处于等待运行状态，像素工位显示就绪状态。</sub></p>

## 核心机制

继续使用已有会话，在画布上明确它们如何交接工作。

![两个原生会话、三个执行步骤：OpenCode A 研究，Codex B 评审，再回到同一个 OpenCode A 修订](.github/assets/workflow.svg)

| 概念 | 含义 |
| --- | --- |
| **会话** | 真实 Codex 或 OpenCode 对话，保留各自历史与模型配置。 |
| **步骤** | 画布上的一次任务；多个步骤可以复用同一个会话。 |
| **交接** | 当前运行中，上游步骤最终助手回答的快照，通过 `{{A1.output}}` 引用；不包含工具消息和思考过程。 |

例如：**OpenCode A → Codex B → 同一个 OpenCode A**，依次完成研究、评审和修订。A1 与 A3 保留 A 的原生上下文，B 接收 A1 的最终回答。这是一个三步 DAG，对应两个会话、三个工位。

## 快速开始

### 环境要求

当前 Demo 连接**同一台主机**上的原生服务。启动前需要：

- **Node.js 22** 与 npm。
- 已登录、可通过共享 app-server daemon 连接的 **Codex CLI**。
- 已运行的 **OpenCode 2.x** 服务与可读取的服务配置 JSON 文件。
- 在原客户端完成业务会话的模型配置与认证。

> **业务模型与辅助模型分开：**业务步骤使用各原生会话的模型和思考档位。自然语言规划及可选的接力润色使用独立 OpenCode 辅助会话，当前硬编码为 `opencode/space-bunny-free`；该模型必须在当前 OpenCode 服务中可用。

```bash
git clone git@github.com:lujunxi57/SessionWeave.git
cd SessionWeave
npm ci
npm run dev
```

打开 **http://127.0.0.1:8787**。当前仓库访问需要相应 GitHub 权限。

生产模式：

```bash
npm run build
npm start
```

如果服务运行在 SSH 主机上，可在本机建立端口转发：

```bash
ssh -N -L 8787:127.0.0.1:8787 <your-ssh-host>
```

### 创建第一个流程

1. 从左侧拖入已有会话，或勾选两个会话后使用 **A → B → A** 模板。
2. 编辑各步骤的用途和提示词，连接步骤并引用上游最终回答。
3. 也可以勾选参与的会话，在计划面板描述协作任务；先检查可编辑的文字方案，再确认生成画布。
4. 点击**运行**派发业务任务，通过运行记录检查步骤状态、实际输入、最终输出和错误。

创建或编辑画布不会派发业务任务；生成文字方案会调用独立的规划模型。

## 功能

| 功能 | 当前行为 |
| --- | --- |
| **发现原生会话** | 浏览 Codex / OpenCode 会话，按最近活动排序，按标题与预览、时间范围及 Harness 筛选。 |
| **可视化规划与编辑** | 手动连接步骤，或将可编辑的自然语言方案转换为画布。 |
| **复用原生配置** | 使用原生 Skill 与文件附件，从 Harness 可用目录选择模型和思考档位。模型变更作用于整个会话；忙碌会话不能切换。 |
| **监听与排队** | 监听原客户端发起的在途轮次，等待忙碌会话，暂停后续派发。 |
| **检查执行过程** | 查看实际发送的输入、最终输出快照、状态变化与错误。 |
| **像素员工与工位** | 一个会话对应一个员工，一个步骤对应一个工位；移动、打字、等待审批、失败和输出交接随真实执行状态变化。可关闭，并支持减少动态效果。 |

## 连接配置

| 环境变量 | 用途 | 默认值或发现方式 |
| --- | --- | --- |
| `CODEX_SOCKET` | Codex 共享 daemon socket 路径 | 从 `codex app-server daemon version` 发现 |
| `OPENCODE_URL` | OpenCode 服务地址 | `http://127.0.0.1:49374` |
| `OPENCODE_SERVICE_FILE` | OpenCode 服务配置文件 | `~/.config/opencode/service.json` |
| `OPENCODE_SERVER_PASSWORD` | 覆盖 OpenCode 服务密码 | 从服务配置读取 |
| `PORT` | 网页服务端口 | `8787` |

当前 OpenCode 适配器始终读取服务配置文件及其中的 `password` 字段。即使通过环境变量覆盖地址或密码，也需要可读取的 JSON 文件。服务凭证仅由后端读取，不发送到浏览器。

## 当前边界与数据流

- **早期单主机 Demo。**目前接入 Codex 与 OpenCode，已验证环境为 Linux + Node.js 22。
- **原客户端仍参与工作流。**权限审批、完整终端交互与客户端专属管理命令在原 CLI / TUI 中操作；网页显示等待审批状态。
- **有限步骤编排。**暂停只阻止后续派发，在途任务继续；尚不支持运行中改图、即时中断或通用循环。
- **编辑器能力部分覆盖。**支持 Skill 补全、历史输入、文件附件与输出引用；完整文件/agent `@` 菜单、Shell 模式和 snippet 尚未实现。搜索覆盖标题与预览，暂不全文检索。
- **记录本地保存，推理由配置的模型服务完成。**流程与运行记录保存在 `.sessionweave/`。关闭浏览器不影响后端执行；后端重启保留快照，将未结束流程标记为失败，不自动重发。输入与上游最终回答通过原生 Harness 发送给其配置的模型服务；启用规划或润色时，也会发送给辅助模型。
- **像素动画反映状态。**尚未细分具体的读文件、编辑或测试工具动作。

## 开发与验证

```bash
npm test
npm run build
```

单元测试使用模拟适配器，覆盖调度、最终回答归属、模型继承与像素状态，不向真实 Harness 发送任务。

可选的像素界面检查需要已启动的网页服务和 Playwright Chromium：

```bash
npx playwright install chromium
npm run test:browser
```

`DEMO_URL` 可指定检查地址。检查拦截 API，使用模拟会话与运行状态，不修改真实会话、模型或已保存流程。默认不生成截图或报告；仅设置 `ARTIFACT_DIR` 时保留检查产物。

技术栈为 **React、TypeScript、React Flow、CodeMirror 与 Fastify**，通过原生协议连接 Codex 和 OpenCode。

## 来源与致谢

SessionWeave 使用了 **OpenChamber、Harnss、React Flow、Sage Paper Light 与 Pixel Agents** 的相关工作，角色素材来源为 **JIK-A-4 / MetroCity**。源码快照与第三方许可保留在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，角色素材来源见 [public/pixel/characters/sources.json](public/pixel/characters/sources.json)。
