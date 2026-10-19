import { FOLDER_NODE_TYPE } from "@/components/canvas/nodes/folder-node";
import { parseSkillMarkdown } from "@/lib/canvas/codex-skill-drop";
import { excelSheetTextForAi, rowsToTsv } from "@/lib/canvas/document-drop";
import { folderDiskPathPromptBlock, resolveFolderDiskPathFromNode, resolveSkillMdPath } from "@/lib/canvas/folder-disk-path";
import { loadFolderPreviewSources } from "@/lib/canvas/folder-preview-cache";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

/** 与 smart-preview-node 中 SMART_PREVIEW_NODE_TYPE 保持一致，避免循环依赖 */
const SMART_PREVIEW_NODE_TYPE = "smart-preview";

/**
 * 智能预览已选中某个 Excel 工作表时的正文（仅该表，不含其它表）。
 * 优先用节点内完整 preview 网格，避免旧的 80×24 content 截断。
 * 未选表或非 Excel 时返回空串，调用方继续走文件夹透传等逻辑。
 */
export function getSmartPreviewSelectedSheetText(node: CanvasNodeData): string {
    if (node.type !== SMART_PREVIEW_NODE_TYPE) return "";
    const meta = node.metadata || {};
    if ((meta.smartPreviewKind || "") !== "excel") return "";
    const sheetIndex = typeof meta.smartPreviewSheetIndex === "number" ? meta.smartPreviewSheetIndex : -1;
    if (sheetIndex < 0) return "";

    const preview = Array.isArray(meta.excelPreview) ? meta.excelPreview : [];
    const rowCount = typeof meta.excelRowCount === "number" ? meta.excelRowCount : preview.length;
    const colCount = typeof meta.excelColCount === "number" ? meta.excelColCount : preview[0]?.length || 0;
    const content = preview.length
        ? excelSheetTextForAi({
              preview,
              content: String(meta.content || ""),
              rowCount,
              colCount,
              contentTruncated: rowCount > preview.length || colCount > (preview[0]?.length || 0),
          })
        : String(meta.content || "").trim();
    if (!content) return "";
    const sheetName = String(meta.smartPreviewSheetName || "").trim();
    return sheetName ? `[${sheetName}]\n${content}` : content;
}

/** 供对话导入等场景：智能预览节点的可读文本（Excel 走选定工作表全文） */
export function getSmartPreviewComposerText(node: CanvasNodeData): string {
    if (node.type !== SMART_PREVIEW_NODE_TYPE) return "";
    const kind = String(node.metadata?.smartPreviewKind || "");
    // pdf/图片无可靠纯文本；html/canvasTsx 用节点缓存正文（画布已预览到的源码）
    if (kind === "pdf" || kind === "image") return "";
    if (kind === "html" || kind === "canvasTsx") {
        return String(node.metadata?.content || "").trim();
    }
    if (kind === "model3d") {
        const name = String(node.metadata?.smartPreviewPath || node.title || "").split(/[\\/]/).pop() || "model";
        const labeled = String(node.metadata?.content || "").trim();
        return labeled || `3D 模型：${name}`;
    }
    const sheetText = getSmartPreviewSelectedSheetText(node);
    if (sheetText) return sheetText;
    const preview = Array.isArray(node.metadata?.excelPreview) ? node.metadata.excelPreview : [];
    if (preview.length) return rowsToTsv(preview);
    return String(node.metadata?.content || "").trim();
}

/** 文件夹节点，或智能预览透传的上游文件夹（已选 Excel 工作表时不透传整夹） */
export function resolveFolderSourceNode(
    node: CanvasNodeData,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
): CanvasNodeData | null {
    if (node.type === FOLDER_NODE_TYPE) return node;
    if (node.type !== SMART_PREVIEW_NODE_TYPE) return null;
    if (getSmartPreviewSelectedSheetText(node)) return null;

    const proxyId = (node.metadata?.proxyFolderNodeId || "").trim();
    if (proxyId) {
        const proxied = nodes.find((item) => item.id === proxyId && item.type === FOLDER_NODE_TYPE);
        if (proxied) return proxied;
    }

    for (const connection of connections) {
        if (connection.toNodeId !== node.id) continue;
        const upstream = nodes.find((item) => item.id === connection.fromNodeId);
        if (upstream?.type === FOLDER_NODE_TYPE) return upstream;
    }
    return null;
}

export function folderInputSummary(folder: CanvasNodeData) {
    const folderName = String(folder.metadata?.folderName || folder.title || "").trim() || folder.id;
    const entryCount = folder.metadata?.folderEntryCount ?? folder.metadata?.folderEntries?.length ?? 0;
    return {
        folderName,
        entryCount,
        text: `文件夹：${folderName}${entryCount ? `（${entryCount} 项）` : ""}`,
        isSkillFolder: (folder.metadata?.folderEntries || []).some((entry) => entry.kind === "file" && /^skill\.md$/i.test(entry.name)),
        /** SKILL.md frontmatter 解析出的技能名，可能与文件夹名不同 */
        skillName: String(folder.metadata?.folderSkillName || "").trim(),
    };
}

/** 对话/隐式选中：文件夹清单 + 本地路径，供 Codex 只读访问 */
export function folderComposerContextText(folder: CanvasNodeData) {
    const summary = folderInputSummary(folder);
    const diskPath = resolveFolderDiskPathFromNode(folder);
    const skillDesc = String(folder.metadata?.folderSkillDescription || "").trim();
    const truncated = Boolean(folder.metadata?.folderTruncated);
    const topLevelDirs = folder.metadata?.folderTopLevelDirs || [];
    const files = (folder.metadata?.folderEntries || []).filter((entry) => entry.kind === "file").slice(0, 80);
    const fileList = files.length && !topLevelDirs.length ? `文件列表（至多 80 条）：\n${files.map((entry) => `- ${entry.path}`).join("\n")}` : "";
    return folderDiskPathPromptBlock({
        folderName: summary.folderName,
        diskPath,
        entryCount: summary.entryCount,
        truncated,
        topLevelDirs,
        skillDescription: skillDesc,
        fileList,
    });
}

const INLINE_TEXT_EXT = /\.(html?|md|markdown|txt|csv|tsv|json|js|mjs|cjs|css|svg|xml|ts|tsx)$/i;
const MAX_INLINE_FILE_CHARS = 60_000;
const MAX_INLINE_TOTAL_CHARS = 120_000;
const MAX_SKILL_CATALOG_ITEMS = 250;
const MAX_SKILL_DESC_CHARS = 240;
const MAX_SKILL_CATALOG_CHARS = 80_000;

function joinDiskPath(root: string, ...parts: string[]) {
    const sep = root.includes("\\") ? "\\" : "/";
    return `${root.replace(/[/\\]+$/, "")}${sep}${parts.join(sep)}`;
}

async function readDiskText(filePath: string): Promise<string> {
    const desktop = window.desktopAPI;
    if (!desktop?.readFile) return "";
    const result = await desktop.readFile(filePath).catch(() => null);
    if (!result?.ok || !result.dataBase64) return "";
    try {
        const binary = atob(result.dataBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    } catch {
        return "";
    }
}

/** 桌面端发送前预读各子 Skill 的 SKILL.md 摘要（Codex 沙箱通常读不到工作区外路径） */
export async function folderComposerSkillCatalogText(folder: CanvasNodeData): Promise<string> {
    const dirs = folder.metadata?.folderTopLevelDirs || [];
    const root = resolveFolderDiskPathFromNode(folder);
    if (!dirs.length || !root) return "";
    const lines: string[] = [`【Skill 目录摘要（预读各子目录 SKILL.md，共 ${dirs.length} 个文件夹）】`];
    let total = lines[0].length;
    let withSkill = 0;
    const slice = dirs.slice(0, MAX_SKILL_CATALOG_ITEMS);
    for (let offset = 0; offset < slice.length; offset += 16) {
        const batch = slice.slice(offset, offset + 16);
        const rows = await Promise.all(
            batch.map(async (dir) => {
                const raw = await readDiskText(joinDiskPath(root, dir, "SKILL.md"));
                if (!raw) return `- ${dir}：（无 SKILL.md）`;
                const parsed = parseSkillMarkdown(raw, dir);
                if (!parsed) return `- ${dir}：（SKILL.md 未解析）`;
                withSkill += 1;
                const desc =
                    parsed.description.length > MAX_SKILL_DESC_CHARS
                        ? `${parsed.description.slice(0, MAX_SKILL_DESC_CHARS)}…`
                        : parsed.description;
                const label = parsed.name !== dir ? `${parsed.name} / ${dir}` : parsed.name;
                return `- ${label}：${desc}`;
            }),
        );
        for (const row of rows) {
            if (total + row.length + 1 > MAX_SKILL_CATALOG_CHARS) {
                lines.push(`…（摘要已达字符上限，余下 Skill 请让用户指定子文件夹或单独连线）`);
                return [...lines, `（已解析 SKILL.md：${withSkill} 个）`].join("\n");
            }
            lines.push(row);
            total += row.length + 1;
        }
    }
    if (dirs.length > MAX_SKILL_CATALOG_ITEMS) {
        lines.push(`…（仅预读前 ${MAX_SKILL_CATALOG_ITEMS} 个，其余 ${dirs.length - MAX_SKILL_CATALOG_ITEMS} 个未列入）`);
    }
    lines.push(`（已解析 SKILL.md：${withSkill} 个；深入某一 Skill 时再读 ${root} 下对应子目录全文。）`);
    return lines.join("\n");
}

/** 单个 Skill 文件夹：预读根目录 SKILL.md 正文摘要（桌面版） */
export async function folderComposerSkillBodyText(folder: CanvasNodeData): Promise<string> {
    if (folder.metadata?.folderTopLevelDirs?.length) return "";
    const diskPath = resolveFolderDiskPathFromNode(folder);
    if (!diskPath || !window.desktopAPI?.readFile) return "";
    const raw = await readDiskText(resolveSkillMdPath(diskPath));
    if (!raw.trim()) return "";
    const parsed = parseSkillMarkdown(raw.slice(0, MAX_INLINE_FILE_CHARS), folder.metadata?.folderName || folder.title || "");
    if (!parsed) return "";
    const body = parsed.instructions.trim();
    if (!body) return "";
    const clipped = body.length > 12_000 ? `${body.slice(0, 12_000)}\n…（SKILL.md 正文已截断）` : body;
    return `【SKILL.md 正文：${parsed.name}】\n${clipped}`;
}

/** 文件夹附件发送前补充正文：Skill 摘要预读 + 无磁盘路径时的缓存内联 */
export async function folderComposerEnrichedPromptText(folder: CanvasNodeData, baseText: string): Promise<string> {
    const parts: string[] = [baseText.trim()];
    const catalog = await folderComposerSkillCatalogText(folder);
    if (catalog) parts.push(catalog);
    const skillBody = await folderComposerSkillBodyText(folder);
    if (skillBody) parts.push(skillBody);
    if (!resolveFolderDiskPathFromNode(folder)) {
        const inline = await folderComposerInlineFileTexts(folder);
        if (inline) parts.push(inline);
    }
    return parts.filter(Boolean).join("\n\n");
}

/** 未记录磁盘路径时（浏览器 / 局域网 / 路径解析失败），把已缓存的文本类源文件正文内联给对话 */
export async function folderComposerInlineFileTexts(folder: CanvasNodeData): Promise<string> {
    if (resolveFolderDiskPathFromNode(folder)) return "";
    const sources = await loadFolderPreviewSources(folder.id).catch(() => []);
    if (!sources.length) return "";
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let total = 0;
    for (const source of sources) {
        if (!INLINE_TEXT_EXT.test(source.name) || !source.data?.byteLength) continue;
        let text = "";
        try {
            text = decoder.decode(source.data).trim();
        } catch {
            continue;
        }
        if (!text) continue;
        if (text.length > MAX_INLINE_FILE_CHARS) text = `${text.slice(0, MAX_INLINE_FILE_CHARS)}\n…（已截断）`;
        if (total + text.length > MAX_INLINE_TOTAL_CHARS && parts.length) break;
        parts.push(`--- 文件正文：${source.path} ---\n${text}`);
        total += text.length;
    }
    return parts.join("\n\n");
}

export function isFolderLikeInputNode(node: CanvasNodeData) {
    if (node.type === FOLDER_NODE_TYPE) return true;
    if (node.type !== SMART_PREVIEW_NODE_TYPE) return false;
    if (getSmartPreviewSelectedSheetText(node)) return false;
    return Boolean((node.metadata?.proxyFolderNodeId || node.metadata?.proxyFolderName || "").trim());
}