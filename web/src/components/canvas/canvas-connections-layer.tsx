import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import {
    annotationArrowPoints,
    buildActiveConnectionEndpoints,
    buildBezierPath2D,
    buildMindBezierPathWithHops,
    connectionArrowPoints,
    connectionLabelWorld,
    findMindEdgeHops,
    getConnectionCurveBounds,
    getConnectionEndpoints,
    isConnectionDashed,
    pointOnConnectionBezier,
    shortenEndpointsForArrow,
} from "@/lib/canvas/canvas-connection-geometry";
import { connectionInvolvesXing, drawXingClayConnection } from "@/lib/canvas/xing-xiaochi-connection-draw";
import { hasAnyXingLive, setXingConnectedNodes, subscribeXingLiveFrame, withLiveXingEndpoints } from "@/lib/canvas/xing-xiaochi-live-registry";
import { applyViewportToContext } from "@/lib/canvas/canvas-viewport-coords";
import { isAnnotationNode, resolveConnectionKind, resolveMindLayoutPeer } from "@/lib/canvas/mind-map";
import { getViewportBounds, intersectsBounds } from "@/lib/canvas/canvas-spatial-index";
import { CANVAS_NODE_LOD_BLEND_SHELL_END } from "@/lib/canvas/canvas-node-lod";
import { useCanvasInteractionStore } from "@/stores/canvas/use-canvas-interaction-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position, ViewportTransform } from "@/types/canvas";

/** 画布连线层：星小驰的线根与身体同帧贴合，有连线时收敛角色大幅动作。 */
type CanvasConnectionsLayerProps = {
    size: { width: number; height: number };
    viewport: ViewportTransform;
    viewportRef: MutableRefObject<ViewportTransform>;
    repaintRef?: MutableRefObject<(() => void) | null>;
    nodesRef?: MutableRefObject<CanvasNodeData[]>;
    connections: CanvasConnection[];
    nodeById: Map<string, CanvasNodeData>;
    selectedConnectionId: string | null;
    relatedConnectionIds: ReadonlySet<string>;
    hidden?: boolean;
    editingLabelConnectionId?: string | null;
    connectingParams: ConnectionHandle | null;
    connectingNode?: CanvasNodeData;
    mouseWorld: Position;
    connectionTargetNode?: CanvasNodeData;
};

export function CanvasConnectionsLayer({
    size,
    viewport,
    viewportRef,
    repaintRef,
    nodesRef,
    connections,
    nodeById,
    selectedConnectionId,
    relatedConnectionIds,
    hidden = false,
    editingLabelConnectionId = null,
    connectingParams,
    connectingNode,
    mouseWorld,
    connectionTargetNode,
}: CanvasConnectionsLayerProps) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const carryColor = colorTheme === "dark" ? "#fb923c" : "#ea580c";
    const mindColor = colorTheme === "dark" ? "#a78bfa" : "#7c3aed";
    const annotationColor = colorTheme === "dark" ? "#a3a3a3" : "#78716c";
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const displaySizeRef = useRef<{ width: number; height: number } | null>(null);
    const carryPhaseRef = useRef(0);
    const paintRef = useRef<(() => void) | null>(null);
    const [simple, setSimple] = useState(viewport.k <= CANVAS_NODE_LOD_BLEND_SHELL_END);
    const simpleRef = useRef(simple);

    useLayoutEffect(() => {
        const ids = new Set(connections.flatMap((connection) => [connection.fromNodeId, connection.toNodeId]));
        if (connectingNode) ids.add(connectingNode.id);
        if (connectionTargetNode) ids.add(connectionTargetNode.id);
        setXingConnectedNodes(ids);
    }, [connections, connectingNode?.id, connectionTargetNode?.id]);
    useEffect(() => () => setXingConnectedNodes(new Set()), []);

    const paintItems = useMemo(() => {
        const items = connections.flatMap((connection) => {
            const from = nodeById.get(connection.fromNodeId);
            const to = nodeById.get(connection.toNodeId);
            if (!from || !to) return [];
            const endpoints = getConnectionEndpoints(
                from,
                to,
                resolveConnectionKind(connection, from, to),
                connection,
                nodeById,
                connections,
                { connectionId: connection.id },
            );
            const draw = endpoints.mind ? shortenEndpointsForArrow(endpoints, 6) : endpoints;
            return [{ connection, from, to, endpoints, draw, bounds: getConnectionCurveBounds(endpoints) }];
        });
        const hops = findMindEdgeHops(items.map((item) => ({ id: item.connection.id, endpoints: item.draw })));
        return items.map((item) => {
            const draw = item.draw;
            const hopList = hops.get(item.connection.id) || [];
            const path = item.endpoints.mind && hopList.length
                ? buildMindBezierPathWithHops(draw, hopList)
                : buildBezierPath2D(draw);
            return { ...item, hops: hopList, path };
        });
    }, [connections, nodeById]);

    const dragPaintItemsRef = useRef<{
        nodes: CanvasNodeData[];
        base: typeof paintItems;
        items: typeof paintItems;
    } | null>(null);

    const paint = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const { width: displayWidth, height: displayHeight } =
            displaySizeRef.current ?? (displaySizeRef.current = getOverlayCanvasSize(canvas, size));
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
        const simpleView = vp.k <= CANVAS_NODE_LOD_BLEND_SHELL_END;
        if (simpleRef.current !== simpleView) {
            simpleRef.current = simpleView;
            setSimple(simpleView);
        }
        applyViewportToContext(ctx, vp, dpr);
        const paintBounds = getViewportBounds(vp, displayWidth, displayHeight, Math.max(280, 260 / vp.k));

        // 拖节点时 nodesRef 已是实时坐标，优先用它重算连线，避免只跟 React 态松手才跳
        const liveDrag = useCanvasInteractionStore.getState().liveDrag;
        const liveNodes = liveDrag && nodesRef?.current?.length ? nodesRef.current : null;
        const cached = dragPaintItemsRef.current;
        const items = liveNodes
            ? (() => {
                  // 同一组坐标可能被拖拽和角色动画重复绘制，几何结果只计算一次。
                  if (cached?.nodes === liveNodes && cached.base === paintItems) return cached.items;
                  const liveById = new Map(liveNodes.map((node) => [node.id, node] as const));
                  // 导图同侧扇出、判断出口还依赖相邻节点；组内叶子的端口可能挂在组框上。
                  const affectedPeers = new Set(liveDrag!.ids);
                  const peers = paintItems.map((item) => {
                      const from = liveById.get(item.from.id) || item.from;
                      const to = liveById.get(item.to.id) || item.to;
                      const layoutFrom = resolveMindLayoutPeer(from, to, liveById);
                      const layoutTo = resolveMindLayoutPeer(to, from, liveById);
                      if (liveDrag!.ids.has(layoutFrom.id) || liveDrag!.ids.has(layoutTo.id) || from !== item.from || to !== item.to) {
                          affectedPeers.add(layoutFrom.id);
                          affectedPeers.add(layoutTo.id);
                      }
                      return { from, to, layoutFrom, layoutTo };
                  });
                  const liveItems = paintItems.map((item, index) => {
                      const { connection } = item;
                      const { from, to, layoutFrom, layoutTo } = peers[index];
                      const kind = resolveConnectionKind(connection, from, to);
                      if (from === item.from && to === item.to && !item.endpoints.bow &&
                          (kind !== "mind" || (!affectedPeers.has(layoutFrom.id) && !affectedPeers.has(layoutTo.id)))) return item;
                      const endpoints = getConnectionEndpoints(
                          from,
                          to,
                          kind,
                          connection,
                          liveById,
                          connections,
                          { skipBow: true, connectionId: connection.id },
                      );
                      const draw = endpoints.mind ? shortenEndpointsForArrow(endpoints, 6) : endpoints;
                      return { ...item, from, to, endpoints, draw, bounds: getConnectionCurveBounds(endpoints) };
                  });
                  if (liveItems.every((item, index) => item === paintItems[index])) {
                      dragPaintItemsRef.current = { nodes: liveNodes, base: paintItems, items: paintItems };
                      return paintItems;
                  }
                  const hops = findMindEdgeHops(liveItems.map((item) => ({ id: item.connection.id, endpoints: item.draw })));
                  const nextItems = liveItems.map((item, index) => {
                      const draw = item.draw;
                      const hopList = hops.get(item.connection.id) || [];
                      if (item === paintItems[index] && hopList.length === item.hops.length && hopList.every((hop, i) => hop.t === item.hops[i].t)) return item;
                      const path = item.endpoints.mind && hopList.length
                          ? buildMindBezierPathWithHops(draw, hopList)
                          : buildBezierPath2D(draw);
                      return { ...item, hops: hopList, path };
                  });
                  dragPaintItemsRef.current = { nodes: liveNodes, base: paintItems, items: nextItems };
                  return nextItems;
              })()
            : paintItems;
        if (!liveNodes) dragPaintItemsRef.current = null;

        items.forEach((item) => {
            const { connection, from, to, endpoints: baseEndpoints, path: basePath, hops: hopList = [] } = item;
            if (hidden) return;
            const endpoints =
                connectionInvolvesXing(from, to) && hasAnyXingLive()
                    ? withLiveXingEndpoints(from, to, connection, baseEndpoints)
                    : baseEndpoints;
            if (!intersectsBounds(endpoints === baseEndpoints ? item.bounds : getConnectionCurveBounds(endpoints), paintBounds)) return;
            const path =
                endpoints === baseEndpoints ? basePath : buildBezierPath2D(endpoints);
            const active = selectedConnectionId === connection.id || relatedConnectionIds.has(connection.id);
            const kind = resolveConnectionKind(connection, from, to);
            const isMind = kind === "mind";
            const isAnnotation = kind === "annotation";
            const dashed = isConnectionDashed(connection, from, to);
            const stroke = connection.carry
                ? carryColor
                : isAnnotation
                  ? annotationColor
                  : isMind
                    ? mindColor
                    : active
                      ? theme.node.activeStroke
                      : theme.node.muted;
            if (connectionInvolvesXing(from, to) && !isMind && !isAnnotation) {
                const farColor = connection.carry ? carryColor : stroke;
                drawXingClayConnection(ctx, endpoints, {
                    from,
                    to,
                    farColor,
                    active,
                    dashed,
                    zoom: vp.k,
                });
                if (connection.label?.trim() && connection.id !== editingLabelConnectionId) {
                    drawConnectionLabel(ctx, endpoints, connection.label.trim(), colorTheme === "dark", theme.node.text, vp.k);
                }
                return;
            }
            if (simpleView) {
                const lw = Math.max(1.25, 2.25 / vp.k);
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.strokeStyle = stroke;
                ctx.lineWidth = connection.carry ? lw + 0.75 : isAnnotation ? Math.max(1, 1.5 / vp.k) : isMind ? Math.max(1.1, 1.75 / vp.k) : active ? lw + 0.35 : lw;
                ctx.globalAlpha = connection.carry ? 0.9 : isAnnotation ? (active ? 0.95 : 0.82) : isMind ? (active ? 0.95 : 0.78) : active ? 0.98 : 0.62;
                if (dashed) ctx.setLineDash([6 / vp.k, 5 / vp.k]);
                if (active && !isMind && !isAnnotation) {
                    ctx.shadowColor = colorTheme === "dark" ? "rgba(47,128,255,0.35)" : "rgba(28,25,23,0.2)";
                    ctx.shadowBlur = 6 / vp.k;
                }
                ctx.stroke(path);
                ctx.setLineDash([]);
                ctx.shadowBlur = 0;
                ctx.globalAlpha = 1;
                if (connection.label?.trim() && connection.id !== editingLabelConnectionId) {
                    drawConnectionLabel(ctx, endpoints, connection.label.trim(), colorTheme === "dark", theme.node.text, vp.k);
                }
                return;
            }
            if (connection.carry) {
                ctx.lineCap = "round";
                ctx.strokeStyle = carryColor;
                ctx.globalAlpha = active ? 0.4 : 0.26;
                ctx.lineWidth = active ? 10 : 8;
                if (dashed) ctx.setLineDash([6 / vp.k, 5 / vp.k]);
                ctx.stroke(path);
                ctx.globalAlpha = 1;
                ctx.lineWidth = active ? 3.5 : 3;
                ctx.strokeStyle = carryColor;
                ctx.stroke(path);
                ctx.setLineDash([]);
                const length = estimateBezierLength(endpoints);
                const t = carryPhaseRef.current % 1;
                const point = pointOnConnectionBezier(endpoints, t);
                ctx.beginPath();
                ctx.fillStyle = carryColor;
                ctx.arc(point.x, point.y, active ? 4.5 : 4, 0, Math.PI * 2);
                ctx.fill();
                carryPhaseRef.current = (carryPhaseRef.current + 0.004 / Math.max(length / 400, 1)) % 1;
                if (connection.label?.trim() && connection.id !== editingLabelConnectionId) {
                    drawConnectionLabel(ctx, endpoints, connection.label.trim(), colorTheme === "dark", theme.node.text, vp.k);
                }
                return;
            }
            if (isAnnotation) {
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.strokeStyle = stroke;
                ctx.lineWidth = active ? 2 : 1.5;
                ctx.globalAlpha = active ? 1 : 0.88;
                if (dashed) ctx.setLineDash([7 / vp.k, 6 / vp.k]);
                const arrowSize = active ? 8 : 7;
                ctx.stroke(buildBezierPath2D(shortenEndpointsForArrow(endpoints, arrowSize)));
                ctx.setLineDash([]);
                const arrow = annotationArrowPoints(endpoints, arrowSize);
                ctx.beginPath();
                ctx.moveTo(arrow[0][0], arrow[0][1]);
                ctx.lineTo(arrow[1][0], arrow[1][1]);
                ctx.lineTo(arrow[2][0], arrow[2][1]);
                ctx.closePath();
                ctx.fillStyle = stroke;
                ctx.fill();
                ctx.globalAlpha = 1;
                if (connection.label?.trim() && connection.id !== editingLabelConnectionId) {
                    drawConnectionLabel(ctx, endpoints, connection.label.trim(), colorTheme === "dark", theme.node.text, vp.k);
                }
                return;
            }
            if (isMind) {
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.strokeStyle = stroke;
                ctx.lineWidth = active ? 2.25 : 1.6;
                ctx.globalAlpha = active ? 1 : 0.88;
                if (dashed) ctx.setLineDash([6 / vp.k, 5 / vp.k]);
                const arrowSize = active ? 7 : 6;
                const draw = shortenEndpointsForArrow(endpoints, arrowSize);
                const strokePath = !active && endpoints === baseEndpoints
                    ? basePath
                    : hopList.length ? buildMindBezierPathWithHops(draw, hopList) : buildBezierPath2D(draw);
                ctx.stroke(strokePath);
                ctx.setLineDash([]);
                const arrow = connectionArrowPoints(endpoints, arrowSize);
                ctx.beginPath();
                ctx.moveTo(arrow[0][0], arrow[0][1]);
                ctx.lineTo(arrow[1][0], arrow[1][1]);
                ctx.lineTo(arrow[2][0], arrow[2][1]);
                ctx.closePath();
                ctx.fillStyle = stroke;
                ctx.fill();
                ctx.globalAlpha = 1;
                if (connection.label?.trim() && connection.id !== editingLabelConnectionId) {
                    drawConnectionLabel(ctx, endpoints, connection.label.trim(), colorTheme === "dark", theme.node.text, vp.k);
                }
                return;
            }
            ctx.lineCap = "round";
            ctx.strokeStyle = stroke;
            ctx.lineWidth = active ? 3 : 2;
            ctx.globalAlpha = active ? 1 : 0.82;
            if (dashed) ctx.setLineDash([6 / vp.k, 5 / vp.k]);
            if (active) {
                ctx.shadowColor = `${theme.node.activeStroke}66`;
                ctx.shadowBlur = 8;
            }
            const arrowSize = active ? 8 : 7;
            ctx.stroke(buildBezierPath2D(shortenEndpointsForArrow(endpoints, arrowSize)));
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
            const arrow = connectionArrowPoints(endpoints, arrowSize);
            ctx.beginPath();
            ctx.moveTo(arrow[0][0], arrow[0][1]);
            ctx.lineTo(arrow[1][0], arrow[1][1]);
            ctx.lineTo(arrow[2][0], arrow[2][1]);
            ctx.closePath();
            ctx.fillStyle = stroke;
            ctx.fill();
            if (connection.label?.trim() && connection.id !== editingLabelConnectionId) {
                drawConnectionLabel(ctx, endpoints, connection.label.trim(), colorTheme === "dark", theme.node.text, vp.k);
            }
        });

        if (connectingParams && connectingNode) {
            const involvingAnnotation = isAnnotationNode(connectingNode) || isAnnotationNode(connectionTargetNode);
            const mindPreview = connectingNode.type === "mind-node" || connectionTargetNode?.type === "mind-node";
            const mode = involvingAnnotation ? ("annotation" as const) : mindPreview ? ("mind" as const) : ("default" as const);
            let endpoints = buildActiveConnectionEndpoints(connectingNode, connectingParams, mouseWorld, connectionTargetNode, mode);
            if (!involvingAnnotation && !mindPreview && connectionInvolvesXing(connectingNode, connectionTargetNode)) {
                const fromNode = connectingParams.handleType === "source" ? connectingNode : connectionTargetNode;
                const toNode = connectingParams.handleType === "source" ? connectionTargetNode : connectingNode;
                const previewConn =
                    connectingParams.handleType === "source"
                        ? { fromAnchor: connectingParams.anchor, toAnchor: undefined }
                        : { fromAnchor: undefined, toAnchor: connectingParams.anchor };
                endpoints = withLiveXingEndpoints(fromNode, toNode, previewConn, endpoints);
                drawXingClayConnection(ctx, endpoints, {
                    from: fromNode,
                    to: toNode,
                    farColor: theme.node.activeStroke,
                    active: true,
                    preview: true,
                    zoom: vp.k,
                });
            } else {
                const path = buildBezierPath2D(endpoints);
                ctx.setLineDash([5 / vp.k, 5 / vp.k]);
                ctx.lineCap = "round";
                ctx.strokeStyle = involvingAnnotation ? annotationColor : mindPreview ? mindColor : theme.node.activeStroke;
                ctx.lineWidth = 2 / vp.k;
                ctx.globalAlpha = 1;
                ctx.stroke(path);
                ctx.setLineDash([]);
            }
        }
    }, [
        annotationColor,
        carryColor,
        colorTheme,
        connectionTargetNode,
        connectingNode,
        connectingParams,
        connections,
        editingLabelConnectionId,
        hidden,
        mindColor,
        mouseWorld,
        nodeById,
        nodesRef,
        paintItems,
        relatedConnectionIds,
        selectedConnectionId,
        size,
        theme,
        viewport,
        viewportRef,
    ]);

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
        const canvas = canvasRef.current;
        const el = canvas?.parentElement;
        if (!canvas || !el) return;
        const observer = new ResizeObserver(() => {
            displaySizeRef.current = getOverlayCanvasSize(canvas, size);
            paintRef.current?.();
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [size]);

    // 星小驰由身体绘制后同帧驱动；传递流动点仅在没有角色帧驱动时自行刷新。
    const hasCarry = useMemo(() => connections.some((connection) => connection.carry), [connections]);
    const needsXingLiveRaf = useMemo(
        () =>
            connections.some((connection) => {
                const from = nodeById.get(connection.fromNodeId);
                const to = nodeById.get(connection.toNodeId);
                return connectionInvolvesXing(from, to);
            }) || connectionInvolvesXing(connectingNode, connectionTargetNode),
        [connections, nodeById, connectingNode, connectionTargetNode],
    );
    useEffect(() => {
        if (hidden || simple || !hasCarry) return;
        let raf = 0;
        const tick = () => {
            if (!needsXingLiveRaf || !hasAnyXingLive()) paintRef.current?.();
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [hidden, simple, hasCarry, needsXingLiveRaf]);

    useEffect(() => {
        if (hidden || !needsXingLiveRaf) return;
        return subscribeXingLiveFrame(() => {
            paintRef.current?.();
        });
    }, [hidden, needsXingLiveRaf]);

    return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

function getOverlayCanvasSize(canvas: HTMLCanvasElement, fallback: { width: number; height: number }) {
    const rect = canvas.parentElement?.getBoundingClientRect();
    return {
        width: Math.max(1, Math.round(rect?.width || canvas.clientWidth || fallback.width)),
        height: Math.max(1, Math.round(rect?.height || canvas.clientHeight || fallback.height)),
    };
}

function estimateBezierLength(endpoints: ReturnType<typeof getConnectionEndpoints>) {
    const { startX, startY, endX, endY } = endpoints;
    return Math.hypot(endX - startX, endY - startY);
}

function drawConnectionLabel(
    ctx: CanvasRenderingContext2D,
    endpoints: ReturnType<typeof getConnectionEndpoints>,
    label: string,
    dark: boolean,
    textColor: string,
    zoom: number,
) {
    const fontSize = 12;
    ctx.save();
    ctx.font = `500 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxW = 220;
    let text = label;
    if (ctx.measureText(text).width > maxW) {
        while (text.length > 1 && ctx.measureText(`${text}…`).width > maxW) text = text.slice(0, -1);
        text = `${text}…`;
    }
    const padX = 8;
    const padY = 4;
    const tw = ctx.measureText(text).width;
    const w = tw + padX * 2;
    const h = fontSize + padY * 2;
    const mid = connectionLabelWorld(endpoints, h);
    const x = mid.x - w / 2;
    const y = mid.y - h / 2;
    const r = 6;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = dark ? "rgba(28,25,23,0.92)" : "rgba(245,243,240,0.96)";
    ctx.fill();
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.12)" : "rgba(28,25,23,0.1)";
    ctx.lineWidth = Math.max(0.75, 1 / Math.max(zoom, 0.5));
    ctx.stroke();
    ctx.fillStyle = textColor;
    ctx.fillText(text, mid.x, mid.y);
    ctx.restore();
}

export { buildConnectionHitItems, hitTestConnectionAt } from "@/lib/canvas/canvas-connection-geometry";
