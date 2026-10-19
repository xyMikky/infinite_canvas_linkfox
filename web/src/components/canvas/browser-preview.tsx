import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { createBrowserHtmlPreview, pdfDataUrlToObjectUrl } from "@/lib/canvas/browser-preview";

/** HTML 文档的 object URL 生命周期与文件夹物化共用此入口。 */
export function BrowserHtmlPreview({ content, folderNodeId = "", path = "", reload = 0, interactive, onLoad }: {
    content: string;
    folderNodeId?: string;
    path?: string;
    reload?: number;
    interactive: boolean;
    onLoad?: (frame: HTMLIFrameElement, content: string, src: string) => void;
}) {
    const [page, setPage] = useState({ src: "", content: "", loading: true, error: "" });
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let cancelled = false;
        let revoke: (() => void) | undefined;
        setPage(previous => ({ ...previous, loading: true, error: "" }));
        void createBrowserHtmlPreview(content, folderNodeId, path).then(result => {
            if (cancelled) { result.revoke(); return; }
            revoke = result.revoke;
            setPage({ src: result.iframeSrc || "", content, loading: false, error: "" });
        }).catch(() => {
            if (!cancelled) setPage({ src: "", content, loading: false, error: "页面资源读取失败，请重试。" });
        });
        return () => { cancelled = true; revoke?.(); };
    }, [content, folderNodeId, path, reload, retry]);
    return (
        <div className="relative h-full w-full" data-canvas-no-zoom>
            {page.src ? <iframe
                title="smart-preview-html"
                data-smart-preview-html-iframe
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
                src={page.src}
                className="block h-full w-full border-0 bg-white"
                style={{ pointerEvents: interactive && !page.loading ? "auto" : "none", visibility: page.loading ? "hidden" : "visible" }}
                onLoad={event => { if (!page.loading) onLoad?.(event.currentTarget, page.content, page.src); }}
            /> : null}
            {page.loading || page.error ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs">
                <span>{page.error || "正在加载页面…"}</span>
                {page.error ? <button type="button" className="rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setRetry(value => value + 1); }}>重新加载</button> : null}
            </div> : null}
        </div>
    );
}

const VIDEO_DRAG_THRESHOLD_PX = 6;
const VIDEO_CONTROLS_HIT_PX = 52;

function isNearNativeVideoControls(event: { currentTarget: HTMLVideoElement; clientY: number }) {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY >= rect.bottom - VIDEO_CONTROLS_HIT_PX;
}

/** 浏览器原生 PDF 查看器（blob + object/embed） */
export function BrowserPdfPreview({
    src,
    className,
    style,
    empty,
}: {
    src: string;
    className?: string;
    style?: CSSProperties;
    empty?: ReactNode;
}) {
    const [objectUrl, setObjectUrl] = useState("");
    useEffect(() => {
        const url = pdfDataUrlToObjectUrl(src);
        setObjectUrl(url || "");
        return () => {
            if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
        };
    }, [src]);
    if (!objectUrl) return <>{empty ?? null}</>;
    return (
        <object data={objectUrl} type="application/pdf" className={className} style={style}>
            <embed src={objectUrl} type="application/pdf" className="h-full w-full border-0" />
        </object>
    );
}

/**
 * 浏览器原生视频：画面区拖动只移动节点，单击才播放/暂停；底部控件条可操作。
 */
export function BrowserVideoPreview({
    src,
    className,
}: {
    src: string;
    className?: string;
}) {
    const pointerStartRef = useRef<{ x: number; y: number; id: number } | null>(null);
    const draggedRef = useRef(false);
    const [ignoreVideoPointer, setIgnoreVideoPointer] = useState(false);

    useEffect(() => {
        const onMove = (event: PointerEvent) => {
            const start = pointerStartRef.current;
            if (!start || event.pointerId !== start.id || draggedRef.current) return;
            if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < VIDEO_DRAG_THRESHOLD_PX) return;
            draggedRef.current = true;
            setIgnoreVideoPointer(true);
        };
        const onUp = (event: PointerEvent) => {
            const start = pointerStartRef.current;
            if (!start || event.pointerId !== start.id) return;
            pointerStartRef.current = null;
            requestAnimationFrame(() => {
                draggedRef.current = false;
                setIgnoreVideoPointer(false);
            });
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
        };
    }, []);

    return (
        <video
            src={src}
            controls
            draggable={false}
            className={`${className || ""} ${ignoreVideoPointer ? "pointer-events-none" : ""}`.trim()}
            onMouseDown={(event) => {
                if (isNearNativeVideoControls(event)) event.stopPropagation();
            }}
            onPointerDown={(event) => {
                pointerStartRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
                draggedRef.current = false;
                setIgnoreVideoPointer(false);
                if (isNearNativeVideoControls(event)) event.stopPropagation();
            }}
            onClick={(event) => {
                if (!draggedRef.current && !ignoreVideoPointer) return;
                event.preventDefault();
                event.stopPropagation();
            }}
        />
    );
}
