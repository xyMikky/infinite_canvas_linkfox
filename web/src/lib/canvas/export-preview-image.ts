import { saveAs } from "file-saver";
import { toPng } from "html-to-image";

import { canvasPaletteDark } from "@/lib/canvas/cursor-canvas-sdk/tokens";

export const SMART_PREVIEW_CAPTURE_ATTR = "data-smart-preview-capture";
export const SMART_PREVIEW_HTML_IFRAME_ATTR = "data-smart-preview-html-iframe";
export const SMART_PREVIEW_NODE_ATTR = "data-smart-preview-node";
export const SMART_PREVIEW_FULLSCREEN_ATTR = "data-smart-preview-fullscreen";

const HD_PIXEL_RATIO = 2;
/** 与报告页 .cr-page / 预览宿主一致，避免全屏导出时右侧大片空白 */
const REPORT_MAX_WIDTH = 920;

export function smartPreviewImageFileName(path: string) {
    const base = (path.split(/[\\/]/).pop() || "").trim() || "preview";
    const stem = base.replace(/\.(canvas\.tsx|tsx|html?|md|markdown|txt|csv|pdf|png|jpe?g|webp)$/i, "") || "preview";
    return `${stem}.png`;
}

function findByAttr(attr: string, nodeId: string): Element | null {
    if (typeof document === "undefined") return null;
    for (const el of document.querySelectorAll(`[${attr}]`)) {
        if (el.getAttribute(attr) === nodeId) return el;
    }
    return null;
}

function scopeForNode(nodeId: string): ParentNode | null {
    return findByAttr(SMART_PREVIEW_FULLSCREEN_ATTR, nodeId) || findByAttr(SMART_PREVIEW_NODE_ATTR, nodeId);
}

function resolveCaptureTarget(scope: ParentNode): HTMLElement | null {
    const capture = scope.querySelector(`[${SMART_PREVIEW_CAPTURE_ATTR}]`) as HTMLElement | null;
    if (capture) return capture;
    const iframe = scope.querySelector(`iframe[${SMART_PREVIEW_HTML_IFRAME_ATTR}]`) as HTMLIFrameElement | null;
    if (!iframe) return null;
    try {
        const doc = iframe.contentDocument;
        const body = doc?.body;
        if (!body) return null;
        const page = body.querySelector(".cr-page") as HTMLElement | null;
        return page || body;
    } catch {
        return null;
    }
}

/** 导出宽度：不超过报告栏，且不低于内容实际占用（避免仍按视口全宽出图） */
function resolveExportWidth(target: HTMLElement, maxWidth = REPORT_MAX_WIDTH) {
    const measured = Math.ceil(Math.max(target.scrollWidth, target.offsetWidth, 1));
    return Math.min(measured, maxWidth);
}

export async function exportElementToPng(input: {
    target: HTMLElement;
    fileName: string;
    backgroundColor?: string;
    maxWidth?: number;
}) {
    const backgroundColor = input.backgroundColor || input.target.dataset.canvasPreviewBackground || canvasPaletteDark.editor;
    const width = resolveExportWidth(input.target, input.maxWidth);
    const height = Math.ceil(Math.max(input.target.scrollHeight, input.target.offsetHeight, 1));
    const dataUrl = await toPng(input.target, {
        pixelRatio: HD_PIXEL_RATIO,
        cacheBust: true,
        backgroundColor,
        width,
        height,
        style: {
            width: `${width}px`,
            maxWidth: `${width}px`,
            height: "auto",
            maxHeight: "none",
            overflow: "visible",
            margin: "0",
        },
    });
    const blob = await (await fetch(dataUrl)).blob();
    saveAs(blob, input.fileName.endsWith(".png") ? input.fileName : `${input.fileName}.png`);
}

export async function exportSmartPreviewImage(input: {
    nodeId: string;
    path?: string;
    backgroundColor?: string;
}) {
    const scope = scopeForNode(input.nodeId);
    if (!scope) throw new Error("preview-not-found");
    const target = resolveCaptureTarget(scope);
    if (!target) throw new Error("capture-target-missing");
    const uiBoard = Boolean(scope.querySelector("[data-html-design-board]"));
    const tools = uiBoard ? target.ownerDocument.querySelector<HTMLStyleElement>("style[data-infinite-ui-tools]") : null;
    const disabled = tools?.disabled;
    if (tools) tools.disabled = true;
    try {
        const pageBackground = uiBoard ? target.ownerDocument.defaultView?.getComputedStyle(target).backgroundColor : undefined;
        await exportElementToPng({
            target,
            fileName: smartPreviewImageFileName(input.path || ""),
            backgroundColor: input.backgroundColor || pageBackground,
            ...(uiBoard ? { maxWidth: Math.max(target.ownerDocument.documentElement.clientWidth, 1) } : {}),
        });
    } finally {
        if (tools) tools.disabled = disabled || false;
    }
}
