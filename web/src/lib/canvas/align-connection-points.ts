import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";

/** 连接点 Y：源节点右中、目标节点左中。 */
export function connectionHandleY(node: CanvasNodeData) {
    return node.position.y + node.height / 2;
}

/**
 * 水平对齐一条连线两端的连接点：两节点垂直中心对齐到平均值，连线变直。
 * 返回需更新的 position（无变化则空 Map）。
 */
export function alignConnectionPointsHorizontally(from: CanvasNodeData, to: CanvasNodeData): Map<string, Position> {
    const fromCy = connectionHandleY(from);
    const toCy = connectionHandleY(to);
    const mid = (fromCy + toCy) / 2;
    const fromDy = mid - fromCy;
    const toDy = mid - toCy;
    const next = new Map<string, Position>();
    if (Math.abs(fromDy) > 1e-6) next.set(from.id, { x: from.position.x, y: from.position.y + fromDy });
    if (Math.abs(toDy) > 1e-6) next.set(to.id, { x: to.position.x, y: to.position.y + toDy });
    return next;
}

/** 按 connectionId 对齐；找不到节点则空 Map。 */
export function alignConnectionById(connectionId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const connection = connections.find((item) => item.id === connectionId);
    if (!connection) return new Map<string, Position>();
    const from = nodes.find((node) => node.id === connection.fromNodeId);
    const to = nodes.find((node) => node.id === connection.toNodeId);
    if (!from || !to) return new Map<string, Position>();
    return alignConnectionPointsHorizontally(from, to);
}
