import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { getCanvasImagePreviewScale, subscribeCanvasImagePreviewScale } from "@/lib/canvas/canvas-image-thumb";
import { canvasImagePreviewEdge, loadCanvasImagePreview } from "@/services/canvas-image-preview";

type CanvasNodeImageProps = {
    src: string;
    storageKey?: string;
    alt?: string;
    className?: string;
    viewportScale?: number;
    nodeWidth?: number;
    nodeHeight?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    mimeType?: string;
    enabled?: boolean;
    lodFullOpacity?: number;
    draggable?: boolean;
    onDragStart?: (event: React.DragEvent<HTMLImageElement>) => void;
};

function getRevealKey(storageKey?: string, src?: string) {
    if (storageKey) return `sk:${storageKey}`;
    if (src) return `src:${src}`;
    return "";
}

export function CanvasNodeImage({ src, storageKey, alt = "", className, viewportScale = 1, nodeWidth = 480, nodeHeight = nodeWidth, naturalWidth = 0, naturalHeight = 0, mimeType = "", enabled = true, draggable = false, onDragStart }: CanvasNodeImageProps) {
    const revealKey = getRevealKey(storageKey, src);
    const [display, setDisplay] = useState<{ key: string; url: string; owned: boolean; edge: number } | null>(null);
    const ownedUrls = useRef(new Set<string>());
    const pendingUrlRef = useRef("");
    const displayRef = useRef(display);
    displayRef.current = display;
    const displaySrc = display?.key === revealKey ? display.url : "";
    const [failed, setFailed] = useState(false);
    const originalOnly = !storageKey || /image\/(gif|svg\+xml)/i.test(mimeType);
    const contain = Boolean(className?.includes("object-contain"));
    const getEdge = useCallback(() => originalOnly ? 0 : canvasImagePreviewEdge(
        nodeWidth, nodeHeight, getCanvasImagePreviewScale() ?? viewportScale, naturalWidth, naturalHeight, contain,
    ), [contain, naturalHeight, naturalWidth, nodeHeight, nodeWidth, originalOnly, viewportScale]);
    const edge = useSyncExternalStore(subscribeCanvasImagePreviewScale, getEdge);

    useEffect(() => {
        if (!enabled || (!src && !storageKey)) return;
        const current = displayRef.current;
        // 当前节点已经清晰时不降档，避免来回缩放反复读取、解码同一张图。
        if (current?.key === revealKey && (current.edge === 0 || (edge !== 0 && current.edge >= edge))) return;
        const controller = new AbortController();
        const { signal } = controller;
        setFailed(false);
        const load = async (nextEdge: number) => {
            const image = await loadCanvasImagePreview(storageKey, src, nextEdge, signal, naturalWidth, naturalHeight);
            if (signal.aborted) {
                if (image.owned) URL.revokeObjectURL(image.url);
                return;
            }
            if (image.owned) ownedUrls.current.add(image.url);
            pendingUrlRef.current = image.url;
            setDisplay({ ...image, key: revealKey, edge: nextEdge });
        };
        void (async () => {
            // 直接加载需要的档位，原图不再等待新生成的 480 缩略图。
            try {
                await load(edge);
            } catch (error) {
                signal.throwIfAborted();
                if (!edge) throw error;
                await load(0);
            }
        })().catch(() => { if (!signal.aborted) setFailed(true); });
        return () => controller.abort();
    }, [edge, enabled, naturalHeight, naturalWidth, revealKey, src, storageKey]);

    useEffect(() => {
        for (const url of ownedUrls.current) {
            if (url === display?.url || url === pendingUrlRef.current) continue;
            URL.revokeObjectURL(url);
            ownedUrls.current.delete(url);
        }
    }, [display]);

    useEffect(() => () => {
        ownedUrls.current.forEach((url) => URL.revokeObjectURL(url));
        ownedUrls.current.clear();
    }, []);

    if (!displaySrc) return failed ? <span className="flex h-full w-full items-center justify-center text-xs opacity-60">图片加载失败</span> : null;
    return (
        <img
            src={displaySrc}
            alt={alt}
            draggable={draggable}
            decoding="async"
            onDragStart={onDragStart}
            className={className}
        />
    );
}
