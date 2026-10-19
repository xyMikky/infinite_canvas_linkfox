import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";
import { isMindNode } from "@/lib/canvas/mind-map";

const GAP_X = 80;
const GAP_Y = 48;
const COMPONENT_GAP_Y = 96;

/** 将选中节点整齐排列：有连线按流向分层并对齐，无连线按网格；导图节点无内连线时竖排。保持选区中心不变。 */
export function arrangeSelectedNodes(nodes: CanvasNodeData[], connections: CanvasConnection[]): Map<string, Position> {
    if (nodes.length < 2) return new Map();

    const ids = new Set(nodes.map((node) => node.id));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const outs = new Map<string, string[]>();
    const ins = new Map<string, string[]>();
    for (const id of ids) {
        outs.set(id, []);
        ins.set(id, []);
    }
    for (const conn of connections) {
        if (!ids.has(conn.fromNodeId) || !ids.has(conn.toNodeId) || conn.fromNodeId === conn.toNodeId) continue;
        outs.get(conn.fromNodeId)!.push(conn.toNodeId);
        ins.get(conn.toNodeId)!.push(conn.fromNodeId);
    }

    const hasEdges = [...outs.values()].some((list) => list.length > 0);
    const allMind = nodes.every((node) => isMindNode(node));
    // 仅选中多个导图子题时选区内常无边，网格会排成 2 列错位；导图同级应竖排对齐
    const laidOut = hasEdges
        ? layoutConnected(nodes, byId, outs, ins)
        : allMind
          ? layoutAsColumn(nodes)
          : layoutAsGrid(nodes);

    return recenter(nodes, laidOut);
}

function compareByPosition(a: CanvasNodeData, b: CanvasNodeData) {
    return a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id);
}

function recenter(original: CanvasNodeData[], positions: Map<string, Position>) {
    if (!positions.size) return positions;
    let oldMinX = Infinity;
    let oldMinY = Infinity;
    let oldMaxX = -Infinity;
    let oldMaxY = -Infinity;
    for (const node of original) {
        oldMinX = Math.min(oldMinX, node.position.x);
        oldMinY = Math.min(oldMinY, node.position.y);
        oldMaxX = Math.max(oldMaxX, node.position.x + node.width);
        oldMaxY = Math.max(oldMaxY, node.position.y + node.height);
    }
    let newMinX = Infinity;
    let newMinY = Infinity;
    let newMaxX = -Infinity;
    let newMaxY = -Infinity;
    for (const node of original) {
        const pos = positions.get(node.id);
        if (!pos) continue;
        newMinX = Math.min(newMinX, pos.x);
        newMinY = Math.min(newMinY, pos.y);
        newMaxX = Math.max(newMaxX, pos.x + node.width);
        newMaxY = Math.max(newMaxY, pos.y + node.height);
    }
    const dx = (oldMinX + oldMaxX) / 2 - (newMinX + newMaxX) / 2;
    const dy = (oldMinY + oldMaxY) / 2 - (newMinY + newMaxY) / 2;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return positions;
    const next = new Map<string, Position>();
    for (const [id, pos] of positions) next.set(id, { x: pos.x + dx, y: pos.y + dy });
    return next;
}

function layoutConnected(
    nodes: CanvasNodeData[],
    byId: Map<string, CanvasNodeData>,
    outs: Map<string, string[]>,
    ins: Map<string, string[]>,
) {
    const components = findComponents(nodes, outs, ins);
    components.sort((a, b) => {
        const ay = a.reduce((sum, n) => sum + n.position.y, 0) / a.length;
        const by = b.reduce((sum, n) => sum + n.position.y, 0) / b.length;
        return ay - by || a[0].id.localeCompare(b[0].id);
    });

    const positions = new Map<string, Position>();
    let cursorY = 0;
    for (const component of components) {
        const local = layoutComponent(component, byId, outs, ins);
        let minY = Infinity;
        let maxY = -Infinity;
        for (const node of component) {
            const pos = local.get(node.id)!;
            minY = Math.min(minY, pos.y);
            maxY = Math.max(maxY, pos.y + node.height);
        }
        const shiftY = cursorY - minY;
        for (const node of component) {
            const pos = local.get(node.id)!;
            positions.set(node.id, { x: pos.x, y: pos.y + shiftY });
        }
        cursorY += maxY - minY + COMPONENT_GAP_Y;
    }
    return positions;
}

function findComponents(nodes: CanvasNodeData[], outs: Map<string, string[]>, ins: Map<string, string[]>) {
    const remaining = new Set(nodes.map((node) => node.id));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const components: CanvasNodeData[][] = [];
    while (remaining.size) {
        const start = remaining.values().next().value as string;
        const queue = [start];
        const group: CanvasNodeData[] = [];
        remaining.delete(start);
        while (queue.length) {
            const id = queue.shift()!;
            group.push(byId.get(id)!);
            for (const next of [...(outs.get(id) || []), ...(ins.get(id) || [])]) {
                if (!remaining.has(next)) continue;
                remaining.delete(next);
                queue.push(next);
            }
        }
        group.sort(compareByPosition);
        components.push(group);
    }
    return components;
}

function layoutComponent(
    nodes: CanvasNodeData[],
    byId: Map<string, CanvasNodeData>,
    outs: Map<string, string[]>,
    ins: Map<string, string[]>,
) {
    const layerOf = assignLayers(nodes, outs, ins);
    const maxLayer = Math.max(0, ...layerOf.values());
    const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
    for (const node of nodes) layers[layerOf.get(node.id) || 0].push(node.id);

    for (const layer of layers) {
        layer.sort((a, b) => compareByPosition(byId.get(a)!, byId.get(b)!));
    }
    for (let pass = 0; pass < 4; pass++) {
        for (let i = 1; i < layers.length; i++) orderByBarycenter(layers[i], layers[i - 1], ins);
        for (let i = layers.length - 2; i >= 0; i--) orderByBarycenter(layers[i], layers[i + 1], outs);
    }

    const colWidths = layers.map((layer) => Math.max(0, ...layer.map((id) => byId.get(id)!.width)));
    const colXs: number[] = [];
    let x = 0;
    for (const width of colWidths) {
        colXs.push(x);
        x += width + GAP_X;
    }

    const positions = new Map<string, Position>();

    // 每层只有一个节点时（如图→结果）：顶对齐，避免矮节点贴在高图垂直中心显得「没排列」
    if (layers.every((layer) => layer.length === 1)) {
        for (let i = 0; i < layers.length; i++) {
            const id = layers[i][0];
            const node = byId.get(id)!;
            positions.set(id, {
                x: colXs[i] + (colWidths[i] - node.width) / 2,
                y: 0,
            });
        }
        return positions;
    }

    const centers = new Map<string, number>();
    // 多层多节点：先从左层向下堆叠，再按邻层重心回摆，减少交叉并让上下游居中对齐。
    placeLayerPacked(layers[0], byId, centers, 0);
    for (let i = 1; i < layers.length; i++) {
        placeLayerByNeighbors(layers[i], byId, centers, ins, true);
    }
    for (let i = layers.length - 2; i >= 0; i--) {
        placeLayerByNeighbors(layers[i], byId, centers, outs, false);
    }
    for (let i = 1; i < layers.length; i++) {
        placeLayerByNeighbors(layers[i], byId, centers, ins, true);
    }

    for (let i = 0; i < layers.length; i++) {
        for (const id of layers[i]) {
            const node = byId.get(id)!;
            const centerY = centers.get(id) ?? 0;
            positions.set(id, {
                x: colXs[i] + (colWidths[i] - node.width) / 2,
                y: centerY - node.height / 2,
            });
        }
    }
    return positions;
}

function assignLayers(nodes: CanvasNodeData[], outs: Map<string, string[]>, ins: Map<string, string[]>) {
    const ids = new Set(nodes.map((node) => node.id));
    const indegree = new Map<string, number>();
    for (const id of ids) indegree.set(id, (ins.get(id) || []).filter((from) => ids.has(from)).length);

    const layerOf = new Map<string, number>();
    const roots = nodes.filter((node) => (indegree.get(node.id) || 0) === 0).sort(compareByPosition);
    const queue = roots.map((node) => node.id);
    for (const id of queue) layerOf.set(id, 0);

    while (queue.length) {
        const id = queue.shift()!;
        const layer = layerOf.get(id) || 0;
        for (const to of outs.get(id) || []) {
            if (!ids.has(to)) continue;
            layerOf.set(to, Math.max(layerOf.get(to) || 0, layer + 1));
            indegree.set(to, (indegree.get(to) || 0) - 1);
            if (indegree.get(to) === 0) queue.push(to);
        }
    }

    // 环内残留节点：按已分层前驱取最长路径，否则落在第 0 层。
    const pending = nodes.filter((node) => !layerOf.has(node.id)).map((node) => node.id);
    while (pending.length) {
        let moved = false;
        for (let i = pending.length - 1; i >= 0; i--) {
            const id = pending[i];
            const preds = (ins.get(id) || []).filter((from) => layerOf.has(from));
            if (!preds.length) continue;
            layerOf.set(id, Math.max(...preds.map((from) => layerOf.get(from) || 0)) + 1);
            pending.splice(i, 1);
            moved = true;
        }
        if (moved) continue;
        const id = pending.pop()!;
        layerOf.set(id, 0);
    }
    return layerOf;
}

function orderByBarycenter(layer: string[], neighborLayer: string[], links: Map<string, string[]>) {
    const index = new Map(neighborLayer.map((id, i) => [id, i]));
    const scored = layer.map((id, order) => {
        const neighbors = (links.get(id) || []).filter((n) => index.has(n));
        const bary = neighbors.length
            ? neighbors.reduce((sum, n) => sum + (index.get(n) || 0), 0) / neighbors.length
            : order;
        return { id, bary, order };
    });
    scored.sort((a, b) => a.bary - b.bary || a.order - b.order || a.id.localeCompare(b.id));
    for (let i = 0; i < layer.length; i++) layer[i] = scored[i].id;
}

function placeLayerPacked(layer: string[], byId: Map<string, CanvasNodeData>, centers: Map<string, number>, startY: number) {
    let y = startY;
    for (const id of layer) {
        const node = byId.get(id)!;
        centers.set(id, y + node.height / 2);
        y += node.height + GAP_Y;
    }
}

function placeLayerByNeighbors(
    layer: string[],
    byId: Map<string, CanvasNodeData>,
    centers: Map<string, number>,
    links: Map<string, string[]>,
    preferNeighbors: boolean,
) {
    const desired = layer.map((id, order) => {
        const node = byId.get(id)!;
        const neighbors = (links.get(id) || []).filter((n) => centers.has(n));
        let center: number;
        if (neighbors.length && preferNeighbors) {
            center = neighbors.reduce((sum, n) => sum + (centers.get(n) || 0), 0) / neighbors.length;
        } else if (centers.has(id)) {
            center = centers.get(id)!;
            if (neighbors.length) {
                const bary = neighbors.reduce((sum, n) => sum + (centers.get(n) || 0), 0) / neighbors.length;
                center = (center + bary) / 2;
            }
        } else if (neighbors.length) {
            center = neighbors.reduce((sum, n) => sum + (centers.get(n) || 0), 0) / neighbors.length;
        } else {
            center = order * 200;
        }
        return { id, node, center, order };
    });

    // 按期望中心排序后消解重叠，保持顺序稳定。
    desired.sort((a, b) => a.center - b.center || a.order - b.order || a.id.localeCompare(b.id));
    // 同步 layer 顺序，供后续 barycenter 使用
    for (let i = 0; i < layer.length; i++) layer[i] = desired[i].id;

    let prevBottom = -Infinity;
    for (const item of desired) {
        let top = item.center - item.node.height / 2;
        if (top < prevBottom + GAP_Y) top = prevBottom + GAP_Y;
        const center = top + item.node.height / 2;
        centers.set(item.id, center);
        prevBottom = top + item.node.height;
    }

    // 若整体可上移贴齐，保持紧凑（避免第一层被推得过低）。
    const first = desired[0];
    if (!first) return;
    const firstTop = (centers.get(first.id) || 0) - first.node.height / 2;
    if (firstTop > 0) {
        for (const item of desired) {
            centers.set(item.id, (centers.get(item.id) || 0) - firstTop);
        }
    }
}

function layoutAsColumn(nodes: CanvasNodeData[]) {
    const sorted = [...nodes].sort(compareByPosition);
    const colWidth = Math.max(...sorted.map((node) => node.width));
    const positions = new Map<string, Position>();
    let y = 0;
    for (const node of sorted) {
        positions.set(node.id, {
            x: (colWidth - node.width) / 2,
            y,
        });
        y += node.height + GAP_Y;
    }
    return positions;
}

function layoutAsGrid(nodes: CanvasNodeData[]) {
    const sorted = [...nodes].sort(compareByPosition);
    const cols = Math.min(sorted.length, Math.max(2, Math.ceil(Math.sqrt(sorted.length))));
    const colWidths: number[] = Array.from({ length: cols }, () => 0);
    const rowHeights: number[] = [];

    sorted.forEach((node, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        colWidths[col] = Math.max(colWidths[col], node.width);
        rowHeights[row] = Math.max(rowHeights[row] || 0, node.height);
    });

    const colXs: number[] = [];
    let x = 0;
    for (const width of colWidths) {
        colXs.push(x);
        x += width + GAP_X;
    }
    const rowYs: number[] = [];
    let y = 0;
    for (const height of rowHeights) {
        rowYs.push(y);
        y += height + GAP_Y;
    }

    const positions = new Map<string, Position>();
    sorted.forEach((node, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        positions.set(node.id, {
            x: colXs[col] + (colWidths[col] - node.width) / 2,
            y: rowYs[row] + (rowHeights[row] - node.height) / 2,
        });
    });
    return positions;
}
