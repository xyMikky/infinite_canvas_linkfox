import type { CanvasConnection, CanvasNodeData, ConnectionHandleSide, Position } from "@/types/canvas";

export const MIND_NODE_TYPE = "mind-node";

/**
 * 导图外形左右/上下尖点相对包围盒的比例（与 mind-node SVG polygon 一致）。
 * 连线锚点必须用尖点，不能用包围盒边，否则菱形等会留缝。
 */
export function mindShapeTipInset(shape: string | undefined): { left: number; right: number; top: number; bottom: number } {
    if (shape === "diamond") return { left: 0, right: 1, top: 0, bottom: 1 };
    if (shape === "hexagon") return { left: 0, right: 1, top: 0.12, bottom: 0.88 };
    if (shape === "circle") return { left: 0, right: 1, top: 0, bottom: 1 };
    return { left: 0, right: 1, top: 0, bottom: 1 };
}

/** 与 mind-node 绘制一致的多边形点（viewBox 0–100） */
export function mindShapePolyPoints(shape: string | undefined): string | null {
    if (shape === "diamond") return "50,0 100,50 50,100 0,50";
    if (shape === "hexagon") return "10,12 90,12 100,50 90,88 10,88 0,50";
    return null;
}

export function mindNodeSideAnchor(node: CanvasNodeData, side: ConnectionHandleSide): Position {
    const inset = mindShapeTipInset(String(node.metadata?.mindShape || ""));
    const { x, y } = node.position;
    const w = node.width;
    const h = node.height;
    if (side === "left") return { x: x + w * inset.left, y: y + h / 2 };
    if (side === "right") return { x: x + w * inset.right, y: y + h / 2 };
    if (side === "top") return { x: x + w / 2, y: y + h * inset.top };
    return { x: x + w / 2, y: y + h * inset.bottom };
}

/** 世界坐标最近的导图尖点边 */
export function nearestMindHandleSide(node: CanvasNodeData, world: Position): ConnectionHandleSide {
    const sides: ConnectionHandleSide[] = ["left", "right", "top", "bottom"];
    let best: ConnectionHandleSide = "left";
    let bestDist = Number.POSITIVE_INFINITY;
    for (const side of sides) {
        const tip = mindNodeSideAnchor(node, side);
        const dist = (tip.x - world.x) ** 2 + (tip.y - world.y) ** 2;
        if (dist < bestDist) {
            bestDist = dist;
            best = side;
        }
    }
    return best;
}

/** 是否为带成员的数据组框（几何/端口可当作布局对端） */
export function isMindDataGroup(node: CanvasNodeData | null | undefined) {
    if (!node || node.type !== "group") return false;
    if (node.metadata?.groupKind === "data" || node.metadata?.groupBundleText) return true;
    const members = node.metadata?.memberIds;
    return Array.isArray(members) && members.length > 0;
}

/**
 * 组外主题连到组内叶子时，端口与贝塞尔按数据组框计算，线接到组边中点（避免落到叶底绕圈）。
 * 同组内叶子互连仍用叶子本身。
 */
export function resolveMindLayoutPeer(
    node: CanvasNodeData,
    other: CanvasNodeData,
    byId: Map<string, CanvasNodeData>,
): CanvasNodeData {
    const groupId = node.metadata?.groupId ? String(node.metadata.groupId) : "";
    if (!groupId) return node;
    const otherGid = other.metadata?.groupId ? String(other.metadata.groupId) : "";
    if (otherGid && otherGid === groupId) return node;
    if (other.id === groupId) return node;
    const group = byId.get(groupId);
    if (!group || !isMindDataGroup(group)) return node;
    return group;
}

/**
 * 导图锚点：明显横/纵用对边；斜向用 L 形（如右出上进），避免拧成别扭的 S 线。
 * 对端为数据组时放宽水平判定，避免高组框中心偏低被误判成竖连。
 */
export function pickMindConnectionSides(from: CanvasNodeData, to: CanvasNodeData): { startSide: ConnectionHandleSide; endSide: ConnectionHandleSide } {
    const dx = to.position.x + to.width / 2 - (from.position.x + from.width / 2);
    const dy = to.position.y + to.height / 2 - (from.position.y + from.height / 2);
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    // 中心几乎对齐时强制对边直连，避免「略偏」被判成 L 形从反侧绕出
    const alignX = Math.min(from.width, to.width) * 0.4;
    const alignY = Math.min(from.height, to.height) * 0.4;
    const involvesGroup = isMindDataGroup(from) || isMindDataGroup(to);

    if (absDx <= alignX && absDy > 4) {
        return { startSide: dy >= 0 ? "bottom" : "top", endSide: dy >= 0 ? "top" : "bottom" };
    }
    if (absDy <= alignY && absDx > 4) {
        return { startSide: dx >= 0 ? "right" : "left", endSide: dx >= 0 ? "left" : "right" };
    }
    // 数据组在旁侧：组框往往很高、中心偏低，优先横连接到近侧边中点
    if (involvesGroup && absDx > 8 && absDx >= absDy * 0.45) {
        return { startSide: dx >= 0 ? "right" : "left", endSide: dx >= 0 ? "left" : "right" };
    }
    // 主轴优先（阈值放宽）：竖链 bottom↔top、横链 left↔right，少走反侧绕圈
    if (absDy >= absDx * 0.85) {
        return { startSide: dy >= 0 ? "bottom" : "top", endSide: dy >= 0 ? "top" : "bottom" };
    }
    if (absDx >= absDy * 0.85) {
        return { startSide: dx >= 0 ? "right" : "left", endSide: dx >= 0 ? "left" : "right" };
    }
    // 斜向且两轴都明显：出口朝主位移，入口朝次轴（L 形外拱）
    if (absDx >= absDy) {
        return { startSide: dx >= 0 ? "right" : "left", endSide: dy >= 0 ? "top" : "bottom" };
    }
    return { startSide: dy >= 0 ? "bottom" : "top", endSide: dx >= 0 ? "left" : "right" };
}

function isMindStructurePeer(node: CanvasNodeData) {
    return isMindNode(node) || isMindDataGroup(node) || isMindEmbeddableNode(node);
}

/** 导图连线：固定父→子方向，并尊重拖出/松手吸附的尖点边；可挂普通节点 */
export function resolveMindConnection(
    dragNodeId: string,
    dropNodeId: string,
    dragSide: ConnectionHandleSide | undefined,
    dropSide: ConnectionHandleSide | undefined,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
): { fromNodeId: string; toNodeId: string; fromSide: ConnectionHandleSide; toSide: ConnectionHandleSide } | null {
    const drag = nodes.find((node) => node.id === dragNodeId);
    const drop = nodes.find((node) => node.id === dropNodeId);
    if (!drag || !drop || drag.id === drop.id || !isMindStructurePeer(drag) || !isMindStructurePeer(drop)) return null;
    if (isAnnotationNode(drag) || isAnnotationNode(drop)) return null;
    // 两端都与导图枢纽无关时不走 mind 父子（避免两块普通节点互连被当成导图）
    if (!isMindNode(drag) && !isMindDataGroup(drag) && !isMindNode(drop) && !isMindDataGroup(drop)) return null;

    const dropIsParentOfDrag = mindParentOf(dragNodeId, nodes, connections)?.id === dropNodeId;
    const dragIsParentOfDrop = mindParentOf(dropNodeId, nodes, connections)?.id === dragNodeId;
    const parent = dropIsParentOfDrag ? drop : dragIsParentOfDrop ? drag : drag;
    const child = parent.id === drag.id ? drop : drag;

    const fromSide =
        (dragNodeId === parent.id ? dragSide : dropNodeId === parent.id ? dropSide : undefined)
        || pickMindConnectionSides(parent, child).startSide;
    const toSide =
        (dragNodeId === child.id ? dragSide : dropNodeId === child.id ? dropSide : undefined)
        || pickMindConnectionSides(parent, child).endSide;

    return { fromNodeId: parent.id, toNodeId: child.id, fromSide, toSide };
}

/**
 * 尺寸变化时用于钉住尖点的边：只按主轴取对边（不做斜向 L），
 * 避免「基本水平」被判成上进，换行加高时左右中点跟着跑。
 */
function pickMindResizeAnchorSide(from: CanvasNodeData, to: CanvasNodeData, role: "start" | "end"): ConnectionHandleSide {
    const dx = to.position.x + to.width / 2 - (from.position.x + from.width / 2);
    const dy = to.position.y + to.height / 2 - (from.position.y + from.height / 2);
    if (Math.abs(dx) >= Math.abs(dy)) {
        if (role === "start") return dx >= 0 ? "right" : "left";
        return dx >= 0 ? "left" : "right";
    }
    if (role === "start") return dy >= 0 ? "bottom" : "top";
    return dy >= 0 ? "top" : "bottom";
}

/**
 * 样式/尺寸变化后重算位置：固定与上游（或下游）连线的尖点。
 * 水平连线钉住左/右中点（换行加高不移）；竖直连线钉住上/下中点（加宽不移）。
 */
export function positionMindNodeAfterResize(
    node: CanvasNodeData,
    nextWidth: number,
    nextHeight: number,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
): Position {
    const local = { ...node, width: nextWidth, height: nextHeight, position: { x: 0, y: 0 } };

    const incoming = connections.find((conn) => conn.kind === "mind" && conn.toNodeId === node.id);
    if (incoming) {
        const from = nodes.find((item) => item.id === incoming.fromNodeId);
        if (from) {
            const endSide = incoming.toSide || pickMindResizeAnchorSide(from, node, "end");
            const oldTip = mindNodeSideAnchor(node, endSide);
            const tipAtOrigin = mindNodeSideAnchor(local, endSide);
            return { x: oldTip.x - tipAtOrigin.x, y: oldTip.y - tipAtOrigin.y };
        }
    }

    const outgoing = connections.find((conn) => conn.kind === "mind" && conn.fromNodeId === node.id);
    if (outgoing) {
        const to = nodes.find((item) => item.id === outgoing.toNodeId);
        if (to) {
            const startSide = outgoing.fromSide || pickMindResizeAnchorSide(node, to, "start");
            const oldTip = mindNodeSideAnchor(node, startSide);
            const tipAtOrigin = mindNodeSideAnchor(local, startSide);
            return { x: oldTip.x - tipAtOrigin.x, y: oldTip.y - tipAtOrigin.y };
        }
    }

    return {
        x: node.position.x + (node.width - nextWidth) / 2,
        y: node.position.y + (node.height - nextHeight) / 2,
    };
}

/** 点击外形边线时，取最近尖点作为缩放角 */
export function nearestMindResizeCorner(
    shape: string | undefined,
    localX: number,
    localY: number,
    width: number,
    height: number,
): "top" | "right" | "bottom" | "left" {
    const inset = mindShapeTipInset(shape);
    const tips: Array<{ corner: "top" | "right" | "bottom" | "left"; x: number; y: number }> = [
        { corner: "top", x: width * 0.5, y: height * inset.top },
        { corner: "right", x: width * inset.right, y: height * 0.5 },
        { corner: "bottom", x: width * 0.5, y: height * inset.bottom },
        { corner: "left", x: width * inset.left, y: height * 0.5 },
    ];
    let best = tips[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const tip of tips) {
        const dist = (tip.x - localX) ** 2 + (tip.y - localY) ** 2;
        if (dist < bestDist) {
            bestDist = dist;
            best = tip;
        }
    }
    return best.corner;
}

/** 导图模式创建菜单用的选项 id（后续可扩展更多适配节点） */
export const MIND_CREATE_ROOT = "mind-create:root";
export const MIND_CREATE_CHILD = "mind-create:child";
export const MIND_CREATE_DECISION = "mind-create:decision";
export const MIND_CREATE_ANNOTATION = "mind-create:annotation";
/** @deprecated 兼容旧 id，等同子节点 */
export const MIND_CREATE_TOPIC = MIND_CREATE_CHILD;

export const MIND_CREATE_TYPES = [MIND_CREATE_ROOT, MIND_CREATE_CHILD, MIND_CREATE_DECISION, MIND_CREATE_ANNOTATION] as const;

export function isMindCreateType(type: string) {
    return (MIND_CREATE_TYPES as readonly string[]).includes(type) || type === "mind-create:topic";
}

export type MindNodeKind = "topic" | "decision" | "annotation";

export function mindKindFromCreateType(type: string): MindNodeKind {
    if (type === MIND_CREATE_DECISION) return "decision";
    if (type === MIND_CREATE_ANNOTATION) return "annotation";
    return "topic";
}

export function isMindNode(node: CanvasNodeData | null | undefined) {
    return Boolean(node && node.type === MIND_NODE_TYPE);
}

export function isAnnotationNode(node: CanvasNodeData | null | undefined) {
    return isMindNode(node) && node?.metadata?.mindKind === "annotation";
}

export function isDecisionNode(node: CanvasNodeData | null | undefined) {
    return isMindNode(node) && node?.metadata?.mindKind === "decision";
}

/** 判断节点出边缺省分支名：优先「是」「否」，再「分支N」 */
export function nextDecisionBranchLabel(parentId: string, connections: CanvasConnection[]): string {
    const used = new Set(
        connections
            .filter((conn) => conn.kind === "mind" && conn.fromNodeId === parentId)
            .map((conn) => String(conn.label || "").trim())
            .filter(Boolean),
    );
    if (!used.has("是")) return "是";
    if (!used.has("否")) return "否";
    let index = 3;
    while (used.has(`分支${index}`)) index += 1;
    return `分支${index}`;
}

/** 为所有判断节点补全缺失的出边 label（不覆盖已有文字） */
export function ensureDecisionOutgoingLabels(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasConnection[] {
    const decisionIds = new Set(nodes.filter(isDecisionNode).map((node) => node.id));
    if (!decisionIds.size) return connections;
    let next = connections;
    for (const parentId of decisionIds) {
        const outs = next.filter((conn) => conn.kind === "mind" && conn.fromNodeId === parentId);
        for (const conn of outs) {
            if (String(conn.label || "").trim()) continue;
            const label = nextDecisionBranchLabel(parentId, next.filter((item) => item.id !== conn.id));
            next = next.map((item) => (item.id === conn.id ? { ...item, label } : item));
        }
    }
    return next;
}

/**
 * 判断节点多条出边（是/否）共用同一出口尖点：按子题质心定方向，避免左右尖分别甩出。
 */
export function sharedDecisionExitSide(
    decision: CanvasNodeData,
    byId: Map<string, CanvasNodeData>,
    connections: CanvasConnection[],
): ConnectionHandleSide | null {
    if (!isDecisionNode(decision)) return null;
    const outs = connections.filter((conn) => conn.kind === "mind" && conn.fromNodeId === decision.id);
    if (outs.length < 2) return null;
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const conn of outs) {
        const to = byId.get(conn.toNodeId);
        if (!to) continue;
        const peer = resolveMindLayoutPeer(to, decision, byId);
        sumX += peer.position.x + peer.width / 2;
        sumY += peer.position.y + peer.height / 2;
        count += 1;
    }
    if (count < 2) return null;
    const dx = sumX / count - (decision.position.x + decision.width / 2);
    const dy = sumY / count - (decision.position.y + decision.height / 2);
    if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? "bottom" : "top";
    return dx >= 0 ? "right" : "left";
}

/** 判断节点出边统一 fromSide；toSide 仍按各子题位置选取 */
export function withSharedDecisionExitSides(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasConnection[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const sharedByParent = new Map<string, ConnectionHandleSide>();
    for (const node of nodes) {
        if (!isDecisionNode(node)) continue;
        const side = sharedDecisionExitSide(node, byId, connections);
        if (side) sharedByParent.set(node.id, side);
    }
    if (!sharedByParent.size) return connections;
    return connections.map((conn) => {
        if (conn.kind !== "mind") return conn;
        const shared = sharedByParent.get(conn.fromNodeId);
        if (!shared) return conn;
        const from = byId.get(conn.fromNodeId);
        const to = byId.get(conn.toNodeId);
        if (!from || !to) {
            return conn.fromSide === shared ? conn : { ...conn, fromSide: shared };
        }
        const layoutTo = resolveMindLayoutPeer(to, from, byId);
        const endSide = pickMindConnectionSides(from, layoutTo).endSide;
        if (conn.fromSide === shared && conn.toSide === endSide) return conn;
        return { ...conn, fromSide: shared, toSide: endSide };
    });
}

export function isMindConnection(connection: CanvasConnection) {
    return connection.kind === "mind";
}

export function isAnnotationConnection(connection: CanvasConnection) {
    return connection.kind === "annotation";
}

/**
 * 标注连线语义：from = 标注节点，to = 被备注的原节点（箭头指向 to）。
 * 若方向反了则对调，保证箭头始终指向原节点。
 */
export function orderAnnotationConnection(
    fromNodeId: string,
    toNodeId: string,
    nodes: CanvasNodeData[],
): { fromNodeId: string; toNodeId: string } {
    const from = nodes.find((node) => node.id === fromNodeId);
    const to = nodes.find((node) => node.id === toNodeId);
    if (isAnnotationNode(to) && !isAnnotationNode(from)) {
        return { fromNodeId: toNodeId, toNodeId: fromNodeId };
    }
    return { fromNodeId, toNodeId };
}

/** 绘制标注连线时纠正 from/to，兼容旧数据 */
export function annotationDrawPair(from: CanvasNodeData, to: CanvasNodeData) {
    if (isAnnotationNode(to) && !isAnnotationNode(from)) return { from: to, to: from };
    return { from, to };
}

/** 可并入导图结构的普通画布节点：除组框与配置工作台外均可作为导图成员（看板、图片、文本、文件夹等） */
export function isMindEmbeddableNode(node: CanvasNodeData | null | undefined) {
    if (!node) return false;
    if (isMindNode(node)) return true;
    return node.type !== "group" && node.type !== "config";
}

/**
 * 连线 kind 判定：
 * - 任一端为标注节点 → annotation（虚线）；
 * - 两端均为导图主题/数据组 → mind；
 * - 一端导图/数据组、另一端普通画布节点（看板/图片/文本等）→ mind（并入导图结构）；
 * - 两端都与导图无关 → null（普通连线/传递）。
 */
export function mindLinkKind(
    from: CanvasNodeData | null | undefined,
    to: CanvasNodeData | null | undefined,
    _side?: ConnectionHandleSide,
): "mind" | "annotation" | null {
    if (!from || !to) return null;
    const fromHub = isMindNode(from) || isMindDataGroup(from);
    const toHub = isMindNode(to) || isMindDataGroup(to);
    if (!fromHub && !toHub) return null;
    if (isAnnotationNode(from) || isAnnotationNode(to)) return "annotation";
    if (fromHub && toHub) return "mind";
    return isMindEmbeddableNode(fromHub ? to : from) ? "mind" : null;
}

/**
 * 绘制/虚线判定用的有效 kind。
 * 历史数据曾把「上下点」误标为 annotation；两端都不是标注节点时按 mind 实线处理。
 */
export function resolveConnectionKind(
    connection: CanvasConnection,
    from?: CanvasNodeData | null,
    to?: CanvasNodeData | null,
): CanvasConnection["kind"] {
    if (connection.kind !== "annotation") return connection.kind;
    if (from && to && !isAnnotationNode(from) && !isAnnotationNode(to)) return "mind";
    return "annotation";
}

export function mindTopicLabel(node: CanvasNodeData) {
    const content = String(node.metadata?.content || "").trim();
    if (content) return content;
    return (node.title || "").trim() || "主题";
}

/** 沿 mind 连线向下找直接子题/并入的普通节点（按画布 Y 排序，稳定大纲顺序） */
export function mindChildrenOf(parentId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const childIds = connections
        .filter((connection) => connection.kind === "mind" && connection.fromNodeId === parentId)
        .map((connection) => connection.toNodeId);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return childIds
        .map((id) => byId.get(id))
        .filter((node): node is CanvasNodeData => Boolean(node) && isMindStructurePeer(node) && !isAnnotationNode(node))
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
}

/** 沿 mind 连线找父主题（可含数据组 / 并入导图的普通节点） */
export function mindParentOf(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const edge = connections.find((connection) => connection.kind === "mind" && connection.toNodeId === nodeId);
    if (!edge) return null;
    const parent = nodes.find((node) => node.id === edge.fromNodeId);
    return parent && isMindStructurePeer(parent) && !isAnnotationNode(parent) ? parent : null;
}

export type MindCollapseSide = "left" | "right" | "top" | "bottom";

export function isMindSideCollapsed(node: CanvasNodeData, side: MindCollapseSide) {
    return Boolean(node.metadata?.mindCollapsedSides?.includes(side));
}

export function toggleMindCollapsedSides(current: MindCollapseSide[] | undefined, side: MindCollapseSide): MindCollapseSide[] | undefined {
    const next = new Set(current || []);
    if (next.has(side)) next.delete(side);
    else next.add(side);
    return next.size ? [...next] : undefined;
}

function mindNeighborSide(parent: CanvasNodeData, other: CanvasNodeData): "left" | "right" | "top" | "bottom" {
    const px = parent.position.x + parent.width / 2;
    const py = parent.position.y + parent.height / 2;
    const ox = other.position.x + other.width / 2;
    const oy = other.position.y + other.height / 2;
    const dx = ox - px;
    const dy = oy - py;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
    return dy >= 0 ? "bottom" : "top";
}

/** 与 parent 直接相连、从指定侧连出的子节点（不含从该侧连入的父节点）；含并入导图的普通节点 */
export function mindSideNeighbors(parent: CanvasNodeData, side: MindCollapseSide, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const list: CanvasNodeData[] = [];
    for (const connection of connections) {
        if (connection.fromNodeId !== parent.id || connection.kind === "annotation") continue;
        const child = byId.get(connection.toNodeId);
        if (!child || isAnnotationNode(child)) continue;
        if (!isMindNode(child) && !(connection.kind === "mind" && isMindEmbeddableNode(child))) continue;
        const exitSide = connection.fromSide ?? mindNeighborSide(parent, child);
        if (exitSide === side) list.push(child);
    }
    return list;
}

/** 从起点沿导图边收集子孙（不穿越 blockId）；只走 mind/annotation 边，避免顺着普通生成连线把无关节点一起折叠 */
function collectConnectedSubtree(startId: string, blockId: string, connections: CanvasConnection[]) {
    const result = new Set<string>();
    const queue = [startId];
    while (queue.length) {
        const id = queue.shift()!;
        if (id === blockId || result.has(id)) continue;
        result.add(id);
        for (const connection of connections) {
            if (connection.kind !== "mind" && connection.kind !== "annotation") continue;
            const next = connection.fromNodeId === id ? connection.toNodeId : connection.toNodeId === id ? connection.fromNodeId : null;
            if (next && next !== blockId && !result.has(next)) queue.push(next);
        }
    }
    return result;
}

/** 因各节点 mindCollapsedSides 而应隐藏的节点 id */
export function collectMindCollapsedNodeIds(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const hidden = new Set<string>();
    for (const node of nodes) {
        if (!isMindNode(node)) continue;
        const sides = node.metadata?.mindCollapsedSides;
        if (!sides?.length) continue;
        for (const side of sides) {
            for (const neighbor of mindSideNeighbors(node, side, nodes, connections)) {
                for (const id of collectConnectedSubtree(neighbor.id, node.id, connections)) hidden.add(id);
            }
        }
    }
    return hidden;
}

export type MindMapAgentContext = {
    rootId: string;
    rootLabel: string;
    nodeCount: number;
    nodeIds: string[];
    selectedInMap: string[];
    outline: string;
};

type MindMapOutlineOptions = {
    includeNodeIds?: boolean;
    includeKinds?: boolean;
    includeAnnotations?: boolean;
    includeStyles?: boolean;
    includeConnectionLabels?: boolean;
};

function mindNodeKindTag(node: CanvasNodeData) {
    if (node.metadata?.mindRole === "root") return "中心";
    if (node.metadata?.mindKind === "decision") return "决策";
    if (node.metadata?.mindKind === "annotation") return "标注";
    return "分支";
}

/** 挂在主题上的标注节点（annotation → topic） */
export function mindAnnotationsOf(targetId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return connections
        .filter((connection) => connection.kind === "annotation" && connection.toNodeId === targetId)
        .map((connection) => byId.get(connection.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node) && isAnnotationNode(node));
}

/** 无 mind 父节点的主题根（一张导图一棵树） */
export function mindMapRoots(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return nodes
        .filter((node) => isMindNode(node) && !isAnnotationNode(node))
        .filter((node) => {
            const parent = mindParentOf(node.id, nodes, connections);
            return !parent || isAnnotationNode(parent);
        })
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
}

function collectMindSubtreeIds(rootId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const ids = new Set<string>();
    const walk = (nodeId: string) => {
        if (ids.has(nodeId)) return;
        const node = nodes.find((item) => item.id === nodeId);
        if (!node || !isMindNode(node)) return;
        ids.add(nodeId);
        for (const annotation of mindAnnotationsOf(nodeId, nodes, connections)) ids.add(annotation.id);
        for (const child of mindChildrenOf(nodeId, nodes, connections)) walk(child.id);
    };
    walk(rootId);
    return ids;
}

function formatMindOutlineLine(node: CanvasNodeData, depth: number, options: MindMapOutlineOptions) {
    const label = mindTopicLabel(node);
    const parts: string[] = [`${"  ".repeat(depth)}-`];
    if (options.includeKinds !== false) {
        const tag = mindNodeKindTag(node);
        if (tag !== "分支" || node.metadata?.mindRole === "root") parts.push(`[${tag}]`);
    }
    parts.push(label);
    if (options.includeNodeIds) parts.push(`(id: ${node.id})`);
    if (options.includeStyles) {
        const style = formatMindNodeStyleTag(node);
        if (style) parts.push(`{${style}}`);
    }
    return parts.join(" ");
}

function formatMindNodeStyleTag(node: CanvasNodeData) {
    const metadata = node.metadata || {};
    const parts: string[] = [];
    const shape = metadata.mindShape ? String(metadata.mindShape) : "";
    const kind = metadata.mindKind ? String(metadata.mindKind) : "";
    const color = metadata.mindColor ? String(metadata.mindColor) : "";
    const fontSize = typeof metadata.fontSize === "number" ? metadata.fontSize : null;
    if (kind && kind !== "topic") parts.push(`kind=${kind}`);
    if (shape && !(kind === "decision" && shape === "hexagon") && !(kind === "annotation" && shape === "underline") && metadata.mindRole !== "root") {
        if (shape !== "rounded" && shape !== "capsule") parts.push(`shape=${shape}`);
    }
    if (color && color !== "#16a34a" && color !== "#d97706" && color !== "#64748b") parts.push(`color=${color}`);
    if (fontSize && fontSize !== 13 && fontSize !== 15) parts.push(`fontSize=${fontSize}`);
    return parts.join(", ");
}

function buildMindMapTreeOutline(roots: CanvasNodeData[], nodes: CanvasNodeData[], connections: CanvasConnection[], options: MindMapOutlineOptions = {}) {
    const lines: string[] = [];
    const visited = new Set<string>();
    const includeAnnotations = options.includeAnnotations !== false;

    const walk = (node: CanvasNodeData, depth: number, edgeLabel?: string) => {
        if (visited.has(node.id)) return;
        visited.add(node.id);
        let line = formatMindOutlineLine(node, depth, options);
        if (options.includeConnectionLabels && edgeLabel) {
            line += ` ←连线「${edgeLabel}」`;
        }
        lines.push(line);
        if (includeAnnotations) {
            for (const annotation of mindAnnotationsOf(node.id, nodes, connections)) {
                if (visited.has(annotation.id)) continue;
                visited.add(annotation.id);
                lines.push(formatMindOutlineLine(annotation, depth + 1, options));
            }
        }
        for (const child of mindChildrenOf(node.id, nodes, connections)) {
            const edge = connections.find((connection) => connection.kind === "mind" && connection.fromNodeId === node.id && connection.toNodeId === child.id);
            walk(child, depth + 1, options.includeConnectionLabels ? edge?.label?.trim() || undefined : undefined);
        }
    };

    for (const root of roots) walk(root, 0);
    return lines.join("\n");
}

/**
 * 从所选 mind 节点生成缩进大纲。
 * 若选中多个，优先各自作为根（去掉已被其它选中节点覆盖的子孙），再拼在一起。
 */
export function buildMindMapOutlineText(
    selected: CanvasNodeData[],
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    options: MindMapOutlineOptions = {},
) {
    const mindSelected = selected.filter((node) => isMindNode(node) && !isAnnotationNode(node));
    if (!mindSelected.length) return "";

    const selectedIds = new Set(mindSelected.map((node) => node.id));
    const roots = mindSelected.filter((node) => {
        let parent = mindParentOf(node.id, nodes, connections);
        while (parent) {
            if (selectedIds.has(parent.id)) return false;
            parent = mindParentOf(parent.id, nodes, connections);
        }
        return true;
    });
    const rootsToUse = roots.length ? roots : mindSelected.slice(0, 1);
    const outline = buildMindMapTreeOutline(rootsToUse, nodes, connections, {
        includeKinds: true,
        includeAnnotations: true,
        includeNodeIds: options.includeNodeIds,
    });
    if (!outline) return "";
    const title = mindTopicLabel(rootsToUse[0]);
    const header = options.includeNodeIds
        ? `【思维导图：${title}】\n节点 id 可用于更新/删除等画布工具。`
        : `【思维导图：${title}】`;
    return [header, outline].join("\n");
}

/** 供 Agent / Codex 读取：带节点 id、角色与标注的完整导图结构 */
export function buildMindMapAgentContexts(nodes: CanvasNodeData[], connections: CanvasConnection[], selectedNodeIds: string[] = []): MindMapAgentContext[] {
    const selected = new Set(selectedNodeIds);
    return mindMapRoots(nodes, connections).map((root) => {
        const nodeIds = [...collectMindSubtreeIds(root.id, nodes, connections)];
        const nodeIdSet = new Set(nodeIds);
        const outline = buildMindMapTreeOutline([root], nodes, connections, {
            includeNodeIds: true,
            includeKinds: true,
            includeAnnotations: true,
            includeStyles: true,
            includeConnectionLabels: true,
        });
        const connectionDigest = formatMindMapConnectionsForAgent(nodeIdSet, nodes, connections);
        return {
            rootId: root.id,
            rootLabel: mindTopicLabel(root),
            nodeCount: nodeIds.length,
            nodeIds,
            selectedInMap: nodeIds.filter((id) => selected.has(id)),
            outline: outline
                ? [
                      `中心主题：${mindTopicLabel(root)} (id: ${root.id})`,
                      "层级（父 → 子；[标注] 挂在主题上；←连线「…」为连线中点文字，等同用户双击连线编辑；节点 {kind/shape/color} 为样式）：",
                      outline,
                      ...(connectionDigest ? ["", connectionDigest] : []),
                  ].join("\n")
                : "",
        };
    }).filter((item) => item.nodeCount > 0 && item.outline);
}

function formatMindMapConnectionsForAgent(nodeIds: Set<string>, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const edges = connections.filter((connection) => {
        if (connection.kind !== "mind" && connection.kind !== "annotation") return false;
        return nodeIds.has(connection.fromNodeId) && nodeIds.has(connection.toNodeId);
    });
    if (!edges.length) return "";
    const lines = edges.map((connection) => {
        const from = byId.get(connection.fromNodeId);
        const to = byId.get(connection.toNodeId);
        const fromLabel = from ? mindTopicLabel(from) : connection.fromNodeId;
        const toLabel = to ? mindTopicLabel(to) : connection.toNodeId;
        const kind = connection.kind === "annotation" ? "虚线标注" : "导图";
        const label = connection.label?.trim() ? ` label「${connection.label.trim()}」` : "";
        const sides = connection.fromSide || connection.toSide ? ` ports ${connection.fromSide || "?"}→${connection.toSide || "?"}` : "";
        return `- [${kind}] ${fromLabel} → ${toLabel} (conn id: ${connection.id})${label}${sides}`;
    });
    return [
        "连线清单（label 为连线中点说明，用户可双击连线编辑；Agent 创建时 connect_nodes 传 label，修改用 canvas_update_connection）：",
        ...lines,
    ].join("\n");
}

export function mindMapsForSelection(contexts: MindMapAgentContext[], selectedNodeIds: string[]) {
    if (!selectedNodeIds.length) return contexts;
    const selected = new Set(selectedNodeIds);
    return contexts.filter((item) => item.nodeIds.some((id) => selected.has(id)));
}

/** Tab 创建子题：默认向右生长；若父题左侧已有子题则向左 */
export function placeMindChildPosition(parent: CanvasNodeData, siblings: CanvasNodeData[], childSize: { width: number; height: number }): Position {
    const growLeft = siblings.some((node) => node.position.x + node.width / 2 < parent.position.x + parent.width / 2)
        && !siblings.some((node) => node.position.x + node.width / 2 >= parent.position.x + parent.width / 2);
    const gapX = 72;
    const gapY = 16;
    const x = growLeft
        ? parent.position.x - gapX - childSize.width
        : parent.position.x + parent.width + gapX;
    if (!siblings.length) {
        return {
            x: x + childSize.width / 2,
            y: parent.position.y + parent.height / 2,
        };
    }
    const sideSiblings = siblings.filter((node) => {
        const mid = node.position.x + node.width / 2;
        const parentMid = parent.position.x + parent.width / 2;
        return growLeft ? mid < parentMid : mid >= parentMid;
    });
    const list = sideSiblings.length ? sideSiblings : siblings;
    const bottom = Math.max(...list.map((node) => node.position.y + node.height));
    return {
        x: x + childSize.width / 2,
        y: bottom + gapY + childSize.height / 2,
    };
}

/** Enter 创建同级：放在当前主题下方，继承相对父题的生长方向 */
export function placeMindSiblingPosition(current: CanvasNodeData, parent: CanvasNodeData | null, siblings: CanvasNodeData[], childSize: { width: number; height: number }): Position {
    if (!parent) {
        return {
            x: current.position.x + current.width / 2,
            y: current.position.y + current.height + 24 + childSize.height / 2,
        };
    }
    const growLeft = current.position.x + current.width / 2 < parent.position.x + parent.width / 2;
    const gapX = 72;
    const gapY = 16;
    const x = growLeft
        ? parent.position.x - gapX - childSize.width
        : parent.position.x + parent.width + gapX;
    const sameSide = siblings.filter((node) => {
        const mid = node.position.x + node.width / 2;
        const parentMid = parent.position.x + parent.width / 2;
        return growLeft ? mid < parentMid : mid >= parentMid;
    });
    const below = sameSide.filter((node) => node.position.y >= current.position.y);
    const anchor = below.length
        ? below.reduce((best, node) => (node.position.y < best.position.y ? node : best))
        : current;
    return {
        x: x + childSize.width / 2,
        y: anchor.position.y + anchor.height + gapY + childSize.height / 2,
    };
}

/** 标注节点：默认放在主题下方；从上方连接点拖出则放上方 */
export function placeAnnotationPosition(
    parent: CanvasNodeData,
    childSize: { width: number; height: number },
    prefer: "above" | "below" = "below",
): Position {
    const gap = 56;
    const x = parent.position.x + parent.width / 2;
    if (prefer === "above") {
        return { x, y: parent.position.y - gap - childSize.height / 2 };
    }
    return { x, y: parent.position.y + parent.height + gap + childSize.height / 2 };
}

/** 方向键：在选中主题对应边外侧放置同级新节点（中心点） */
export function placeMindNeighborPosition(
    current: CanvasNodeData,
    side: ConnectionHandleSide,
    childSize: { width: number; height: number },
): Position {
    const gap = 72;
    const cx = current.position.x + current.width / 2;
    const cy = current.position.y + current.height / 2;
    if (side === "left") return { x: current.position.x - gap - childSize.width / 2, y: cy };
    if (side === "right") return { x: current.position.x + current.width + gap + childSize.width / 2, y: cy };
    if (side === "top") return { x: cx, y: current.position.y - gap - childSize.height / 2 };
    return { x: cx, y: current.position.y + current.height + gap + childSize.height / 2 };
}
