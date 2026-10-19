---
name: generate-canvas-report
description: >-
  生成 Infinite Canvas 可视化报告（优先 .canvas.tsx，其次单文件 HTML）。
  当用户要求看板、KPI、漏斗、图表报告、流程图、审批流、状态机、组织架构、时序图、
  系统架构、部署拓扑、甘特、时间线、用户旅程、财务报表、方案对比、Canvas 报告、
  可视化分析页时使用。
---

# 生成 Canvas 报告

你在 Infinite Canvas 中交付的是**可预览成品文件**，不是聊天说明。优先产出单个 `.canvas.tsx`；只有用户明确要求网页、或环境不支持 TSX 时，才改用单文件 `.html`。

## 何时使用

- 看板 / KPI / 漏斗 / 占比构成 / 排名 / 趋势
- 流程图 / 审批流 / 状态机 / 组织架构 / 依赖关系
- 时序图 / 系统架构 / 部署拓扑 / API 一览
- 甘特、时间线等计划排期；用户旅程；财务报表；方案对比与决策矩阵
- 「做一份 Canvas 报告」「做成可视化」「做个看板」

不要用本 Skill 去做：纯文字结论（用 `.md`）、纯表格明细（用 `.csv`）、图片生成、**思维导图 / 脑图 / 大纲树**（用画布 MCP：`canvas_create_node(nodeType=mind-node)` + `canvas_connect_nodes`，直接落在当前画布，不要写 output 文件）。

## 产物选型

| 场景 | 文件 |
| --- | --- |
| 默认可视化报告 | `*.canvas.tsx` |
| 用户只要可双击打开的网页 | `*.html`（暗色单文件报告） |
| 结论长文 + 明细 | `.md` + `.csv`（不要硬做成 Canvas） |

一轮最多 3 个文件；可视化任务通常 **只交 1 个** `.canvas.tsx`。

## `.canvas.tsx` 硬性规则

1. 单文件；文件名英文，以 `.canvas.tsx` 结尾（例如 `order-flow.canvas.tsx`）。
2. **只能**从 `"infinite-canvas"` import；禁止其它 npm 包 / 相对路径 / CSS 文件。**原生 HTML / SVG 标签（`div` `svg` `path` `rect` `text` 等）可以直接写**，运行时已注入 React，SDK 没有的图形一律用原生标签自绘。
3. `export default` 一个 React 函数组件；数据全部内联在文件里。
4. 禁止 `fetch`、动态 import、外链 CDN、emoji 装饰、渐变、重阴影。
5. 文案默认中文；数字必须来自输入，缺失写「—」或「无数据」，禁止估算编造。
6. 在 Infinite Canvas Codex 智能节点（沙箱档）中，必须用文件块协议，块外不要写任何字：

```text
<<<FILE:report.canvas.tsx>>>
...源码...
<<<END>>>
```

联网执行档则把最终文件写到本轮 `outputDir`，不要输出文件块。

## 可用 API（infinite-canvas 全部导出）

布局：`Stack` `Row` `Grid` `Spacer` `Divider`  
排版：`H1` `H2` `H3` `Text` `Code` `Link`  
组件：`Pill` `Stat` `Callout` `Card` `CardHeader` `CardBody` `Table` `Button` `UsageBar` `Swatch` `CollapsibleSection`  
图表：`BarChart` `LineChart` `PieChart` `FlowDiagram`  
状态与交互：`useCanvasState` `useHoverTip` `HoverTip`  
主题配色：`useHostTheme` `chartPalette` `colorPalette` `toneColor` `mergeStyle`

关键约定：

- `BarChart`：单序列会渲染成**横向条**（适合排名 / 漏斗）；要竖向柱状请给两个序列，或单序列加 `stacked`；`normalized` 看占比结构。
- `LineChart`：真折线，`fill` 加面积底色，`categories` + `series={[{ name, data }]}`。
- `PieChart`：`data={[{ label, value, tone? }]}`，`donut` 环图（中心自动显示合计）。
- `FlowDiagram`：流程 / 状态机 / 组织架构首选，**只填数据不算坐标**：
  `nodes=[{ id, label, note?, shape: "process" | "decision" | "terminal", tone? }]`
  `edges=[{ from, to, label? }]`；回边（打回、重试）自动绕行；`direction="column"` 纵向，适合审批链和组织架构。
  **规划书节点必须一眼可读**：`label` 写完整步骤/页面内容，禁止 `slice` 或「……」截断。长句交给组件自动换行加高；短标题 + 完整说明时用 `label` + `note`。规划类纵向图建议 `nodeWidth={320}` 以上。
- `Table`：`headers` + `rows`，单元格可以放 JSX（Pill、着色 Text、迷你 SVG）。
- `Stat`：`value` + `label`，可选 `tone="success" | "warning" | "danger" | "info"`；`Callout`：`tone` + `title`。
- 悬停明细：`BarChart` `LineChart` `PieChart` `UsageBar` `FlowDiagram` 已内置鼠标悬停提示，不用额外写；自绘 SVG 需要悬停时用 `useHoverTip` + `HoverTip`（容器 `position:relative`，目标元素挂 `onMouseMove={(e) => show(e, 内容)}` 与 `onMouseLeave={hide}`）。
- 颜色一律取 `useHostTheme()` / `chartPalette` / `colorPalette` / `toneColor`，不要写死十六进制。

## 题材 → 版式选型（按这个挑，不要千篇一律）

| 题材 | 首选形式 |
| --- | --- |
| 漏斗 / 排名 | `BarChart horizontal` |
| 趋势走势 | `LineChart`（可 `fill`） |
| 构成占比 | `PieChart donut` / `BarChart normalized` / `UsageBar` |
| 流程 / 审批 / 状态机 | `FlowDiagram` |
| 组织架构 / 层级拆解 | `FlowDiagram direction="column"` |
| 接口时序 | 自绘 SVG 时序图（参考 examples） |
| 系统架构 / 部署拓扑 | div 分层分组卡片（比 SVG 稳，方便放文字） |
| 甘特 / 时间线 | 自绘（div 进度条 / 点线列表，参考 examples） |
| 用户旅程 | 阶段网格 + 自绘情绪曲线 |
| 财务报表 | `Table`（缩进 + 小计加粗 + 同比着色）+ 自绘瀑布图 |
| 方案对比 / 决策 | 双栏 Card / 四象限 / diff 色块 |
| 任务看板 / 行动清单 | Grid 多列 Card / 勾选列表 |
| 热力矩阵 / 雷达 / 散点 / 进度环 / 子弹图 | 自绘 SVG（参考 examples） |

版式结构自由组合：标题区（H1 + 一行说明 + Pill）→ 结论 Callout（有结论才放）→ 按题材挑 3～6 个区块。题材是流程就让流程图当主角，题材是排期就让甘特当主角，**不要每次都产出「KPI Grid + 一张条形图」的固定模板**。

## 参考示例（写之前先读）

与本文件同目录的 `examples/`：

- `canvas-gallery.canvas.tsx`：全部呈现形式图鉴——排版、指标、表格、标准图表、自绘 SVG（趋势 / 进度环 / 子弹图 / 热力 / 散点 / 雷达 / 贡献日历）、流程关系、时间计划、看板清单、对比决策、交互。
- `canvas-diagrams.canvas.tsx`：业务与技术题材——财务报表 + 瀑布图、组织架构、用户旅程、系统架构分层、接口时序图、部署拓扑、API 表。

时序图、瀑布图、甘特、雷达这类自绘图形，直接抄示例里的小组件改数据，不要从零手写坐标。

## HTML 后备（仅必要时）

单文件、内联 CSS；暗色底 `#181818`，扁平无阴影；语义类可用 `.cr-page` `.cr-stack` `.cr-h1` `.cr-pill` `.cr-stat` `.cr-callout` `.cr-hbar`。不要外链图表库。

## 质量红线

- 每个展示数字都能在上游输入里找到出处；明细超过 15 行另给 `.csv`。
- 只用上面列出的 `infinite-canvas` 导出 + 原生标签；引用不存在的导出会直接报错。
- 自绘 SVG 不写死颜色，文本过长要截断或换行，别让文字溢出图形。
- 用户说「导出 / 下载」时：在画布智能预览选中该文件后点「导出」即可得到源文件。
