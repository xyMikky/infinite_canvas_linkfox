/**
 * 运营五看链路导图（仅五看）
 * 布局：主链居中竖排 · 看宏观详细步骤在右侧子链 · 「否」再右一列
 * 规范：canvas-agent/agent-instructions.md
 */
const fs = require("fs");
const path = require("path");

const PROJECTS_PATH = path.join(__dirname, "../data/canvas-dev/projects.json");
const PROJECT_ID = "rEiJkRRRxssaMOrmPdV4X";

function mind(id, content, opts = {}) {
  const {
    x = 0,
    y = 0,
    width = 280,
    height = 52,
    mindRole,
    mindKind = "topic",
    mindShape = "rounded",
    mindColor = "#334155",
    fontSize = 14,
    description = "",
  } = opts;
  return {
    id,
    type: "mind-node",
    title: content,
    position: { x, y },
    width,
    height,
    metadata: {
      content,
      mindRole,
      mindKind,
      mindShape,
      fontSize,
      status: "success",
      ...(description ? { description } : {}),
      ...(mindColor ? { mindColor } : {}),
    },
  };
}

function conn(id, fromNodeId, toNodeId, label, fromSide = "bottom", toSide = "top") {
  return {
    id,
    fromNodeId,
    toNodeId,
    kind: "mind",
    fromSide,
    toSide,
    ...(label ? { label } : {}),
  };
}

function annConn(id, fromNodeId, toNodeId, fromSide = "right", toSide = "left") {
  return {
    id,
    fromNodeId,
    toNodeId,
    kind: "annotation",
    fromSide,
    toSide,
  };
}

function preview(id, title, content, x, y, w, h, previewPath) {
  return {
    id,
    type: "smart-preview",
    title,
    position: { x, y },
    width: w,
    height: h,
    metadata: {
      status: "success",
      smartPreviewPath: previewPath,
      smartPreviewKind: "markdown",
      content,
    },
  };
}

function centerX(width) {
  return 520 - width / 2;
}

function buildFiveLookMindMap() {
  const MACRO_X = 860; // 看宏观详细步骤列
  const SIDE_X = 1280; // 「否」与旁注列
  const dy = 130;
  const dyMacro = 78; // 子链更密，挂在 A 旁侧往下长

  const deliveryPreview = `# 运营五看 · 交付与门禁

## 执行顺序（推荐）
| Phase | 看什么 | Skill | 交付 |
|---|---|---|---|
| 0 | 规划 | five-look-planner | 【五看任务规划卡】 |
| 0.5 | 步骤计划 | five-look-plan-gate | validate 通过才开跑 |
| A | 看宏观 | macro-analysis | 独立 HTML · 约 8 页 |
| B | 看市场 | market-analysis | 独立 HTML · 18 页 |
| D | 看竞对 | competitor-analysis | 每 ASIN 四页 · **先于 C** |
| C | 看客户 | customer-analysis | 独立 HTML · 4 页 |
| E | 看自己 | （缺口 · 人工） | 规划书参数表 |
| F | 合并 | merge_five_look_spa.py | 可选总册 |

## 硬门禁（是 / 否）
| 判断 | 是 | 否 |
|---|---|---|
| 已有 5–8 个竞品 ASIN？ | 继续 Phase D | **停** · 人工确认竞品 ASIN |
| 竞品评论已齐？ | 继续 Phase C | **等** · 看竞对补全评论 |

## 禁止
- ops-five-look-dashboard（已禁用）
- 产品经理长页当五看终态
`;

  const y = (i) => i * dy;
  // 看宏观子链：从 Phase A 同行起，向下排
  const aY = y(3);
  const my = (i) => aY + i * dyMacro;

  const nodes = [
    mind("five-root", "运营五看 · 链路总览", {
      x: centerX(280),
      y: y(0),
      width: 280,
      height: 56,
      mindRole: "root",
      mindShape: "capsule",
      mindColor: "#0f766e",
      fontSize: 16,
      description: "规划 → 各看独立 HTML → 可选合并",
    }),

    mind("five-p0", "Phase 0 · 五看规划", {
      x: centerX(260),
      y: y(1),
      width: 260,
      mindColor: "#0d9488",
      description: "five-look-planner → 规划卡 + 范围裁剪",
    }),
    mind("five-p05", "Phase 0.5 · 步骤级计划", {
      x: centerX(280),
      y: y(2),
      width: 280,
      mindColor: "#14b8a6",
      description: "five-look-plan-gate → validate 通过才开跑",
    }),

    mind("five-a", "Phase A · 看宏观", {
      x: centerX(220),
      y: aY,
      width: 220,
      mindColor: "#2f6f6a",
      description: "大环境值不值得做 · 右侧为详细步骤",
    }),

    // —— 看宏观详细步骤（旁人看得懂）——
    mind("ma-1", "① 先说清看什么", {
      x: MACRO_X,
      y: my(0),
      width: 280,
      mindColor: "#2f6f6a",
      description: "品类、站点、产品依附什么才有需求（如：有车家庭 / 养狗家庭）",
    }),
    mind("ma-2", "② 弄清谁会买、为什么买", {
      x: MACRO_X,
      y: my(1),
      width: 300,
      mindColor: "#2f6f6a",
      description: "用户规模、动机、需求变化因素——先于本品市场规模",
    }),
    mind("ma-3", "③ 查现在市场有多大", {
      x: MACRO_X,
      y: my(2),
      width: 280,
      mindColor: "#2f6f6a",
      description: "多源数字对照；大盘≠小品类；有月销表用近12个月加总",
    }),
    mind("ma-4", "④ 看搜索热度怎么变", {
      x: MACRO_X,
      y: my(3),
      width: 280,
      mindColor: "#2f6f6a",
      description: "上级类目 + 本品一起查；有涨跌就出图",
    }),
    mind("ma-5", "⑤ 判断未来涨还是跌", {
      x: MACRO_X,
      y: my(4),
      width: 280,
      mindColor: "#2f6f6a",
      description: "列出驱动因素，标高/中/低权重，每条要有证据",
    }),
    mind("ma-6", "⑥ 给出值不值得做的结论", {
      x: MACRO_X,
      y: my(5),
      width: 300,
      mindColor: "#2f6f6a",
      description: "总体判断 + 安全合规风险 + 大盘怎么落到本品",
    }),
    mind("ma-7", "⑦ 整理成约 8 页报告", {
      x: MACRO_X,
      y: my(6),
      width: 280,
      mindColor: "#2f6f6a",
      description: "独立 HTML；关键数字都能查到来源",
    }),

    mind("five-b", "Phase B · 看市场", {
      x: centerX(220),
      y: y(4),
      width: 220,
      mindColor: "#3d5a80",
      description: "market-analysis · 类目怎么进入",
    }),

    mind("gate-boss", "已有 5–8 个竞品 ASIN？", {
      x: centerX(250),
      y: y(5),
      width: 250,
      height: 56,
      mindKind: "decision",
      mindShape: "hexagon",
      mindColor: "#115e59",
    }),
    mind("boss-no", "停 · 人工确认竞品 ASIN", {
      x: SIDE_X,
      y: y(5),
      width: 250,
      mindColor: "#9a3412",
      description: "AskQuestion 确认 5–8 个竞品 ASIN · 禁止用 Top100 整表顶替",
    }),

    mind("five-d", "Phase D · 看竞对", {
      x: centerX(220),
      y: y(6),
      width: 220,
      mindColor: "#8b4513",
      description: "competitor-analysis · 先拿评论与素材",
    }),

    mind("gate-reviews", "竞品评论已齐？", {
      x: centerX(210),
      y: y(7),
      width: 210,
      height: 56,
      mindKind: "decision",
      mindShape: "hexagon",
      mindColor: "#115e59",
    }),
    mind("reviews-no", "等 · 看竞对补全评论", {
      x: SIDE_X,
      y: y(7),
      width: 230,
      mindColor: "#9a3412",
      description: "买前 Reddit 可先跑 · 售后页待 D 落盘后再写",
    }),

    mind("five-c", "Phase C · 看客户", {
      x: centerX(220),
      y: y(8),
      width: 220,
      mindColor: "#6b4c7a",
      description: "customer-analysis · 复用 D 评论 + Reddit",
    }),

    mind("five-e", "Phase E · 看自己（可选）", {
      x: centerX(260),
      y: y(9),
      width: 260,
      mindColor: "#64748b",
      description: "尚无独立 Skill · 规划书 + 人工",
    }),

    mind("five-f", "Phase F · 合并 SPA（可选）", {
      x: centerX(280),
      y: y(10),
      width: 280,
      mindColor: "#2d5016",
      description: "merge_five_look_spa.py · ≥2 看要总册时",
    }),

    mind("ann-single", "单看任务：跳过规划与合并，直接跑对应 Skill", {
      x: SIDE_X,
      y: y(1),
      width: 300,
      height: 52,
      mindKind: "annotation",
      mindShape: "underline",
      mindColor: "#94a3b8",
      fontSize: 13,
    }),
    mind("ann-reddit", "Reddit 可与 A/B/D 并行抓取", {
      x: SIDE_X,
      y: y(8),
      width: 260,
      height: 52,
      mindKind: "annotation",
      mindShape: "underline",
      mindColor: "#94a3b8",
      fontSize: 13,
    }),

    preview(
      "preview-five-delivery",
      "五看交付清单.md",
      deliveryPreview,
      centerX(420),
      y(11) + 20,
      420,
      420,
      "五看交付清单.md",
    ),
  ];

  const connections = [
    conn("e-root-p0", "five-root", "five-p0"),
    conn("e-p0-p05", "five-p0", "five-p05"),
    conn("e-p05-a", "five-p05", "five-a"),
    conn("e-a-b", "five-a", "five-b"),
    conn("e-b-gate", "five-b", "gate-boss"),
    conn("e-gate-d-yes", "gate-boss", "five-d", "是"),
    conn("e-gate-d-no", "gate-boss", "boss-no", "否", "right", "left"),
    conn("e-d-gate2", "five-d", "gate-reviews"),
    conn("e-gate-c-yes", "gate-reviews", "five-c", "是"),
    conn("e-gate-c-no", "gate-reviews", "reviews-no", "否", "right", "left"),
    conn("e-c-e", "five-c", "five-e"),
    conn("e-e-f", "five-e", "five-f"),
    conn("e-f-preview", "five-f", "preview-five-delivery"),

    // 看宏观子链：主链 → ①，再竖向串行
    conn("e-a-ma1", "five-a", "ma-1", undefined, "right", "left"),
    conn("e-ma1-2", "ma-1", "ma-2"),
    conn("e-ma2-3", "ma-2", "ma-3"),
    conn("e-ma3-4", "ma-3", "ma-4"),
    conn("e-ma4-5", "ma-4", "ma-5"),
    conn("e-ma5-6", "ma-5", "ma-6"),
    conn("e-ma6-7", "ma-6", "ma-7"),

    annConn("e-ann-single", "ann-single", "five-p0"),
    annConn("e-ann-reddit", "ann-reddit", "five-c"),
  ];

  return {
    title: "运营五看·链路导图",
    nodes,
    connections,
    // 对准看宏观 + 右侧步骤，保证可读
    viewport: { x: 40, y: -80, k: 0.68 },
    updatedAt: new Date().toISOString(),
  };
}

function main() {
  const raw = fs.readFileSync(PROJECTS_PATH, "utf8");
  const data = JSON.parse(raw);
  const idx = data.state.projects.findIndex((p) => p.id === PROJECT_ID);
  if (idx < 0) {
    console.error("Project not found:", PROJECT_ID);
    process.exit(1);
  }
  const built = buildFiveLookMindMap();
  const prev = data.state.projects[idx];
  data.state.projects[idx] = {
    ...prev,
    title: built.title,
    nodes: built.nodes,
    connections: built.connections,
    viewport: built.viewport,
    updatedAt: built.updatedAt,
  };
  fs.writeFileSync(PROJECTS_PATH, JSON.stringify(data, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        projectId: PROJECT_ID,
        title: built.title,
        nodes: built.nodes.length,
        connections: built.connections.length,
        macroSteps: built.nodes.filter((n) => String(n.id).startsWith("ma-")).map((n) => n.metadata.content),
      },
      null,
      2,
    ),
  );
}

main();
