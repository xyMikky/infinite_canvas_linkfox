import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type AlignGuide = { axis: "x" | "y"; position: number; start: number; end: number; kind?: "spacing" };
export type AlignBox = { left: number; top: number; right: number; bottom: number };
export type AlignEdges = { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };
export type SnapSmoothState = { x: number; y: number; lastT: number };

const RELATED_SNAP_PX = 12;
const RELATED_CENTER_SNAP_PX = 20;
const NEAR_SNAP_PX = 5;
const GUIDE_RANGE_PX = 96;
const GUIDE_MATCH_PX = 0.75;
const SPACING_SNAP_PX = 8;
const SPACING_LANE_LIMIT = 16;

type SnapHit = { delta: number; abs: number; related: boolean; guide: AlignGuide; edge?: keyof AlignEdges };

function gapAlong(a: AlignBox, b: AlignBox, axis: "x" | "y") {
    if (axis === "x") return a.bottom < b.top ? b.top - a.bottom : b.bottom < a.top ? a.top - b.bottom : 0;
    return a.right < b.left ? b.left - a.right : b.right < a.left ? a.left - b.right : 0;
}

function connectedIds(seed: Iterable<string>, connections: CanvasConnection[]) {
    const graph = new Map<string, string[]>();
    for (const connection of connections) {
        const from = connection.fromNodeId;
        const to = connection.toNodeId;
        if (!graph.has(from)) graph.set(from, []);
        if (!graph.has(to)) graph.set(to, []);
        graph.get(from)!.push(to);
        graph.get(to)!.push(from);
    }
    const seen = new Set<string>();
    const queue: string[] = [];
    for (const id of seed) {
        if (seen.has(id)) continue;
        seen.add(id);
        queue.push(id);
    }
    while (queue.length) {
        const id = queue.shift()!;
        const next = graph.get(id);
        if (!next) continue;
        for (const other of next) {
            if (seen.has(other)) continue;
            seen.add(other);
            queue.push(other);
        }
    }
    return seen;
}

/** 仅一层直连邻居（不含自身），用于连接点免点击吸附。 */
function directNeighborIds(seed: Iterable<string>, connections: CanvasConnection[]) {
    const seeds = new Set(seed);
    const neighbors = new Set<string>();
    for (const connection of connections) {
        if (seeds.has(connection.fromNodeId)) neighbors.add(connection.toNodeId);
        if (seeds.has(connection.toNodeId)) neighbors.add(connection.fromNodeId);
    }
    for (const id of seeds) neighbors.delete(id);
    return neighbors;
}

function betterHit(current: SnapHit | null, next: SnapHit) {
    if (!current || next.abs < current.abs - 1e-6 || (Math.abs(next.abs - current.abs) <= 1e-6 && next.related && !current.related)) return next;
    return current;
}

function dragHits(moving: AlignBox, other: AlignBox, related: boolean, snapPx: number, rangePx: number, axis: "x" | "y", includeCenters = false, centerSnapPx = snapPx): SnapHit[] {
    const hits: SnapHit[] = [];
    const start = axis === "x" ? Math.min(moving.top, other.top) : Math.min(moving.left, other.left);
    const end = axis === "x" ? Math.max(moving.bottom, other.bottom) : Math.max(moving.right, other.right);
    if (gapAlong(moving, other, axis) <= rangePx) {
        const pairs = axis === "x"
            ? [[moving.left, other.left], [moving.left, other.right], [moving.right, other.right], [moving.right, other.left]]
            : [[moving.top, other.top], [moving.top, other.bottom], [moving.bottom, other.bottom], [moving.bottom, other.top]];
        for (const [from, to] of pairs) {
            const delta = to - from;
            const abs = Math.abs(delta);
            if (abs > snapPx) continue;
            hits.push({ delta, abs, related, guide: { axis, position: to, start, end } });
        }
    }
    // 相连节点的连接点（中心）不受 96px 正交间距限制：拖右边即可对齐左边，不必先点选锚点
    if (includeCenters && related) {
        const from = axis === "y" ? (moving.top + moving.bottom) / 2 : (moving.left + moving.right) / 2;
        const to = axis === "y" ? (other.top + other.bottom) / 2 : (other.left + other.right) / 2;
        const delta = to - from;
        const abs = Math.abs(delta);
        if (abs <= centerSnapPx) hits.push({ delta, abs, related, guide: { axis, position: to, start, end } });
    }
    return hits;
}

function resizeHits(moving: AlignBox, other: AlignBox, related: boolean, snapPx: number, rangePx: number, edges: AlignEdges, axis: "x" | "y"): SnapHit[] {
    if (gapAlong(moving, other, axis) > rangePx) return [];
    const pairs = axis === "x"
        ? [...(edges.left ? [[moving.left, other.left, "left"] as const, [moving.left, other.right, "left"] as const] : []), ...(edges.right ? [[moving.right, other.right, "right"] as const, [moving.right, other.left, "right"] as const] : [])]
        : [...(edges.top ? [[moving.top, other.top, "top"] as const, [moving.top, other.bottom, "top"] as const] : []), ...(edges.bottom ? [[moving.bottom, other.bottom, "bottom"] as const, [moving.bottom, other.top, "bottom"] as const] : [])];
    const start = axis === "x" ? Math.min(moving.top, other.top) : Math.min(moving.left, other.left);
    const end = axis === "x" ? Math.max(moving.bottom, other.bottom) : Math.max(moving.right, other.right);
    const hits: SnapHit[] = [];
    for (const [from, to, edge] of pairs) {
        const delta = to - from;
        const abs = Math.abs(delta);
        if (abs > snapPx) continue;
        hits.push({ delta, abs, related, edge, guide: { axis: axis === "x" ? "x" : "y", position: to, start, end } });
    }
    return hits;
}

function pinBox(box: AlignBox, hit: SnapHit, minWidth: number, minHeight: number): AlignBox | null {
    const next = { ...box };
    if (hit.edge === "left") next.left = hit.guide.position;
    else if (hit.edge === "right") next.right = hit.guide.position;
    else if (hit.edge === "top") next.top = hit.guide.position;
    else next.bottom = hit.guide.position;
    if (next.right - next.left < minWidth || next.bottom - next.top < minHeight) return null;
    return next;
}

function applyRatio(box: AlignBox, hit: SnapHit, edges: AlignEdges, ratio: number, minWidth: number, minHeight: number): AlignBox | null {
    const next = { ...box };
    if (hit.axis === "y") {
        const height = next.bottom - next.top;
        const width = Math.max(minWidth, height * ratio);
        if (edges.left && !edges.right) next.left = next.right - width;
        else if (edges.right && !edges.left) next.right = next.left + width;
        else {
            const cx = (next.left + next.right) / 2;
            next.left = cx - width / 2;
            next.right = cx + width / 2;
        }
        if (hit.edge === "top") next.top = box.top;
        if (hit.edge === "bottom") next.bottom = box.bottom;
    } else {
        const width = next.right - next.left;
        const height = Math.max(minHeight, width / ratio);
        if (edges.top && !edges.bottom) next.top = next.bottom - height;
        else if (edges.bottom && !edges.top) next.bottom = next.top + height;
        else {
            const cy = (next.top + next.bottom) / 2;
            next.top = cy - height / 2;
            next.bottom = cy + height / 2;
        }
        if (hit.edge === "left") next.left = box.left;
        if (hit.edge === "right") next.right = box.right;
    }
    if (next.right - next.left < minWidth || next.bottom - next.top < minHeight) return null;
    return next;
}

function mergeGuide(map: Map<string, AlignGuide>, guide: AlignGuide) {
    const key = `${guide.axis}:${Math.round(guide.position * 10)}`;
    const current = map.get(key);
    if (current) {
        current.start = Math.min(current.start, guide.start);
        current.end = Math.max(current.end, guide.end);
        return;
    }
    map.set(key, { ...guide });
}

function collectGuides(input: {
    box: AlignBox;
    allNodes: CanvasNodeData[];
    skipIds: Iterable<string>;
    zoom?: number;
    preferredTargetId?: string | null;
    /** 直连邻居：可显示免点击的中心对齐参考线 */
    directNeighborIds?: Set<string>;
    edges?: AlignEdges;
}) {
    const skip = new Set(input.skipIds);
    const zoom = Math.max(input.zoom || 1, 0.01);
    const range = GUIDE_RANGE_PX / zoom;
    const map = new Map<string, AlignGuide>();
    const useTop = !input.edges || input.edges.top;
    const useBottom = !input.edges || input.edges.bottom;
    const useLeft = !input.edges || input.edges.left;
    const useRight = !input.edges || input.edges.right;
    const ys = [...(useTop ? [input.box.top] : []), ...(useBottom ? [input.box.bottom] : [])];
    const xs = [...(useLeft ? [input.box.left] : []), ...(useRight ? [input.box.right] : [])];
    for (const node of input.allNodes) {
        if (skip.has(node.id)) continue;
        const preferred = Boolean(input.preferredTargetId && node.id === input.preferredTargetId);
        const direct = Boolean(input.directNeighborIds?.has(node.id));
        const rangePx = preferred ? Number.POSITIVE_INFINITY : range;
        const other: AlignBox = { left: node.position.x, top: node.position.y, right: node.position.x + node.width, bottom: node.position.y + node.height };
        if (ys.length && gapAlong(input.box, other, "y") <= rangePx) {
            for (const y of ys) for (const target of [other.top, other.bottom]) {
                if (Math.abs(y - target) > GUIDE_MATCH_PX) continue;
                mergeGuide(map, { axis: "y", position: target, start: Math.min(input.box.left, other.left), end: Math.max(input.box.right, other.right) });
            }
        }
        if (xs.length && gapAlong(input.box, other, "x") <= rangePx) {
            for (const x of xs) for (const target of [other.left, other.right]) {
                if (Math.abs(x - target) > GUIDE_MATCH_PX) continue;
                mergeGuide(map, { axis: "x", position: target, start: Math.min(input.box.top, other.top), end: Math.max(input.box.bottom, other.bottom) });
            }
        }
        const movingCy = (input.box.top + input.box.bottom) / 2;
        const otherCy = (other.top + other.bottom) / 2;
        if ((preferred || direct) && Math.abs(movingCy - otherCy) <= GUIDE_MATCH_PX) {
            mergeGuide(map, { axis: "y", position: otherCy, start: Math.min(input.box.left, other.left), end: Math.max(input.box.right, other.right) });
        }
        const movingCx = (input.box.left + input.box.right) / 2;
        const otherCx = (other.left + other.right) / 2;
        if ((preferred || direct) && Math.abs(movingCx - otherCx) <= GUIDE_MATCH_PX) {
            mergeGuide(map, { axis: "x", position: otherCx, start: Math.min(input.box.top, other.top), end: Math.max(input.box.bottom, other.bottom) });
        }
    }
    return [...map.values()];
}

type SpacingHit = { delta: number; abs: number; a: AlignBox; b: AlignBox; mode: "after" | "before" | "between" };

/**
 * 等距吸附：在与 moving 同一行（axis="x"）/同一列（axis="y"）的静态节点中，
 * 找相邻节点对 a、b，使 moving 与其中一个的间距匹配 a、b 之间的间距。
 */
function spacingSnapForAxis(moving: AlignBox, others: AlignBox[], axis: "x" | "y", snapPx: number): SpacingHit | null {
    const lo = axis === "x" ? "left" : "top";
    const hi = axis === "x" ? "right" : "bottom";
    const clo = axis === "x" ? "top" : "left";
    const chi = axis === "x" ? "bottom" : "right";
    let lane = others.filter((box) => Math.min(box[chi], moving[chi]) - Math.max(box[clo], moving[clo]) > 0);
    if (lane.length < 2) return null;
    if (lane.length > SPACING_LANE_LIMIT) {
        const center = (moving[lo] + moving[hi]) / 2;
        lane = lane
            .sort((p, q) => Math.abs((p[lo] + p[hi]) / 2 - center) - Math.abs((q[lo] + q[hi]) / 2 - center))
            .slice(0, SPACING_LANE_LIMIT);
    }
    lane.sort((p, q) => p[lo] - q[lo]);
    let best: SpacingHit | null = null;
    const consider = (delta: number, a: AlignBox, b: AlignBox, mode: SpacingHit["mode"]) => {
        const abs = Math.abs(delta);
        if (abs <= snapPx && (!best || abs < best.abs)) best = { delta, abs, a, b, mode };
    };
    for (let i = 0; i < lane.length; i++) {
        for (let j = i + 1; j < lane.length; j++) {
            const a = lane[i];
            const b = lane[j];
            const gap = b[lo] - a[hi];
            if (gap <= 1) continue;
            if (Math.min(a[chi], b[chi]) - Math.max(a[clo], b[clo]) <= 0) continue;
            // 间隙中夹着其它节点的跨对不算相邻间距
            if (lane.some((c) => c !== a && c !== b && c[hi] > a[hi] && c[lo] < b[lo])) continue;
            consider(b[hi] + gap - moving[lo], a, b, "after");
            consider(a[lo] - gap - moving[hi], a, b, "before");
            const inner = (gap - (moving[hi] - moving[lo])) / 2;
            if (inner > 1) consider(a[hi] + inner - moving[lo], a, b, "between");
        }
    }
    return best;
}

function spacingGuides(moving: AlignBox, hit: SpacingHit, axis: "x" | "y"): AlignGuide[] {
    const lo = axis === "x" ? "left" : "top";
    const hi = axis === "x" ? "right" : "bottom";
    const clo = axis === "x" ? "top" : "left";
    const chi = axis === "x" ? "bottom" : "right";
    const boxes = hit.mode === "after" ? [hit.a, hit.b, moving] : hit.mode === "before" ? [moving, hit.a, hit.b] : [hit.a, moving, hit.b];
    const cross = (Math.max(boxes[0][clo], boxes[1][clo], boxes[2][clo]) + Math.min(boxes[0][chi], boxes[1][chi], boxes[2][chi])) / 2;
    const guideAxis = axis === "x" ? "y" : "x";
    return [
        { axis: guideAxis, position: cross, start: boxes[0][hi], end: boxes[1][lo], kind: "spacing" },
        { axis: guideAxis, position: cross, start: boxes[1][hi], end: boxes[2][lo], kind: "spacing" },
    ];
}

function nodeBox(node: CanvasNodeData): AlignBox {
    return { left: node.position.x, top: node.position.y, right: node.position.x + node.width, bottom: node.position.y + node.height };
}

export function snapResizeToNearbyNodes(input: {
    nodeId: string;
    box: AlignBox;
    edges: AlignEdges;
    minWidth: number;
    minHeight: number;
    keepRatio: boolean;
    ratio: number;
    allNodes: CanvasNodeData[];
    connections: CanvasConnection[];
    zoom: number;
    preferredTargetId?: string | null;
}) {
    const zoom = Math.max(input.zoom || 1, 0.01);
    const relatedSnap = RELATED_SNAP_PX / zoom;
    const nearSnap = NEAR_SNAP_PX / zoom;
    const range = GUIDE_RANGE_PX / zoom;
    const relatedIds = connectedIds([input.nodeId], input.connections);
    let xHit: SnapHit | null = null;
    let yHit: SnapHit | null = null;
    for (const node of input.allNodes) {
        if (node.id === input.nodeId) continue;
        const preferred = Boolean(input.preferredTargetId && node.id === input.preferredTargetId);
        const related = preferred || relatedIds.has(node.id);
        const snapPx = related ? relatedSnap : nearSnap;
        const rangePx = preferred ? Number.POSITIVE_INFINITY : range;
        const other = nodeBox(node);
        for (const hit of resizeHits(input.box, other, related, snapPx, rangePx, input.edges, "x")) xHit = betterHit(xHit, hit);
        for (const hit of resizeHits(input.box, other, related, snapPx, rangePx, input.edges, "y")) yHit = betterHit(yHit, hit);
    }
    let box = input.box;
    const pins: AlignEdges & { left?: number; right?: number; top?: number; bottom?: number } = {};
    const keepRatio = Boolean(input.keepRatio && input.ratio && input.ratio > 0);
    const primary = keepRatio ? (yHit && (!xHit || yHit.abs <= xHit.abs) ? yHit : xHit) : null;
    if (keepRatio && primary) {
        const pinned = pinBox(input.box, primary, input.minWidth, input.minHeight);
        const next = pinned ? applyRatio(pinned, primary, input.edges, input.ratio, input.minWidth, input.minHeight) : null;
        if (next) {
            box = next;
            Object.assign(pins, { [primary.edge!]: primary.guide.position });
        }
    } else {
        if (xHit) {
            const next = pinBox(box, xHit, input.minWidth, input.minHeight);
            if (next) {
                box = next;
                Object.assign(pins, { [xHit.edge!]: xHit.guide.position });
            }
        }
        if (yHit) {
            const next = pinBox(box, yHit, input.minWidth, input.minHeight);
            if (next) {
                box = next;
                Object.assign(pins, { [yHit.edge!]: yHit.guide.position });
            }
        }
    }
    if (pins.left != null) box.left = pins.left;
    if (pins.right != null) box.right = pins.right;
    if (pins.top != null) box.top = pins.top;
    if (pins.bottom != null) box.bottom = pins.bottom;
    return {
        box,
        pins,
        guides: collectGuides({ box, allNodes: input.allNodes, skipIds: [input.nodeId], zoom: input.zoom, preferredTargetId: input.preferredTargetId }),
    };
}

export function snapDragToNearbyNodes(input: {
    movingIds: Set<string>;
    initialPositions: Array<{ id: string; x: number; y: number }>;
    allNodes: CanvasNodeData[];
    connections: CanvasConnection[];
    dx: number;
    dy: number;
    zoom: number;
    preferredTargetId?: string | null;
}) {
    const zoom = Math.max(input.zoom || 1, 0.01);
    const relatedSnap = RELATED_SNAP_PX / zoom;
    const relatedCenterSnap = RELATED_CENTER_SNAP_PX / zoom;
    const nearSnap = NEAR_SNAP_PX / zoom;
    const range = GUIDE_RANGE_PX / zoom;
    const initialById = new Map(input.initialPositions.map((item) => [item.id, item]));
    const moving = input.allNodes.filter((node) => input.movingIds.has(node.id) && initialById.has(node.id));
    if (!moving.length) return { dx: input.dx, dy: input.dy, guides: [] as AlignGuide[] };
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const node of moving) {
        const initial = initialById.get(node.id)!;
        const x = initial.x + input.dx;
        const y = initial.y + input.dy;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + node.width);
        bottom = Math.max(bottom, y + node.height);
    }
    const movingBox: AlignBox = { left, top, right, bottom };
    const relatedIds = connectedIds(input.movingIds, input.connections);
    const neighbors = directNeighborIds(input.movingIds, input.connections);
    const includeCenters = moving.length === 1;
    let xHit: SnapHit | null = null;
    let yHit: SnapHit | null = null;
    const staticBoxes: AlignBox[] = [];
    for (const node of input.allNodes) {
        if (input.movingIds.has(node.id)) continue;
        const preferred = Boolean(input.preferredTargetId && node.id === input.preferredTargetId);
        const related = preferred || relatedIds.has(node.id);
        const direct = preferred || neighbors.has(node.id);
        const snapPx = related ? relatedSnap : nearSnap;
        const rangePx = preferred ? Number.POSITIVE_INFINITY : range;
        // 免点击中心吸附仅对直连；远端节点仍需先点选 preferred 才放开
        const snapCenters = includeCenters && direct;
        const other = nodeBox(node);
        staticBoxes.push(other);
        for (const hit of dragHits(movingBox, other, related, snapPx, rangePx, "x", snapCenters, relatedCenterSnap)) xHit = betterHit(xHit, hit);
        for (const hit of dragHits(movingBox, other, related, snapPx, rangePx, "y", snapCenters, relatedCenterSnap)) yHit = betterHit(yHit, hit);
    }
    // 等距吸附：与边缘吸附各取偏差更小者
    const spacingSnap = SPACING_SNAP_PX / zoom;
    const spacingXHit = spacingSnapForAxis(movingBox, staticBoxes, "x", spacingSnap);
    const spacingYHit = spacingSnapForAxis(movingBox, staticBoxes, "y", spacingSnap);
    const useSpacingX = spacingXHit && (!xHit || spacingXHit.abs < xHit.abs) ? spacingXHit : null;
    const useSpacingY = spacingYHit && (!yHit || spacingYHit.abs < yHit.abs) ? spacingYHit : null;
    const deltaX = useSpacingX ? useSpacingX.delta : xHit?.delta || 0;
    const deltaY = useSpacingY ? useSpacingY.delta : yHit?.delta || 0;
    const dx = input.dx + deltaX;
    const dy = input.dy + deltaY;
    const snappedBox: AlignBox = {
        left: movingBox.left + deltaX,
        top: movingBox.top + deltaY,
        right: movingBox.right + deltaX,
        bottom: movingBox.bottom + deltaY,
    };
    const guides = collectGuides({
        box: snappedBox,
        allNodes: input.allNodes,
        skipIds: input.movingIds,
        zoom: input.zoom,
        preferredTargetId: input.preferredTargetId,
        directNeighborIds: neighbors,
    });
    if (useSpacingX) guides.push(...spacingGuides(snappedBox, useSpacingX, "x"));
    if (useSpacingY) guides.push(...spacingGuides(snappedBox, useSpacingY, "y"));
    return { dx, dy, guides };
}

export function smoothSnapOffset(state: SnapSmoothState, target: { x: number; y: number }, dt: number) {
    const k = 1 - Math.exp(-Math.max(dt, 0) / 28);
    return { x: state.x + (target.x - state.x) * k, y: state.y + (target.y - state.y) * k };
}
