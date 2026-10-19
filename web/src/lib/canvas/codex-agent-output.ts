import { nanoid } from "nanoid";
import * as XLSX from "xlsx";

import { buildAddFolderNodeOp } from "@/components/canvas/nodes/folder-node";
import { buildAddSmartPreviewNodeOp } from "@/components/canvas/nodes/smart-preview-node";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { CURSOR_REPORT_STYLE_GUIDE } from "@/lib/canvas/cursor-report-html";
import { isCanvasTsxFileName, parseFolderPreviewFile, stashFolderPreviewSources, upsertFolderPreviewFile } from "@/lib/canvas/folder-preview-cache";
import { CanvasNodeType, type CanvasFolderEntry } from "@/types/canvas";

export type CodexAgentFile = { name: string; ext: string; content: string };

/** 与系统提示里的协议一致；正文里可以正常出现 ``` 代码围栏 */
const FILE_BLOCK = /<<<FILE:\s*([^\n>]+?)\s*>>>\r?\n([\s\S]*?)\r?\n?<<<END>>>/g;
const TEXT_EXTS = new Set(["md", "markdown", "txt"]);
const FOLDER_GAP = 96;
const PREVIEW_GAP = 64;
const FOLDER_WIDTH = 300;

/**
 * 联网执行档：开放网络与命令权限，让 Codex 按上游 Skill 真正把活干完，产物统一落到 outputDir。
 * 画布随后把该目录挂成文件夹节点，所以这里不使用文件块协议。
 */
export function buildCodexAgentExecutionPrompt(input: { nodeId: string; userPrompt: string; hasReferences: boolean; outputDir: string; skillName?: string; referenceCanvasNodeIds?: string[] }) {
    const refIds = (input.referenceCanvasNodeIds || []).filter(Boolean);
    return [
        "【系统设定 · Infinite Canvas Codex 智能节点 · 联网执行档】",
        `你是画布工作流中的一个执行节点（sourceNodeId=${input.nodeId}）。本轮已开放网络访问与命令执行权限，你要真正把任务做完，而不是只写一份说明。`,
        "",
        "── 读输入（禁止先读整张画布）──",
        "1. 本节点上游连线、@引用、附件已注入下方「用户要求与输入资料」；这就是全部任务输入。",
        "2. 禁止调用 canvas_get_state / canvas_export_snapshot 读取整张画布（会把无关的几十上百个节点灌进上下文，浪费且干扰）。",
        "3. 禁止为了“了解情况”先扫画布；只有用户明确要求改布局/查全布结构时才可读取画布。",
        "4. 表格以 TSV 给出：一行一条记录，列之间用制表符分隔，第一行通常是表头。",
        "5. 上游文件夹若给出「本地绝对路径」，必须直接读取该路径（含子目录）；不要把文件夹逻辑名当成工作区根目录下的相对路径去搜索。",
        "6. Skill 若要求某个工具（例如浏览器 MCP）而当前环境没有，就换等效手段达成同一目标，并在最后说明你实际用了什么通道。",
        input.hasReferences ? "7. 附件里的图片也是输入资料，直接结合画面内容理解任务，不要再去画布里找同一张图。" : "",
        refIds.length
            ? `8. 上游参考图已在画布，节点 ID：${refIds.join(", ")}。生图时必须把这些 ID 直接传给 canvas_generate_image.referenceNodeIds，禁止 canvas_create_attachment_nodes 再复制一份。`
            : "",
        input.skillName ? `${refIds.length ? "9" : "8"}. 本轮还加载了 Skill「${input.skillName}」，一并遵守。` : "",
        "",
        "── 执行 ──",
        "1. 允许联网抓取、执行命令、运行与安装脚本依赖，按任务需要自行决定步骤。",
        "2. 数据真实性零容忍：只写真正拿到的数据，禁止估算、补全、编造。",
        "3. 确实拿不到数据时，不要产出空壳文件，直接在总结里说明失败原因和已经尝试过的手段。",
        "4. 用户要求用画布模型生图（如 banana / RunningHub / 低价渠道版等）时：",
        "   - 必须调用 `canvas_generate_image`，并传 `anchorNodeId=" + input.nodeId + "`（本智能节点）。",
        refIds.length
            ? `   - referenceNodeIds 必须使用已有上游节点：[${refIds.join(", ")}]，不要先创建附件副本。`
            : "   - 可同时传 `referenceNodeIds`；仅当图片还不是画布节点时才先 `canvas_create_attachment_nodes`。",
        "   - 调用成功后画布会立刻在本节点右侧出现「生成中」占位框；禁止说「等生成完再放到画布/交付目录」。",
        "   - 不要用 `workbench_image_*`，不要自己建空图节点，不要把画布生图主结果再复制到交付目录当主交付。",
        "   - 占位节点会自己变成成图，不要反复轮询 `generation_get_status`（最多查 1 次确认；不要连续查 2–3 次）。「失败 0」只是计数文案；running≥1 时继续等画布节点即可。",
        "   - 若返回「当前不在画布页」/「没有已连接画布」：同一参数最多再试 1 次；仍失败则停止并说明需用户确认画布已打开且 Codex 已连接。禁止 site_navigate、canvas_list_projects、浏览器 js、读源码、查端口来「修连接」。",
        "",
        "── 产物 ──",
        `1. 非画布生图的交付文件（xlsx/csv/md/html 等）写到目录：${input.outputDir}（不存在就自己创建）。Skill 规定了别的归档目录时，也要把最终产物复制一份到这里。`,
        "2. 画布 `canvas_generate_*` 产出的图片/视频已在画布占位节点上更新，不必再写入上述目录。",
        "3. 全部写完后，用一段话说明你做了什么、产出了哪些文件/节点。不要输出 <<<FILE:...>>> 文件块。",
        "",
        "── 用户要求与输入资料 ──",
        input.userPrompt.trim(),
    ]
        .filter(Boolean)
        .join("\n");
}

/** Codex 智能体模式内置技能：规范输入理解、产物选型、质量红线与输出协议 */
export function buildCodexAgentSystemPrompt(input: { nodeId: string; userPrompt: string; hasReferences: boolean; skillName?: string }) {
    return [
        "【系统设定 · Infinite Canvas Codex 智能节点】",
        `你是画布工作流中的一个执行节点（sourceNodeId=${input.nodeId}）。上游把资料交给你，你思考后产出文件，文件会直接变成画布上的下游节点。`,
        "核心信条：你交付的是**成品文件**，不是聊天回复。读者拿到文件就能直接用，不需要再问你一句话。",
        "",
        "── Step 1 · 读输入（禁止先读整张画布）──",
        "1. 本节点上游连线、@引用、附件已注入下方「用户要求与输入资料」；这就是全部任务输入。",
        "2. 禁止调用 canvas_get_state / canvas_export_snapshot 读取整张画布。不要为了“确认输入”去扫全布节点。",
        "3. 只有用户明确要求查看/修改整张画布布局时，才允许读取画布；普通写提示词、分析、改文件任务一律禁止。",
        "4. 表格以 TSV 给出：一行一条记录，列之间用制表符分隔，第一行通常是表头。按列位置严格对齐理解，空单元格表示该项缺失。",
        "5. 字段盘点：动手前先过一遍每个字段属于哪种形态（单值指标 / 时间序列 / 类目排名 / 占比构成 / 区间分布 / 多维明细 / 文本），并想清楚它的去向。",
        "6. 信息利用率：每个字段要么被用上，要么在产物里写明为什么没用。不许悄悄丢字段——那是在浪费用户已经采集到的信息。",
        "7. 数据真实性零容忍：每个数字都必须能在输入里找到出处。缺失就写「—」或「无数据」，禁止估算、补全、外推、凑整。",
        "8. 上游文件夹会给出本地路径。需要读文件时优先使用该绝对路径，不要在工作区根目录按文件夹名盲目搜索。",
        input.hasReferences ? "9. 附件里的图片也是输入资料，直接结合画面内容理解任务，不要再去画布里找同一张图。" : "",
        input.skillName ? `10. 本轮加载了 Skill「${input.skillName}」，按它的专业要求执行；与下面的产物选型和输出协议冲突时，以输出协议为准。` : "",
        "",
        "── Step 2 · 选产物形式 ──",
        "先判断读者要什么，再决定产出什么。对照下表选，拿不准就选 .md：",
        "  结论 / 分析报告 / 方案 / 说明文档            → .md",
        "  需要被后续节点继续加工的纯文本片段            → .txt",
        "  行列数据 / 清洗结果 / 汇总透视 / 对照表       → .csv（画布会渲染成 Excel 表格）",
        "  图表 / 看板 / KPI / 转化漏斗 / 可视化浏览     → .html（Cursor 报告风格）或 .canvas.tsx",
        "常见搭配：数据分析类任务给「.md 结论 + .csv 明细」两个文件；看板/漏斗/KPI 报告给单个 .html。",
        "反面案例：把几十行数据塞进 Markdown 表格（应该给 .csv）；为一句话结论做一个 HTML 页面（应该给 .md）。",
        "CSV 用纯数字列 + 表头带单位。",
        "HTML 看板必须是单文件、内联 CSS/SVG（可少量内联 JS），能离线双击打开；不要依赖外网图表 CDN（除非用户明确要求）。",
        CURSOR_REPORT_STYLE_GUIDE,
        "若任务是 UI 界面设计或交互原型：优先单文件 HTML，保留完整页面结构和真实响应式布局，不套用上面的报告版式。",
        "UI HTML 的可编辑标题、段落、按钮文字须在静态 HTML 中独立标记，并设置唯一稳定的 data-ui-text（例如 <span data-ui-text=\"hero-title\">标题</span>）。标记内仅含文字及换行 br，图标和强调标签放在外部；不要标记脚本生成/实时变化的文字或包含其他子标签的容器。",
        "UI 动效优先 CSS animations/transitions 或 Web Animations，正常响应悬停、点击与滚动，并尊重 prefers-reduced-motion；不要用定时器反复覆盖可编辑文案。后续修改以输入资料中最新的节点 HTML 为准，保留用户已改文案和 data-ui-text 标识。",
        "若产出 .canvas.tsx：单文件，仅允许 import 自 \"infinite-canvas\"，default export 组件，数据全部内联，禁止 fetch。",
        "",
        "── Step 3 · 输出协议 ──",
        "1. 直接产出，不要反问用户，不要解释过程，不要汇报你做了什么。",
        "2. 产物必须包在文件块里，文件块之外不允许有任何文字：",
        "<<<FILE:文件名.扩展名>>>",
        "文件正文",
        "<<<END>>>",
        "3. 一轮最多 3 个文件块；扩展名只能是 .md / .txt / .csv / .html / .canvas.tsx。",
        "4. 文件名用英文、数字、- 和 _，要能看出内容，不要带目录分隔符（.canvas.tsx 例外保留该后缀）。",
        "5. 正文里可以正常使用 ``` 代码围栏；但正文中不得出现 <<<FILE: 或 <<<END>>> 这两个标记。",
        "",
        "【禁止】调用 image_gen 生图、修改仓库文件、发起网页搜索、执行与本任务无关的命令、调用 canvas_get_state / canvas_export_snapshot。",
        "",
        "── 用户要求与输入资料 ──",
        input.userPrompt.trim(),
    ]
        .filter(Boolean)
        .join("\n");
}

export function parseCodexAgentOutput(text: string): CodexAgentFile[] {
    const files: CodexAgentFile[] = [];
    for (const match of text.matchAll(FILE_BLOCK)) {
        const name = sanitizeFileName(match[1]);
        const content = match[2].replace(/\s+$/, "");
        if (!name || !content.trim()) continue;
        files.push({ name, ext: agentFileExt(name), content });
    }
    return files;
}

function agentFileExt(name: string) {
    if (isCanvasTsxFileName(name)) return "canvas.tsx";
    return name.split(".").pop()?.toLowerCase() || "md";
}

/** Codex 没按协议输出时，整段回复当成一篇 Markdown */
export function codexAgentFallbackFiles(text: string): CodexAgentFile[] {
    const content = text.trim();
    return content ? [{ name: "result.md", ext: "md", content }] : [];
}

/**
 * 纯文本/Markdown 单文件 → 文本节点；其余（表格、HTML、多文件）→ 文件夹节点 + 智能预览节点。
 */
export async function applyCodexAgentFilesToCanvas(input: {
    applyOps: (ops: CanvasAgentOp[]) => unknown;
    source: { id: string; position: { x: number; y: number }; width: number; height: number };
    files: CodexAgentFile[];
    title: string;
}) {
    const { applyOps, source, files } = input;
    if (!files.length) return { kind: "none" as const, count: 0, nodeIds: [] as string[], previewNodeId: "" };
    const baseX = source.position.x + source.width + FOLDER_GAP;
    const baseY = source.position.y;

    if (files.length === 1 && TEXT_EXTS.has(files[0].ext)) {
        const file = files[0];
        const id = `text-${nanoid()}`;
        applyOps([
            {
                type: "add_node",
                id,
                nodeType: CanvasNodeType.Text,
                title: file.name,
                position: { x: baseX, y: baseY },
                metadata: {
                    content: file.content,
                    status: "success",
                    ...(file.ext === "txt" ? {} : { documentKind: "markdown" as const }),
                },
            },
            { type: "connect_nodes", id: `conn-${nanoid()}`, fromNodeId: source.id, toNodeId: id },
        ]);
        return { kind: "text" as const, count: 1, nodeIds: [id], previewNodeId: id };
    }

    const nodes = await mountAgentFolderNode({ ...input, files: files.map(materializeAgentFile) });
    return { kind: "folder" as const, count: files.length, ...nodes };
}

/** 联网执行档产物：把 Codex 写到磁盘的整个输出目录挂成文件夹节点 + 智能预览 */
export async function applyCodexAgentRunDirToCanvas(input: {
    applyOps: (ops: CanvasAgentOp[]) => unknown;
    source: { id: string; position: { x: number; y: number }; width: number; height: number };
    files: Array<{ path: string; file: File }>;
    title: string;
}) {
    if (!input.files.length) return { kind: "none" as const, count: 0, nodeIds: [] as string[], previewNodeId: "" };
    const nodes = await mountAgentFolderNode(input);
    return { kind: "folder" as const, count: input.files.length, ...nodes };
}

async function mountAgentFolderNode(input: {
    applyOps: (ops: CanvasAgentOp[]) => unknown;
    source: { id: string; position: { x: number; y: number }; width: number; height: number };
    files: Array<{ path: string; file: File }>;
    title: string;
}) {
    const { applyOps, source, files } = input;
    const baseX = source.position.x + source.width + FOLDER_GAP;
    const baseY = source.position.y;
    const folderId = `folder-${nanoid()}`;
    await stashFolderPreviewSources(folderId, files);
    // 同时写好解析缓存：HTML 与表格同时产出时源缓存会跳过 xlsx，预览会取不到
    for (const item of files) {
        const parsed = await parseFolderPreviewFile(item.file, item.path);
        if (parsed) await upsertFolderPreviewFile(folderId, parsed);
    }
    const entries: CanvasFolderEntry[] = files.map((item) => ({ path: item.path, name: item.path.split("/").pop() || item.path, kind: "file", size: item.file.size }));
    const previewId = `smart-preview-${nanoid()}`;
    applyOps([
        buildAddFolderNodeOp({
            id: folderId,
            folderName: input.title,
            entries,
            position: { x: baseX, y: baseY },
            totalBytes: entries.reduce((sum, entry) => sum + (entry.size || 0), 0),
        }),
        buildAddSmartPreviewNodeOp({ id: previewId, position: { x: baseX + FOLDER_WIDTH + PREVIEW_GAP, y: baseY }, title: entries[0]?.name }),
        { type: "connect_nodes", id: `conn-${nanoid()}`, fromNodeId: source.id, toNodeId: folderId },
        { type: "connect_nodes", id: `conn-${nanoid()}`, fromNodeId: folderId, toNodeId: previewId },
    ]);
    return { nodeIds: [folderId, previewId], previewNodeId: previewId };
}

/** CSV 转成 xlsx，智能预览才能按表格渲染而不是当纯文本 */
function materializeAgentFile(file: CodexAgentFile): { path: string; file: File } {
    if (file.ext === "csv") {
        try {
            const name = `${file.name.replace(/\.csv$/i, "")}.xlsx`;
            const workbook = XLSX.read(file.content, { type: "string" });
            const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
            return { path: name, file: new File([data], name) };
        } catch {
            // 解析失败时保留原始 CSV
        }
    }
    return { path: file.name, file: new File([file.content], file.name) };
}

function sanitizeFileName(raw: string) {
    const base = raw.replace(/\\/g, "/").split("/").pop()?.trim() || "";
    const safe = base.replace(/["*:<>?|]/g, "").trim();
    if (!safe) return "";
    return /\.[a-z0-9]+$/i.test(safe) ? safe : `${safe}.md`;
}
