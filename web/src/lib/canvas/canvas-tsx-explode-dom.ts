import { nanoid } from "nanoid";
import { toPng } from "html-to-image";

import { SMART_PREVIEW_NODE_TYPE } from "@/components/canvas/nodes/smart-preview-node";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { SMART_PREVIEW_CAPTURE_ATTR } from "@/lib/canvas/export-preview-image";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export const CANVAS_BLOCK_ATTR = "data-canvas-block";
export const CANVAS_CONNECT_ATTR = "data-canvas-connect";
export const SMART_PREVIEW_NODE_ATTR = "data-smart-preview-node";

export type MeasuredCanvasBlock = {
    id: string;
    title: string;
    html: string;
    imageDataUrl?: string;
    /** 含图表等需 React 悬停交互：裁剪活预览而非静态 HTML */
    live?: boolean;
    previewTheme?: "light" | "dark";
    sourceSize?: { width: number; height: number };
    x: number;
    y: number;
    width: number;
    height: number;
    connectTo: string[];
};

const GROUP_PAD = 28;
const MIN_BLOCK_W = 72;
const MIN_BLOCK_H = 36;
/** 全量覆盖拆分：小标题/文本行也保留 */
const MIN_FRAG_W = 24;
const MIN_FRAG_H = 14;
const FRAGMENT_PAD = 2;
/** 容器高于此值继续下钻拆分 */
const SPLIT_MIN_H = 420;
const MAX_SPLIT_DEPTH = 6;

function blockTitle(el: HTMLElement, fallback: string) {
    const heading = el.querySelector("h1,h2,h3,h4");
    if (heading?.textContent?.trim()) return heading.textContent.trim().slice(0, 48);
    const label = el.getAttribute("aria-label")?.trim();
    if (label) return label.slice(0, 48);
    // 图表图例会把「配送方式100FBA…」粘成一行，优先取较短的独立文本节点
    for (const node of Array.from(el.querySelectorAll("p, span, div, figcaption"))) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.children.length > 0) continue;
        const t = (node.textContent || "").trim();
        if (t.length >= 2 && t.length <= 24) return t.slice(0, 48);
    }
    const text = (el.textContent || "").trim().replace(/\s+/g, " ");
    const beforeDigits = text.match(/^([^\d]{2,24})/);
    if (beforeDigits) return beforeDigits[1].trim().slice(0, 48);
    if (text) return text.slice(0, 24);
    return fallback.slice(0, 48);
}

/** SDK 悬停容器、源码事件和图表必须保留 React，不能转成静态 HTML。 */
function isLiveChartBlock(el: HTMLElement) {
    const selector = "[data-canvas-live], .recharts-wrapper, .recharts-surface, [class*='recharts']";
    if (el.matches(selector) || el.querySelector(selector)) return true;
    for (const svg of Array.from(el.querySelectorAll("svg"))) {
        if (svg.querySelectorAll("path, circle, rect, polyline, polygon").length >= 4) return true;
    }
    return false;
}

function hasCardLikeStyle(el: HTMLElement) {
    const style = (el.getAttribute("style") || "").toLowerCase();
    if (style.includes("border")) return true;
    if (style.includes("borderradius") || style.includes("border-radius")) return true;
    if (style.includes("borderleft") || style.includes("border-left")) return true;
    if (style.includes("box-shadow") || style.includes("boxshadow")) return true;
    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_BLOCK_W || rect.height < MIN_BLOCK_H) return false;
    if (style.includes("background") && !style.includes("background: transparent") && !style.includes("background:transparent")) return true;
    return false;
}

/**
 * 自顶向下分段：整份内容全量覆盖（标题、指标行、图表区都保留），
 * 卡片/标记块直接成块，过高或以卡片为主的容器继续下钻。
 */
function collectBlockElements(capture: HTMLElement) {
    const captureW = Math.max(capture.offsetWidth, capture.clientWidth, 1);
    const captureH = Math.max(capture.offsetHeight, capture.scrollHeight, 1);
    const tooLarge = (el: Element) => {
        if (!(el instanceof HTMLElement)) return false;
        return el.offsetWidth > captureW * 0.9 && el.offsetHeight > captureH * 0.55;
    };
    const isBlockCandidate = (el: HTMLElement) => el.hasAttribute(CANVAS_BLOCK_ATTR) || hasCardLikeStyle(el);
    const visibleChildren = (el: HTMLElement) =>
        (Array.from(el.children).filter((child) => child instanceof HTMLElement) as HTMLElement[]).filter((child) => {
            return child.offsetWidth >= MIN_FRAG_W && child.offsetHeight >= MIN_FRAG_H;
        });
    const shouldSplit = (el: HTMLElement) => {
        const kids = visibleChildren(el);
        if (kids.length < 2) return false;
        if (tooLarge(el)) return true;
        if (el.offsetHeight >= SPLIT_MIN_H) return true;
        return kids.filter(isBlockCandidate).length >= 2;
    };

    const fragments: HTMLElement[] = [];
    const walk = (el: HTMLElement, depth: number) => {
        for (const child of visibleChildren(el)) {
            // 不拆开挂着交互 ref / 事件的容器，避免裁掉它所控制的悬停内容。
            if (child.hasAttribute("data-canvas-live")) {
                fragments.push(child);
                continue;
            }
            if (isBlockCandidate(child) && !tooLarge(child)) {
                fragments.push(child);
                continue;
            }
            if (depth < MAX_SPLIT_DEPTH && shouldSplit(child)) {
                walk(child, depth + 1);
                continue;
            }
            fragments.push(child);
        }
    };
    walk(capture, 0);
    return fragments;
}

/** 相对 capture 的布局坐标（消除画布 viewport scale 对 getBoundingClientRect 的影响） */
function measureOffset(el: HTMLElement, capture: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const captureRect = capture.getBoundingClientRect();
    const style = getComputedStyle(capture);
    const layoutW = Math.max(parseFloat(style.width) || capture.offsetWidth, 1);
    const layoutH = Math.max(parseFloat(style.height) || capture.offsetHeight, 1);
    const scaleX = captureRect.width / layoutW;
    const scaleY = captureRect.height / layoutH;
    const sx = scaleX > 0.01 ? scaleX : 1;
    const sy = scaleY > 0.01 ? scaleY : 1;
    return {
        x: (rect.left - captureRect.left) / sx + capture.scrollLeft,
        y: (rect.top - captureRect.top) / sy + capture.scrollTop,
        width: rect.width / sx,
        height: rect.height / sy,
    };
}

/** 剥掉只包一层的空壳，避免外框比真实卡片大一圈 */
function resolveTightFragmentElement(el: HTMLElement): HTMLElement {
    let cur = el;
    for (let depth = 0; depth < 5; depth++) {
        if (cur.hasAttribute("data-canvas-live")) break;
        const kids = (Array.from(cur.children).filter((child) => child instanceof HTMLElement) as HTMLElement[]).filter((child) => {
            return child.offsetWidth >= MIN_FRAG_W && child.offsetHeight >= MIN_FRAG_H;
        });
        if (kids.length !== 1) break;
        const only = kids[0];
        const pw = Math.max(cur.offsetWidth, 1);
        const ph = Math.max(cur.offsetHeight, 1);
        const cw = only.offsetWidth;
        const ch = only.offsetHeight;
        if (ch <= 0 || ph <= 0) break;
        const fillsMost = ch >= ph * 0.72 && cw >= pw * 0.72;
        const childIsCard = only.hasAttribute(CANVAS_BLOCK_ATTR) || hasCardLikeStyle(only);
        if (fillsMost || childIsCard) {
            cur = only;
            continue;
        }
        break;
    }
    return cur;
}

async function snapshotBlock(el: HTMLElement) {
    try {
        return await toPng(el, {
            pixelRatio: 2,
            cacheBust: true,
            backgroundColor: "transparent",
        });
    } catch {
        return "";
    }
}

/** 剥掉 script 与内联事件，防止片段回灌同文档时执行脚本 */
function sanitizeFragmentHtml(html: string) {
    const template = document.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll("script").forEach((el) => el.remove());
    template.content.querySelectorAll("*").forEach((el) => {
        for (const attr of Array.from(el.attributes)) {
            if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
        }
    });
    return template.innerHTML;
}

/** 在独立节点的排版环境中测量静态片段，保留原预览继承的字体与行高。 */
async function measureStaticFragment(el: HTMLElement, width: number) {
    const host = document.createElement("div");
    const w = Math.max(MIN_FRAG_W, width);
    host.setAttribute("data-canvas-fragment-layout", "1");
    Object.assign(host.style, {
        display: "flow-root", boxSizing: "content-box", width: `${w}px`,
        padding: `${FRAGMENT_PAD}px`, overflow: "visible",
        position: "fixed", left: "-100000px", top: "0", visibility: "hidden",
    });
    host.innerHTML = sanitizeFragmentHtml(el.outerHTML);
    const clone = host.firstElementChild as HTMLElement;
    const canvases = el.querySelectorAll("canvas");
    clone.querySelectorAll("canvas").forEach((canvas, index) => {
        const image = document.createElement("img");
        image.src = canvases[index].toDataURL();
        image.style.cssText = canvas.style.cssText;
        image.style.width = getComputedStyle(canvases[index]).width;
        image.style.height = getComputedStyle(canvases[index]).height;
        canvas.replaceWith(image);
    });
    // SVG 快照与休眠的活组件同时存在，避免渐变/裁剪引用命中另一棵树的 id。
    const ids = new Map<string, string>();
    for (const element of host.querySelectorAll("[id]")) {
        const id = `canvas-snapshot-${nanoid(10)}`;
        ids.set(element.id, id);
        element.id = id;
    }
    for (const element of host.querySelectorAll("*")) {
        for (const attr of Array.from(element.attributes)) {
            const value = attr.value.replace(/url\(["']?#([^\s)'"]+)["']?\)/g, (match, id: string) => ids.has(id) ? `url(#${ids.get(id)})` : match);
            element.setAttribute(attr.name, (attr.name === "href" || attr.name === "xlink:href") && ids.has(value.slice(1)) ? `#${ids.get(value.slice(1))}` : value);
        }
    }
    const inputs = el.querySelectorAll("input, textarea, select");
    clone.querySelectorAll("input, textarea, select").forEach((element, index) => {
        const original = inputs[index];
        if (element instanceof HTMLInputElement && original instanceof HTMLInputElement) {
            element.setAttribute("value", original.value);
            element.toggleAttribute("checked", original.checked);
        } else if (element instanceof HTMLTextAreaElement && original instanceof HTMLTextAreaElement) element.textContent = original.value;
        else if (element instanceof HTMLSelectElement && original instanceof HTMLSelectElement) {
            Array.from(element.options).forEach((option, i) => option.toggleAttribute("selected", original.options[i].selected));
        }
    });
    const style = getComputedStyle(el);
    for (const name of ["font-family", "font-size", "font-weight", "font-style", "font-variant", "font-feature-settings", "line-height", "letter-spacing", "word-spacing", "white-space", "word-break", "overflow-wrap", "text-align", "text-transform", "direction", "color"]) {
        clone.style.setProperty(name, style.getPropertyValue(name));
    }
    // 原节点的外边距已体现在画布坐标里，避免独立渲染时再次叠加。
    Object.assign(clone.style, { boxSizing: "border-box", width: `${w}px`, margin: "0" });
    document.body.appendChild(host);
    try {
        await Promise.all(Array.from(host.querySelectorAll("img"), (img) => img.decode().catch(() => undefined)));
        const measuredWidth = Math.ceil(Math.max(host.getBoundingClientRect().width, host.scrollWidth));
        const measuredHeight = Math.ceil(Math.max(host.getBoundingClientRect().height, host.scrollHeight));
        for (const name of ["position", "left", "top", "visibility"]) host.style.removeProperty(name);
        return { html: host.outerHTML, width: measuredWidth, height: measuredHeight };
    } finally {
        host.remove();
    }
}

/** 只保存裁剪范围对应的片段，不能把整份报告复制进闲置节点的 DOM。 */
export function findLiveCanvasFragment(capture: HTMLElement, clip: { x: number; y: number }) {
    let closest: { element: HTMLElement; width: number; distance: number } | undefined;
    for (const raw of collectBlockElements(capture)) {
        const element = resolveTightFragmentElement(raw);
        const box = measureOffset(element, capture);
        const distance = Math.abs(box.x - FRAGMENT_PAD - clip.x) + Math.abs(box.y - FRAGMENT_PAD - clip.y);
        if (!closest || distance < closest.distance) closest = { element, width: box.width, distance };
    }
    return closest?.element;
}

export async function captureLiveCanvasFragment(capture: HTMLElement, clip: { x: number; y: number }, element?: HTMLElement) {
    const target = element && capture.contains(element) ? element : findLiveCanvasFragment(capture, clip);
    return target ? (await measureStaticFragment(target, measureOffset(target, capture).width)).html : "";
}

/** 从已渲染的智能预览 DOM 测量可拆块（以当前实际布局宽度为基准）。 */
export async function measureCanvasBlocks(nodeId: string, node: CanvasNodeData): Promise<MeasuredCanvasBlock[] | null> {
    if (typeof document === "undefined") return null;
    const scope = document.querySelector(`[${SMART_PREVIEW_NODE_ATTR}="${nodeId}"]`);
    const capture = scope?.querySelector(`[${SMART_PREVIEW_CAPTURE_ATTR}]`) as HTMLElement | null;
    if (!capture) return null;
    await document.fonts.ready;
    if (!capture.isConnected) return null;

    // 冻结为当前可见的实际宽度，避免测量瞬间与重渲时 maxWidth/百分比不一致
    const prevWidth = capture.style.width;
    const prevMaxWidth = capture.style.maxWidth;
    const prevMinWidth = capture.style.minWidth;
    const prevMargin = capture.style.margin;
    const layoutWidth = Math.max(1, parseFloat(getComputedStyle(capture).width) || capture.offsetWidth || node.width);
    capture.style.width = `${layoutWidth}px`;
    capture.style.maxWidth = `${layoutWidth}px`;
    capture.style.minWidth = `${layoutWidth}px`;
    capture.style.margin = "0";
    void capture.offsetWidth;

    try {
        const elements = collectBlockElements(capture);
        if (!elements.length) return null;

        const captureH = Math.max(capture.scrollHeight, capture.offsetHeight, 1);
        const sourceSize = { width: layoutWidth, height: Math.ceil(captureH) };

        const blocks: MeasuredCanvasBlock[] = [];
        for (let index = 0; index < elements.length; index++) {
            const rawEl = elements[index] as HTMLElement;
            const el = resolveTightFragmentElement(rawEl);
            const box = measureOffset(el, capture);
            const rawId = el.getAttribute(CANVAS_BLOCK_ATTR) || "";
            const id = rawId && rawId !== "true" ? rawId : `block-${index}`;
            const connectRaw = el.getAttribute(CANVAS_CONNECT_ATTR) || "";
            const connectTo = connectRaw
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean);
            const live = isLiveChartBlock(el);
            // 位图 <canvas> 仍截图；可交互图表走 live 裁剪预览；其余静态 HTML
            const needsSnapshot = !live && Boolean(el.querySelector("canvas"));
            const imageDataUrl = needsSnapshot ? await snapshotBlock(el) : "";
            const fragment = !imageDataUrl ? await measureStaticFragment(el, box.width) : null;
            const pad = imageDataUrl ? 0 : FRAGMENT_PAD;
            const style = getComputedStyle(el);
            const contentW = Math.max(box.width, el.scrollWidth + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0));
            const contentH = Math.max(box.height, el.scrollHeight + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0));
            const fragW = Math.max(fragment?.width ?? (imageDataUrl ? box.width : contentW) + pad * 2, MIN_FRAG_W);
            const fragH = Math.max(fragment?.height ?? (imageDataUrl ? box.height : contentH) + pad * 2, MIN_FRAG_H);
            blocks.push({
                id,
                title: blockTitle(el, id),
                html: fragment?.html || "",
                imageDataUrl: imageDataUrl || undefined,
                live: live || undefined,
                previewTheme: live ? useThemeStore.getState().theme : undefined,
                sourceSize: live ? sourceSize : undefined,
                x: box.x - pad,
                y: box.y - pad,
                width: fragW,
                height: fragH,
                connectTo,
            });
        }

        return blocks.length ? blocks : null;
    } finally {
        capture.style.width = prevWidth;
        capture.style.maxWidth = prevMaxWidth;
        capture.style.minWidth = prevMinWidth;
        capture.style.margin = prevMargin;
    }
}

export function buildCanvasDomExplodeOps(node: CanvasNodeData, blocks: MeasuredCanvasBlock[]) {
    const minX = Math.min(...blocks.map((block) => block.x));
    const minY = Math.min(...blocks.map((block) => block.y));
    const maxX = Math.max(...blocks.map((block) => block.x + block.width));
    const maxY = Math.max(...blocks.map((block) => block.y + block.height));
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const groupWidth = Math.max(node.width, Math.ceil(contentW + GROUP_PAD * 2));
    const groupHeight = Math.max(node.height, Math.ceil(contentH + GROUP_PAD * 2));
    const groupPosition = { x: node.position.x, y: node.position.y };
    const source = String(node.metadata?.content || "");
    const path = String(node.metadata?.smartPreviewPath || "");

    const ops: CanvasAgentOp[] = [];
    const nodeIds: string[] = [];
    const idMap = new Map<string, string>();

    for (const block of blocks) {
        const id = `canvas-frag-${nanoid(8)}`;
        idMap.set(block.id, id);
        nodeIds.push(id);
        const position = {
            x: groupPosition.x + GROUP_PAD + (block.x - minX),
            y: groupPosition.y + GROUP_PAD + (block.y - minY),
        };
        const width = Math.max(MIN_FRAG_W, Math.ceil(block.width));
        const height = Math.max(MIN_FRAG_H, Math.ceil(block.height));
        const useImage = Boolean(block.imageDataUrl);
        const useLive = Boolean(block.live && source.trim());
        ops.push({
            type: "add_node",
            id,
            nodeType: useImage ? CanvasNodeType.Image : SMART_PREVIEW_NODE_TYPE,
            title: block.title,
            position,
            width,
            height,
            metadata: useImage
                ? {
                      content: block.imageDataUrl,
                      canvasFragment: true,
                      groupId: node.id,
                      status: "success",
                  }
                : useLive
                  ? {
                        smartPreviewKind: "canvasTsx",
                        canvasFragment: true,
                        canvasFragmentLive: true,
                        canvasFragmentPreview: { html: block.html, theme: block.previewTheme! },
                        canvasTsxState: node.metadata?.canvasTsxState,
                        content: source,
                        smartPreviewPath: path || "canvas.tsx",
                        canvasFragmentClip: {
                            x: block.x,
                            y: block.y,
                            width: block.width,
                            height: block.height,
                        },
                        canvasFragmentSourceSize: block.sourceSize,
                        groupId: node.id,
                        interactive: true,
                        status: "idle",
                    }
                  : {
                        smartPreviewKind: "html",
                        canvasFragment: true,
                        content: block.html,
                        groupId: node.id,
                        status: "idle",
                    },
        });
    }

    for (const block of blocks) {
        const fromId = idMap.get(block.id);
        if (!fromId) continue;
        for (const target of block.connectTo) {
            const toId = idMap.get(target);
            if (!toId) continue;
            ops.push({
                type: "connect_nodes",
                id: `conn-${nanoid(8)}`,
                fromNodeId: fromId,
                toNodeId: toId,
            });
        }
    }

    ops.push({
        type: "update_node",
        id: node.id,
        patch: {
            type: CanvasNodeType.Group,
            title: node.title || blocks[0]?.title || "数据组",
            position: groupPosition,
            width: groupWidth,
            height: groupHeight,
            metadata: {
                ...node.metadata,
                groupKind: "data",
                canvasExploded: true,
                canvasExplodedSource: source,
                canvasExplodedPath: path,
                smartPreviewKind: "",
                smartPreviewPath: "",
                content: "",
                smartPreviewFullscreen: false,
                interactive: false,
            },
        },
    });
    ops.push({ type: "select_nodes", ids: [node.id] });
    return { ops, nodeCount: nodeIds.length };
}
