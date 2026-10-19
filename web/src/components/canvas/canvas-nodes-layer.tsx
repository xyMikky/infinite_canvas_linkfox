import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import { getBatchExpandedBounds } from "@/lib/canvas/canvas-batch-layout";
import { CANVAS_NODE_LOD_RELEASE_MS, resolveCanvasNodeLod, resolveCanvasNodeLodMedia, resolveCanvasNodeLodPhase, type CanvasNodeLodVisual } from "@/lib/canvas/canvas-node-lod";
import { resolveCanvasNodeVisibility } from "@/lib/canvas/canvas-node-visibility";
import { buildCanvasSpatialIndex, getViewportBounds, resolveViewportRenderPadding, type CanvasSpatialItem } from "@/lib/canvas/canvas-spatial-index";
import { useCanvasInteractionStore } from "@/stores/canvas/use-canvas-interaction-store";
import { canvasImagePreviewEdge, readCanvasImageThumbnail } from "@/services/canvas-image-preview";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";

type NodeLod = CanvasNodeLodVisual & { showLodMedia: boolean };
export type CanvasNodesLayerHandle = { updateViewport: (viewport: ViewportTransform) => void };

type CanvasNodesLayerProps = {
    nodes: CanvasNodeData[];
    viewport: ViewportTransform;
    size: { width: number; height: number };
    expandedImageNodeIds: ReadonlySet<string>;
    hiddenNodeIds: ReadonlySet<string>;
    panelNodeId: string | null;
    isNodeDragging: boolean;
    dragRef: RefObject<{ dragIds: ReadonlySet<string> }>;
    ready: boolean;
    renderNode: (node: CanvasNodeData, lod: NodeLod, keepContentActive: boolean, deferContent: boolean) => ReactNode;
};

const NodeActivity = (React as typeof React & { Activity: React.ExoticComponent<{ mode: "visible" | "hidden"; children: ReactNode }> }).Activity;
const resolveLod = (scale: number, previous?: NodeLod): NodeLod => {
    const visual = resolveCanvasNodeLodPhase(scale);
    return {
        ...visual,
        contentLod: resolveCanvasNodeLod(scale, previous?.contentLod ?? visual.contentLod),
        showLodMedia: resolveCanvasNodeLodMedia(scale, previous?.showLodMedia),
    };
};

/** 视口变化只更新此层，页面仍负责业务动作和手势结束后的视口保存。 */
export const CanvasNodesLayer = forwardRef<CanvasNodesLayerHandle, CanvasNodesLayerProps>(function CanvasNodesLayer({
    nodes, viewport, size, expandedImageNodeIds, hiddenNodeIds, panelNodeId, isNodeDragging, dragRef, ready, renderNode,
}, ref) {
    const selectedNodeIds = useCanvasInteractionStore((state) => state.selectedNodeIds);
    const [visual, setVisual] = useState(() => ({ viewport, lod: resolveLod(viewport.k) }));
    const appliedRef = useRef(visual);
    const latestViewportRef = useRef(viewport);
    const frameRef = useRef<number | null>(null);
    const contentReleaseTimerRef = useRef<number | null>(null);
    const contentReleaseDeadlineRef = useRef<number | null>(null);
    const retainedIdsRef = useRef(new Set<string>());
    const spatialCacheRef = useRef<{ items: Map<string, CanvasSpatialItem>; tree: ReturnType<typeof buildCanvasSpatialIndex> } | null>(null);
    const spatialIndex = useMemo(() => {
        const previous = spatialCacheRef.current;
        let changed = !previous || previous.items.size !== nodes.length;
        const items = nodes.map((node) => {
            const bounds = expandedImageNodeIds.has(node.id) ? getBatchExpandedBounds(node) : { x: node.position.x, y: node.position.y, width: node.width, height: node.height };
            const old = previous?.items.get(node.id);
            if (old && old.minX === bounds.x && old.minY === bounds.y && old.maxX === bounds.x + bounds.width && old.maxY === bounds.y + bounds.height) return old;
            changed = true;
            return { id: node.id, minX: bounds.x, minY: bounds.y, maxX: bounds.x + bounds.width, maxY: bounds.y + bounds.height };
        });
        if (!changed && previous) return previous.tree;
        const tree = buildCanvasSpatialIndex(items);
        spatialCacheRef.current = { items: new Map(items.map((item) => [item.id, item])), tree };
        return tree;
    }, [expandedImageNodeIds, nodes]);
    const queryRef = useRef({ spatialIndex, size });
    queryRef.current = { spatialIndex, size };
    const [contentIds, setContentIds] = useState(() => new Set(spatialIndex.search(getViewportBounds(viewport, size.width, size.height, 0)).map((item) => item.id)));
    const contentIdsRef = useRef(contentIds);
    const contentQueryRef = useRef<{ viewport: ViewportTransform; query: typeof queryRef.current } | null>(null);
    const forceContentQueryRef = useRef(false);

    const updateViewport = useCallback((next: ViewportTransform, forceContentQuery = false): void => {
        latestViewportRef.current = next;
        forceContentQueryRef.current ||= forceContentQuery;
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            const latest = latestViewportRef.current;
            const previous = appliedRef.current;
            const query = queryRef.current;
            const lastQuery = contentQueryRef.current;
            const moved = lastQuery ? Math.abs(latest.x - lastQuery.viewport.x) + Math.abs(latest.y - lastQuery.viewport.y) + Math.abs(latest.k / lastQuery.viewport.k - 1) * Math.max(query.size.width, query.size.height) : Infinity;
            if (!lastQuery || forceContentQueryRef.current || moved >= 64 || lastQuery.query.spatialIndex !== query.spatialIndex || lastQuery.query.size.width !== query.size.width || lastQuery.query.size.height !== query.size.height) {
                forceContentQueryRef.current = false;
                contentQueryRef.current = { viewport: latest, query };
                // 80px 提前唤醒，离开 160px 后休眠；移动不足 64px 复用集合，减少边界抖动。
                const bounds = (padding: number) => getViewportBounds(latest, query.size.width, query.size.height, padding / Math.max(latest.k, 0.05));
                const nextContentIds = new Set(query.spatialIndex.search(bounds(80)).map((item) => item.id));
                for (const item of query.spatialIndex.search(bounds(160))) {
                    if (contentIdsRef.current.has(item.id)) nextContentIds.add(item.id);
                }
                if (nextContentIds.size !== contentIdsRef.current.size || [...nextContentIds].some((id) => !contentIdsRef.current.has(id))) {
                    contentIdsRef.current = nextContentIds;
                    setContentIds(nextContentIds);
                }
            }
            const ratio = latest.k / previous.viewport.k;
            // 保留现有剔除阈值；不能使用 startTransition，避免连续手势打断新节点挂载。
            const recull = Math.abs(latest.x - previous.viewport.x) >= 220 || Math.abs(latest.y - previous.viewport.y) >= 220 || ratio <= 0.9 || ratio >= 1.15;
            const lod = resolveLod(latest.k, previous.lod);
            // 共用一个释放计时器，短暂缩小不拆内容；返回滞回区立即取消释放。
            if (lod.contentLod === "shell" && previous.lod.contentLod === "full") {
                const now = performance.now();
                contentReleaseDeadlineRef.current ??= now + CANVAS_NODE_LOD_RELEASE_MS;
                if (now < contentReleaseDeadlineRef.current) {
                    lod.contentLod = "full";
                    if (contentReleaseTimerRef.current === null) {
                        contentReleaseTimerRef.current = window.setTimeout(() => {
                            contentReleaseTimerRef.current = null;
                            updateViewport(latestViewportRef.current);
                        }, contentReleaseDeadlineRef.current - now + 1);
                    }
                }
            } else {
                contentReleaseDeadlineRef.current = null;
                if (contentReleaseTimerRef.current !== null) window.clearTimeout(contentReleaseTimerRef.current);
                contentReleaseTimerRef.current = null;
            }
            const relod = lod.contentLod !== previous.lod.contentLod || lod.shellOpacity !== previous.lod.shellOpacity || lod.fullOpacity !== previous.lod.fullOpacity || lod.showLodMedia !== previous.lod.showLodMedia;
            if (!recull && !relod) return;
            const nextVisual = { viewport: recull ? latest : previous.viewport, lod: relod ? lod : previous.lod };
            appliedRef.current = nextVisual;
            setVisual(nextVisual);
        });
    }, []);

    useImperativeHandle(ref, () => ({ updateViewport }), [updateViewport]);
    useLayoutEffect(() => { updateViewport(viewport, true); }, [updateViewport, viewport]);
    useLayoutEffect(() => { updateViewport(latestViewportRef.current); }, [updateViewport, spatialIndex, size.width, size.height]);
    useEffect(() => () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        if (contentReleaseTimerRef.current !== null) window.clearTimeout(contentReleaseTimerRef.current);
        contentReleaseTimerRef.current = null;
        contentReleaseDeadlineRef.current = null;
    }, []);

    const visibility = useMemo(() => {
        // size 由页面的 ResizeObserver 更新，不在视口剔除时重复读取布局。
        const padding = resolveViewportRenderPadding(visual.viewport.k, size.width, size.height);
        const bounds = getViewportBounds(visual.viewport, size.width, size.height, padding);
        return resolveCanvasNodeVisibility(nodes, {
            visibleIds: new Set(spatialIndex.search(bounds).map((item) => item.id)),
            contentIds,
            selectedIds: isNodeDragging ? new Set([...selectedNodeIds, ...(dragRef.current?.dragIds || [])]) : selectedNodeIds,
            hiddenIds: hiddenNodeIds,
            retainedIds: retainedIdsRef.current,
            panelId: panelNodeId,
        });
    }, [contentIds, dragRef, hiddenNodeIds, isNodeDragging, nodes, panelNodeId, selectedNodeIds, size.height, size.width, spatialIndex, visual.viewport]);

    useLayoutEffect(() => {
        if (ready) retainedIdsRef.current = visibility.retainedIds;
    }, [ready, visibility]);

    useEffect(() => {
        if (!ready || !visual.lod.showLodMedia) return;
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            const vp = latestViewportRef.current;
            const centerX = (size.width / 2 - vp.x) / vp.k;
            const centerY = (size.height / 2 - vp.y) / vp.k;
            const distance = (node: CanvasNodeData) => Math.hypot(node.position.x + node.width / 2 - centerX, node.position.y + node.height / 2 - centerY);
            const nearby = visibility.renderNodes.filter((node) => node.type === CanvasNodeType.Image && visibility.activeIds.has(node.id) && !contentIds.has(node.id) && !selectedNodeIds.has(node.id) && node.id !== panelNodeId)
                .sort((a, b) => distance(a) - distance(b)).slice(0, 2);
            void (async () => {
                for (const node of nearby) {
                    if (controller.signal.aborted) return;
                    const images = node.metadata?.images || [];
                    const primary = images.find((image) => image.id === (node.metadata?.primaryImageId || images[0]?.id));
                    const key = primary?.storageKey || node.metadata?.storageKey;
                    if (!key || /image\/(gif|svg\+xml)/i.test(primary?.mimeType || node.metadata?.mimeType || "")) continue;
                    const width = primary?.naturalWidth || node.metadata?.naturalWidth || 0;
                    const height = primary?.naturalHeight || node.metadata?.naturalHeight || 0;
                    const edge = canvasImagePreviewEdge(node.width, node.height, vp.k, width, height, !node.metadata?.freeResize && visual.lod.contentLod === "full");
                    if (!edge) continue;
                    try {
                        await readCanvasImageThumbnail(key, primary?.content || node.metadata?.content || "", edge, controller.signal, width, height, true);
                    } catch { /* 预取失败不影响节点进入屏幕后正常加载。 */ }
                }
            })();
        }, 180);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [contentIds, panelNodeId, ready, selectedNodeIds, size.height, size.width, visibility, visual.lod.contentLod, visual.lod.showLodMedia]);

    return visibility.renderNodes.map((node) => (
        <NodeActivity key={node.id} mode={visibility.activeIds.has(node.id) ? "visible" : "hidden"}>
            {renderNode(node, visual.lod, selectedNodeIds.has(node.id) || panelNodeId === node.id || Boolean(isNodeDragging && dragRef.current?.dragIds.has(node.id)), !contentIds.has(node.id))}
        </NodeActivity>
    ));
});
