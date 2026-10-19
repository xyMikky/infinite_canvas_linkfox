import { appendComposerFile, appendComposerText, mentionedComposerFileIds, removeComposerFileToken } from "@/lib/agent/composer-inline";
import { getDataUrlByteSize } from "@/lib/image-utils";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { folderComposerContextText, folderComposerEnrichedPromptText, getSmartPreviewComposerText } from "@/lib/canvas/folder-input-resolve";
import { resolveFolderDiskPathFromNode } from "@/lib/canvas/folder-disk-path";
import { buildMindMapOutlineText, isMindNode } from "@/lib/canvas/mind-map";
import { expandCanvasSelectionIds } from "@/lib/canvas/expand-canvas-selection";
import { getImageBlob, imageToDataUrl } from "@/services/image-storage";
import { useAgentStore, type AgentAttachment } from "@/stores/use-agent-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

function attachmentPayloadBytes(attachments: AgentAttachment[]) {
    return attachments.reduce((total, item) => {
        if (item.kind && item.kind !== "image") return total;
        return total + (item.dataUrl?.length || 0);
    }, 0);
}

const MAX_TEXT_CHARS = 8_000;
/** Excel 等工作表正文单独放宽，避免 101×34 这类表被二次截成「可视区」 */
const MAX_SMART_PREVIEW_CHARS = 120_000;
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_PAYLOAD_BYTES = 28 * 1024 * 1024;

function looksLikeAbsoluteDiskPath(path: string) {
    const value = path.trim();
    if (!value) return false;
    if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
    if (value.startsWith("\\\\")) return true;
    if (value.startsWith("/") && !value.startsWith("//")) return true;
    return false;
}

/** 右侧 Agent 底部对话框拖入区（画布节点拖入直接写入对话内容） */
export const CODEX_PANEL_DROP_ZONE_ATTR = "data-codex-composer-drop-zone";
/** @deprecated 等同底部对话框拖入区 */
export const CODEX_PANEL_CONNECT_ATTR = CODEX_PANEL_DROP_ZONE_ATTR;

/** 用矩形命中，避免 elementFromPoint 点到正在拖的节点本身 */
export function isPointOverCodexPanelDropZone(clientX: number, clientY: number) {
    if (typeof document === "undefined") return false;
    const { panelOpen, panelClosing } = useAgentStore.getState();
    if (!panelOpen || panelClosing) return false;
    const zone = document.querySelector<HTMLElement>(`[data-agent-panel-shell] [${CODEX_PANEL_DROP_ZONE_ATTR}="true"]`);
    if (!zone) return false;
    const rect = zone.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

export function isCodexPanelConnectTarget(clientX: number, clientY: number) {
    return isPointOverCodexPanelDropZone(clientX, clientY);
}

export type CanvasComposerSelection = {
    attachments: AgentAttachment[];
    textParts: string[];
    selectedCount: number;
    importedCount: number;
};

type ImageSource = {
    content: string;
    storageKey: string;
    mimeType: string;
    width: number;
    height: number;
    bytes: number;
};

function looksLikeBinaryUrl(value: string) {
    return value.startsWith("blob:") || value.startsWith("data:") || /^https?:\/\//i.test(value);
}

function resolveImageSource(node: CanvasNodeData): ImageSource {
    const meta = node.metadata || {};
    let content = String(meta.content || "").trim();
    let storageKey = String(meta.storageKey || "").trim();
    let mimeType = String(meta.mimeType || "").trim();
    let width = meta.naturalWidth || 0;
    let height = meta.naturalHeight || 0;
    let bytes = meta.bytes || 0;
    if ((!content && !storageKey) && Array.isArray(meta.images)) {
        const primary = meta.primaryImageId
            ? meta.images.find((item) => item.id === meta.primaryImageId)
            : meta.images.find((item) => item.content || item.storageKey);
        if (primary) {
            content = String(primary.content || "").trim();
            storageKey = String(primary.storageKey || "").trim();
            mimeType = primary.mimeType || mimeType;
            width = primary.naturalWidth || width;
            height = primary.naturalHeight || height;
            bytes = primary.bytes || bytes;
        }
    }
    return { content, storageKey, mimeType, width, height, bytes };
}

function isImageLikeNode(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Image || node.type === "codex-image") {
        const src = resolveImageSource(node);
        return Boolean(src.content || src.storageKey);
    }
    if (node.type === "smart-preview" && String(node.metadata?.smartPreviewKind || "") === "image") {
        const src = resolveImageSource(node);
        return Boolean(src.content || src.storageKey);
    }
    const content = String(node.metadata?.content || "");
    return content.startsWith("data:image");
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("read failed"));
        reader.readAsDataURL(blob);
    });
}

/** blob 无 mime 时 FileReader 会给出 data:application/octet-stream，需归一成 image/* */
function normalizeImageDataUrl(dataUrl: string, mimeHint?: string) {
    if (!dataUrl.startsWith("data:")) return dataUrl;
    if (dataUrl.startsWith("data:image/")) return dataUrl;
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return dataUrl;
    const header = dataUrl.slice(0, comma);
    const payload = dataUrl.slice(comma + 1);
    const mime = mimeHint?.startsWith("image/") ? mimeHint : "image/png";
    const isBase64 = header.includes(";base64");
    return `data:${mime}${isBase64 ? ";base64" : ""},${payload}`;
}

function textFromNode(node: CanvasNodeData, allNodes?: CanvasNodeData[], connections?: CanvasConnection[]): string {
    if (isMindNode(node)) {
        if (allNodes && connections) {
            const outline = buildMindMapOutlineText([node], allNodes, connections, { includeNodeIds: true });
            if (outline) return outline;
        }
        const content = String(node.metadata?.content || node.title || "").trim();
        return content ? `【思维导图主题：${content}】` : describeNodeFallback(node);
    }
    if (node.type === CanvasNodeType.Text) {
        const content = String(node.metadata?.content || "").trim();
        if (!content) return describeNodeFallback(node);
        const body = content.length > MAX_TEXT_CHARS ? `${content.slice(0, MAX_TEXT_CHARS)}\n…` : content;
        return `【画布文本：${node.title || "文本"}】\n${body}`;
    }
    if (node.type === "smart-preview") {
        const kind = String(node.metadata?.smartPreviewKind || "");
        if (kind === "image") return "";
        if (kind === "canvasTsx" || kind === "html") {
            const title = (node.title || "").trim() || (kind === "html" ? "HTML" : "项目文件");
            const path = String(node.metadata?.smartPreviewPath || "").trim();
            const content = String(node.metadata?.content || "").trim();
            if (content) {
                const body = content.length > MAX_SMART_PREVIEW_CHARS ? `${content.slice(0, MAX_SMART_PREVIEW_CHARS)}\n…` : content;
                return [
                    `【${kind === "html" ? "智能预览" : "项目文件"}：${title}】`,
                    looksLikeAbsoluteDiskPath(path) ? `本地路径：${path}` : "",
                    "```",
                    body,
                    "```",
                ]
                    .filter(Boolean)
                    .join("\n");
            }
            if (looksLikeAbsoluteDiskPath(path)) return `【项目文件：${title}】\n本地路径：${path}`;
            if (path) {
                return `【智能预览：${title}】\n画布已预览此文件，但未带本地绝对路径且无缓存正文；请用 canvas_get_state 读该节点，不要在工作区根目录搜索「${path}」。`;
            }
            return describeNodeFallback(node);
        }
        const content = getSmartPreviewComposerText(node);
        if (content) {
            const limit = kind === "excel" || kind === "csv" ? MAX_SMART_PREVIEW_CHARS : MAX_TEXT_CHARS;
            const body = content.length > limit ? `${content.slice(0, limit)}\n…` : content;
            return `【智能预览：${node.title || kind || "预览"}】\n${body}`;
        }
        const path = String(node.metadata?.smartPreviewPath || "").trim();
        if (looksLikeAbsoluteDiskPath(path)) return `【智能预览：${node.title || kind || "预览"}】\n本地路径：${path}`;
        return describeNodeFallback(node);
    }
    if (node.type === "folder") {
        return folderComposerContextText(node);
    }
    if (node.type === CanvasNodeType.Group) {
        const content = String(node.metadata?.content || node.metadata?.groupBundleText || "").trim();
        if (content) {
            const body = content.length > MAX_SMART_PREVIEW_CHARS ? `${content.slice(0, MAX_SMART_PREVIEW_CHARS)}\n…` : content;
            return `【数据组：${node.title || "分组"}】\n${body}`;
        }
        return describeNodeFallback(node);
    }
    if (node.type === CanvasNodeType.Config) {
        const prompt = String(node.metadata?.composerContent || node.metadata?.prompt || node.metadata?.content || "").trim();
        if (prompt) {
            const body = prompt.length > MAX_TEXT_CHARS ? `${prompt.slice(0, MAX_TEXT_CHARS)}\n…` : prompt;
            return `【配置节点：${node.title || "配置"}】\n${body}`;
        }
        return describeNodeFallback(node);
    }
    if (node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) {
        const title = (node.title || "").trim() || (node.type === CanvasNodeType.Video ? "视频" : "音频");
        const prompt = String(node.metadata?.prompt || "").trim();
        const mime = String(node.metadata?.mimeType || "").trim();
        const lines = [`【画布${node.type === CanvasNodeType.Video ? "视频" : "音频"}：${title}】`];
        if (mime) lines.push(`类型：${mime}`);
        if (prompt) lines.push(prompt.length > MAX_TEXT_CHARS ? `${prompt.slice(0, MAX_TEXT_CHARS)}\n…` : prompt);
        return lines.join("\n");
    }
    return describeNodeFallback(node);
}

function describeNodeFallback(node: CanvasNodeData): string {
    const title = (node.title || "").trim() || node.type;
    const prompt = String(node.metadata?.prompt || node.metadata?.composerContent || "").trim();
    const content = String(node.metadata?.content || "").trim();
    const lines = [`【画布节点：${title}】`, `类型：${node.type}`];
    if (prompt) {
        lines.push(prompt.length > MAX_TEXT_CHARS ? `${prompt.slice(0, MAX_TEXT_CHARS)}\n…` : prompt);
    } else if (content && !looksLikeBinaryUrl(content)) {
        lines.push(content.length > MAX_TEXT_CHARS ? `${content.slice(0, MAX_TEXT_CHARS)}\n…` : content);
    }
    return lines.join("\n");
}

async function attachmentFromImageNode(node: CanvasNodeData): Promise<AgentAttachment | null> {
    const src = resolveImageSource(node);
    try {
        let dataUrl = "";
        if (src.content.startsWith("data:")) {
            dataUrl = src.content;
        } else if (src.storageKey) {
            try {
                const blob = await getImageBlob(src.storageKey);
                if (blob) dataUrl = await blobToDataUrl(blob);
            } catch {
                /* fall through */
            }
        }
        if (!dataUrl) {
            dataUrl = await imageToDataUrl({
                url: src.content,
                dataUrl: "",
                storageKey: src.storageKey,
            });
        }
        if (!dataUrl?.startsWith("data:") && src.content && !src.content.startsWith("data:")) {
            try {
                dataUrl = await blobToDataUrl(await (await fetch(src.content)).blob());
            } catch {
                /* ignore */
            }
        }
        if (!dataUrl?.startsWith("data:")) return null;
        dataUrl = normalizeImageDataUrl(dataUrl, src.mimeType || undefined);
        if (!dataUrl.startsWith("data:image")) return null;
        const mime = dataUrl.slice(5, dataUrl.indexOf(";")) || src.mimeType || "image/png";
        const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
        // 必须用独立 dataUrl，禁止复用画布节点的 blob: URL（发送/移除附件时会 revoke，导致原图消失）
        return {
            id: `canvas-${node.id}`,
            name: `${(node.title || "canvas").slice(0, 40)}.${ext}`,
            type: mime,
            size: src.bytes || getDataUrlByteSize(dataUrl),
            width: src.width || 0,
            height: src.height || 0,
            url: dataUrl,
            dataUrl,
            kind: "image",
            canvasNodeId: node.id,
        };
    } catch {
        return null;
    }
}

function makeContextAttachment(input: {
    nodeId: string;
    name: string;
    kind: "file" | "folder" | "text";
    localPath?: string;
    promptText: string;
}): AgentAttachment {
    return {
        id: `canvas-${input.nodeId}`,
        name: input.name,
        type: input.kind === "folder" ? "application/x-canvas-folder" : input.kind === "file" ? "application/x-canvas-file" : "text/plain",
        size: 0,
        width: 0,
        height: 0,
        url: "",
        dataUrl: "",
        kind: input.kind,
        localPath: input.localPath || "",
        promptText: input.promptText,
        canvasNodeId: input.nodeId,
    };
}

/** 文件夹无磁盘路径时补上缓存正文；有磁盘路径时预读 Skill 目录摘要 */
async function enrichFolderRefWithInlineTexts(node: CanvasNodeData, ref: AgentAttachment): Promise<AgentAttachment> {
    if (node.type !== "folder") return ref;
    const promptText = await folderComposerEnrichedPromptText(node, ref.promptText || "");
    if (promptText === (ref.promptText || "").trim()) return ref;
    return { ...ref, promptText };
}

/** 文件夹 / 项目文件等：输入区用小节点，发送时展开为路径（优先）或短上下文 */
export function contextRefFromNode(node: CanvasNodeData): AgentAttachment | null {
    if (node.type === "folder") {
        const name = String(node.metadata?.folderName || node.title || "文件夹").trim() || "文件夹";
        const localPath = resolveFolderDiskPathFromNode(node);
        const promptText = folderComposerContextText(node);
        return makeContextAttachment({ nodeId: node.id, name, kind: "folder", localPath, promptText });
    }
    if (node.type === "smart-preview") {
        const previewKind = String(node.metadata?.smartPreviewKind || "");
        if (previewKind === "image") return null;
        const title = (node.title || "").trim() || previewKind || "预览";
        const storedPath = String(node.metadata?.smartPreviewPath || "").trim();
        const absPath = looksLikeAbsoluteDiskPath(storedPath) ? storedPath : "";
        const inline =
            previewKind === "html" || previewKind === "canvasTsx"
                ? String(node.metadata?.content || "").trim()
                : getSmartPreviewComposerText(node);
        if (inline) {
            const limit =
                previewKind === "excel" || previewKind === "csv" || previewKind === "html" || previewKind === "canvasTsx"
                    ? MAX_SMART_PREVIEW_CHARS
                    : MAX_TEXT_CHARS;
            const body = inline.length > limit ? `${inline.slice(0, limit)}\n…` : inline;
            const lines = [`【智能预览：${title}】`];
            if (absPath) lines.push(`本地绝对路径：${absPath}`);
            if (previewKind === "html" || previewKind === "canvasTsx") {
                lines.push("以下为画布节点已缓存的源码（优先据此分析；不要只在工作区根目录按文件名搜索）：", "```", body, "```");
            } else {
                lines.push(body);
            }
            return makeContextAttachment({ nodeId: node.id, name: title, kind: "file", localPath: absPath, promptText: lines.join("\n") });
        }
        if (absPath) {
            return makeContextAttachment({
                nodeId: node.id,
                name: title,
                kind: "file",
                localPath: absPath,
                promptText: `【项目文件：${title}】\n本地绝对路径：${absPath}\n请直接读取该绝对路径；不要把文件名当成工作区根目录下的相对路径去搜索。若沙箱读失败，请说明限制，并用 canvas_get_state 读取画布节点内容。`,
            });
        }
        if (storedPath) {
            return makeContextAttachment({
                nodeId: node.id,
                name: title,
                kind: "file",
                localPath: "",
                promptText: `【智能预览：${title}】\n画布上已有此预览，但未带本地绝对路径且节点内无缓存正文。请用 canvas_get_state 读取该节点 metadata.content，禁止在工作区根目录搜索「${storedPath}」。`,
            });
        }
        const fallback = textFromNode(node);
        if (!fallback) return null;
        return makeContextAttachment({ nodeId: node.id, name: title, kind: "file", localPath: "", promptText: fallback });
    }
    if (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Config || node.type === CanvasNodeType.Group) {
        const text = textFromNode(node);
        if (!text) return null;
        const title = (node.title || "").trim() || (node.type === CanvasNodeType.Group ? "数据组" : node.type === CanvasNodeType.Config ? "配置" : "文本");
        return makeContextAttachment({ nodeId: node.id, name: title, kind: "text", promptText: text });
    }
    if (node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) {
        const text = textFromNode(node);
        if (!text) return null;
        return makeContextAttachment({
            nodeId: node.id,
            name: (node.title || "").trim() || node.type,
            kind: "text",
            promptText: text,
        });
    }
    return null;
}

export function isImageAgentAttachment(item: AgentAttachment) {
    if (item.kind && item.kind !== "image") return false;
    return Boolean(item.dataUrl?.startsWith("data:image"));
}

export function expandComposerContext(attachments: AgentAttachment[]) {
    return attachments
        .filter((item) => !isImageAgentAttachment(item))
        .map((item) => {
            const text = String(item.promptText || "").trim();
            if (text) return text;
            const path = String(item.localPath || "").trim();
            if (path) return `【${item.name || "文件"}】\n本地路径：${path}`;
            return "";
        })
        .filter(Boolean)
        .join("\n\n");
}

/** 将指定/当前选中节点转为 Codex 对话框可用的图片附件与上下文小节点 */
export async function collectCanvasSelectionForComposer(
    snapshot: CanvasAgentSnapshot | null | undefined,
    options?: { nodeIds?: string[]; existingIds?: Set<string>; maxAttachments?: number; nodes?: CanvasNodeData[]; connections?: CanvasConnection[] },
): Promise<CanvasComposerSelection> {
    const selectedIds = options?.nodeIds || snapshot?.selectedNodeIds || [];
    const pool = options?.nodes || snapshot?.nodes || [];
    const idSet = new Set(expandCanvasSelectionIds(selectedIds, pool));
    const connections = options?.connections || snapshot?.connections || [];
    const nodes = pool.filter((node) => idSet.has(node.id));
    const existingIds = options?.existingIds || new Set<string>();
    const maxAttachments = options?.maxAttachments ?? MAX_ATTACHMENTS;
    const attachments: AgentAttachment[] = [];
    const textParts: string[] = [];
    let importedCount = 0;

    const mindSelected = nodes.filter(isMindNode);
    const mindCovered = new Set<string>();
    if (mindSelected.length) {
        const outline = buildMindMapOutlineText(mindSelected, pool, connections, { includeNodeIds: true });
        if (outline) {
            textParts.push(outline);
            importedCount += mindSelected.length;
            mindSelected.forEach((node) => mindCovered.add(node.id));
        }
    }

    for (const node of nodes) {
        if (mindCovered.has(node.id)) continue;
        if (isImageLikeNode(node)) {
            if (attachments.length + existingIds.size >= maxAttachments) {
                const text = textFromNode(node) || describeNodeFallback(node);
                textParts.push(text);
                importedCount += 1;
                continue;
            }
            if (existingIds.has(`canvas-${node.id}`)) {
                importedCount += 1;
                continue;
            }
            const attachment = await attachmentFromImageNode(node);
            if (attachment) {
                attachments.push(attachment);
                importedCount += 1;
                continue;
            }
            textParts.push(describeNodeFallback(node));
            importedCount += 1;
            continue;
        }
        const rawRef = contextRefFromNode(node);
        const ref = rawRef ? await enrichFolderRefWithInlineTexts(node, rawRef) : null;
        if (ref) {
            if (existingIds.has(ref.id) || attachments.some((item) => item.id === ref.id)) {
                importedCount += 1;
                continue;
            }
            if (attachments.length + existingIds.size >= maxAttachments) {
                if (ref.promptText) textParts.push(ref.promptText);
                importedCount += 1;
                continue;
            }
            attachments.push(ref);
            importedCount += 1;
            continue;
        }
        const text = textFromNode(node, pool, connections);
        if (!text) continue;
        textParts.push(text);
        importedCount += 1;
    }

    return { attachments, textParts, selectedCount: nodes.length, importedCount };
}

export function canvasNodeIdFromAttachment(item: Pick<AgentAttachment, "id" | "canvasNodeId">) {
    const explicit = String(item.canvasNodeId || "").trim();
    if (explicit) return explicit;
    if (item.id.startsWith("canvas-")) return item.id.slice("canvas-".length);
    return "";
}

export function withCanvasNodeId(item: AgentAttachment): AgentAttachment {
    const canvasNodeId = canvasNodeIdFromAttachment(item);
    return canvasNodeId && item.canvasNodeId !== canvasNodeId ? { ...item, canvasNodeId } : item;
}

/** 仅当前画布选中；不再回退上一轮附件，避免下一条消息自动带上上次的文件。 */
export async function resolveImplicitTurnContext(
    snapshot: CanvasAgentSnapshot | null | undefined,
): Promise<{ attachments: AgentAttachment[]; textParts: string[] }> {
    const selected = await collectCanvasSelectionForComposer(snapshot);
    return {
        attachments: selected.attachments.map(withCanvasNodeId),
        textParts: selected.textParts,
    };
}

/** @deprecated 仅图片；优先用 resolveImplicitTurnContext */
export async function resolveImplicitTurnAttachments(
    snapshot: CanvasAgentSnapshot | null | undefined,
): Promise<AgentAttachment[]> {
    const context = await resolveImplicitTurnContext(snapshot);
    return context.attachments.filter(isImageAgentAttachment);
}

/**
 * 选中变化时立刻写入输入区小节点（同步 peek），再异步补全图片 dataUrl。
 * 避免先闪「将随本条发送」预览条、再跳成芯片。
 */
export async function syncCanvasSelectionToComposer(
    snapshot: CanvasAgentSnapshot | null | undefined,
    options?: { isStale?: () => boolean },
): Promise<void> {
    applyCanvasAttachmentsToComposer(peekCanvasSelectionAttachments(snapshot).map((item) => ({ ...item, autoCanvasContext: true })));
    if (options?.isStale?.()) return;
    const selected = await collectCanvasSelectionForComposer(snapshot);
    if (options?.isStale?.()) return;
    applyCanvasAttachmentsToComposer(selected.attachments.map(withCanvasNodeId).map((item) => ({ ...item, autoCanvasContext: true })));
}

/** 同步可立刻展示的芯片：上下文节点 + 已有可预览 URL 的图片 */
export function peekCanvasSelectionAttachments(snapshot: CanvasAgentSnapshot | null | undefined): AgentAttachment[] {
    const selectedIds = snapshot?.selectedNodeIds || [];
    if (!selectedIds.length) return [];
    const idSet = new Set(expandCanvasSelectionIds(selectedIds, snapshot?.nodes || []));
    const attachments: AgentAttachment[] = [];
    for (const node of snapshot?.nodes || []) {
        if (!idSet.has(node.id)) continue;
        if (isImageLikeNode(node)) {
            const src = resolveImageSource(node);
            const previewUrl = src.content && (src.content.startsWith("data:") || src.content.startsWith("blob:") || /^https?:\/\//i.test(src.content))
                ? src.content
                : "";
            const dataUrl = previewUrl.startsWith("data:image") ? previewUrl : "";
            attachments.push({
                id: `canvas-${node.id}`,
                name: `${(node.title || "canvas").slice(0, 40)}.png`,
                type: dataUrl ? dataUrl.slice(5, dataUrl.indexOf(";")) || "image/png" : "image/png",
                size: src.bytes || 0,
                width: src.width || 0,
                height: src.height || 0,
                url: previewUrl || dataUrl,
                dataUrl,
                kind: "image",
                canvasNodeId: node.id,
            });
            continue;
        }
        const ref = contextRefFromNode(node);
        if (ref) attachments.push(ref);
    }
    return attachments.map(withCanvasNodeId);
}

function applyCanvasAttachmentsToComposer(canvasAttachments: AgentAttachment[]) {
    const store = useAgentStore.getState();
    const manual = store.attachments.filter((item) => !canvasNodeIdFromAttachment(item));
    let nextPrompt = store.prompt;
    for (const item of store.attachments) {
        if (!canvasNodeIdFromAttachment(item)) continue;
        nextPrompt = removeComposerFileToken(nextPrompt, item.id);
    }
    for (const item of canvasAttachments) nextPrompt = appendComposerFile(nextPrompt, item.id);
    const nextAttachments = [...manual, ...canvasAttachments];
    const same =
        nextAttachments.length === store.attachments.length
        && nextPrompt === store.prompt
        && nextAttachments.every((item, index) => {
            const prev = store.attachments[index];
            return prev
                && prev.id === item.id
                && prev.kind === item.kind
                && prev.localPath === item.localPath
                && prev.dataUrl === item.dataUrl
                && prev.url === item.url
                && prev.promptText === item.promptText;
        });
    if (same) return;
    store.setAgentState({ attachments: nextAttachments, prompt: nextPrompt });
}

export type ImplicitComposerPreviewItem = {
    id: string;
    kind: "image" | "folder" | "file" | "text" | "other";
    title: string;
    previewUrl?: string;
};

/** 同步预览：当前画布选中将在未手动附带文件时随本条发送的内容 */
export function collectImplicitComposerPreview(snapshot: CanvasAgentSnapshot | null | undefined): ImplicitComposerPreviewItem[] {
    const selectedIds = snapshot?.selectedNodeIds || [];
    if (!selectedIds.length) return [];
    const idSet = new Set(expandCanvasSelectionIds(selectedIds, snapshot?.nodes || []));
    const items: ImplicitComposerPreviewItem[] = [];
    for (const node of snapshot?.nodes || []) {
        if (!idSet.has(node.id)) continue;
        if (isImageLikeNode(node)) {
            const src = resolveImageSource(node);
            const previewUrl = src.content && (src.content.startsWith("data:") || src.content.startsWith("blob:") || /^https?:\/\//i.test(src.content))
                ? src.content
                : undefined;
            items.push({ id: node.id, kind: "image", title: (node.title || "").trim() || "图片", previewUrl });
            continue;
        }
        if (node.type === "folder") {
            items.push({
                id: node.id,
                kind: "folder",
                title: String(node.metadata?.folderName || node.title || "文件夹").trim() || "文件夹",
            });
            continue;
        }
        if (node.type === "smart-preview") {
            const kind = String(node.metadata?.smartPreviewKind || "");
            if (kind === "image") continue;
            items.push({
                id: node.id,
                kind: kind === "canvasTsx" ? "file" : kind === "excel" || kind === "csv" || kind === "text" || kind === "markdown" ? "file" : "other",
                title: (node.title || "").trim() || kind || "预览",
            });
            continue;
        }
        if (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Config || node.type === CanvasNodeType.Group) {
            items.push({ id: node.id, kind: "text", title: (node.title || "").trim() || node.type });
            continue;
        }
        if (node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) {
            items.push({ id: node.id, kind: "other", title: (node.title || "").trim() || node.type });
        }
    }
    return items;
}

export type ApplyCanvasToComposerResult =
    | { ok: true; count: number }
    | { ok: false; reason: "no-canvas" | "empty" | "too-large" | "error"; error?: string };

/** 把画布节点按顺序内联写入 Codex 输入区（图片/文件小节点），并打开对话页 */
export async function applyCanvasNodesToComposer(
    nodeIds: string[],
    options?: { nodes?: CanvasNodeData[] },
): Promise<ApplyCanvasToComposerResult> {
    const store = useAgentStore.getState();
    const snapshot = store.canvasContext?.snapshot;
    const liveNodes = options?.nodes;
    if (!snapshot && !liveNodes?.length) return { ok: false, reason: "no-canvas" };
    const ids = nodeIds.filter(Boolean);
    if (!ids.length) return { ok: false, reason: "empty" };
    try {
        const byId = new Map((snapshot?.nodes || []).map((node) => [node.id, node]));
        // 优先用实时 nodes（拖拽松手时 store 快照可能落后一帧）
        for (const node of liveNodes || []) byId.set(node.id, node);
        const allNodes = [...byId.values()];
        const connections = snapshot?.connections || [];
        const mergedAttachments = [...store.attachments];
        let nextPrompt = store.prompt;
        let importedCount = 0;
        const fileCountInPrompt = () => mentionedComposerFileIds(nextPrompt).length;
        const mindNodes = ids.map((id) => byId.get(id)).filter((node): node is CanvasNodeData => Boolean(node) && isMindNode(node));
        const mindCovered = new Set<string>();
        if (mindNodes.length) {
            const outline = buildMindMapOutlineText(mindNodes, allNodes, connections, { includeNodeIds: true });
            if (outline) {
                nextPrompt = appendComposerText(nextPrompt, outline);
                importedCount += mindNodes.length;
                mindNodes.forEach((node) => mindCovered.add(node.id));
            }
        }

        for (const id of ids) {
            const node = byId.get(id);
            if (!node || mindCovered.has(node.id)) continue;
            if (isImageLikeNode(node)) {
                if (fileCountInPrompt() >= MAX_ATTACHMENTS) {
                    nextPrompt = appendComposerText(nextPrompt, describeNodeFallback(node));
                    importedCount += 1;
                    continue;
                }
                const existing = mergedAttachments.find(
                    (item) => item.id === `canvas-${node.id}` || item.dataUrl === node.metadata?.content,
                );
                if (existing) {
                    if (!nextPrompt.includes(`@[file:${existing.id}]`)) nextPrompt = appendComposerFile(nextPrompt, existing.id);
                    importedCount += 1;
                    continue;
                }
                const attachment = await attachmentFromImageNode(node);
                if (attachment) {
                    mergedAttachments.push(attachment);
                    nextPrompt = appendComposerFile(nextPrompt, attachment.id);
                    importedCount += 1;
                    continue;
                }
                nextPrompt = appendComposerText(nextPrompt, describeNodeFallback(node));
                importedCount += 1;
                continue;
            }
            const rawRef = contextRefFromNode(node);
            const ref = rawRef ? await enrichFolderRefWithInlineTexts(node, rawRef) : null;
            if (ref) {
                const existing = mergedAttachments.find((item) => item.id === ref.id);
                if (existing) {
                    if (!nextPrompt.includes(`@[file:${existing.id}]`)) nextPrompt = appendComposerFile(nextPrompt, existing.id);
                    importedCount += 1;
                    continue;
                }
                if (fileCountInPrompt() >= MAX_ATTACHMENTS) {
                    nextPrompt = appendComposerText(nextPrompt, ref.promptText || describeNodeFallback(node));
                    importedCount += 1;
                    continue;
                }
                mergedAttachments.push(ref);
                nextPrompt = appendComposerFile(nextPrompt, ref.id);
                importedCount += 1;
                continue;
            }
            const text = textFromNode(node, allNodes, connections);
            if (!text) continue;
            nextPrompt = appendComposerText(nextPrompt, text);
            importedCount += 1;
        }

        if (!importedCount) return { ok: false, reason: "empty" };
        if (attachmentPayloadBytes(mergedAttachments) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
            return { ok: false, reason: "too-large" };
        }
        store.setAgentState({ attachments: mergedAttachments, prompt: nextPrompt });
        store.openPanel({ tab: "chat" });
        return { ok: true, count: importedCount };
    } catch (error) {
        return { ok: false, reason: "error", error: error instanceof Error ? error.message : String(error) };
    }
}
