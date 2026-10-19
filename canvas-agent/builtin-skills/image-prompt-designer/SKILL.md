---
name: image-prompt-designer
description: >-
  通用 AI 生图提示词方法论。仅当用户明确要求写/优化/体检生图提示词、提示词结构、参考图引用、色彩纪律，
  或只要 Prompt 不要实际调用生图 API 时使用。画布工作台默认生图/改图/图生图/文生图不要走本 Skill。
  覆盖 Nano Banana / Gemini / Midjourney / Flux / SDXL / DALL·E / Seedream 等通用结构与提交前自检。
  关键词：提示词方法论、prompt engineering、可迁移提示词、提示词优化、只写提示词。
---

# AI 生图提示词设计 · Image Prompt Designer

## 概述

本 Skill 是一个**自包含、可迁移**的 AI 生图提示词设计引擎。它把分散在多份规则里的"提示词怎么写"经验，收敛成一套可独立运行的方法论。

**设计目标**：

- **零外部依赖**——不引用任何主控中心、向量检索、案例库、品牌规范或其他项目私有文件；全部知识内化在本 Skill 的 `references/` 与 `assets/templates/` 内。
- **跨项目可迁移**——把整个 `image-prompt-designer/` 文件夹复制到任意 Codex skills 目录即可使用。
- **跨模型通用**——核心原则对 Nano Banana / Gemini / Midjourney / Flux / SDXL / DALL·E / Seedream 等主流模型都适用；模型特有语法在 `references/PROMPT_STRUCTURE.md` 中单列。

**它做什么**：构造 / 优化 / 体检生图提示词（img2img 与 txt2img）。
**它不做什么**：不实际调用生图 API、不评审已生成图片的审美、不管理案例库。

## 使用场景

- 用户说"帮我写 / 设计 / 优化一套生图提示词"
- 多张参考图合成（产品 + 版式 + 包装 / 人物 + 场景 + 服装）需要正确引用
- 电商产品图、海报、Banner、模特场景图、换背景、换装、风格转换
- 文生图概念探索
- 已有提示词翻车，需要按规范"体检"找问题

## 可配置项（迁移到新项目时先确认）

本 Skill 不锁死任何项目偏好，下列默认值可被项目约定或用户单轮指令覆盖：

| 配置项 | 默认 | 说明 |
|---|---|---|
| Prompt 主体语言 | 跟随用户工作语言 | 用户用中文交流就写中文主体；技术锚点永远保留原样（见下） |
| 默认背景 | 由用户/场景决定（电商常用纯白 `#ffffff`） | 不盲目继承参考图背景，详见 COLOR_AND_BACKGROUND.md |
| 默认比例 / 分辨率 | img2img `3:4` / txt2img `1:1` / `2k` | 用户指定即覆盖 |
| 结构标签 | 英文 `[TAG]` | token 更省，详见 PROMPT_STRUCTURE.md |

**技术锚点恒不翻译、不省略**：`image 1/2/3`、HEX 色号、`--aspect-ratio`/`--resolution` 等参数、文件路径、品牌名/Logo 文字、`BACKGROUND ONLY`/`PRODUCT ONLY` 等大写硬约束词。

## 工作流程

```
① 解析需求 → 判定 img2img / txt2img、参考图清单、画面目标
   ↓
② 规划结构 → 选六要素 + 英文结构标签骨架（PROMPT_STRUCTURE.md）
   ↓
③ 写参考图引用 → 每张 image N = 编号 + 借鉴维度，遵守过度描述陷阱（REFERENCE_IMAGE_PROTOCOL.md）
   ↓
④ 写色彩与背景 → 产品色独立 / 角色隔离 / 背景纪律，避开禁句（COLOR_AND_BACKGROUND.md）
   ↓
⑤ 通篇卫生 → 四铁律：去内部标识、去目录块、不复述参考图视觉、转正向表述（FOUR_IRON_LAWS.md）
   ↓
⑥ 提交前自检 → 跑一遍 PRE_SUBMIT_CHECKLIST.md，逐项 ✅ 再交付
   ↓
⑦ 交付 → 完整 Prompt 主体 + --images 清单 + 参数；多张图各自独立成段
```

复杂任务（≥3 个维度同时变 / 多图合成 / 实景图洗白底再合成）建议拆成**多步提示词序列**（如先洗背景 → 再合成），而非强塞进一条。

## 核心知识包（详见 references/）

| 文件 | 管什么 | 一句话铁律 |
|---|---|---|
| `references/FOUR_IRON_LAWS.md` | 提示词卫生四铁律 | Prompt 每个 token 都在和参考图抢注意力，别浪费 |
| `references/REFERENCE_IMAGE_PROTOCOL.md` | 参考图引用协议 | 传了图必引用，引用必带借鉴维度，不复述图里已有的东西 |
| `references/COLOR_AND_BACKGROUND.md` | 色彩纪律与背景策略 | 产品色只来自产品图，装饰色只染装饰，背景色单独裁决 |
| `references/PROMPT_STRUCTURE.md` | 结构 / 六要素 / 语言 / token | 主语言跟用户，结构标签用英文，锚点不翻译 |
| `references/PRE_SUBMIT_CHECKLIST.md` | 提交前自检清单 | 不自检不交付 |

模板：`assets/templates/prompt_template.md` 是填空式骨架，可直接套用。

## 使用方法

1. 收到提示词需求后，先按"可配置项"确认语言/背景/比例（多数可直接采用默认并说明）。
2. 复杂或多图任务，先读相关 reference（至少 REFERENCE_IMAGE_PROTOCOL.md + FOUR_IRON_LAWS.md）。
3. 用 `assets/templates/prompt_template.md` 起草，逐段填写。
4. 交付前对照 `references/PRE_SUBMIT_CHECKLIST.md` 自检，输出自检表。
5. 把完整 Prompt（中文/用户语言主体 + 技术锚点）+ `--images` 清单 + 参数一并交付。

## 示例（多图合成 · img2img）

```text
[LAYOUT — 来自 image 1]
完整复刻 image 1 的陈列版式骨架——白底对角分散布列、疏密节奏、留白比例、柔和接触投影、均匀棚拍光。

[PRODUCTS — 来自 image 2]
画面陈列的部件精确呈现 image 2 中的产品原样，颜色/材质/结构与 image 2 一致；以主体产品作画面主视觉，其余按 image 1 节奏环绕、互不重叠。

[PACKAGING — 来自 image 3]
右上角立一只 3/4 视角包装盒，盒面设计复刻 image 3；从实景环境中提取，置于同一纯白无缝背景。

[BACKGROUND]
干净纯白无缝背景，精确使用 #ffffff，明亮高调棚拍光，仅留极淡接触阴影。

[CAMERA & FOCUS]
微俯视 hero 陈列视角，整组清晰对焦、高解析细节。

--aspect-ratio 1:1
--resolution 2k
--images "image1路径" "image2路径" "image3路径"
```

为什么这样写：只说"呈现 image 2 原样"而不逐个复述部件（铁律三）；背景明确 HEX（背景纪律）；用"仅留极淡接触阴影"代替"不要杂物"（铁律四）；三张图都有 `image N` + 借鉴维度（引用协议）。

## 注意事项

- 本 Skill 只产出**提示词文本**，不调用任何生图工具/API。
- 迁移到其他项目时，无需改动任何路径——它不引用 Skill 外部文件。
- 与项目里可能已有的"生图业务编排 Skill"互补：本 Skill 专注"怎么写好提示词"这一层能力，可被其他 Skill 调用，也可单独使用。
- 模型差异（负向提示词、权重语法、风格关键词）见 `references/PROMPT_STRUCTURE.md` 的"模型差异速查"。
