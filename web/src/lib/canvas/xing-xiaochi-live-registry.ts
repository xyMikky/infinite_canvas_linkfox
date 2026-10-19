import type { ConnectionEndpoints } from "@/lib/canvas/canvas-connection-geometry";
import { absoluteXingSurfacePoint, isXingXiaochiNode, xingBodyCenterLocal } from "@/lib/canvas/xing-xiaochi-ports";
import type { GrokCharacterInstance } from "@/lib/canvas/xing-xiaochi-engine";
import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";

type XingLiveEntry = {
    svg: SVGSVGElement;
    body: SVGPathElement;
    sizePx: number;
    bot?: GrokCharacterInstance | null;
};

type GrokBotInternal = GrokCharacterInstance & {
    _paint?: (now: number) => void;
    __xingLiveHooked?: boolean;
};

const liveByNodeId = new Map<string, XingLiveEntry>();
const frameListeners = new Set<() => void>();
let connectedNodeIds = new Set<string>();

export function setXingConnectedNodes(ids: Set<string>) {
    connectedNodeIds = ids;
    liveByNodeId.forEach((entry, id) => entry.bot?.setTethered(ids.has(id)));
}

export function registerXingLive(nodeId: string, entry: XingLiveEntry) {
    liveByNodeId.set(nodeId, entry);
    entry.bot?.setTethered(connectedNodeIds.has(nodeId));
    hookBotFrame(entry);
}

export function unregisterXingLive(nodeId: string) {
    liveByNodeId.delete(nodeId);
}

export function hasXingLive(nodeId: string) {
    return liveByNodeId.has(nodeId);
}

export function hasAnyXingLive() {
    return liveByNodeId.size > 0;
}

/** 订阅星小驰角色每帧绘制之后的回调（与身体动画同帧） */
export function subscribeXingLiveFrame(listener: () => void) {
    frameListeners.add(listener);
    return () => {
        frameListeners.delete(listener);
    };
}

function emitXingLiveFrame() {
    frameListeners.forEach((fn) => {
        try {
            fn();
        } catch {
            /* ignore */
        }
    });
}

function hookBotFrame(entry: XingLiveEntry) {
    const bot = entry.bot as GrokBotInternal | null | undefined;
    if (!bot?._paint || bot.__xingLiveHooked) return;
    const orig = bot._paint.bind(bot);
    bot._paint = (now: number) => {
        orig(now);
        emitXingLiveFrame();
    };
    bot.__xingLiveHooked = true;
}

function angleDelta(a: number, b: number) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
}

/**
 * 锁定身体局部方向，接点随身体一起动；在真实节点屏幕框中换算世界坐标，
 * 包含状态文字引起的 SVG 位移，不假定角色始终在节点正中。
 */
export function getLiveXingWorldPoint(node: CanvasNodeData, preferredWorld: Position): (Position & { normal: Position }) | null {
    const entry = liveByNodeId.get(node.id);
    if (!entry?.body || !entry.svg) return null;
    try {
        const { svg, body } = entry;
        const len = body.getTotalLength();
        if (!(len > 0)) return null;
        const ctm = body.getScreenCTM();
        const rect = svg.closest("[data-node-id]")?.getBoundingClientRect();
        if (!ctm || !rect || rect.width <= 1 || rect.height <= 1) return null;
        const sp = svg.createSVGPoint();
        const pivot = 114.27;
        const toWorld = (point: Position) => {
            sp.x = point.x;
            sp.y = point.y;
            const screen = sp.matrixTransform(ctm);
            return {
                x: node.position.x + ((screen.x - rect.left) / rect.width) * node.width,
                y: node.position.y + ((screen.y - rect.top) / rect.height) * node.height,
            };
        };
        const centerLocal = xingBodyCenterLocal(node);
        const targetAngle = Math.atan2(
            preferredWorld.y - node.position.y - centerLocal.y * node.height,
            preferredWorld.x - node.position.x - centerLocal.x * node.width,
        );
        const at = (length: number) => body.getPointAtLength(((length % len) + len) % len);
        const distance = (length: number) => {
            const pt = at(length);
            return angleDelta(Math.atan2(pt.y - pivot, pt.x - pivot), targetAngle);
        };
        const step = len / 48;
        let bestLength = 0;
        let bestD = Infinity;
        for (let i = 0; i < 48; i++) {
            const d = distance(i * step);
            if (d < bestD) {
                bestD = d;
                bestLength = i * step;
            }
        }
        // 细化相邻采样区间，避免端点在离散轮廓点之间逐格跳动。
        let left = bestLength - step;
        let right = bestLength + step;
        for (let i = 0; i < 10; i++) {
            const a = left + (right - left) / 3;
            const b = right - (right - left) / 3;
            if (distance(a) < distance(b)) right = b;
            else left = a;
        }
        const point = toWorld(at((left + right) / 2));
        const center = toWorld({ x: pivot, y: pivot });
        if (![point.x, point.y, center.x, center.y].every(Number.isFinite)) return null;
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        const radius = Math.hypot(dx, dy) || 1;
        return { ...point, normal: { x: dx / radius, y: dy / radius } };
    } catch {
        return null;
    }
}

/** 只替换星小驰端点为活表面点；按极角锁定，并重算径向法线（避免仍用导图正交控点拧弯） */
export function withLiveXingEndpoints(
    from: CanvasNodeData | null | undefined,
    to: CanvasNodeData | null | undefined,
    connection: Pick<CanvasConnection, "fromAnchor" | "toAnchor"> | null | undefined,
    endpoints: ConnectionEndpoints,
): ConnectionEndpoints {
    let { startX, startY, endX, endY } = endpoints;
    let startNormal = endpoints.startNormal;
    let endNormal = endpoints.endNormal;
    if (from && isXingXiaochiNode(from)) {
        const preferred = connection?.fromAnchor
            ? absoluteXingSurfacePoint(from, connection.fromAnchor)
            : { x: startX, y: startY };
        const live = getLiveXingWorldPoint(from, preferred);
        if (live) {
            startX = live.x;
            startY = live.y;
            startNormal = live.normal;
        }
    }
    if (to && isXingXiaochiNode(to)) {
        const preferred = connection?.toAnchor
            ? absoluteXingSurfacePoint(to, connection.toAnchor)
            : { x: endX, y: endY };
        const live = getLiveXingWorldPoint(to, preferred);
        if (live) {
            endX = live.x;
            endY = live.y;
            endNormal = live.normal;
        }
    }

    return {
        ...endpoints,
        startX,
        startY,
        endX,
        endY,
        xing: true,
        startNormal: startNormal || endpoints.startNormal,
        endNormal: endNormal || endpoints.endNormal,
        // 清掉导图正交边，避免 buildBezier 再走 mind L 弯
        mind: false,
        startSide: undefined,
        endSide: undefined,
    };
}
