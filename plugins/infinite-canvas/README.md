# Infinite Canvas Codex Plugin

让 Codex 可以打开并操作 Infinite Canvas。

## 安装

macOS / Linux：

```bash
git clone https://github.com/basketikun/infinite-canvas.git
cd infinite-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add infinite-canvas@infinite-canvas-local
```

Windows PowerShell：

```powershell
git clone https://github.com/basketikun/infinite-canvas.git
cd infinite-canvas
codex plugin marketplace add "$PWD"
codex plugin add infinite-canvas@infinite-canvas-local
```

Windows CMD 将 `$PWD` 替换为 `%cd%`。

## MCP 说明

画布工具 MCP（`infinite-canvas`）由本地 **Canvas Agent** 在创建对话时注入，**不要**再用：

```bash
npx -y @basketikun/canvas-agent mcp
```

`npx` 会向 stdout 输出进度信息，破坏 MCP JSON-RPC 握手，并容易抢占 `17371` 端口。请先启动本地 `canvas-agent`（`npm run start`），再在网页里新建对话。

安装后新建一个 Codex 任务，然后输入：

```text
帮我打开并连接到 Infinite Canvas
```

## 内置 Skills

| Skill | 用途 |
| --- | --- |
| `open-canvas` | 打开并连接 Infinite Canvas |
| `canvas` | 用 MCP 读写/操作当前画布节点 |

生成 Canvas 可视化报告的 `generate-canvas-report` 已内置在应用中（位于 `canvas-agent/builtin-skills/`，本地 Agent 启动时自动装入站点工作空间），无需通过本插件安装。
