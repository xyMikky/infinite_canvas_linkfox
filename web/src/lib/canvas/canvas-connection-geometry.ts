import RBush from "rbush";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, ConnectionHandleSide, Position } from "@/types/canvas";
import { CanvasNodeType } from "@/types/canvas";
import { absoluteAnchorPoint, edgeOfRelativeAnchor, nearestBorderAnchor } from "@/lib/canvas/canvas-node-geometry";
import {
    absoluteXingSurfacePoint,
    isXingXiaochiNode,
    nearestXingSurfaceAnchor,
    sideToXingSurfaceAnchor,
    stickyXingWorldPoint,
    xingBodyCenterLocal,
} from "@/lib/canvas/xing-xiaochi-ports";
import {
    annotationDrawPair,
    isDecisionNode,
    isMindDataGroup,
    isMindNode,
    mindNodeSideAnchor,
    nearestMindHandleSide,
    pickMindConnectionSides,
    resolveConnectionKind,
    resolveMindLayoutPeer,
    sharedDecisionExitSide,
} from "@/lib/canvas/mind-map";

export { pickMindConnectionSides };

/** 连线只依赖几何与端口语义；正文、标题、进度等变化不使缓存失效。 */
export function sameConnectionNodeGeometry(a: CanvasNodeData | undefined, b: CanvasNodeData) {
    return a === b || Boolean(a && a.type === b.type &&
        a.position.x === b.position.x && a.position.y === b.position.y && a.width === b.width && a.height === b.height &&
        a.metadata?.mindShape === b.metadata?.mindShape && a.metadata?.mindKind === b.metadata?.mindKind &&
        a.metadata?.groupId === b.metadata?.groupId && isMindDataGroup(a) === isMindDataGroup(b));
}

/** 虚线：显式 dashed；未设时仅「真·标注连线」默认虚线 */
export function isConnectionDashed(connection: CanvasConnection, from?: CanvasNodeData | null, to?: CanvasNodeData | null) {
    if (typeof connection.dashed === "boolean") return connection.dashed;
    return resolveConnectionKind(connection, from, to) === "annotation";
}

export type ConnectionEndpoints = {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    curvature: number;
    /** 导图连线：控制点在水平方向按端点朝向取符号 */
    mind?: boolean;
    /** 标注连线：上下点 / 顶边弧线 */
    annotation?: boolean;
    /** 导图上下连接（实线，竖直贝塞尔） */
    vertical?: boolean;
    /** 导图正交路由：起点离开方向 / 终点进入外侧法线 */
    startSide?: ConnectionHandleSide;
    endSide?: ConnectionHandleSide;
    /** 长边避障：沿弦法线方向外拱的控制点偏移（有符号），绕开挡道节点 */
    bow?: number;
    /** 星小驰：沿表面径向起笔，不用导图正交 L 弯 */
    xing?: boolean;
    startNormal?: Position;
    endNormal?: Position;
};

/** 星小驰端：离开身体的径向单位向量；其它节点：沿边外法线 */
function endpointOutwardNormal(
    node: CanvasNodeData | null | undefined,
    world: Position,
    side?: ConnectionHandleSide,
): Position {
    if (node && isXingXiaochiNode(node)) {
        const c = xingBodyCenterLocal(node);
        const cx = node.position.x + c.x * node.width;
        const cy = node.position.y + c.y * node.height;
        const dx = world.x - cx;
        const dy = world.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        return { x: dx / len, y: dy / len };
    }
    return sideOutward(side || "right");
}

function buildXingConnectionEndpoints(
    from: CanvasNodeData,
    to: CanvasNodeData,
    start: Position,
    end: Position,
    startSide?: ConnectionHandleSide,
    endSide?: ConnectionHandleSide,
): ConnectionEndpoints {
    const span = Math.max(Math.hypot(end.x - start.x, end.y - start.y), 48);
    return {
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        curvature: Math.max(span * 0.26, 20),
        xing: true,
        startNormal: endpointOutwardNormal(from, start, startSide),
        endNormal: endpointOutwardNormal(to, end, endSide),
        startSide,
        endSide,
    };
}

function sideOutward(side: ConnectionHandleSide): Position {
    if (side === "left") return { x: -1, y: 0 };
    if (side === "right") return { x: 1, y: 0 };
    if (side === "top") return { x: 0, y: -1 };
    return { x: 0, y: 1 };
}


function resolveNodeEndpoint(
    node: CanvasNodeData,
    anchor: Position | undefined,
    fallbackSide: "left" | "right" | "top" | "bottom",
): Position {
    if (isXingXiaochiNode(node)) {
        return absoluteXingSurfacePoint(node, anchor || sideToXingSurfaceAnchor(fallbackSide, node));
    }
    if (anchor) {
        return isMindNode(node) ? mindNodeSideAnchor(node, edgeOfRelativeAnchor(anchor)) : absoluteAnchorPoint(node, anchor);
    }
    if (isMindNode(node)) return mindNodeSideAnchor(node, fallbackSide);
    if (fallbackSide === "left") return { x: node.position.x, y: node.position.y + node.height / 2 };
    if (fallbackSide === "top") return { x: node.position.x + node.width / 2, y: node.position.y };
    if (fallbackSide === "bottom") return { x: node.position.x + node.width / 2, y: node.position.y + node.height };
    return { x: node.position.x + node.width, y: node.position.y + node.height / 2 };
}

export function getConnectionEndpoints(
    from: CanvasNodeData,
    to: CanvasNodeData,
    kind?: CanvasConnection["kind"],
    anchors?: Pick<CanvasConnection, "fromAnchor" | "toAnchor" | "fromSide" | "toSide"> | null,
    nodeById?: Map<string, CanvasNodeData>,
    connections?: CanvasConnection[],
    options?: { skipBow?: boolean; connectionId?: string },
): ConnectionEndpoints {
    if (kind === "annotation") {
        const pair = annotationDrawPair(from, to);
        return getAnnotationConnectionEndpoints(pair.from, pair.to);
    }
    // 边框锚点优先（数据组任意边落点）；再走导图尖点路由
    if (anchors?.fromAnchor || anchors?.toAnchor) {
        const startSide = anchors.fromAnchor ? edgeOfRelativeAnchor(anchors.fromAnchor) : "right";
        const endSide = anchors.toAnchor ? edgeOfRelativeAnchor(anchors.toAnchor) : "left";
        const start = resolveNodeEndpoint(from, anchors.fromAnchor, startSide);
        const end = resolveNodeEndpoint(to, anchors.toAnchor, endSide);
        // 星小驰表面锚点：勿套导图 mind L 弯（底边会竖直甩出一大段再拐）
        if (kind !== "mind" && kind !== "annotation" && (isXingXiaochiNode(from) || isXingXiaochiNode(to))) {
            return buildXingConnectionEndpoints(from, to, start, end, startSide, endSide);
        }
        const span = Math.max(Math.hypot(end.x - start.x, end.y - start.y), 48);
        const sameAxis =
            (startSide === "left" || startSide === "right") === (endSide === "left" || endSide === "right");
        const endpoints: ConnectionEndpoints = {
            startX: start.x,
            startY: start.y,
            endX: end.x,
            endY: end.y,
            curvature: Math.max(span * (sameAxis ? 0.42 : 0.55), sameAxis ? 36 : 48),
            mind: true,
            vertical: startSide === "top" || startSide === "bottom" || endSide === "top" || endSide === "bottom",
            startSide,
            endSide,
        };
        return kind === "mind" && !options?.skipBow ? withMindEdgeBow(endpoints, from, to, nodeById) : endpoints;
    }
    if (kind === "mind") {
        const layoutFrom = nodeById ? resolveMindLayoutPeer(from, to, nodeById) : from;
        const layoutTo = nodeById ? resolveMindLayoutPeer(to, from, nodeById) : to;
        // 落点改用组框后，端口按组框几何重算，忽略指向叶子时留下的旧 fromSide/toSide
        const useStoredSides = layoutFrom.id === from.id && layoutTo.id === to.id;
        let startSide = useStoredSides ? anchors?.fromSide : undefined;
        let endSide = useStoredSides ? anchors?.toSide : undefined;
        // 判断节点是/否：强制同一出口尖点（绘制时即生效，无需等重排落盘）
        if (nodeById && connections && isDecisionNode(layoutFrom)) {
            const shared = sharedDecisionExitSide(layoutFrom, nodeById, connections);
            if (shared) {
                startSide = shared;
                endSide = pickMindConnectionSides(layoutFrom, layoutTo).endSide;
            }
        }
        const connectionId = options?.connectionId || connectionIdOf(anchors);
        const mindEndpoints = getMindConnectionEndpoints(layoutFrom, layoutTo, startSide, endSide, {
            connectionId,
            connections,
            nodeById,
        });
        return options?.skipBow ? mindEndpoints : withMindEdgeBow(mindEndpoints, layoutFrom, layoutTo, nodeById);
    }
    const start = resolveNodeEndpoint(from, undefined, "right");
    const end = resolveNodeEndpoint(to, undefined, "left");
    if (isXingXiaochiNode(from) || isXingXiaochiNode(to)) {
        return buildXingConnectionEndpoints(from, to, start, end, "right", "left");
    }
    const dx = Math.abs(end.x - start.x);
    const curvature = Math.max(dx * 0.5, 50);
    return { startX: start.x, startY: start.y, endX: end.x, endY: end.y, curvature };
}

/**
 * 组框 / 看板等非 mind 大节点：锚点沿所选边向对端投影（夹在边内），
 * 避免固定用边中点在对端偏移时拉出长斜线；导图胶囊仍用几何尖点。
 */
function slideMindSideAnchor(node: CanvasNodeData, side: ConnectionHandleSide, peer: CanvasNodeData): Position {
    const tip = mindNodeSideAnchor(node, side);
    if (isMindNode(node)) return tip;
    if (side === "left" || side === "right") {
        const pad = Math.min(28, Math.max(10, node.height * 0.18));
        const peerCy = peer.position.y + peer.height / 2;
        const y = Math.min(Math.max(peerCy, node.position.y + pad), node.position.y + node.height - pad);
        return { x: tip.x, y };
    }
    const pad = Math.min(28, Math.max(10, node.width * 0.18));
    const peerCx = peer.position.x + peer.width / 2;
    const x = Math.min(Math.max(peerCx, node.position.x + pad), node.position.x + node.width - pad);
    return { x, y: tip.y };
}

type MindFanContext = {
    connectionId?: string;
    connections?: CanvasConnection[];
    nodeById?: Map<string, CanvasNodeData>;
};

function connectionIdOf(anchors?: Pick<CanvasConnection, "fromAnchor" | "toAnchor" | "fromSide" | "toSide"> | null) {
    return anchors && "id" in anchors && typeof (anchors as CanvasConnection).id === "string" ? (anchors as CanvasConnection).id : "";
}

/** 普通 mind 同侧多线沿边等距落点；判断节点出边仍共用尖点。 */
function fanMindSideAnchor(
    point: Position,
    node: CanvasNodeData,
    side: ConnectionHandleSide,
    role: "from" | "to",
    fan?: MindFanContext,
): Position {
    if (!isMindNode(node) || !fan?.connections?.length || !fan.connectionId || !fan.nodeById) return point;
    if (role === "from" && isDecisionNode(node) && sharedDecisionExitSide(node, fan.nodeById, fan.connections)) return point;
    const siblings = fan.connections.filter((conn) => mindConnectionSideOnNode(conn, node.id, side, fan.nodeById!, fan.connections!) !== null);
    if (siblings.length <= 1) return point;
    const ranked = [...siblings].sort((a, b) => {
        const da = peerAlongSide(a, node.id, side, fan.nodeById!);
        const db = peerAlongSide(b, node.id, side, fan.nodeById!);
        return da - db || a.id.localeCompare(b.id);
    });
    const index = ranked.findIndex((conn) => conn.id === fan.connectionId);
    if (index < 0) return point;
    const along = side === "left" || side === "right" ? node.height : node.width;
    const pad = Math.min(28, Math.max(10, along * 0.16));
    const usable = Math.max(along - pad * 2, 12);
    const offset = pad + (usable * (index + 1)) / (ranked.length + 1);
    if (side === "left" || side === "right") return { x: point.x, y: node.position.y + offset };
    return { x: node.position.x + offset, y: point.y };
}

function mindConnectionSideOnNode(
    connection: CanvasConnection,
    nodeId: string,
    side: ConnectionHandleSide,
    nodeById: Map<string, CanvasNodeData>,
    connections: CanvasConnection[],
): ConnectionHandleSide | null {
    const from = nodeById.get(connection.fromNodeId);
    const to = nodeById.get(connection.toNodeId);
    if (!from || !to || resolveConnectionKind(connection, from, to) !== "mind") return null;
    const layoutFrom = resolveMindLayoutPeer(from, to, nodeById);
    const layoutTo = resolveMindLayoutPeer(to, from, nodeById);
    const useStored = layoutFrom.id === from.id && layoutTo.id === to.id;
    let startSide = useStored ? connection.fromSide : undefined;
    let endSide = useStored ? connection.toSide : undefined;
    if (isDecisionNode(layoutFrom)) {
        const shared = sharedDecisionExitSide(layoutFrom, nodeById, connections);
        if (shared) {
            startSide = shared;
            endSide = pickMindConnectionSides(layoutFrom, layoutTo).endSide;
        }
    }
    const auto = pickMindConnectionSides(layoutFrom, layoutTo);
    const resolvedStart = startSide || auto.startSide;
    const resolvedEnd = endSide || auto.endSide;
    if (layoutFrom.id === nodeId && resolvedStart === side) return resolvedStart;
    if (layoutTo.id === nodeId && resolvedEnd === side) return resolvedEnd;
    return null;
}

function peerAlongSide(connection: CanvasConnection, nodeId: string, side: ConnectionHandleSide, nodeById: Map<string, CanvasNodeData>) {
    const from = nodeById.get(connection.fromNodeId);
    const to = nodeById.get(connection.toNodeId);
    if (!from || !to) return 0;
    const layoutFrom = resolveMindLayoutPeer(from, to, nodeById);
    const layoutTo = resolveMindLayoutPeer(to, from, nodeById);
    const peer = layoutFrom.id === nodeId ? layoutTo : layoutFrom;
    return side === "left" || side === "right" ? peer.position.y + peer.height / 2 : peer.position.x + peer.width / 2;
}

/** 按相对位置选尖点；若传入手动边则优先使用 */
export function getMindConnectionEndpoints(
    from: CanvasNodeData,
    to: CanvasNodeData,
    startSide?: ConnectionHandleSide | null,
    endSide?: ConnectionHandleSide | null,
    fan?: MindFanContext,
): ConnectionEndpoints {
    const auto = pickMindConnectionSides(from, to);
    const resolvedStart = startSide || auto.startSide;
    const resolvedEnd = endSide || auto.endSide;
    const start = fanMindSideAnchor(slideMindSideAnchor(from, resolvedStart, to), from, resolvedStart, "from", fan);
    const end = fanMindSideAnchor(slideMindSideAnchor(to, resolvedEnd, from), to, resolvedEnd, "to", fan);
    const span = Math.max(Math.hypot(end.x - start.x, end.y - start.y), 48);
    const sameAxis =
        (resolvedStart === "left" || resolvedStart === "right") === (resolvedEnd === "left" || resolvedEnd === "right");
    const curvature = Math.max(span * (sameAxis ? 0.42 : 0.55), sameAxis ? 36 : 48);
    return {
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        curvature,
        mind: true,
        vertical: resolvedStart === "top" || resolvedStart === "bottom" || resolvedEnd === "top" || resolvedEnd === "bottom",
        startSide: resolvedStart,
        endSide: resolvedEnd,
    };
}

/** 避障只对跨度足够大的导图边启用；短边基本不会穿节点 */
const BOW_MIN_SPAN = 200;
const BOW_MARGIN = 28;
const BOW_MAX = 240;

/**
 * 长导图边避障：检测弦线段沿途挡道的实体节点（组框空心可穿），
 * 取「清障所需偏移小」的一侧算 bow，让贝塞尔从旁边绕过而不是直穿节点。
 */
function withMindEdgeBow(
    endpoints: ConnectionEndpoints,
    from: CanvasNodeData,
    to: CanvasNodeData,
    nodeById?: Map<string, CanvasNodeData>,
): ConnectionEndpoints {
    if (!nodeById || nodeById.size < 3) return endpoints;
    const dx = endpoints.endX - endpoints.startX;
    const dy = endpoints.endY - endpoints.startY;
    const span = Math.hypot(dx, dy);
    if (span < BOW_MIN_SPAN) return endpoints;
    const ux = dx / span;
    const uy = dy / span;
    const nx = -uy;
    const ny = ux;
    const skip = new Set([from.id, to.id]);
    if (from.metadata?.groupId) skip.add(String(from.metadata.groupId));
    if (to.metadata?.groupId) skip.add(String(to.metadata.groupId));

    let blocked = false;
    let posNeed = 0;
    let negNeed = 0;
    for (const node of nodeById.values()) {
        if (skip.has(node.id)) continue;
        if (node.type === "group") continue;
        let minT = Infinity;
        let maxT = -Infinity;
        let minP = Infinity;
        let maxP = -Infinity;
        for (const corner of [
            { x: node.position.x, y: node.position.y },
            { x: node.position.x + node.width, y: node.position.y },
            { x: node.position.x, y: node.position.y + node.height },
            { x: node.position.x + node.width, y: node.position.y + node.height },
        ]) {
            const rx = corner.x - endpoints.startX;
            const ry = corner.y - endpoints.startY;
            const t = rx * ux + ry * uy;
            const p = rx * nx + ry * ny;
            minT = Math.min(minT, t);
            maxT = Math.max(maxT, t);
            minP = Math.min(minP, p);
            maxP = Math.max(maxP, p);
        }
        // 端点附近留 24px 起步区，避免把相邻父子当成障碍
        if (maxT < 24 || minT > span - 24) continue;
        if (minP > 8 || maxP < -8) continue;
        blocked = true;
        posNeed = Math.max(posNeed, maxP + BOW_MARGIN);
        negNeed = Math.min(negNeed, minP - BOW_MARGIN);
    }
    if (!blocked) return endpoints;
    const chosen = posNeed <= -negNeed ? Math.min(posNeed, BOW_MAX) : Math.max(negNeed, -BOW_MAX);
    // 双控制点同偏移时曲线中点约为 0.75×偏移，按 4/3 补偿
    return { ...endpoints, bow: chosen * (4 / 3) };
}

/** 标注连线：from=标注 → to=原节点；两端取相对朝向的尖点，箭头在 to */
export function getAnnotationConnectionEndpoints(from: CanvasNodeData, to: CanvasNodeData): ConnectionEndpoints {
    const fromCX = from.position.x + from.width / 2;
    const fromCY = from.position.y + from.height / 2;
    const toCX = to.position.x + to.width / 2;
    const toCY = to.position.y + to.height / 2;
    const dx = toCX - fromCX;
    const dy = toCY - fromCY;

    const startSide =
        Math.abs(dy) >= Math.abs(dx) * 0.55
            ? dy < 0
                ? "top"
                : "bottom"
            : dx < 0
              ? "left"
              : "right";
    const endSide =
        Math.abs(dy) >= Math.abs(dx) * 0.55
            ? dy < 0
                ? "bottom"
                : "top"
            : dx < 0
              ? "right"
              : "left";

    const start = mindNodeSideAnchor(from, startSide);
    const end = mindNodeSideAnchor(to, endSide);

    const span = Math.max(Math.hypot(end.x - start.x, end.y - start.y), 40);
    const curvature = Math.max(span * 0.38, 32);
    return { startX: start.x, startY: start.y, endX: end.x, endY: end.y, curvature, annotation: true };
}

export function buildBezierPath2D(endpoints: ConnectionEndpoints): Path2D {
    const path = new Path2D();
    path.moveTo(endpoints.startX, endpoints.startY);
    const { c1x, c1y, c2x, c2y } = bezierControls(endpoints);
    path.bezierCurveTo(c1x, c1y, c2x, c2y, endpoints.endX, endpoints.endY);
    return path;
}

function bezierControls(endpoints: ConnectionEndpoints) {
    const controls = baseBezierControls(endpoints);
    const bow = endpoints.bow || 0;
    if (!bow) return controls;
    const dx = endpoints.endX - endpoints.startX;
    const dy = endpoints.endY - endpoints.startY;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return {
        c1x: controls.c1x + nx * bow,
        c1y: controls.c1y + ny * bow,
        c2x: controls.c2x + nx * bow,
        c2y: controls.c2y + ny * bow,
    };
}

function baseBezierControls(endpoints: ConnectionEndpoints) {
    const { startX, startY, endX, endY, curvature, mind, annotation, vertical, startSide, endSide, xing, startNormal, endNormal } =
        endpoints;
    // 星小驰：沿表面径向短控点起笔，避免默认水平贝塞尔 / 导图正交在接点处拧成钩
    if (xing && startNormal && endNormal) {
        const span = Math.hypot(endX - startX, endY - startY) || 1;
        const d = Math.min(Math.max(curvature * 0.55, 14), span * 0.3);
        return {
            c1x: startX + startNormal.x * d,
            c1y: startY + startNormal.y * d,
            c2x: endX + endNormal.x * d,
            c2y: endY + endNormal.y * d,
        };
    }
    if (annotation) {
        const dx = endX - startX;
        const dy = endY - startY;
        if (Math.abs(dy) >= Math.abs(dx) * 0.55) {
            const dir = endY >= startY ? 1 : -1;
            return {
                c1x: startX,
                c1y: startY + curvature * dir,
                c2x: endX,
                c2y: endY - curvature * dir,
            };
        }
        // 水平向：控制点沿连线法向轻微外拱，箭头仍指向 end（原节点）
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const bow = dy <= 0 ? -1 : 1;
        return {
            c1x: startX + dx * 0.3 + nx * curvature * 0.55 * bow,
            c1y: startY + dy * 0.3 + ny * curvature * 0.55 * bow,
            c2x: endX - dx * 0.3 + nx * curvature * 0.55 * bow,
            c2y: endY - dy * 0.3 + ny * curvature * 0.55 * bow,
        };
    }
    if (mind) {
        // 有明确离开/进入边：控制点沿外侧法线伸出 → 右出上进呈外拱 L 形
        if (startSide && endSide) {
            const n1 = sideOutward(startSide);
            const n2 = sideOutward(endSide);
            const dx = Math.abs(endX - startX);
            const dy = Math.abs(endY - startY);
            const opposite =
                (startSide === "bottom" && endSide === "top") ||
                (startSide === "top" && endSide === "bottom") ||
                (startSide === "left" && endSide === "right") ||
                (startSide === "right" && endSide === "left");
            const sameAxis =
                (startSide === "left" || startSide === "right") === (endSide === "left" || endSide === "right");
            // 对边直连：控制点收短，居中时接近直线，避免大弯绕圈
            if (opposite && sameAxis) {
                const span = sameAxis && (startSide === "left" || startSide === "right") ? dx : dy;
                const d = Math.min(Math.max(span * 0.22, 12), Math.max(curvature * 0.55, 28));
                return {
                    c1x: startX + n1.x * d,
                    c1y: startY + n1.y * d,
                    c2x: endX + n2.x * d,
                    c2y: endY + n2.y * d,
                };
            }
            const d1 = Math.max(curvature * 0.85, Math.min(dx * 0.4, dy * 0.55 + 24), 28);
            const d2 = Math.max(curvature * 0.85, Math.min(dy * 0.4, dx * 0.55 + 24), 28);
            return {
                c1x: startX + n1.x * d1,
                c1y: startY + n1.y * d1,
                c2x: endX + n2.x * d2,
                c2y: endY + n2.y * d2,
            };
        }
        if (vertical || Math.abs(endY - startY) >= Math.abs(endX - startX) * 0.55) {
            const dir = endY >= startY ? 1 : -1;
            return {
                c1x: startX,
                c1y: startY + curvature * dir,
                c2x: endX,
                c2y: endY - curvature * dir,
            };
        }
        const dir = endX >= startX ? 1 : -1;
        return {
            c1x: startX + curvature * dir,
            c1y: startY,
            c2x: endX - curvature * dir,
            c2y: endY,
        };
    }
    return {
        c1x: startX + curvature,
        c1y: startY,
        c2x: endX - curvature,
        c2y: endY,
    };
}

export function bezierPathD(endpoints: ConnectionEndpoints) {
    const { startX, startY, endX, endY } = endpoints;
    const { c1x, c1y, c2x, c2y } = bezierControls(endpoints);
    return `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}`;
}

/** 贝塞尔曲线上参数 t∈[0,1] 的点（用于连线中点标签等） */
export function pointOnConnectionBezier(endpoints: ConnectionEndpoints, t: number): Position {
    const { startX, startY, endX, endY } = endpoints;
    const { c1x, c1y, c2x, c2y } = bezierControls(endpoints);
    const u = 1 - t;
    return {
        x: u * u * u * startX + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * endX,
        y: u * u * u * startY + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * endY,
    };
}

export function tangentOnConnectionBezier(endpoints: ConnectionEndpoints, t: number): Position {
    const { startX, startY, endX, endY } = endpoints;
    const { c1x, c1y, c2x, c2y } = bezierControls(endpoints);
    const u = 1 - t;
    const dx = 3 * u * u * (c1x - startX) + 6 * u * t * (c2x - c1x) + 3 * t * t * (endX - c2x);
    const dy = 3 * u * u * (c1y - startY) + 6 * u * t * (c2y - c1y) + 3 * t * t * (endY - c2y);
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
}

/** 标签中心：沿法线离开描边，默认抬到线上方，避免压住连线。 */
export function connectionLabelWorld(endpoints: ConnectionEndpoints, pillHeight = 20): Position {
    const mid = pointOnConnectionBezier(endpoints, 0.5);
    const tan = tangentOnConnectionBezier(endpoints, 0.5);
    let nx = -tan.y;
    let ny = tan.x;
    if (ny > 0) {
        nx = -nx;
        ny = -ny;
    }
    const offset = 8 + pillHeight / 2;
    return { x: mid.x + nx * offset, y: mid.y + ny * offset };
}

export type MindHop = { t: number };

/** 贝塞尔位于端点与控制点的凸包内，不能只按两个节点是否可见裁掉跨屏长线。 */
export function getConnectionCurveBounds(endpoints: ConnectionEndpoints) {
    const { c1x, c1y, c2x, c2y } = bezierControls(endpoints);
    return {
        minX: Math.min(endpoints.startX, endpoints.endX, c1x, c2x),
        minY: Math.min(endpoints.startY, endpoints.endY, c1y, c2y),
        maxX: Math.max(endpoints.startX, endpoints.endX, c1x, c2x),
        maxY: Math.max(endpoints.startY, endpoints.endY, c1y, c2y),
    };
}

function sampleBezierPoints(endpoints: ConnectionEndpoints, steps: number) {
    const pts: Position[] = [];
    for (let i = 0; i <= steps; i += 1) pts.push(pointOnConnectionBezier(endpoints, i / steps));
    return pts;
}

function segmentIntersect(a1: Position, a2: Position, b1: Position, b2: Position) {
    const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
    if (Math.abs(d) < 1e-6) return null;
    const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
    const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
    if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
    return { t, u };
}

function mergeMindHops(endpoints: ConnectionEndpoints, hops: MindHop[]): MindHop[] {
    const sorted = [...hops].sort((a, b) => a.t - b.t);
    const next: MindHop[] = [];
    for (const hop of sorted) {
        const last = next[next.length - 1];
        if (!last) {
            next.push({ t: hop.t });
            continue;
        }
        const a = pointOnConnectionBezier(endpoints, last.t);
        const b = pointOnConnectionBezier(endpoints, hop.t);
        if (Math.hypot(a.x - b.x, a.y - b.y) < 28) last.t = (last.t + hop.t) / 2;
        else next.push({ t: hop.t });
    }
    return next;
}

const MIND_HOP_STEPS = 32;
const mindCurveSamples = new WeakMap<ConnectionEndpoints, ReturnType<typeof sampleMindCurve>>();
function sampleMindCurve(endpoints: ConnectionEndpoints) {
    const pts = sampleBezierPoints(endpoints, MIND_HOP_STEPS);
    const left = Math.min(...pts.map((p) => p.x)), right = Math.max(...pts.map((p) => p.x));
    const top = Math.min(...pts.map((p) => p.y)), bottom = Math.max(...pts.map((p) => p.y));
    return {
        minX: left, maxX: right, minY: top, maxY: bottom, left, right, top, bottom,
        segments: pts.slice(1).map((end, index) => {
            const start = pts[index];
            return {
                start, end,
                left: Math.min(start.x, end.x), right: Math.max(start.x, end.x),
                top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y),
            };
        }),
    };
}

/** 导图边相交时 id 较大的边抬桥；用空间索引筛选候选，复用未变化曲线的采样。 */
export function findMindEdgeHops(items: Array<{ id: string; endpoints: ConnectionEndpoints }>): Map<string, MindHop[]> {
    const mind = items.filter((item) => item.endpoints.mind);
    const hops = new Map<string, MindHop[]>();
    if (mind.length < 2) return hops;
    const steps = MIND_HOP_STEPS;
    const sampled = mind.map((item, index) => {
        let sample = mindCurveSamples.get(item.endpoints);
        if (!sample) {
            sample = sampleMindCurve(item.endpoints);
            mindCurveSamples.set(item.endpoints, sample);
        }
        return { ...item, index, ...sample };
    });
    const tree = new RBush<(typeof sampled)[number]>().load(sampled);
    const add = (id: string, t: number) => {
        const list = hops.get(id) || [];
        if (list.some((hop) => Math.abs(hop.t - t) < 0.05)) return;
        list.push({ t });
        hops.set(id, list);
    };
    for (const a of sampled) {
        // 按原顺序比较，保留过近交叉的合并结果。
        for (const b of tree.search(a).filter((item) => item.index > a.index).sort((x, y) => x.index - y.index)) {
            // 包围框不相交时无需比较 32×32 段，采样与抬桥规则保持不变。
            if (a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top) continue;
            for (let ia = 0; ia < a.segments.length; ia += 1) {
                const sa = a.segments[ia];
                if (sa.right < b.left || b.right < sa.left || sa.bottom < b.top || b.bottom < sa.top) continue;
                for (let ib = 0; ib < b.segments.length; ib += 1) {
                    const sb = b.segments[ib];
                    if (sa.right < sb.left || sb.right < sa.left || sa.bottom < sb.top || sb.bottom < sa.top) continue;
                    const hit = segmentIntersect(sa.start, sa.end, sb.start, sb.end);
                    if (!hit) continue;
                    const tA = (ia + hit.t) / steps;
                    const tB = (ib + hit.u) / steps;
                    if (tA < 0.14 || tA > 0.86 || tB < 0.14 || tB > 0.86) continue;
                    const tanA = tangentOnConnectionBezier(a.endpoints, tA);
                    const tanB = tangentOnConnectionBezier(b.endpoints, tB);
                    if (Math.abs(tanA.x * tanB.x + tanA.y * tanB.y) > 0.93) continue;
                    const upper = a.id > b.id ? a : b;
                    add(upper.id, upper === a ? tA : tB);
                }
            }
        }
    }
    const byId = new Map(mind.map((item) => [item.id, item]));
    for (const [id, list] of hops) {
        const item = byId.get(id);
        hops.set(id, item ? mergeMindHops(item.endpoints, list) : list);
    }
    return hops;
}

/** 交叉处用二次弧抬起，其余仍沿原贝塞尔。 */
export function buildMindBezierPathWithHops(endpoints: ConnectionEndpoints, hops: MindHop[]): Path2D {
    const merged = mergeMindHops(endpoints, hops);
    if (!merged.length) return buildBezierPath2D(endpoints);
    let length = 0;
    let prev = pointOnConnectionBezier(endpoints, 0);
    for (let i = 1; i <= 16; i += 1) {
        const point = pointOnConnectionBezier(endpoints, i / 16);
        length += Math.hypot(point.x - prev.x, point.y - prev.y);
        prev = point;
    }
    const dt = Math.min(0.09, Math.max(0.025, 12 / Math.max(length, 48)));
    const path = new Path2D();
    path.moveTo(endpoints.startX, endpoints.startY);
    const sampleTo = (from: number, to: number) => {
        const steps = Math.max(1, Math.round(Math.abs(to - from) * 40));
        for (let i = 1; i <= steps; i += 1) {
            const point = pointOnConnectionBezier(endpoints, from + ((to - from) * i) / steps);
            path.lineTo(point.x, point.y);
        }
    };
    let cursor = 0;
    for (const hop of merged) {
        const tA = Math.max(0.02, hop.t - dt);
        const tB = Math.min(0.98, hop.t + dt);
        if (tA > cursor) sampleTo(cursor, tA);
        const pB = pointOnConnectionBezier(endpoints, tB);
        const mid = pointOnConnectionBezier(endpoints, hop.t);
        const tan = tangentOnConnectionBezier(endpoints, hop.t);
        let nx = -tan.y;
        let ny = tan.x;
        if (ny > 0) {
            nx = -nx;
            ny = -ny;
        }
        path.quadraticCurveTo(mid.x + nx * 8, mid.y + ny * 8, pB.x, pB.y);
        cursor = tB;
    }
    if (cursor < 1) sampleTo(cursor, 1);
    return path;
}

/** 箭头朝向：有入口边时垂直贴边向内，避免扇出斜线把三角插进描边 */
function arrowDirection(endpoints: ConnectionEndpoints): { ux: number; uy: number } {
    if (endpoints.endSide) {
        const out = sideOutward(endpoints.endSide);
        return { ux: -out.x, uy: -out.y };
    }
    const { endX, endY } = endpoints;
    const { c2x, c2y } = bezierControls(endpoints);
    const vx = endX - c2x;
    const vy = endY - c2y;
    const len = Math.hypot(vx, vy) || 1;
    return { ux: vx / len, uy: vy / len };
}

/** 线画到箭头根部，避免线头穿进箭头尖 / 节点边 */
export function shortenEndpointsForArrow(endpoints: ConnectionEndpoints, size = 7): ConnectionEndpoints {
    const { ux, uy } = arrowDirection(endpoints);
    const tipInset = Math.min(2.5, size * 0.28);
    const pull = size * 0.92 + tipInset;
    return {
        ...endpoints,
        endX: endpoints.endX - ux * pull,
        endY: endpoints.endY - uy * pull,
    };
}

/** 连线终点箭头（指向 end）；尖端略退到边外，翼展收窄 */
export function connectionArrowPoints(endpoints: ConnectionEndpoints, size = 7) {
    const { endX, endY } = endpoints;
    const { ux, uy } = arrowDirection(endpoints);
    const tipInset = Math.min(2.5, size * 0.28);
    const tipX = endX - ux * tipInset;
    const tipY = endY - uy * tipInset;
    const px = -uy;
    const py = ux;
    const wing = size * 0.36;
    return [
        [tipX, tipY],
        [tipX - ux * size + px * wing, tipY - uy * size + py * wing],
        [tipX - ux * size - px * wing, tipY - uy * size - py * wing],
    ] as const;
}

export function annotationArrowPoints(endpoints: ConnectionEndpoints, size = 7) {
    return connectionArrowPoints(endpoints, size);
}

export function buildActiveConnectionEndpoints(
    node: CanvasNodeData,
    handle: ConnectionHandle,
    mouseWorld: Position,
    target?: CanvasNodeData,
    mode: "default" | "mind" | "annotation" = "default",
): ConnectionEndpoints {
    // 标注模式：虚线+箭头语义；导图上下点仍走 mind（实线）几何
    if (mode === "annotation") {
        if (target) {
            const from = handle.handleType === "source" ? node : target;
            const to = handle.handleType === "source" ? target : node;
            return getAnnotationConnectionEndpoints(from, to);
        }
        const fromTop = handle.side === "top" || (handle.side !== "bottom" && mouseWorld.y < node.position.y + node.height / 2);
        const start = handle.handleType === "source"
            ? mindNodeSideAnchor(node, fromTop ? "top" : "bottom")
            : mouseWorld;
        const end = handle.handleType === "source"
            ? mouseWorld
            : mindNodeSideAnchor(node, fromTop ? "top" : "bottom");
        const span = Math.max(Math.hypot(end.x - start.x, end.y - start.y), 40);
        return { startX: start.x, startY: start.y, endX: end.x, endY: end.y, curvature: Math.max(span * 0.35, 28), annotation: true };
    }
    if (mode === "mind") {
        if (target?.type === CanvasNodeType.Group) {
            const toAnchor = nearestBorderAnchor(target, mouseWorld);
            const border = absoluteAnchorPoint(target, toAnchor);
            const borderSide = edgeOfRelativeAnchor(toAnchor);
            if (handle.handleType === "source") {
                const startSide: ConnectionHandleSide =
                    handle.side === "top" || handle.side === "bottom" || handle.side === "left" || handle.side === "right"
                        ? handle.side
                        : mouseWorld.x < node.position.x + node.width / 2
                          ? "left"
                          : "right";
                const start = mindNodeSideAnchor(node, startSide);
                const span = Math.max(Math.hypot(border.x - start.x, border.y - start.y), 48);
                return {
                    startX: start.x,
                    startY: start.y,
                    endX: border.x,
                    endY: border.y,
                    curvature: Math.max(span * 0.5, 40),
                    mind: true,
                    startSide,
                    endSide: borderSide,
                    vertical: startSide === "top" || startSide === "bottom" || borderSide === "top" || borderSide === "bottom",
                };
            }
            const endSide: ConnectionHandleSide =
                handle.side === "top" || handle.side === "bottom" || handle.side === "left" || handle.side === "right" ? handle.side : "left";
            const end = mindNodeSideAnchor(node, endSide);
            const span = Math.max(Math.hypot(end.x - border.x, end.y - border.y), 48);
            return {
                startX: border.x,
                startY: border.y,
                endX: end.x,
                endY: end.y,
                curvature: Math.max(span * 0.5, 40),
                mind: true,
                startSide: borderSide,
                endSide,
                vertical: endSide === "top" || endSide === "bottom" || borderSide === "top" || borderSide === "bottom",
            };
        }
        if (target) {
            const from = handle.handleType === "source" ? node : target;
            const to = handle.handleType === "source" ? target : node;
            const dropSide = nearestMindHandleSide(target, mouseWorld);
            const startSide =
                handle.handleType === "source"
                    ? handle.side === "top" || handle.side === "bottom" || handle.side === "left" || handle.side === "right"
                        ? handle.side
                        : pickMindConnectionSides(from, to).startSide
                    : dropSide;
            const endSide =
                handle.handleType === "source"
                    ? dropSide
                    : handle.side === "top" || handle.side === "bottom" || handle.side === "left" || handle.side === "right"
                      ? handle.side
                      : pickMindConnectionSides(from, to).endSide;
            return getMindConnectionEndpoints(from, to, startSide, endSide);
        }
        if (handle.side === "top" || handle.side === "bottom") {
            const start = handle.handleType === "source" ? mindNodeSideAnchor(node, handle.side) : mouseWorld;
            const end = handle.handleType === "source" ? mouseWorld : mindNodeSideAnchor(node, handle.side);
            const span = Math.max(Math.hypot(end.x - start.x, end.y - start.y), 40);
            return { startX: start.x, startY: start.y, endX: end.x, endY: end.y, curvature: Math.max(span * 0.35, 28), mind: true, vertical: true };
        }
        const fromMid = node.position.x + node.width / 2;
        const growLeft = mouseWorld.x < fromMid;
        const start = handle.handleType === "source"
            ? mindNodeSideAnchor(node, growLeft ? "left" : "right")
            : mouseWorld;
        const end = handle.handleType === "source"
            ? mouseWorld
            : mindNodeSideAnchor(node, growLeft ? "right" : "left");
        const curvature = Math.max(Math.abs(end.x - start.x) * 0.45, 36);
        return { startX: start.x, startY: start.y, endX: end.x, endY: end.y, curvature, mind: true };
    }
    const anchor = defaultNodeHandleAnchor(node, handle);
    const startX = handle.handleType === "source" ? anchor.x : mouseWorld.x;
    const startY = handle.handleType === "source" ? anchor.y : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : anchor.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : anchor.y;
    // 吸附数据组：终点/起点落到组边框最近点，不强制左右中点
    if (target?.type === CanvasNodeType.Group) {
        const toAnchor = nearestBorderAnchor(target, mouseWorld);
        const border = absoluteAnchorPoint(target, toAnchor);
        const borderSide = edgeOfRelativeAnchor(toAnchor);
        if (handle.handleType === "source") {
            const startSide: ConnectionHandleSide =
                handle.side === "top" || handle.side === "bottom" || handle.side === "left" || handle.side === "right" ? handle.side : "right";
            const start = mindNodeSideAnchor(node, startSide);
            const span = Math.max(Math.hypot(border.x - start.x, border.y - start.y), 48);
            return {
                startX: start.x,
                startY: start.y,
                endX: border.x,
                endY: border.y,
                curvature: Math.max(span * 0.5, 40),
                mind: true,
                startSide,
                endSide: borderSide,
                vertical: startSide === "top" || startSide === "bottom" || borderSide === "top" || borderSide === "bottom",
            };
        }
        const endSide: ConnectionHandleSide =
            handle.side === "top" || handle.side === "bottom" || handle.side === "left" || handle.side === "right" ? handle.side : "left";
        const end = mindNodeSideAnchor(node, endSide);
        const span = Math.max(Math.hypot(end.x - border.x, end.y - border.y), 48);
        return {
            startX: border.x,
            startY: border.y,
            endX: end.x,
            endY: end.y,
            curvature: Math.max(span * 0.5, 40),
            mind: true,
            startSide: borderSide,
            endSide,
            vertical: endSide === "top" || endSide === "bottom" || borderSide === "top" || borderSide === "bottom",
        };
    }
    // 星小驰：表面任意吸附（黏土粘滞）
    const xingStartAnchor = (n: CanvasNodeData) =>
        handle.anchor || nearestXingSurfaceAnchor(n, mouseWorld);
    if (target && isXingXiaochiNode(target)) {
        const sticky = stickyXingWorldPoint(target, mouseWorld);
        const surface = absoluteXingSurfacePoint(target, nearestXingSurfaceAnchor(target, sticky));
        if (handle.handleType === "source") {
            const start = isXingXiaochiNode(node)
                ? absoluteXingSurfacePoint(node, xingStartAnchor(node))
                : { x: startX, y: startY };
            const startSide =
                handle.side === "top" || handle.side === "bottom" || handle.side === "left" || handle.side === "right"
                    ? handle.side
                    : "right";
            return buildXingConnectionEndpoints(node, target, start, surface, startSide, edgeOfRelativeAnchor(nearestXingSurfaceAnchor(target, sticky)));
        }
        const end = isXingXiaochiNode(node)
            ? absoluteXingSurfacePoint(node, xingStartAnchor(node))
            : { x: endX, y: endY };
        const endSide =
            handle.side === "top" || handle.side === "bottom" || handle.side === "left" || handle.side === "right"
                ? handle.side
                : "left";
        return buildXingConnectionEndpoints(target, node, surface, end, edgeOfRelativeAnchor(nearestXingSurfaceAnchor(target, sticky)), endSide);
    }
    if (isXingXiaochiNode(node)) {
        const start = absoluteXingSurfacePoint(node, xingStartAnchor(node));
        const ghost = { position: { x: mouseWorld.x, y: mouseWorld.y }, width: 1, height: 1 } as CanvasNodeData;
        if (handle.handleType === "source") {
            return buildXingConnectionEndpoints(node, ghost, start, mouseWorld, undefined, "left");
        }
        return buildXingConnectionEndpoints(ghost, node, mouseWorld, start, "right", undefined);
    }
    const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;
    const snappedStartY = handle.handleType === "target" && target ? target.position.y + target.height / 2 : startY;
    const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;
    const snappedEndY = handle.handleType === "source" && target ? target.position.y + target.height / 2 : endY;
    const distance = Math.abs(snappedEndX - snappedStartX);
    const curvature = distance * 0.5;
    return { startX: snappedStartX, startY: snappedStartY, endX: snappedEndX, endY: snappedEndY, curvature };
}

function defaultNodeHandleAnchor(node: CanvasNodeData, handle: ConnectionHandle): Position {
    const midY = node.position.y + node.height / 2;
    const midX = node.position.x + node.width / 2;
    if (handle.side === "left") return { x: node.position.x, y: midY };
    if (handle.side === "right") return { x: node.position.x + node.width, y: midY };
    if (handle.side === "top") return { x: midX, y: node.position.y };
    if (handle.side === "bottom") return { x: midX, y: node.position.y + node.height };
    return handle.handleType === "source"
        ? { x: node.position.x + node.width, y: midY }
        : { x: node.position.x, y: midY };
}

export type ConnectionHitItem = {
    id: string;
    path: Path2D;
};

export function buildConnectionHitItems(connections: CanvasConnection[], nodeById: Map<string, CanvasNodeData>): ConnectionHitItem[] {
    const items: ConnectionHitItem[] = [];
    connections.forEach((connection) => {
        const from = nodeById.get(connection.fromNodeId);
        const to = nodeById.get(connection.toNodeId);
        if (!from || !to) return;
        items.push({
            id: connection.id,
            path: buildBezierPath2D(
                getConnectionEndpoints(from, to, resolveConnectionKind(connection, from, to), connection, nodeById, connections),
            ),
        });
    });
    return items;
}

let hitTestContext: CanvasRenderingContext2D | null = null;

function getHitTestContext() {
    if (hitTestContext) return hitTestContext;
    const canvas = document.createElement("canvas");
    hitTestContext = canvas.getContext("2d");
    return hitTestContext;
}

export function hitTestConnectionAt(worldX: number, worldY: number, items: ConnectionHitItem[], tolerance = 8) {
    const ctx = getHitTestContext();
    if (!ctx) return null;
    ctx.lineWidth = tolerance * 2;
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (ctx.isPointInStroke(item.path, worldX, worldY)) return item.id;
    }
    return null;
}

export function hitTestNodeBoundsAt(worldX: number, worldY: number, nodes: CanvasNodeData[]) {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        const { x, y } = node.position;
        if (worldX >= x && worldX <= x + node.width && worldY >= y && worldY <= y + node.height) return node;
    }
    return null;
}
