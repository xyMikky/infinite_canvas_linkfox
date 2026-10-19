import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { setCanvasTouchPinchActive } from "@/lib/canvas/touch-pinch";
import { applyCanvasNodeLodOpacity } from "@/lib/canvas/canvas-node-lod";
import { publishCanvasImagePreviewScale } from "@/lib/canvas/canvas-image-thumb";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ViewportTransform } from "@/types/canvas";

export type ApplyViewportOptions = { immediate?: boolean };

export type InfiniteCanvasHandle = {
    applyViewport: (next: ViewportTransform, options?: ApplyViewportOptions) => void;
};

type InfiniteCanvasProps = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    viewportApiRef?: React.MutableRefObject<InfiniteCanvasHandle | null>;
    viewport: ViewportTransform;
    tool: "select" | "relatedSelect" | "pan";
    backgroundMode?: CanvasBackgroundMode;
    onViewportChange: (viewport: ViewportTransform) => void;
    onViewportLive?: (viewport: ViewportTransform) => void;
    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onCanvasDeselect?: () => void;
    onTouchGestureStart?: () => void;
    onCanvasDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    overlay?: React.ReactNode;
    children: React.ReactNode;
};

// 手势期间视觉变换走命令式 DOM；React 提交只在手势结束时做一次，避免拖动/缩放中整页重渲染造成顿挫
// 鼠标滚轮两格之间常有 150~250ms 停顿，过短会在缩放途中提交视口、整页节点重渲染一次
const VIEWPORT_GESTURE_IDLE_MS = 140;
const ZOOM_ANIM_ALPHA = 0.28;
const ZOOM_ANIM_FRAME_MS = 1000 / 60;

type ZoomTarget = ViewportTransform & { anchorX: number; anchorY: number };

function applyCanvasLayerTransform(scaleEl: HTMLDivElement | null, translateEl: HTMLDivElement | null, viewport: ViewportTransform) {
    if (scaleEl) scaleEl.style.transform = `scale(${viewport.k})`;
    if (translateEl) translateEl.style.transform = `translate(${viewport.x / viewport.k}px, ${viewport.y / viewport.k}px)`;
    applyCanvasNodeLodOpacity(viewport.k);
    publishCanvasImagePreviewScale(viewport.k);
}

function applyCanvasGridPosition(gridEl: HTMLDivElement | null, viewport: ViewportTransform) {
    if (!gridEl) return;
    const gridSize = 48 * viewport.k;
    gridEl.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    gridEl.style.backgroundPosition = `${viewport.x % gridSize}px ${viewport.y % gridSize}px`;
}

/** 框选/平移的 preventDefault 会阻止默认焦点转移，需让输入框、按钮等主动失焦。 */
function blurActiveElement() {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
}

export function InfiniteCanvas({
    containerRef,
    viewportApiRef,
    viewport,
    tool,
    backgroundMode = "lines",
    onViewportChange,
    onViewportLive,
    onCanvasMouseDown,
    onCanvasDeselect,
    onTouchGestureStart,
    onCanvasDoubleClick,
    onContextMenu,
    onDrop,
    overlay,
    children,
}: InfiniteCanvasProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const panState = useRef({
        isPanning: false,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        hasMoved: false,
        startedOnBackground: false,
    });
    const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
    const pinchRef = useRef<{
        ids: [number, number];
        startDistance: number;
        worldX: number;
        worldY: number;
        startViewport: ViewportTransform;
    } | null>(null);
    const visualViewportRef = useRef(viewport);
    const pendingViewportRef = useRef<ViewportTransform | null>(null);
    const gestureRef = useRef(false);
    const scaleLayerRef = useRef<HTMLDivElement | null>(null);
    const translateLayerRef = useRef<HTMLDivElement | null>(null);
    const gridRef = useRef<HTMLDivElement | null>(null);
    const gestureEndTimerRef = useRef<number | null>(null);
    const panFrameRef = useRef<number | null>(null);
    const pendingPanViewportRef = useRef<ViewportTransform | null>(null);
    const zoomAnimRef = useRef<number | null>(null);
    const zoomTargetRef = useRef<ZoomTarget | null>(null);
    const zoomAnimTimeRef = useRef<number | null>(null);
    const pinchFrameRef = useRef<number | null>(null);
    const pendingPinchViewportRef = useRef<ViewportTransform | null>(null);
    const onViewportChangeRef = useRef(onViewportChange);
    const onViewportLiveRef = useRef(onViewportLive);
    const applyVisualViewportRef = useRef<(next: ViewportTransform, options?: ApplyViewportOptions) => void>(() => {});
    const endGestureRef = useRef<() => void>(() => {});
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [isControlPressed, setIsControlPressed] = useState(false);
    const [isPanning, setIsPanning] = useState(false);

    onViewportChangeRef.current = onViewportChange;
    onViewportLiveRef.current = onViewportLive;
    const stopPanning = () => {
        if (!panState.current.isPanning) return;
        panState.current.isPanning = false;
    };
    const stopPanningRef = useRef(stopPanning);
    stopPanningRef.current = stopPanning;

    const flushCommit = () => {
        const next = pendingViewportRef.current;
        if (!next) return;
        pendingViewportRef.current = null;
        onViewportChangeRef.current(next);
    };

    const endGesture = () => {
        if (gestureEndTimerRef.current != null) {
            window.clearTimeout(gestureEndTimerRef.current);
            gestureEndTimerRef.current = null;
        }
        const scaleEl = scaleLayerRef.current;
        const translateEl = translateLayerRef.current;
        if (scaleEl) scaleEl.style.willChange = "";
        if (translateEl) translateEl.style.willChange = "";
        gestureRef.current = false;
        flushCommit();
    };

    const scheduleGestureEnd = () => {
        if (gestureEndTimerRef.current != null) window.clearTimeout(gestureEndTimerRef.current);
        gestureEndTimerRef.current = window.setTimeout(() => {
            gestureEndTimerRef.current = null;
            endGesture();
        }, VIEWPORT_GESTURE_IDLE_MS);
    };

    const cancelZoomAnim = () => {
        if (zoomAnimRef.current != null) cancelAnimationFrame(zoomAnimRef.current);
        zoomAnimRef.current = null;
        zoomTargetRef.current = null;
        zoomAnimTimeRef.current = null;
    };

    const stepZoomAnim = (time: number) => {
        zoomAnimRef.current = null;
        const target = zoomTargetRef.current;
        if (!target) return;
        const current = visualViewportRef.current;
        if (Math.abs(target.x - current.x) < 0.5 && Math.abs(target.y - current.y) < 0.5 && Math.abs(target.k - current.k) < target.k * 0.001) {
            zoomTargetRef.current = null;
            zoomAnimTimeRef.current = null;
            applyVisualViewportRef.current({ x: target.x, y: target.y, k: target.k });
            return;
        }
        const last = zoomAnimTimeRef.current;
        zoomAnimTimeRef.current = time;
        const elapsed = last == null ? ZOOM_ANIM_FRAME_MS : Math.min(64, Math.max(1, time - last));
        const alpha = 1 - Math.pow(1 - ZOOM_ANIM_ALPHA, elapsed / ZOOM_ANIM_FRAME_MS);
        const { anchorX, anchorY } = target;
        const k = Math.exp(Math.log(current.k) + (Math.log(target.k) - Math.log(current.k)) * alpha);
        const currentWorldX = (anchorX - current.x) / current.k;
        const currentWorldY = (anchorY - current.y) / current.k;
        const worldX = currentWorldX + ((anchorX - target.x) / target.k - currentWorldX) * alpha;
        const worldY = currentWorldY + ((anchorY - target.y) / target.k - currentWorldY) * alpha;
        applyVisualViewportRef.current({ x: anchorX - worldX * k, y: anchorY - worldY * k, k });
        zoomAnimRef.current = requestAnimationFrame(stepZoomAnim);
    };

    const applyVisualViewport = (next: ViewportTransform, options?: ApplyViewportOptions) => {
        visualViewportRef.current = next;
        pendingViewportRef.current = next;
        applyCanvasLayerTransform(scaleLayerRef.current, translateLayerRef.current, next);
        applyCanvasGridPosition(gridRef.current, next);
        onViewportLiveRef.current?.(next);
        if (options?.immediate) {
            const scaleEl = scaleLayerRef.current;
            if (scaleEl) scaleEl.style.willChange = "";
            gestureRef.current = false;
            if (gestureEndTimerRef.current != null) {
                window.clearTimeout(gestureEndTimerRef.current);
                gestureEndTimerRef.current = null;
            }
            flushCommit();
            return;
        }
        gestureRef.current = true;
        const scaleEl = scaleLayerRef.current;
        const translateEl = translateLayerRef.current;
        if (scaleEl) scaleEl.style.willChange = "transform";
        if (translateEl) translateEl.style.willChange = "transform";
        scheduleGestureEnd();
    };

    applyVisualViewportRef.current = applyVisualViewport;
    endGestureRef.current = endGesture;
    const visual = visualViewportRef.current;

    const cancelZoomAnimRef = useRef(cancelZoomAnim);
    cancelZoomAnimRef.current = cancelZoomAnim;

    useLayoutEffect(() => {
        if (viewportApiRef)
            viewportApiRef.current = {
                applyViewport: (next, options) => {
                    cancelZoomAnimRef.current();
                    applyVisualViewportRef.current(next, options);
                },
            };
        return () => {
            if (viewportApiRef) viewportApiRef.current = null;
        };
    }, [viewportApiRef]);

    useLayoutEffect(() => {
        if (gestureRef.current) return;
        visualViewportRef.current = viewport;
        applyCanvasLayerTransform(scaleLayerRef.current, translateLayerRef.current, viewport);
        applyCanvasGridPosition(gridRef.current, viewport);
    }, [viewport]);

    useEffect(
        () => () => {
            if (gestureEndTimerRef.current != null) window.clearTimeout(gestureEndTimerRef.current);
            if (panFrameRef.current != null) cancelAnimationFrame(panFrameRef.current);
            if (zoomAnimRef.current != null) cancelAnimationFrame(zoomAnimRef.current);
            if (pinchFrameRef.current != null) cancelAnimationFrame(pinchFrameRef.current);
        },
        [],
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Control") setIsControlPressed(true);
            if (event.code !== "Space") return;
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true']")) return;
            event.preventDefault();
            setIsSpacePressed(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") {
                const target = event.target instanceof Element ? event.target : null;
                if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true']"))) event.preventDefault();
                setIsSpacePressed(false);
            }
            if (event.key === "Control") setIsControlPressed(false);
        };

        const handleBlur = () => {
            setIsSpacePressed(false);
            setIsControlPressed(false);
            touchPointsRef.current.clear();
            if (pinchFrameRef.current != null) cancelAnimationFrame(pinchFrameRef.current);
            pinchFrameRef.current = null;
            pendingPinchViewportRef.current = null;
            pinchRef.current = null;
            setCanvasTouchPinchActive(false);
            stopPanningRef.current();
            setIsPanning(false);
            document.body.style.cursor = "";
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, []);

    const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;

        // 以当前动画目标为基准累积滚轮步进，再逐帧缓动逼近。
        const base = zoomTargetRef.current ?? visualViewportRef.current;
        const delta = -event.deltaY;
        const factor = Math.pow(1.1, delta / 100);
        const newScale = Math.min(Math.max(base.k * factor, base.k < 0.05 ? Number.EPSILON : 0.05), 5);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const worldX = (mouseX - base.x) / base.k;
        const worldY = (mouseY - base.y) / base.k;

        zoomTargetRef.current = {
            x: mouseX - worldX * newScale,
            y: mouseY - worldY * newScale,
            k: newScale,
            anchorX: mouseX,
            anchorY: mouseY,
        };
        if (zoomAnimRef.current == null) {
            zoomAnimTimeRef.current = null;
            zoomAnimRef.current = requestAnimationFrame(stepZoomAnim);
        }
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (pinchRef.current) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom]")) return;
        if (target?.closest("[data-connection-create-menu]")) return;
        const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");
        const temporaryTool = event.ctrlKey || isSpacePressed;
        const activeTool = temporaryTool ? (tool === "pan" ? "select" : "pan") : tool;
        // 触屏空白处始终用单指平移；鼠标仍严格遵循当前工具与中键习惯。
        const shouldPan = event.button === 1 || (event.button === 0 && (activeTool === "pan" || (event.pointerType === "touch" && isBackgroundClick)));

        if (shouldPan) {
            event.preventDefault();
            blurActiveElement();
            cancelZoomAnim();
            event.currentTarget.setPointerCapture(event.pointerId);
            const current = visualViewportRef.current;
            panState.current = {
                isPanning: true,
                startX: event.clientX,
                startY: event.clientY,
                initialX: current.x,
                initialY: current.y,
                hasMoved: false,
                startedOnBackground: isBackgroundClick,
            };
            setIsPanning(true);
            document.body.style.cursor = "grabbing";
            return;
        }

        if (event.button === 0 && isBackgroundClick) {
            event.preventDefault();
            blurActiveElement();
            event.currentTarget.setPointerCapture(event.pointerId);
            onCanvasMouseDown?.(event);
        }
    };

    const handleTouchPointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== "touch") return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],[data-connection-create-menu],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;
        touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touchPointsRef.current.size < 2 || pinchRef.current) return;

        event.preventDefault();
        event.stopPropagation();
        setCanvasTouchPinchActive(true);
        cancelZoomAnim();
        if (panFrameRef.current != null) cancelAnimationFrame(panFrameRef.current);
        panFrameRef.current = null;
        pendingPanViewportRef.current = null;
        stopPanningRef.current();
        setIsPanning(false);
        document.body.style.cursor = "";
        onTouchGestureStart?.();

        const entries = [...touchPointsRef.current.entries()].slice(0, 2) as Array<[number, { x: number; y: number }]>;
        const [[firstId, first], [secondId, second]] = entries;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const startCenterX = (first.x + second.x) / 2 - rect.left;
        const startCenterY = (first.y + second.y) / 2 - rect.top;
        const startViewport = visualViewportRef.current;
        pinchRef.current = {
            ids: [firstId, secondId],
            startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
            worldX: (startCenterX - startViewport.x) / startViewport.k,
            worldY: (startCenterY - startViewport.y) / startViewport.k,
            startViewport,
        };
        for (const id of [firstId, secondId]) {
            try {
                event.currentTarget.setPointerCapture(id);
            } catch {
                // 个别浏览器不允许从第二根手指的事件捕获第一根手指，仍可依赖全屏画布接收移动。
            }
        }
    };

    const handleTouchPointerMoveCapture = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== "touch" || !touchPointsRef.current.has(event.pointerId)) return;
        touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const pinch = pinchRef.current;
        if (!pinch) return;
        event.preventDefault();
        event.stopPropagation();
        const first = touchPointsRef.current.get(pinch.ids[0]);
        const second = touchPointsRef.current.get(pinch.ids[1]);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!first || !second || !rect) return;
        const centerX = (first.x + second.x) / 2 - rect.left;
        const centerY = (first.y + second.y) / 2 - rect.top;
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
        const nextScale = Math.min(5, Math.max(0.05, pinch.startViewport.k * (distance / pinch.startDistance)));
        // 一帧内可能收到两根手指的多次移动，只应用该帧最后一次的视口。
        pendingPinchViewportRef.current = {
            x: centerX - pinch.worldX * nextScale,
            y: centerY - pinch.worldY * nextScale,
            k: nextScale,
        };
        if (pinchFrameRef.current == null) pinchFrameRef.current = requestAnimationFrame(flushPinchViewport);
    };

    const flushPinchViewport = () => {
        if (pinchFrameRef.current != null) cancelAnimationFrame(pinchFrameRef.current);
        pinchFrameRef.current = null;
        const next = pendingPinchViewportRef.current;
        pendingPinchViewportRef.current = null;
        if (next) applyVisualViewportRef.current(next);
    };

    const handleTouchPointerEndCapture = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== "touch" || !touchPointsRef.current.has(event.pointerId)) return;
        const wasPinching = Boolean(pinchRef.current);
        touchPointsRef.current.delete(event.pointerId);
        if (!wasPinching) return;
        event.preventDefault();
        event.stopPropagation();
        flushPinchViewport();
        pinchRef.current = null;
        setCanvasTouchPinchActive(false);
        endGestureRef.current();
    };

    const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],[data-node-id],[data-connection-id]")) return;
        onCanvasDoubleClick?.(event);
    };

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            if (!panState.current.isPanning) return;

            const dx = event.clientX - panState.current.startX;
            const dy = event.clientY - panState.current.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                panState.current.hasMoved = true;
            }

            pendingPanViewportRef.current = {
                x: panState.current.initialX + dx,
                y: panState.current.initialY + dy,
                k: visualViewportRef.current.k,
            };
            // 高轮询率鼠标一帧可能产生多次 pointermove；只应用该帧最后一个位置。
            if (panFrameRef.current == null) {
                panFrameRef.current = requestAnimationFrame(() => {
                    panFrameRef.current = null;
                    const next = pendingPanViewportRef.current;
                    pendingPanViewportRef.current = null;
                    if (next) applyVisualViewportRef.current(next);
                });
            }
        };

        const handlePointerUp = () => {
            if (!panState.current.isPanning) return;

            if (panFrameRef.current != null) {
                cancelAnimationFrame(panFrameRef.current);
                panFrameRef.current = null;
            }
            const finalViewport = pendingPanViewportRef.current;
            pendingPanViewportRef.current = null;
            if (finalViewport) applyVisualViewportRef.current(finalViewport);
            if (!panState.current.hasMoved && panState.current.startedOnBackground) {
                onCanvasDeselect?.();
            }
            stopPanningRef.current();
            setIsPanning(false);
            document.body.style.cursor = "";
            endGestureRef.current();
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
            document.body.style.cursor = "";
        };
    }, [onCanvasDeselect]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Prevent canvas scrolling from moving the page while preserving native scrolling inside overlays and dialogs.
        const preventWheelScroll = (event: WheelEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;
            event.preventDefault();
        };
        container.addEventListener("wheel", preventWheelScroll, { passive: false });
        return () => container.removeEventListener("wheel", preventWheelScroll);
    }, [containerRef]);

    const temporaryTool = isControlPressed || isSpacePressed;
    const activeTool = temporaryTool ? (tool === "pan" ? "select" : "pan") : tool;
    const cursor = isPanning ? "grabbing" : activeTool === "pan" ? "grab" : undefined;

    return (
        <div
            ref={containerRef}
            className="relative h-full w-full select-none overflow-hidden"
            style={{ background: theme.canvas.background, cursor, overscrollBehavior: "none" }}
            onPointerDownCapture={handleTouchPointerDownCapture}
            onPointerMoveCapture={handleTouchPointerMoveCapture}
            onPointerUpCapture={handleTouchPointerEndCapture}
            onPointerCancelCapture={handleTouchPointerEndCapture}
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
            onWheel={handleWheel}
            onContextMenu={onContextMenu}
            onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={onDrop}
        >
            <div className="absolute inset-0 z-0" style={{ touchAction: "none" }} aria-hidden />
            <CanvasGrid viewport={visual} mode={backgroundMode} gridRef={gridRef} />
            {/* 连线 overlay 低于节点层，避免线盖住星小驰眼睛等形象 */}
            <div className="pointer-events-none absolute inset-0 z-[1]">{overlay}</div>
            {/* 视口坐标归零，避免 scale 后合成层过大导致高缩放时不绘制 */}
            <div ref={scaleLayerRef} className="absolute left-0 top-0 z-[2] origin-top-left" style={{ transform: `scale(${visual.k})` }}>
                <div ref={translateLayerRef} style={{ transform: `translate(${visual.x / visual.k}px, ${visual.y / visual.k}px)` }}>
                    {children}
                </div>
            </div>
        </div>
    );
}

function CanvasGrid({ viewport, mode, gridRef }: { viewport: ViewportTransform; mode: CanvasBackgroundMode; gridRef: React.RefObject<HTMLDivElement | null> }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (mode === "blank") return null;

    const gridSize = 48 * viewport.k;
    const x = viewport.x % gridSize;
    const y = viewport.y % gridSize;
    const dotSize = viewport.k < 0.12 ? 0.8 : 1.15;
    const backgroundImage =
        mode === "dots" ? `radial-gradient(circle, ${theme.canvas.dot} ${dotSize}px, transparent ${dotSize + 0.2}px)` : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;

    return (
        <div
            ref={gridRef}
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
                backgroundImage,
                backgroundSize: `${gridSize}px ${gridSize}px`,
                backgroundPosition: `${x}px ${y}px`,
            }}
        />
    );
}
