/**
 * 星小驰表面锚点：与 web/public/xing-xiaochi/clay-override.js 中
 * softStarPath(CX, CY, 100, 74, 5, 12) + VIEW 坐标系一致，再映射到节点框。
 */
import { CODEX_IMAGE_NODE_TYPE } from "@/stores/use-codex-image-job-store";
import type { CanvasNodeData, Position } from "@/types/canvas";

export function isXingXiaochiNode(node: CanvasNodeData | null | undefined) {
    return Boolean(node && node.type === CODEX_IMAGE_NODE_TYPE);
}

/** 与 clay-override / tables.js 一致 */
const VIEW = { minX: -15, minY: -15, width: 259, height: 259 } as const;
const CLAY_CX = 114.27;
const CLAY_CY = 116;
const CLAY_OUTER = 100;
const CLAY_INNER = 74;
const CLAY_TIPS = 5;
const CLAY_EDGE_SAMPLES = 20;

/** Content 默认 live 边长；映射轮廓时与节点框居中关系一致 */
export const XING_LIVE_SIZE = 120;

const STICKY_PX = 40;
const HARD_SNAP_PX = 14;

/** 与 clay-override softStarPath 相同的 Catmull-Rom 轮廓（VIEW 坐标） */
function sampleClayOutlineView(): Position[] {
    const tips = CLAY_TIPS * 2;
    const pts: Position[] = [];
    for (let i = 0; i < tips; i++) {
        const a = -Math.PI / 2 + (i / tips) * Math.PI * 2;
        const r = i % 2 === 0 ? CLAY_OUTER : CLAY_INNER;
        pts.push({ x: CLAY_CX + Math.cos(a) * r, y: CLAY_CY + Math.sin(a) * r });
    }
    const n = pts.length;
    const round: Position[] = [];
    for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n];
        const p1 = pts[i];
        const p2 = pts[(i + 1) % n];
        const p3 = pts[(i + 2) % n];
        for (let s = 0; s < CLAY_EDGE_SAMPLES; s++) {
            const t = s / CLAY_EDGE_SAMPLES;
            const t2 = t * t;
            const t3 = t2 * t;
            round.push({
                x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
                y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
            });
        }
    }
    return round;
}

const VIEW_RING = sampleClayOutlineView();

/** 节点内 live SVG 像素边长（与 Content 居中展示一致） */
export function xingLiveSizeForNode(node: CanvasNodeData) {
    return Math.max(48, Math.min(XING_LIVE_SIZE, node.width, node.height));
}

/** VIEW 坐标 → 节点相对 0–1（live 在节点内水平垂直居中） */
function viewToNodeLocal(node: CanvasNodeData, view: Position): Position {
    const svg = xingLiveSizeForNode(node);
    const ox = (node.width - svg) / 2;
    const oy = (node.height - svg) / 2;
    const sx = ((view.x - VIEW.minX) / VIEW.width) * svg;
    const sy = ((view.y - VIEW.minY) / VIEW.height) * svg;
    return {
        x: (ox + sx) / Math.max(node.width, 1),
        y: (oy + sy) / Math.max(node.height, 1),
    };
}

function ringLocal(node: CanvasNodeData): Position[] {
    return VIEW_RING.map((p) => viewToNodeLocal(node, p));
}

/** 身体中心（live 居中），用于极角吸附 */
export function xingBodyCenterLocal(node: CanvasNodeData): Position {
    const svg = xingLiveSizeForNode(node);
    return {
        x: ((node.width - svg) / 2 + svg / 2) / Math.max(node.width, 1),
        y: ((node.height - svg) / 2 + svg / 2) / Math.max(node.height, 1),
    };
}

function angleOfLocal(local: Position, center: Position) {
    return Math.atan2(local.y - center.y, local.x - center.x);
}

function angleDelta(a: number, b: number) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
}

/** 按极角在轮廓上取点：点击哪一方向就落在哪一瓣，不欧氏吸到尖角 */
function nearestOnRingByAngle(node: CanvasNodeData, local: Position): Position {
    const ring = ringLocal(node);
    const center = xingBodyCenterLocal(node);
    const target = angleOfLocal(local, center);
    let best = ring[0];
    let bestD = Infinity;
    for (const p of ring) {
        const d = angleDelta(angleOfLocal(p, center), target);
        if (d < bestD) {
            bestD = d;
            best = p;
        }
    }
    return { x: best.x, y: best.y };
}

/** 兼容旧调用：用真实轮廓外接框近似主体区 */
export function getXingBodyRect(node: CanvasNodeData) {
    const ring = ringLocal(node);
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const p of ring) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** @deprecated 请用 getXingBodyRect(node)；静态值仅作兜底 */
export const XING_BODY = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 } as const;

export function sideToXingSurfaceAnchor(side?: "left" | "right" | "top" | "bottom", node?: CanvasNodeData): Position {
    const host = node || ({ width: 128, height: 128, position: { x: 0, y: 0 } } as CanvasNodeData);
    if (side === "top") return nearestOnRingByAngle(host, { x: 0.5, y: 0 });
    if (side === "bottom") return nearestOnRingByAngle(host, { x: 0.5, y: 1 });
    if (side === "left") return nearestOnRingByAngle(host, { x: 0, y: 0.5 });
    if (side === "right") return nearestOnRingByAngle(host, { x: 1, y: 0.5 });
    return nearestOnRingByAngle(host, { x: 1, y: 0.5 });
}

/** 落在真实黏土轮廓上（不再向中心假 inset） */
export function absoluteXingSurfacePoint(node: CanvasNodeData, anchor: Position): Position {
    return {
        x: node.position.x + anchor.x * node.width,
        y: node.position.y + anchor.y * node.height,
    };
}

export function worldToXingAnchor(node: CanvasNodeData, world: Position): Position {
    return {
        x: (world.x - node.position.x) / Math.max(node.width, 1),
        y: (world.y - node.position.y) / Math.max(node.height, 1),
    };
}

/** 落盘锚点对应的极角（相对身体中心） */
export function xingAnchorAngle(node: CanvasNodeData, anchor: Position) {
    return angleOfLocal(anchor, xingBodyCenterLocal(node));
}

export function nearestXingSurfaceAnchor(node: CanvasNodeData, world: Position): Position {
    return nearestOnRingByAngle(node, worldToXingAnchor(node, world));
}

export function isNearXingSurface(node: CanvasNodeData, world: Position, pad = STICKY_PX) {
    const onSurface = absoluteXingSurfacePoint(node, nearestXingSurfaceAnchor(node, world));
    return Math.hypot(world.x - onSurface.x, world.y - onSurface.y) <= pad;
}

export function stickyXingWorldPoint(node: CanvasNodeData, world: Position): Position {
    const anchor = nearestXingSurfaceAnchor(node, world);
    const onSurface = absoluteXingSurfacePoint(node, anchor);
    const dx = world.x - onSurface.x;
    const dy = world.y - onSurface.y;
    const d = Math.hypot(dx, dy);
    if (d <= HARD_SNAP_PX) return onSurface;
    if (d >= STICKY_PX) {
        const body = getXingBodyRect(node);
        const left = node.position.x + body.x * node.width;
        const top = node.position.y + body.y * node.height;
        const right = left + body.w * node.width;
        const bottom = top + body.h * node.height;
        const inside =
            world.x >= left - STICKY_PX &&
            world.x <= right + STICKY_PX &&
            world.y >= top - STICKY_PX &&
            world.y <= bottom + STICKY_PX;
        if (!inside) return world;
    }
    const t = Math.max(0, Math.min(1, 1 - (d - HARD_SNAP_PX) / (STICKY_PX - HARD_SNAP_PX)));
    const ease = t * t * (3 - 2 * t);
    return {
        x: world.x + (onSurface.x - world.x) * ease,
        y: world.y + (onSurface.y - world.y) * ease,
    };
}

export const XING_CLAY_COLOR = "#E23B4C";

export function xingClayColorForNode(_node: CanvasNodeData | null | undefined): string {
    // 主体始终是珊瑚红，线根不能因任务状态单独变色而露出接缝。
    return XING_CLAY_COLOR;
}

export type XingAgentMood = "idle" | "queued" | "running" | "success" | "error";

export function xingMoodToCharacterState(mood: XingAgentMood): string {
    if (mood === "queued") return "listening";
    if (mood === "running") return "thinking";
    if (mood === "success") return "celebrate";
    if (mood === "error") return "confused";
    return "curious";
}
