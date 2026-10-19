export type CanvasReport = {
    title: string;
    source: string;
    path: string;
    theme: "light" | "dark";
    state: Record<string, unknown>;
    assets: Record<string, string>;
};

export function reportAssetKey(reference: string, sourcePath: string): string {
    const value = reference.trim();
    if (/^(data:|#)/i.test(value) || !value) return value;
    if (/^\/\//.test(value)) return `https:${value}`;
    if (/^[a-z][\w+.-]*:/i.test(value)) return value;
    const base = sourcePath.replaceAll("\\", "/").split("/").slice(0, -1);
    const parts = value.startsWith("/") ? [] : base;
    for (const part of decodeURIComponent(value.split(/[?#]/)[0]).replaceAll("\\", "/").split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") {
            if (!parts.length) throw new Error("素材路径不能越过文件夹根目录");
            parts.pop();
        } else parts.push(part);
    }
    return parts.join("/");
}

/** 预收集普通字面量；实际渲染还会报告动态生成的 URL，不能把此扫描当成源码解析器。 */
export function collectReportAssetReferences(source: string): string[] {
    const references = new Set<string>();
    for (const match of source.matchAll(/["'`]([^"'`\r\n]+)["'`]/g)) {
        const value = match[1];
        if (/^(blob:|image:|media:|audio:|video:|folder-src:)/.test(value) || /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico|mp4|webm|mp3|wav|ogg|woff2?|ttf)([?#][^\s]*)?$/i.test(value)) references.add(value);
    }
    for (const match of source.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) references.add(match[1]);
    return [...references].filter((value) => !value.startsWith("data:") && !value.startsWith("#") && !value.includes("${"));
}

export function escapeReportHtml(value: string) {
    return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** 独立于 React 的启动保护；函数会内嵌进交付文件，不能引用模块内其他变量。 */
function reportBootstrap() {
    const root = document.getElementById("root")!;
    const { channel } = JSON.parse(document.getElementById("canvas-report-data")!.textContent!);
    let timer: ReturnType<typeof setTimeout>;
    let failed = false;
    const cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener("error", onError, true);
        window.removeEventListener("unhandledrejection", onRejection);
        window.removeEventListener("canvas-report-mounted", cleanup);
    };
    const fail = (reason: string) => {
        if (failed) return;
        failed = true;
        cleanup();
        const error = `报告启动失败：${reason}`;
        root.textContent = error;
        root.setAttribute("role", "alert");
        if (channel) window.parent.postMessage({ type: "canvas-report-status", channel, ready: false, error }, "*");
    };
    const onError = (event: Event) => {
        if (event.target === document.getElementById("canvas-report-runtime")) fail("运行文件加载失败，请重新打开报告");
        else if (event.target === window) fail((event as ErrorEvent).message || "运行文件执行失败");
    };
    const onRejection = (event: PromiseRejectionEvent) => fail(String(event.reason?.message || event.reason || "启动时发生异步错误"));
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("canvas-report-mounted", cleanup, { once: true });
    timer = setTimeout(() => fail("启动超时，请重新打开报告"), 15_000);
}

export function createReportDocument(report: CanvasReport, runtimeDataUrl: string, channel = "") {
    if (!/^data:text\/javascript;base64,[a-zA-Z0-9+/]+=*$/.test(runtimeDataUrl)) throw new Error("交付运行时必须内嵌");
    const json = JSON.stringify({ ...report, channel }).replaceAll("<", "\\u003c");
    const bootstrapUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(`(${reportBootstrap.toString()})()`)}`;
    const csp = "default-src 'none'; script-src data: 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escapeReportHtml(report.title)}</title></head><body><div id="root">正在打开报告…</div><script id="canvas-report-data" type="application/json">${json}</script><script src="${bootstrapUrl}"></script><script id="canvas-report-runtime" src="${runtimeDataUrl}"></script></body></html>`;
}

/** 下载后仍保留不授予同源权限的边界，不能把用户 TSX 放到外层页面执行。 */
export function createReportDeliveryHtml(report: CanvasReport, runtimeDataUrl: string) {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeReportHtml(report.title)}</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block;overflow:hidden}</style></head><body><iframe title="${escapeReportHtml(report.title)}" sandbox="allow-scripts" srcdoc="${escapeReportHtml(createReportDocument(report, runtimeDataUrl))}"></iframe></body></html>`;
}
