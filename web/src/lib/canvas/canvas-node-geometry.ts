import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ConnectionHandle, type ConnectionHandleSide, type Position } from "@/types/canvas";
import { isMindNode, mindNodeSideAnchor } from "@/lib/canvas/mind-map";

export function nodeBounds(nodes: CanvasNodeData[]) {
    return nodes.reduce(
        (acc, node) => ({
            left: Math.min(acc.left, node.position.x),
            top: Math.min(acc.top, node.position.y),
            right: Math.max(acc.right, node.position.x + node.width),
            bottom: Math.max(acc.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}

function nodeCenter(node: CanvasNodeData) {
    return { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
}

export function groupContainsNodeCenter(group: CanvasNodeData, node: CanvasNodeData) {
    const { x, y } = nodeCenter(node);
    return x >= group.position.x && x <= group.position.x + group.width && y >= group.position.y && y <= group.position.y + group.height;
}

/** 按 groupId 收集子节点与嵌套子组（不含自身） */
export function collectDescendantIds(groupId: string, nodes: CanvasNodeData[]) {
    const result = new Set<string>();
    const queue = [groupId];
    const seen = new Set<string>([groupId]);
    while (queue.length) {
        const id = queue.shift()!;
        for (const node of nodes) {
            if (node.metadata?.groupId !== id || seen.has(node.id)) continue;
            seen.add(node.id);
            result.add(node.id);
            if (node.type === CanvasNodeType.Group) queue.push(node.id);
        }
    }
    return result;
}

function dragRootNodes(movedIds: Set<string>, nodes: CanvasNodeData[]) {
    return nodes.filter((node) => movedIds.has(node.id) && (!node.metadata?.groupId || !movedIds.has(node.metadata.groupId)));
}

export function findGroupDropTarget(movedIds: Set<string>, nodes: CanvasNodeData[]) {
    const movingRoots = dragRootNodes(movedIds, nodes);
    if (!movingRoots.length) return null;
    const blocked = new Set<string>();
    for (const node of movingRoots) {
        if (node.type !== CanvasNodeType.Group) continue;
        blocked.add(node.id);
        for (const id of collectDescendantIds(node.id, nodes)) blocked.add(id);
    }
    return (
        [...nodes].reverse().find((group) => {
            if (group.type !== CanvasNodeType.Group || movedIds.has(group.id) || blocked.has(group.id)) return false;
            return movingRoots.some((node) => groupContainsNodeCenter(group, node));
        }) || null
    );
}

/** 为选中节点创建包围组框尺寸（紧贴选区 + 少量内边距，不再强制最小 240×180） */
export function boundsForGroupFrame(nodes: CanvasNodeData[], pad = 24) {
    const bounds = nodeBounds(nodes);
    if (!Number.isFinite(bounds.left)) return null;
    return {
        position: { x: bounds.left - pad, y: bounds.top - pad },
        width: Math.max(48, bounds.right - bounds.left + pad * 2),
        height: Math.max(48, bounds.bottom - bounds.top + pad * 2),
    };
}

export function snapNodesIntoGroup(movedIds: Set<string>, nodes: CanvasNodeData[], group: CanvasNodeData) {
    const movingNodes = nodes.filter((node) => movedIds.has(node.id));
    if (!movingNodes.length) return nodes;
    const pad = 24;
    const bounds = nodeBounds(movingNodes);
    const left = group.position.x + pad;
    const top = group.position.y + pad;
    const right = group.position.x + group.width - pad;
    const bottom = group.position.y + group.height - pad;
    const dx = bounds.right - bounds.left > right - left ? left - bounds.left : bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0;
    const dy = bounds.bottom - bounds.top > bottom - top ? top - bounds.top : bounds.top < top ? top - bounds.top : bounds.bottom > bottom ? bottom - bounds.bottom : 0;
    return nodes.map((node) => {
        if (!movedIds.has(node.id)) return node;
        const next = { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } };
        if (node.metadata?.groupId && movedIds.has(node.metadata.groupId)) return next;
        return { ...next, metadata: { ...node.metadata, groupId: group.id } };
    });
}

export function findContainingGroupId(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const descendantIds = node.type === CanvasNodeType.Group ? collectDescendantIds(node.id, nodes) : new Set<string>();
    let best: CanvasNodeData | undefined;
    let bestArea = Infinity;
    for (const group of nodes) {
        if (group.type !== CanvasNodeType.Group || group.id === node.id || descendantIds.has(group.id)) continue;
        if (!groupContainsNodeCenter(group, node)) continue;
        const area = Math.max(group.width, 1) * Math.max(group.height, 1);
        if (area < bestArea) {
            best = group;
            bestArea = area;
        }
    }
    return best?.id;
}

/** 拖动组框时把组内成员一并纳入拖动集合（含子组；旧画布无 groupId 时按中心是否落在组框内兜底） */
export function collectGroupDragMemberIds(groupId: string, group: CanvasNodeData, nodes: CanvasNodeData[], dragIds: Set<string>) {
    const queue = [groupId];
    const seen = new Set<string>([groupId]);
    const groupById = new Map(nodes.filter((node) => node.type === CanvasNodeType.Group).map((node) => [node.id, node]));
    const adopt = (node: CanvasNodeData) => {
        if (seen.has(node.id)) return;
        seen.add(node.id);
        dragIds.add(node.id);
        if (node.type === CanvasNodeType.Group) queue.push(node.id);
    };
    while (queue.length) {
        const id = queue.shift()!;
        const current = id === groupId ? group : groupById.get(id);
        for (const node of nodes) {
            if (seen.has(node.id)) continue;
            if (node.metadata?.groupId === id) {
                adopt(node);
                continue;
            }
            if (
                node.type === CanvasNodeType.Group &&
                current &&
                groupContainsNodeCenter(current, node) &&
                node.width * node.height < current.width * current.height
            ) {
                adopt(node);
            }
        }
    }
}

/** 沿全部连线（无向）收集与 seed 同一连通分量；数据组成员与组框视为相连，避免关联选择在组边断掉 */
export function collectConnectedComponentIds(seedId: string, connections: CanvasConnection[], nodes: CanvasNodeData[] = []) {
    const result = new Set<string>([seedId]);
    const queue = [seedId];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const childrenByGroup = new Map<string, string[]>();
    for (const node of nodes) {
        const groupId = node.metadata?.groupId;
        if (!groupId) continue;
        const list = childrenByGroup.get(groupId);
        if (list) list.push(node.id);
        else childrenByGroup.set(groupId, [node.id]);
    }
    const enqueue = (next: string) => {
        if (result.has(next)) return;
        result.add(next);
        queue.push(next);
    };
    while (queue.length) {
        const id = queue.shift()!;
        for (const connection of connections) {
            const next = connection.fromNodeId === id ? connection.toNodeId : connection.toNodeId === id ? connection.fromNodeId : null;
            if (next) enqueue(next);
        }
        const node = nodeById.get(id);
        if (!node) continue;
        if (node.type === CanvasNodeType.Group) {
            for (const childId of childrenByGroup.get(id) || []) enqueue(childId);
        } else if (node.metadata?.groupId) {
            enqueue(node.metadata.groupId);
        }
    }
    return result;
}

/** 将选中集合扩展为各自连通分量的并集 */
export function expandSelectionByConnections(selectedIds: Iterable<string>, connections: CanvasConnection[], nodes: CanvasNodeData[] = []) {
    const expanded = new Set<string>();
    for (const id of selectedIds) {
        for (const connected of collectConnectedComponentIds(id, connections, nodes)) expanded.add(connected);
    }
    return expanded;
}

export function getConnectionTargetAnchor(node: CanvasNodeData, current: ConnectionHandle) {
    if (isMindNode(node)) {
        if (current.side === "top" || current.side === "bottom" || current.side === "left" || current.side === "right") {
            return mindNodeSideAnchor(node, current.side);
        }
        // 未带 side 时：吸附到目标的输入侧尖点（左）或输出侧尖点（右）
        return mindNodeSideAnchor(node, current.handleType === "source" ? "left" : "right");
    }
    if (current.side === "top") {
        return { x: node.position.x + node.width / 2, y: node.position.y };
    }
    if (current.side === "bottom") {
        return { x: node.position.x + node.width / 2, y: node.position.y + node.height };
    }
    return {
        x: current.handleType === "source" ? node.position.x : node.position.x + node.width,
        y: node.position.y + node.height / 2,
    };
}

/** 世界坐标投影到节点边框，返回相对锚点（0–1） */
export function nearestBorderAnchor(node: CanvasNodeData, world: Position): { x: number; y: number } {
    const { x, y } = node.position;
    const w = Math.max(node.width, 1);
    const h = Math.max(node.height, 1);
    const dL = Math.abs(world.x - x);
    const dR = Math.abs(world.x - (x + w));
    const dT = Math.abs(world.y - y);
    const dB = Math.abs(world.y - (y + h));
    const min = Math.min(dL, dR, dT, dB);
    let ax = x;
    let ay = y;
    if (min === dL) {
        ax = x;
        ay = Math.max(y, Math.min(y + h, world.y));
    } else if (min === dR) {
        ax = x + w;
        ay = Math.max(y, Math.min(y + h, world.y));
    } else if (min === dT) {
        ay = y;
        ax = Math.max(x, Math.min(x + w, world.x));
    } else {
        ay = y + h;
        ax = Math.max(x, Math.min(x + w, world.x));
    }
    return { x: (ax - x) / w, y: (ay - y) / h };
}

export function absoluteAnchorPoint(node: CanvasNodeData, anchor: { x: number; y: number }): Position {
    return {
        x: node.position.x + anchor.x * node.width,
        y: node.position.y + anchor.y * node.height,
    };
}

export function edgeOfRelativeAnchor(anchor: { x: number; y: number }): ConnectionHandleSide {
    if (anchor.y <= 0.02) return "top";
    if (anchor.y >= 0.98) return "bottom";
    if (anchor.x <= 0.02) return "left";
    if (anchor.x >= 0.98) return "right";
    // 内部点：取更近的边
    const dL = anchor.x;
    const dR = 1 - anchor.x;
    const dT = anchor.y;
    const dB = 1 - anchor.y;
    const min = Math.min(dL, dR, dT, dB);
    if (min === dT) return "top";
    if (min === dB) return "bottom";
    if (min === dL) return "left";
    return "right";
}

export function sideToRelativeAnchor(side?: ConnectionHandleSide): { x: number; y: number } {
    if (side === "top") return { x: 0.5, y: 0 };
    if (side === "bottom") return { x: 0.5, y: 1 };
    if (side === "left") return { x: 0, y: 0.5 };
    return { x: 1, y: 0.5 };
}

/** 点到节点边框的距离（框内为到最近边，框外为到最近边投影） */
export function distanceToNodeBorder(node: CanvasNodeData, world: Position): number {
    const { x, y } = node.position;
    const right = x + node.width;
    const bottom = y + node.height;
    if (world.x >= x && world.x <= right && world.y >= y && world.y <= bottom) {
        return Math.min(world.x - x, right - world.x, world.y - y, bottom - world.y);
    }
    const cx = Math.max(x, Math.min(right, world.x));
    const cy = Math.max(y, Math.min(bottom, world.y));
    return Math.hypot(world.x - cx, world.y - cy);
}

export function dataGroupBorderHitPx(viewportScale: number) {
    return Math.max(10, Math.min(20, 14 / Math.max(viewportScale, 0.05)));
}

export function isDataGroupBorderHit(node: CanvasNodeData, world: Position, viewportScale: number) {
    if (node.type !== CanvasNodeType.Group) return true;
    const isData = node.metadata?.groupKind === "data" || Boolean(node.metadata?.groupBundleText || node.metadata?.content);
    if (!isData) return true;
    return distanceToNodeBorder(node, world) <= dataGroupBorderHitPx(viewportScale);
}

export function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    // 组与组不能互连；数据组可作为上游输出或下游边框接入点
    if (first.type === CanvasNodeType.Group && second.type === CanvasNodeType.Group) return null;
    if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
    // 工作台只有输入点，永远作为连线终点
    if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    // 从左侧输入点拖出时，对端是上游输出，当前节点是下游输入
    if (firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    return { fromNodeId: first.id, toNodeId: second.id };
}
