import {
    buildBezierPath2D,
    connectionArrowPoints,
    pointOnConnectionBezier,
    tangentOnConnectionBezier,
    shortenEndpointsForArrow,
    type ConnectionEndpoints,
} from "@/lib/canvas/canvas-connection-geometry";
import { isXingXiaochiNode, xingClayColorForNode } from "@/lib/canvas/xing-xiaochi-ports";
import type { CanvasNodeData } from "@/types/canvas";

export function connectionInvolvesXing(from?: CanvasNodeData | null, to?: CanvasNodeData | null) {
    return Boolean(isXingXiaochiNode(from) || isXingXiaochiNode(to));
}

/**
 * 线根从身体内部以同色渐细延伸到连线，和主体形成连续轮廓。
 */
export function drawXingClayConnection(
    ctx: CanvasRenderingContext2D,
    endpoints: ConnectionEndpoints,
    opts: {
        from?: CanvasNodeData | null;
        to?: CanvasNodeData | null;
        farColor: string;
        active?: boolean;
        dashed?: boolean;
        preview?: boolean;
        zoom?: number;
    },
) {
    const { from, to, farColor, active = false, dashed = false, preview = false, zoom = 1 } = opts;
    const fromXing = isXingXiaochiNode(from);
    const toXing = isXingXiaochiNode(to);
    if (!fromXing && !toXing) return false;

    const clayFrom = fromXing ? xingClayColorForNode(from) : farColor;
    const clayTo = toXing ? xingClayColorForNode(to) : farColor;
    const z = Math.max(zoom, 0.35);
    const lineW = (preview ? 4.25 : active ? 4.75 : 4.4) / Math.sqrt(z);

    // 星小驰端把起点略探进身体，让 round cap 贴在表面上，避免悬空缝
    const inset = lineW * 1.8;
    const drawBase = insetXingEndpoint(endpoints, fromXing, toXing, inset);
    const arrowSize = preview || toXing ? 0 : active ? 8 : 7;
    const drawEp = arrowSize ? shortenEndpointsForArrow(drawBase, arrowSize) : drawBase;
    const path = buildBezierPath2D(drawEp);
    if (fromXing) fillClayRoot(ctx, drawEp, true, clayFrom, lineW, preview);
    if (toXing) fillClayRoot(ctx, drawEp, false, clayTo, lineW, preview);

    const gradient = ctx.createLinearGradient(endpoints.startX, endpoints.startY, endpoints.endX, endpoints.endY);
    if (fromXing && toXing) {
        gradient.addColorStop(0, clayFrom);
        gradient.addColorStop(1, clayTo);
    } else if (fromXing) {
        gradient.addColorStop(0, clayFrom);
        gradient.addColorStop(0.7, clayFrom);
        gradient.addColorStop(1, farColor);
    } else {
        gradient.addColorStop(0, farColor);
        gradient.addColorStop(0.3, clayTo);
        gradient.addColorStop(1, clayTo);
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (dashed || preview) ctx.setLineDash([6 / z, 5 / z]);
    ctx.globalAlpha = preview ? 0.95 : 1;
    ctx.strokeStyle = gradient;
    ctx.lineWidth = lineW;
    if (active && !preview) {
        ctx.shadowColor = `${fromXing ? clayFrom : clayTo}22`;
        ctx.shadowBlur = 2.5 / z;
    }
    ctx.stroke(path);
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    if (arrowSize) {
        const arrow = connectionArrowPoints(endpoints, arrowSize);
        ctx.beginPath();
        ctx.moveTo(arrow[0][0], arrow[0][1]);
        ctx.lineTo(arrow[1][0], arrow[1][1]);
        ctx.lineTo(arrow[2][0], arrow[2][1]);
        ctx.closePath();
        ctx.fillStyle = farColor;
        ctx.fill();
    }
    return true;
}

/** 沿同一条贝塞尔收细到线宽，根部埋入身体，接合处不再叠圆点。 */
function fillClayRoot(
    ctx: CanvasRenderingContext2D,
    endpoints: ConnectionEndpoints,
    from: boolean,
    color: string,
    lineWidth: number,
    preview: boolean,
) {
    const span = Math.hypot(endpoints.endX - endpoints.startX, endpoints.endY - endpoints.startY);
    const range = Math.min(0.4, (lineWidth * 10) / Math.max(span, 1));
    const sides: { x: number; y: number }[][] = [[], []];
    for (let i = 0; i <= 16; i++) {
        const u = i / 16;
        const t = from ? u * range : 1 - u * range;
        const point = pointOnConnectionBezier(endpoints, t);
        const tangent = tangentOnConnectionBezier(endpoints, t);
        const length = Math.hypot(tangent.x, tangent.y) || 1;
        const width = lineWidth * (0.5 + 2.2 * (1 - u) ** 2);
        for (let side = 0; side < 2; side++) {
            const offset = width * (side === 0 ? 1 : -1);
            sides[side].push({ x: point.x - (tangent.y / length) * offset, y: point.y + (tangent.x / length) * offset });
        }
    }
    ctx.save();
    ctx.globalAlpha = preview ? 0.95 : 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(sides[0][0].x, sides[0][0].y);
    for (const point of [...sides[0].slice(1), ...sides[1].reverse()]) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

/** 星小驰端沿切线略探进表面，圆角端盖压住轮廓（朝曲线内侧/身体内移，勿外漂） */
function insetXingEndpoint(
    endpoints: ConnectionEndpoints,
    fromXing: boolean,
    toXing: boolean,
    inset: number,
): ConnectionEndpoints {
    if (!fromXing && !toXing) return endpoints;
    let { startX, startY, endX, endY } = endpoints;
    if (fromXing) {
        const p1 = pointOnConnectionBezier(endpoints, 0.06);
        const dx = p1.x - startX;
        const dy = p1.y - startY;
        const len = Math.hypot(dx, dy) || 1;
        startX -= (dx / len) * inset;
        startY -= (dy / len) * inset;
    }
    if (toXing) {
        const p1 = pointOnConnectionBezier(endpoints, 0.94);
        const dx = endX - p1.x;
        const dy = endY - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        endX += (dx / len) * inset;
        endY += (dy / len) * inset;
    }
    return { ...endpoints, startX, startY, endX, endY };
}
