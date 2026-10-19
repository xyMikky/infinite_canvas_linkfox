import type { CanvasNodeData } from "@/types/canvas";

export type HtmlDesignSource = { document: Document; shape: string; fields: Record<string, string>; lineBreaks: Record<string, number[]> };
export type HtmlTextEdit = { id: string; before: string; after: string; beforeBreaks?: number[]; afterBreaks?: number[] };
const markerCache = new WeakMap<object, boolean>();

/** 页面内锚点仍属于原文档，进入链接页面后禁止把文案写回原节点。 */
export function isHtmlDesignDocument(frame: HTMLIFrameElement, src: string) {
    try { return Boolean(src) && frame.contentWindow?.location.href.split("#")[0] === src.split("#")[0]; }
    catch { return false; }
}

export function isHtmlDesignBoard(meta: { htmlDesignBoard?: boolean; content?: string }) {
    if (typeof meta.htmlDesignBoard === "boolean") return meta.htmlDesignBoard;
    const cached = markerCache.get(meta);
    if (cached !== undefined) return cached;
    const marked = /\bdata-ui-text\s*=/.test(meta.content || "");
    markerCache.set(meta, marked);
    return marked;
}

export function isEditableHtmlText(element: Element) {
    return element.namespaceURI === "http://www.w3.org/1999/xhtml"
        && Array.from(element.children).every(child => child.localName === "br")
        && !element.closest("script,style,noscript,template,textarea,select,input,img,br,hr,iframe,video,audio,canvas,object,embed,pre,code,[contenteditable]");
}

export function readHtmlText(element: Element) {
    return Array.from(element.childNodes).map(node => node.nodeType === 3 ? node.textContent : node.nodeName === "BR" ? "\n" : "").join("");
}

export function readHtmlTextBreaks(element: Element) {
    const breaks: number[] = [];
    let offset = 0;
    for (const node of element.childNodes) {
        if (node.nodeType === 3) offset += node.textContent?.length || 0;
        else if (node.nodeName === "BR") { breaks.push(offset); offset++; }
    }
    return breaks;
}

export function splitHtmlText(text: string, breaks?: number[]) {
    if (!breaks) return text.split("\n");
    let start = 0;
    const lines = breaks.map(offset => { const line = text.slice(start, offset); start = offset + 1; return line; });
    return [...lines, text.slice(start)];
}

export function reverseHtmlTextEdit(edit: HtmlTextEdit): HtmlTextEdit {
    return { ...edit, before: edit.after, after: edit.before, beforeBreaks: edit.afterBreaks, afterBreaks: edit.beforeBreaks };
}

/** 显式换行用 br 保存，避免普通段落把换行折成空格；文字始终走 Text 节点。 */
export function writeHtmlText(element: Element, text: string, breaks?: number[]) {
    const document = element.ownerDocument;
    element.replaceChildren(...splitHtmlText(text, breaks).flatMap((line, index) => index
        ? [document.createElement("br"), document.createTextNode(line)]
        : [document.createTextNode(line)]));
}

function serialize(document: Document) {
    const doctype = document.doctype ? new XMLSerializer().serializeToString(document.doctype) + "\n" : "";
    return doctype + document.documentElement.outerHTML;
}

/** 明确标记且唯一的静态文字叶子才允许编辑，不猜测 DOM 路径或抹掉内嵌图标。 */
export function readHtmlDesignSource(source: string): HtmlDesignSource {
    const document = new DOMParser().parseFromString(source, "text/html");
    const groups = new Map<string, Element[]>();
    for (const element of document.querySelectorAll("[data-ui-text]")) {
        const id = element.getAttribute("data-ui-text") || "";
        groups.set(id, [...(groups.get(id) || []), element]);
    }
    const fields: Record<string, string> = Object.create(null);
    const lineBreaks: Record<string, number[]> = Object.create(null);
    const leaves: { element: Element; children: ChildNode[] }[] = [];
    for (const [id, elements] of groups) {
        if (!id || id.length > 128 || elements.length !== 1 || !isEditableHtmlText(elements[0])) continue;
        fields[id] = readHtmlText(elements[0]);
        lineBreaks[id] = readHtmlTextBreaks(elements[0]);
        leaves.push({ element: elements[0], children: Array.from(elements[0].childNodes) });
        elements[0].textContent = "";
    }
    const shape = serialize(document);
    for (const { element, children } of leaves) element.replaceChildren(...children);
    return { document, shape, fields, lineBreaks };
}

export function patchHtmlDesignText(source: HtmlDesignSource, edit: HtmlTextEdit): string | null {
    if (!Object.hasOwn(source.fields, edit.id) || source.fields[edit.id] !== edit.before || edit.after.length > 20_000) return null;
    const document = source.document.cloneNode(true) as Document;
    const element = Array.from(document.querySelectorAll("[data-ui-text]")).find(item => item.getAttribute("data-ui-text") === edit.id);
    if (!element) return null;
    writeHtmlText(element, edit.after, edit.afterBreaks);
    return serialize(document);
}

/** 回写前再次比对节点、路径与源版本；过期编辑不制造保存或撤销记录。 */
export function replaceHtmlDesignContent(nodes: CanvasNodeData[], input: { nodeId: string; path: string; expected: string; content: string }) {
    const target = nodes.find(node => node.id === input.nodeId);
    if (!target || target.type !== "smart-preview" || target.metadata?.smartPreviewKind !== "html"
        || (target.metadata.smartPreviewPath || "") !== input.path || target.metadata.content !== input.expected || input.content === input.expected) return nodes;
    return nodes.map(node => node === target ? { ...node, metadata: { ...node.metadata, content: input.content } } : node);
}
