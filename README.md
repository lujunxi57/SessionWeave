# SessionWeave

把真实 Codex CLI / OpenCode TUI 会话编排为可执行的网页工作流。

SessionWeave 将已有会话作为资源，将每个画布节点作为一次执行步骤。A → B → 同一个 A 的接力保留原生会话上下文，并把本次运行的最终回答传给下游。

## 功能

- **真实会话**：发现已有 Codex / OpenCode 会话，按最近活动排序，支持标题与预览搜索、时间范围和 Harness 筛选。
- **可视化编排**：拖入会话、连接步骤，使用 `{{A1.output}}` 引用本次运行的上游最终回答。
- **自然语言规划**：先生成可编辑的文字方案，确认后转为画布；点击运行才向业务会话派发任务。
- **原生配置**：业务步骤沿用会话当前模型与思考档位，支持原生 Skill、文件附件和模型选择。
- **执行与记录**：监听原客户端的在途任务、等待忙碌会话、暂停后续派发，并查看实际输入、最终输出和错误。
- **像素员工**：一个会话对应一个员工，一个步骤对应一个工位；A → B → A 是两个员工、三个工位，结果沿连线接力。

## 环境要求

当前版本是面向单台主机的早期 Demo，已在 Linux + Node.js 22 环境验证。

- Node.js 22 和 npm。
- 已登录、可通过共享 app-server daemon 连接的 Codex CLI。
- 已运行的 OpenCode 2.x 服务，以及可读取的服务配置文件。
- 自然语言规划和接力润色使用独立的 OpenCode `space-bunny-free` 辅助会话，需要该模型在当前服务中可用。
- 会话中的业务任务使用各自 Harness 已配置的模型；本项目不提供模型服务或认证凭证。

## 启动

```bash
git clone git@github.com:lujunxi57/SessionWeave.git
cd SessionWeave
npm ci
npm run dev
```

打开 **http://127.0.0.1:8787**。仓库访问需要相应的 GitHub 权限。

生产模式：

```bash
npm run build
npm start
```

应用默认仅监听 localhost。运行在 SSH 主机时，可在本机建立端口转发：

```bash
ssh -N -L 8787:127.0.0.1:8787 <your-ssh-host>
```

### 连接配置

| 环境变量 | 用途 | 默认值或发现方式 |
| --- | --- | --- |
| `CODEX_SOCKET` | Codex 共享 daemon socket 路径 | 从 `codex app-server daemon version` 发现 |
| `OPENCODE_URL` | OpenCode 服务地址 | `http://127.0.0.1:49374` |
| `OPENCODE_SERVICE_FILE` | OpenCode 服务配置文件 | `~/.config/opencode/service.json` |
| `OPENCODE_SERVER_PASSWORD` | 覆盖 OpenCode 服务密码 | 从服务配置读取 |
| `PORT` | 网页服务端口 | `8787` |

当前 OpenCode 适配器始终读取服务配置文件；即使使用环境变量覆盖地址或密码，也需要一个可读取的 JSON 配置文件。凭证仅由后端读取，不发送到浏览器。

## 使用

1. 从左侧拖入已有会话，或勾选参与规划的会话。
2. 在右侧描述协作任务、选择 Skill，生成并检查文字方案。
3. 确认画布，编辑各步骤的提示词与上游输出引用。
4. 点击运行，查看各步骤状态及运行记录。

例如：OpenCode A 实现功能 → Codex B 审查代码 → 同一个 OpenCode A 修复并验证。A1 和 A3 引用同一会话，但拥有不同步骤 ID；这是三步接力，不是无限循环。

模型选择作用于原生会话。点击节点的模型按钮后，可搜索模型、调整原生思考档位，点击外部保存；运行中的会话不能切换。

## 验证

```bash
npm test
npm run build
```

单元测试使用模拟适配器，覆盖调度、最终回答归属、模型继承和像素状态，不向真实 Harness 发送任务。

像素界面检查需要先启动网页服务并安装 Playwright Chromium：

```bash
npx playwright install chromium
npm run test:browser
```

可通过 `DEMO_URL` 指定检查地址。浏览器检查拦截 API，仅使用模拟会话和运行状态，不修改真实会话、模型或已保存的流程。默认不生成截图或报告；仅在设置 `ARTIFACT_DIR` 时保存检查产物。

## 当前边界

- 当前仅接入 Codex 与 OpenCode；完整终端嵌入和客户端专属管理命令仍需在原客户端操作。
- Skill 补全、历史输入导航、文件附件与输出引用可用；文件/agent 的完整 `@` 菜单、Shell 模式与 snippet 尚未实现。
- 权限审批在原客户端处理，网页显示等待状态。
- 暂停只阻止后续派发，在途任务继续；不支持即时插话、运行中改图或通用循环。
- 数据保存在本地 `.sessionweave/`。关闭浏览器不影响后端执行；后端重启后保留快照并停止未结束流程，不自动重发。
- 像素动画按运行状态切换，尚未细分具体读文件、编辑或测试工具动作。
- 搜索覆盖标题与预览，暂不全文检索。

## 技术与来源

React、TypeScript、React Flow、CodeMirror 和 Fastify；通过原生协议连接 Codex 与 OpenCode。

输入组件、RPC 结构、配色与像素资源的来源及许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。第三方角色资源同时保留来源清单与许可文件。
