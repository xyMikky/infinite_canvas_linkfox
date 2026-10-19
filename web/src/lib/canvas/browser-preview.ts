/**
 * 画布预览能力封装：标明各格式由「浏览器原生」还是「应用内解析」负责。
 * PDF / 音视频 / HTML / 图片 → 浏览器；Markdown / Excel / CSV / 文本 → 应用解析后自绘。
 */

import { isVectorPreviewFileName, parseVectorPreview, type VectorPreviewResult } from "@/lib/canvas/ai-eps-preview";

/** HTML 仍由浏览器运行；节点正文优先于文件夹缓存，保留编辑后的文案。 */
export async function createBrowserHtmlPreview(content: string, folderNodeId = "", path = "") {
    if (folderNodeId && path) {
        const { materializeHtmlProject } = await import("@/lib/canvas/folder-html-project");
        return materializeHtmlProject(folderNodeId, path, content, content || undefined);
    }
    const iframeSrc = URL.createObjectURL(new Blob([content], { type: "text/html;charset=utf-8" }));
    return { iframeSrc, assetCount: 0, revoke: () => URL.revokeObjectURL(iframeSrc) };
}

export type PreviewEngine =
    | "browser-pdf"
    | "browser-media"
    | "browser-html"
    | "browser-image"
    | "app-markdown"
    | "app-excel"
    | "app-csv"
    | "app-text"
    | "unsupported";

export type BrowserPreviewPayload =
    | { engine: "browser-pdf"; content: string; truncated: boolean }
    | { engine: "browser-image"; content: string; truncated: boolean }
    | { engine: "unsupported"; reason?: string };

/** data:/blob: PDF → object URL，供浏览器 PDF 查看器嵌入（避免 data: iframe 白屏） */
export function pdfDataUrlToObjectUrl(dataUrl: string): string | null {
    const trimmed = (dataUrl || "").trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("blob:")) return trimmed;
    const match = trimmed.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
    if (!match) return null;
    const mime = (match[1] || "application/pdf").trim() || "application/pdf";
    const isBase64 = Boolean(match[2]);
    const payload = match[3] || "";
    try {
        let bytes: Uint8Array;
        if (isBase64) {
            const binary = atob(payload);
            bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        } else {
            const decoded = decodeURIComponent(payload);
            bytes = new Uint8Array(decoded.length);
            for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i);
        }
        const type = mime.includes("pdf") ? "application/pdf" : mime;
        return URL.createObjectURL(new Blob([bytes], { type }));
    } catch {
        return null;
    }
}

export function resolvePreviewEngine(fileName: string): PreviewEngine {
    const name = (fileName || "").trim();
    if (/\.(pdf)$/i.test(name)) return "browser-pdf";
    if (/\.(ai|eps)$/i.test(name)) return "browser-pdf"; // 优先 PDF 兼容体，否则降级为预览图
    if (/\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(name)) return "browser-image";
    if (/\.(mp4|webm|mov|mkv|m4v)$/i.test(name) || /\.(mp3|wav|flac|aac|ogg|m4a)$/i.test(name)) return "browser-media";
    if (/\.(html?|htm)$/i.test(name)) return "browser-html";
    if (/\.(md|markdown)$/i.test(name)) return "app-markdown";
    if (/\.(xlsx|xls)$/i.test(name)) return "app-excel";
    if (/\.(csv|tsv)$/i.test(name)) return "app-csv";
    if (/\.(txt)$/i.test(name)) return "app-text";
    return "unsupported";
}

export function isBrowserPreviewEngine(engine: PreviewEngine) {
    return engine === "browser-pdf" || engine === "browser-media" || engine === "browser-html" || engine === "browser-image";
}

/** 将向量/PDF 文件解析为浏览器可嵌入的 payload */
export async function prepareBrowserVectorPreview(file: File): Promise<BrowserPreviewPayload> {
    if (!isVectorPreviewFileName(file.name) && file.type !== "application/pdf") {
        return { engine: "unsupported" };
    }
    const preview: VectorPreviewResult = await parseVectorPreview(file);
    if (!preview?.content) return { engine: "unsupported", reason: "unreadable" };
    if (preview.kind === "image") return { engine: "browser-image", content: preview.content, truncated: preview.truncated };
    return { engine: "browser-pdf", content: preview.content, truncated: preview.truncated };
}
