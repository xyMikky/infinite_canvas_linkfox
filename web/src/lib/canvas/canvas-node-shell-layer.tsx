import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { MutableRefObject } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_IMAGE_FADE_MS, scheduleOpacityFadeIn } from "@/lib/canvas/canvas-image-thumb";
import { applyViewportToContext } from "@/lib/canvas/canvas-viewport-coords";
import { resolveImageUrl } from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";

type CanvasNodeShellLayerProps = {
    nodes: CanvasNodeData[];
    size: { width: number; height: number };
    viewport: ViewportTransform;
    viewportRef: MutableRefObject<ViewportTransform>;
    viewportScale: number;
    repaintRef?: MutableRefObject<(() => void) | null>;
    showLodMedia: boolean;
    selectedNodeIds: ReadonlySet<string>;
    relatedNodeIds: ReadonlySet<string>;
};

export function CanvasNodeShellLayer({ nodes, size, viewport, viewportRef, viewportScale, repaintRef, showLodMedia, selectedNodeIds, relatedNodeIds }: CanvasNodeShellLayerProps) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
    const displaySrcByNodeIdRef = useRef(new Map<string, string>());
    const imageFadeStartRef = useRef(new Map<string, number>());
    const fadeRafRef = useRef<number | null>(null);

    const scheduleFadeRepaint = useCallback(() => {
        if (fadeRafRef.current != null) return;
        fadeRafRef.current = requestAnimationFrame(() => {
            fadeRafRef.current = null;
            const now = performance.now();
            const fading = Array.from(imageFadeStartRef.current.values()).some((start) => now - start < CANVAS_IMAGE_FADE_MS);
            paintRef.current?.();
            if (fading) scheduleFadeRepaint();
        });
    }, []);

    const markImageFadeStart = useCallback(
        (src: string) => {
            if (!src || imageFadeStartRef.current.has(src)) return;
            imageFadeStartRef.current.set(src, performance.now());
            scheduleFadeRepaint();
        },
        [scheduleFadeRepaint],
    );

    const ensureImage = useCallback(
        (src: string) => {
            const cache = imageCacheRef.current;
            const cached = cache.get(src);
            if (cached?.complete && cached.naturalWidth > 0) {
                markImageFadeStart(src);
                return cached;
            }
            const image = cached || new Image();
            image.decoding = "async";
            if (!cached) {
                image.onload = () => {
                    markImageFadeStart(src);
                    paintRef.current?.();
                };
            }
            image.src = src;
            cache.set(src, image);
            if (image.complete && image.naturalWidth > 0) {
                markImageFadeStart(src);
                return image;
            }
            return null;
        },
        [markImageFadeStart],
    );

    const paintRef = useRef<(() => void) | null>(null);
    const paint = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const { width: displayWidth, height: displayHeight } = getOverlayCanvasSize(canvas, size);
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(displayWidth * dpr));
        const height = Math.max(1, Math.round(displayHeight * dpr));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const vp = viewportRef.current ?? viewport;
        applyViewportToContext(ctx, vp, dpr);

        nodes.forEach((node) => {
            const previewSrc = displaySrcByNodeIdRef.current.get(node.id) || getShellPreviewSrc(node);
            drawShellNode(ctx, node, {
                active: selectedNodeIds.has(node.id) || relatedNodeIds.has(node.id),
                theme,
                colorTheme,
                viewportScale: vp.k,
                showMedia: showLodMedia,
                previewSrc,
                ensureImage,
                getImageFadeAlpha: (src) => getImageFadeAlpha(imageFadeStartRef.current, src, performance.now()),
            });
        });
    }, [colorTheme, ensureImage, nodes, relatedNodeIds, selectedNodeIds, showLodMedia, size, theme, viewport, viewportRef]);

    paintRef.current = paint;

    useLayoutEffect(() => {
        paint();
    }, [paint, viewport]);

    useEffect(() => {
        if (!repaintRef) return;
        const previous = repaintRef.current;
        const wrapped = () => {
            previous?.();
            paint();
        };
        repaintRef.current = wrapped;
        return () => {
            if (repaintRef.current === wrapped) repaintRef.current = previous ?? null;
        };
    }, [paint, repaintRef]);

    useEffect(() => {
        let cancelled = false;
        nodes.forEach((node) => {
            const src = getShellPreviewSrc(node);
            if (!src) return;
            ensureImage(src);
            if (node.type !== CanvasNodeType.Image) return;
            void resolveImageUrl(node.metadata?.storageKey, src).then((url) => {
                const resolved = url || src;
                if (cancelled || !resolved) return;
                displaySrcByNodeIdRef.current.set(node.id, resolved);
                ensureImage(resolved);
                repaintRef?.current?.();
            });
        });
        return () => {
            cancelled = true;
        };
    }, [ensureImage, nodes, repaintRef]);

    useEffect(() => {
        const el = canvasRef.current?.parentElement;
        if (!el) return;
        const observer = new ResizeObserver(() => paint());
        observer.observe(el);
        return () => observer.disconnect();
    }, [paint]);

    useEffect(
        () => () => {
            if (fadeRafRef.current != null) cancelAnimationFrame(fadeRafRef.current);
        },
        [],
    );

    return <canvas ref={canvasRef} className="absolute inset-0 z-[2] h-full w-full pointer-events-none" />;
}

function getImageFadeAlpha(fadeStartBySrc: Map<string, number>, src: string, now: number) {
    const fadeStart = fadeStartBySrc.get(src);
    if (fadeStart == null) return 1;
    return Math.max(0, Math.min(1, (now - fadeStart) / CANVAS_IMAGE_FADE_MS));
}

function getOverlayCanvasSize(canvas: HTMLCanvasElement, fallback: { width: number; height: number }) {
    const rect = canvas.parentElement?.getBoundingClientRect();
    return {
        width: Math.max(1, Math.round(rect?.width || canvas.clientWidth || fallback.width)),
        height: Math.max(1, Math.round(rect?.height || canvas.clientHeight || fallback.height)),
    };
}

function drawShellNode(
    ctx: CanvasRenderingContext2D,
    node: CanvasNodeData,
    options: {
        active: boolean;
        theme: (typeof canvasThemes)[keyof typeof canvasThemes];
        colorTheme: "light" | "dark";
        viewportScale: number;
        showMedia: boolean;
        previewSrc: string;
        ensureImage: (src: string) => HTMLImageElement | null;
        getImageFadeAlpha: (src: string) => number;
    },
) {
    const { x, y } = node.position;
    const { width, height } = node;
    const radius = Math.min(18, width / 6, height / 6);
    const { active, theme, colorTheme, viewportScale, showMedia, previewSrc, ensureImage, getImageFadeAlpha } = options;
    const hasImage = node.type === CanvasNodeType.Image && Boolean(previewSrc);
    const hasVideo = node.type === CanvasNodeType.Video && Boolean(previewSrc);

    ctx.save();
    ctx.shadowColor = colorTheme === "dark" ? "rgba(0,0,0,0.45)" : "rgba(28,25,23,0.18)";
    ctx.shadowBlur = Math.max(4, 10 / viewportScale);
    ctx.shadowOffsetY = Math.max(1, 3 / viewportScale);

    roundRect(ctx, x, y, width, height, radius);
    ctx.fillStyle = hasImage || hasVideo ? "#0c0b0a" : theme.node.panel;
    ctx.fill();

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    if (showMedia && previewSrc && (hasImage || hasVideo)) {
        const image = ensureImage(previewSrc);
        if (image?.complete && image.naturalWidth > 0) {
            ctx.save();
            roundRect(ctx, x, y, width, height, radius);
            ctx.clip();
            ctx.globalAlpha = getImageFadeAlpha(previewSrc);
            drawCoverImage(ctx, image, x, y, width, height);
            ctx.restore();
        }
    } else if (!hasImage && !hasVideo) {
        drawTypeGlyph(ctx, node, x, y, width, height, theme);
    }

    const title = (node.title || "").trim();
    if (title && height * viewportScale >= 28) {
        drawTitleOverlay(ctx, title, x, y, width, height, viewportScale);
    }

    ctx.strokeStyle = active ? "#2f80ff" : hasImage || hasVideo ? "rgba(255,255,255,0.14)" : theme.node.stroke;
    ctx.lineWidth = active ? Math.max(1.5, 2 / viewportScale) : Math.max(1, 1.25 / viewportScale);
    roundRect(ctx, x, y, width, height, radius);
    ctx.stroke();
    ctx.restore();
}

function drawCoverImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawW = image.naturalWidth * scale;
    const drawH = image.naturalHeight * scale;
    ctx.drawImage(image, x + (width - drawW) / 2, y + (height - drawH) / 2, drawW, drawH);
}

function drawTitleOverlay(ctx: CanvasRenderingContext2D, title: string, x: number, y: number, width: number, height: number, viewportScale: number) {
    const barH = Math.min(34, height * 0.28);
    const gradient = ctx.createLinearGradient(0, y + height - barH, 0, y + height);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.55, "rgba(0,0,0,0.45)");
    gradient.addColorStop(1, "rgba(0,0,0,0.78)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y + height - barH, width, barH);

    const fontSize = Math.max(9, Math.min(12, 11 / viewportScale));
    if (fontSize * viewportScale < 7) return;
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const padding = Math.max(6, 8 / viewportScale);
    ctx.fillText(truncateText(ctx, title, width - padding * 2), x + padding, y + height - padding, width - padding * 2);
}

function drawTypeGlyph(ctx: CanvasRenderingContext2D, node: CanvasNodeData, x: number, y: number, width: number, height: number, theme: (typeof canvasThemes)[keyof typeof canvasThemes]) {
    const label = nodeTypeLabel(node);
    const centerX = x + width / 2;
    const centerY = y + height / 2 - 6;
    ctx.fillStyle = theme.node.muted;
    ctx.font = `600 ${Math.max(10, Math.min(14, width / 5))}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.85;
    ctx.fillText(label, centerX, centerY);
    ctx.globalAlpha = 1;
}

function nodeTypeLabel(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Video) return "视频";
    if (node.type === CanvasNodeType.Audio) return "音频";
    if (node.type === CanvasNodeType.Group) return "组";
    if (node.type === CanvasNodeType.Config) return "配置";
    if (node.metadata?.documentKind === "excel" || node.metadata?.excelParentId) return "表格";
    return "节点";
}

function getShellPreviewSrc(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Image) {
        const images = node.metadata?.images || [];
        const primaryId = node.metadata?.primaryImageId || images[0]?.id;
        const primary = images.find((image) => image.id === primaryId);
        return primary?.content || node.metadata?.content || "";
    }
    if (node.type === CanvasNodeType.Video) return node.metadata?.content || "";
    return "";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let next = text;
    while (next.length > 1 && ctx.measureText(`${next}…`).width > maxWidth) next = next.slice(0, -1);
    return `${next}…`;
}
