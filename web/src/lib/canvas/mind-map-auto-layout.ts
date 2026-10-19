import {
    isAnnotationNode,
    isMindEmbeddableNode,
    isMindNode,
    mindAnnotationsOf,
    mindChildrenOf,
    mindMapRoots,
    pickMindConnectionSides,
    resolveMindLayoutPeer,
    withSharedDecisionExitSides,
} from "@/lib/canvas/mind-map";
import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";

const GAP_X = 88;
const GAP_Y = 56;
/** 连线中点 label 胶囊预留高度/宽度 */
const LABEL_RESERVE = 44;
const ANNOTATION_GAP = 28;
const ANNOTATION_SIDE_GAP = 24;
const EMPTY_GROUP_HEIGHT = 88;

type Cardinal = "left" | "right" | "top" | "bottom";

/** 按真实尺寸排布：含 mind↔group 流程枢纽，竖链居中，并为连线 label / 标注预留空隙。 */
export function layoutMindMaps(nodes: CanvasNodeData[], connections: CanvasConnection[]): Map<string, Position> {
    const positions = new Map<string, Position>();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const sizes = hubSizeMap(nodes);
    const linked = mindLinkedEmbeddableIds(nodes, connections);

    layoutFlowHubs(nodes, connections, byId, sizes, positions, linked);

    const roots = mindMapRoots(nodes, connections);
    for (const root of roots) {
        if (!positions.has(root.id)) positions.set(root.id, { ...root.position });
        layoutChildrenOf(root.id, nodes, connections, byId, positions);
        placeAnnotationsForTree(root.id, nodes, connections, byId, positions);
    }

    // 组框移动时，组内成员同步平移（否则只动外框）
    for (const group of nodes.filter(isDataGroup)) {
        const next = positions.get(group.id);
        if (!next) continue;
        const dx = next.x - group.position.x;
        const dy = next.y - group.position.y;
        if (dx === 0 && dy === 0) continue;
        for (const member of nodes) {
            if (member.metadata?.groupId !== group.id || member.id === group.id) continue;
            const cur = positions.get(member.id) || member.position;
            positions.set(member.id, { x: cur.x + dx, y: cur.y + dy });
        }
    }

    separateOverlappingPositions(
        nodes,
        sizes,
        positions,
        linked,
        verticalMindSpineIds(
            nodes.map((node) => {
                const pos = positions.get(node.id);
                return pos ? { ...node, position: pos } : node;
            }),
            connections,
        ),
    );
    return positions;
}

/** 已通过 mind 边并入导图的普通画布节点（看板/图片等）：当作流程枢纽参与排版与消重叠 */
function mindLinkedEmbeddableIds(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const ids = new Set<string>();
    for (const conn of connections) {
        if (conn.kind !== "mind") continue;
        for (const id of [conn.fromNodeId, conn.toNodeId]) {
            const node = byId.get(id);
            if (!node || isMindNode(node) || !isMindEmbeddableNode(node)) continue;
            if (node.metadata?.groupId) continue;
            ids.add(id);
        }
    }
    return ids;
}

function isDataGroup(node: CanvasNodeData) {
    if (node.type !== "group") return false;
    if (node.metadata?.groupKind === "data" || node.metadata?.groupBundleText) return true;
    const members = node.metadata?.memberIds;
    return Array.isArray(members) && members.length > 0;
}

/** 流程枢纽：未入组的主题/判断 + 数据组框（组内叶子不单独当枢纽） */
function isFlowHub(node: CanvasNodeData) {
    if (isDataGroup(node)) return true;
    return isMindNode(node) && !isAnnotationNode(node) && !node.metadata?.groupId;
}

function hubSizeMap(nodes: CanvasNodeData[]) {
    const sizes = new Map<string, { width: number; height: number }>();
    for (const node of nodes) {
        if (!isDataGroup(node)) {
            sizes.set(node.id, { width: node.width, height: node.height });
            continue;
        }
        const members = nodes.filter((item) => item.metadata?.groupId === node.id && item.id !== node.id);
        if (members.length) {
            sizes.set(node.id, { width: node.width, height: node.height });
            continue;
        }
        // 无成员的大虚线框（常被误包整段流程）按标题条压缩，避免撑爆间距
        const title = String(node.title || "").trim();
        sizes.set(node.id, {
            width: Math.min(node.width, Math.max(220, title.length * 14 + 48)),
            height: Math.min(node.height, EMPTY_GROUP_HEIGHT),
        });
    }
    return sizes;
}

/**
 * 沿 mind 边（含连到 group 整框）从中心向外铺开枢纽节点。
 * 纯 mind→mind 树仍由后续扇区布局补齐未覆盖的子树。
 */
function layoutFlowHubs(
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    byId: Map<string, CanvasNodeData>,
    sizes: Map<string, { width: number; height: number }>,
    positions: Map<string, Position>,
    linked: Set<string> = new Set(),
) {
    const hubs = nodes.filter((node) => isFlowHub(node) || linked.has(node.id));
    if (hubs.length < 2) return;
    const hubIds = new Set(hubs.map((node) => node.id));
    // 枢纽↔枢纽边；若只连到组内叶子，视为连到组框，把组拉到父旁，避免跨屏长线
    const edges: CanvasConnection[] = [];
    for (const conn of connections) {
        if (conn.kind !== "mind" || !hubIds.has(conn.fromNodeId)) continue;
        if (hubIds.has(conn.toNodeId)) {
            edges.push(conn);
            continue;
        }
        const to = byId.get(conn.toNodeId);
        const groupId = to?.metadata?.groupId ? String(to.metadata.groupId) : "";
        if (groupId && hubIds.has(groupId)) {
            edges.push({ ...conn, toNodeId: groupId });
        }
    }
    if (!edges.length) return;

    const seed =
        hubs.find((node) => node.metadata?.mindRole === "root") ||
        hubs.find((node) => !edges.some((edge) => edge.toNodeId === node.id)) ||
        hubs[0];
    positions.set(seed.id, { ...seed.position });
    const placed = new Set<string>([seed.id]);
    const queue = [seed.id];

    while (queue.length) {
        const id = queue.shift()!;
        const parent = byId.get(id);
        const parentPos = positions.get(id);
        if (!parent || !parentPos) continue;
        const parentSize = sizes.get(id) || { width: parent.width, height: parent.height };
        const parentRect = { x: parentPos.x, y: parentPos.y, width: parentSize.width, height: parentSize.height };

        const pending = new Map<Cardinal, Array<{ node: CanvasNodeData; gap: number }>>();
        const pendingIds = new Set<string>();
        for (const edge of edges) {
            // 只用从当前枢纽指出的有向边铺子节点，避免无向交叉边把布局扯乱
            if (edge.fromNodeId !== id) continue;
            const otherId = edge.toNodeId;
            if (placed.has(otherId) || pendingIds.has(otherId)) continue;
            const other = byId.get(otherId);
            if (!other) continue;
            // 组内叶子不走枢纽布局（由 pack 处理）；避免与组框抢位后再被组平移甩到远处
            if (other.metadata?.groupId) continue;
            const side = resolveHubLayoutSide(parent, other, sizes);
            const axis = side === "left" || side === "right" ? "x" : "y";
            const gap = edgeGap(edge.fromNodeId, edge.toNodeId, connections, axis);
            const list = pending.get(side) || [];
            list.push({ node: other, gap });
            pending.set(side, list);
            pendingIds.add(otherId);
        }

        for (const [side, list] of pending) {
            placeHubSideCluster(parentRect, side, list, sizes, positions);
            for (const item of list) {
                if (placed.has(item.node.id)) continue;
                placed.add(item.node.id);
                queue.push(item.node.id);
            }
        }
    }
}

/** 初始坐标几乎重叠时不要信端口/微位移，否则会六向散开绕成一团 */
const CLUSTER_EPS = 48;

function resolveHubLayoutSide(
    parent: CanvasNodeData,
    other: CanvasNodeData,
    sizes: Map<string, { width: number; height: number }>,
): Cardinal {
    // 用双方原始坐标判断意图，避免父节点已重排后把子题方位判反
    const pSize = sizes.get(parent.id) || { width: parent.width, height: parent.height };
    const size = sizes.get(other.id) || { width: other.width, height: other.height };
    const dx = other.position.x + size.width / 2 - (parent.position.x + pSize.width / 2);
    const dy = other.position.y + size.height / 2 - (parent.position.y + pSize.height / 2);
    if (Math.abs(dx) < CLUSTER_EPS && Math.abs(dy) < CLUSTER_EPS) {
        // 堆在一起：数据组向右，主链枢纽向下，避免抢同一列把线拉得很长
        if (isDataGroup(other)) return "right";
        return "bottom";
    }
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top";
}

function placeHubSideCluster(
    parent: { x: number; y: number; width: number; height: number },
    side: Cardinal,
    items: Array<{ node: CanvasNodeData; gap: number }>,
    sizes: Map<string, { width: number; height: number }>,
    positions: Map<string, Position>,
) {
    if (!items.length) return;
    const parentCx = parent.x + parent.width / 2;
    const parentCy = parent.y + parent.height / 2;
    const gap = Math.max(...items.map((item) => item.gap));

    if (side === "left" || side === "right") {
        const heights = items.map((item) => (sizes.get(item.node.id) || item.node).height);
        const total = heights.reduce((sum, h) => sum + h, 0) + GAP_Y * Math.max(0, items.length - 1);
        let cursor = items.length === 1 ? parentCy - heights[0] / 2 : parentCy - total / 2;
        items.forEach((item, index) => {
            const size = sizes.get(item.node.id) || { width: item.node.width, height: item.node.height };
            const x = side === "right" ? parent.x + parent.width + gap : parent.x - gap - size.width;
            positions.set(item.node.id, { x, y: cursor });
            cursor += heights[index] + GAP_Y;
        });
        return;
    }

    const widths = items.map((item) => (sizes.get(item.node.id) || item.node).width);
    const totalW = widths.reduce((sum, w) => sum + w, 0) + GAP_X * Math.max(0, items.length - 1);
    let cursor = items.length === 1 ? parentCx - widths[0] / 2 : parentCx - totalW / 2;
    items.forEach((item, index) => {
        const size = sizes.get(item.node.id) || { width: item.node.width, height: item.node.height };
        const y = side === "bottom" ? parent.y + parent.height + gap : parent.y - gap - size.height;
        positions.set(item.node.id, { x: cursor, y });
        cursor += widths[index] + GAP_X;
    });
}

function edgeGap(
    parentId: string,
    childId: string,
    connections: CanvasConnection[],
    axis: "x" | "y",
) {
    const base = axis === "y" ? GAP_Y : GAP_X;
    const edge = connections.find(
        (conn) => conn.kind === "mind" && conn.fromNodeId === parentId && conn.toNodeId === childId,
    );
    return base + (String(edge?.label || "").trim() ? LABEL_RESERVE : 0);
}

function layoutChildrenOf(
    parentId: string,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    byId: Map<string, CanvasNodeData>,
    positions: Map<string, Position>,
) {
    const parent = byId.get(parentId);
    if (!parent) return;
    const parentPos = positions.get(parentId) || parent.position;
    const children = mindChildrenOf(parentId, nodes, connections);
    if (!children.length) return;

    // 已被枢纽排过的、以及数据组成员：不在此铺位（成员只随组框平移 + pack，避免先贴父题再被组甩到远处拉长连线）
    const pending = children.filter((child) => !positions.has(child.id) && !child.metadata?.groupId);
    const buckets = new Map<Cardinal, CanvasNodeData[]>();
    pending.forEach((child, index) => {
        const side = classifyCardinal(parent, child, index, pending.length);
        const list = buckets.get(side) || [];
        list.push(child);
        buckets.set(side, list);
    });

    for (const [side, list] of buckets) {
        placeCardinalCluster(parent, parentPos, side, list, connections, positions);
    }

    for (const child of children) {
        layoutChildrenOf(child.id, nodes, connections, byId, positions);
    }
}

/** 明显方位跟几何；几乎重叠时主链向下、少量分支向右，禁止六向轮转散开 */
function classifyCardinal(parent: CanvasNodeData, child: CanvasNodeData, _index: number, total: number): Cardinal {
    const px = parent.position.x + parent.width / 2;
    const py = parent.position.y + parent.height / 2;
    const cx = child.position.x + child.width / 2;
    const cy = child.position.y + child.height / 2;
    const dx = cx - px;
    const dy = cy - py;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx < CLUSTER_EPS && absDy < CLUSTER_EPS) {
        // 多子题默认向下主链；少量向右
        if (total >= 3) return "bottom";
        return "right";
    }

    if (absDx >= absDy) return dx >= 0 ? "right" : "left";
    return dy >= 0 ? "bottom" : "top";
}

function placeCardinalCluster(
    parent: CanvasNodeData,
    parentPos: Position,
    side: Cardinal,
    children: CanvasNodeData[],
    connections: CanvasConnection[],
    positions: Map<string, Position>,
) {
    if (!children.length) return;
    const parentCx = parentPos.x + parent.width / 2;
    const parentCy = parentPos.y + parent.height / 2;
    const sorted = [...children].sort((a, b) => {
        if (side === "left" || side === "right") {
            return a.position.y - b.position.y || a.position.x - b.position.x;
        }
        return a.position.x - b.position.x || a.position.y - b.position.y;
    });

    if (side === "left" || side === "right") {
        const heights = sorted.map((child) => child.height);
        const total = heights.reduce((sum, h) => sum + h, 0) + GAP_Y * Math.max(0, sorted.length - 1);
        let cursor = parentCy - total / 2;
        if (sorted.length === 1) cursor = parentCy - sorted[0].height / 2;

        sorted.forEach((child, index) => {
            const gap = edgeGap(parent.id, child.id, connections, "x");
            const x = side === "right" ? parentPos.x + parent.width + gap : parentPos.x - gap - child.width;
            positions.set(child.id, { x, y: cursor });
            cursor += heights[index] + GAP_Y;
        });
        return;
    }

    // 上/下：竖链相对父题水平居中；多子题时整簇相对父中心居中横排
    if (sorted.length === 1) {
        const child = sorted[0];
        const gap = edgeGap(parent.id, child.id, connections, "y");
        const x = parentCx - child.width / 2;
        const y =
            side === "bottom"
                ? parentPos.y + parent.height + gap
                : parentPos.y - gap - child.height;
        positions.set(child.id, { x, y });
        return;
    }

    const widths = sorted.map((child) => child.width);
    const totalW = widths.reduce((sum, w) => sum + w, 0) + GAP_X * (sorted.length - 1);
    let cursor = parentCx - totalW / 2;
    const gapY = Math.max(...sorted.map((child) => edgeGap(parent.id, child.id, connections, "y")), GAP_Y);
    sorted.forEach((child, index) => {
        const y =
            side === "bottom"
                ? parentPos.y + parent.height + gapY
                : parentPos.y - gapY - child.height;
        positions.set(child.id, { x: cursor, y });
        cursor += widths[index] + GAP_X;
    });
}

/**
 * 全局消重叠：导图主题/判断/标注与数据组框互相推开。
 * 组框移动时成员必须同位移；组内成员互不在此推挤（交给 pack）；
 * 成员与组外冲突时优先只挪组外节点，避免成员被推出虚线框。
 * 竖链主轴与旁侧冲突时只横向挪旁侧，避免主链被挤歪。
 */
function separateOverlappingPositions(
    nodes: CanvasNodeData[],
    sizes: Map<string, { width: number; height: number }>,
    positions: Map<string, Position>,
    linked: Set<string> = new Set(),
    spineIds: Set<string> = new Set(),
) {
    const candidates = nodes.filter((node) => {
        if (isDataGroup(node)) return true;
        if (linked.has(node.id)) return true;
        return isMindNode(node);
    });
    if (candidates.length < 2) return;

    const membersOf = new Map<string, string[]>();
    for (const node of nodes) {
        const gid = node.metadata?.groupId ? String(node.metadata.groupId) : "";
        if (!gid || node.id === gid) continue;
        const list = membersOf.get(gid) || [];
        list.push(node.id);
        membersOf.set(gid, list);
    }

    const nudge = (id: string, dx: number, dy: number) => {
        if (!dx && !dy) return;
        const cur = positions.get(id) || nodes.find((node) => node.id === id)?.position;
        if (!cur) return;
        positions.set(id, { x: cur.x + dx, y: cur.y + dy });
        const members = membersOf.get(id);
        if (!members?.length) return;
        for (const memberId of members) {
            const mp = positions.get(memberId) || nodes.find((node) => node.id === memberId)?.position;
            if (!mp) continue;
            positions.set(memberId, { x: mp.x + dx, y: mp.y + dy });
        }
    };

    const gap = 20;
    for (let pass = 0; pass < 12; pass += 1) {
        let moved = false;
        for (let i = 0; i < candidates.length; i += 1) {
            for (let j = i + 1; j < candidates.length; j += 1) {
                const a = candidates[i];
                const b = candidates[j];
                // 组框与其成员允许重叠（成员本就在框内）
                if (a.type === "group" && b.metadata?.groupId === a.id) continue;
                if (b.type === "group" && a.metadata?.groupId === b.id) continue;
                // 同组成员间距由 pack 负责，这里互推只会把人推出框
                const aGid = a.metadata?.groupId ? String(a.metadata.groupId) : "";
                const bGid = b.metadata?.groupId ? String(b.metadata.groupId) : "";
                if (aGid && aGid === bGid) continue;

                const ap = positions.get(a.id) || a.position;
                const bp = positions.get(b.id) || b.position;
                const as = sizes.get(a.id) || { width: a.width, height: a.height };
                const bs = sizes.get(b.id) || { width: b.width, height: b.height };
                const ar = { x: ap.x, y: ap.y, width: as.width, height: as.height };
                const br = { x: bp.x, y: bp.y, width: bs.width, height: bs.height };
                if (!rectsOverlap(ar, br, gap)) continue;

                const acx = ar.x + ar.width / 2;
                const acy = ar.y + ar.height / 2;
                const bcx = br.x + br.width / 2;
                const bcy = br.y + br.height / 2;
                const overlapX = Math.min(ar.x + ar.width, br.x + br.width) - Math.max(ar.x, br.x);
                const overlapY = Math.min(ar.y + ar.height, br.y + br.height) - Math.max(ar.y, br.y);
                if (overlapX <= 0 || overlapY <= 0) continue;

                const aAnn = isAnnotationNode(a);
                const bAnn = isAnnotationNode(b);
                const aIsMember = Boolean(aGid) && a.type !== "group";
                const bIsMember = Boolean(bGid) && b.type !== "group";
                const aSpine = spineIds.has(a.id);
                const bSpine = spineIds.has(b.id);
                // 竖链对撞优先上下推，避免主轴横向错位
                let pushAlongX = overlapX < overlapY;
                if (aSpine && bSpine) pushAlongX = false;
                const push = (pushAlongX ? overlapX : overlapY) + gap;
                const dir = pushAlongX ? (acx <= bcx ? -1 : 1) : acy <= bcy ? -1 : 1;
                const dx = pushAlongX ? push : 0;
                const dy = pushAlongX ? 0 : push;

                if (aAnn && !bAnn) {
                    nudge(a.id, dir * dx, dir * dy);
                } else if (bAnn && !aAnn) {
                    nudge(b.id, -dir * dx, -dir * dy);
                } else if (aIsMember && !bIsMember) {
                    // 只挪组外，避免成员飞出虚线框
                    nudge(b.id, -dir * dx, -dir * dy);
                } else if (bIsMember && !aIsMember) {
                    nudge(a.id, dir * dx, dir * dy);
                } else if (pushAlongX && aSpine && !bSpine) {
                    nudge(b.id, -dir * dx, 0);
                } else if (pushAlongX && bSpine && !aSpine) {
                    nudge(a.id, dir * dx, 0);
                } else {
                    const half = push / 2;
                    const hdx = pushAlongX ? half : 0;
                    const hdy = pushAlongX ? 0 : half;
                    nudge(a.id, dir * hdx, dir * hdy);
                    nudge(b.id, -dir * hdx, -dir * hdy);
                }
                moved = true;
            }
        }
        if (!moved) break;
    }
}

/** 布局完成后按最终坐标重算 mind 端口，避免旧端口绕线成蛛网 */
export function refreshMindConnectionSides(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasConnection[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const refreshed = connections.map((conn) => {
        if (conn.kind !== "mind") return conn;
        const from = byId.get(conn.fromNodeId);
        const to = byId.get(conn.toNodeId);
        if (!from || !to) return conn;
        const layoutFrom = resolveMindLayoutPeer(from, to, byId);
        const layoutTo = resolveMindLayoutPeer(to, from, byId);
        const sides = pickMindConnectionSides(layoutFrom, layoutTo);
        if (conn.fromSide === sides.startSide && conn.toSide === sides.endSide) return conn;
        return { ...conn, fromSide: sides.startSide, toSide: sides.endSide };
    });
    return withSharedDecisionExitSides(nodes, refreshed);
}

function placeAnnotationsForTree(
    rootId: string,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    byId: Map<string, CanvasNodeData>,
    positions: Map<string, Position>,
) {
    const walk = (nodeId: string) => {
        const topic = byId.get(nodeId);
        if (!topic) return;
        const topicPos = positions.get(nodeId) || topic.position;
        const children = mindChildrenOf(nodeId, nodes, connections);
        const hasDownChild = children.some((child) => {
            const pos = positions.get(child.id) || child.position;
            return pos.y + child.height / 2 > topicPos.y + topic.height / 2;
        });
        const hasLeftChild = children.some((child) => {
            const pos = positions.get(child.id) || child.position;
            return pos.x + child.width / 2 < topicPos.x + topic.width / 2 - 8;
        });
        const annotations = mindAnnotationsOf(nodeId, nodes, connections);
        if (hasDownChild || hasLeftChild) {
            // 有下向/左侧子题时标注放到右侧，避免与竖链、分支、连线 label 抢位
            let y = topicPos.y;
            const x = topicPos.x + topic.width + ANNOTATION_SIDE_GAP;
            for (const annotation of annotations) {
                const next = clearAnnotationSlot(annotation, { x, y }, nodes, positions, nodeId);
                positions.set(annotation.id, next);
                y = next.y + annotation.height + 12;
            }
        } else {
            let y = topicPos.y + topic.height + ANNOTATION_GAP;
            for (const annotation of annotations) {
                const preferred = {
                    x: topicPos.x + topic.width / 2 - annotation.width / 2,
                    y,
                };
                const next = clearAnnotationSlot(annotation, preferred, nodes, positions, nodeId);
                positions.set(annotation.id, next);
                y = next.y + annotation.height + 16;
            }
        }
        for (const child of children) walk(child.id);
    };
    walk(rootId);
}

/** 标注落位时避开已排好的主题/组框/其它标注，优先向下再向右挪 */
function clearAnnotationSlot(
    annotation: CanvasNodeData,
    preferred: Position,
    nodes: CanvasNodeData[],
    positions: Map<string, Position>,
    hostId: string,
): Position {
    let x = preferred.x;
    let y = preferred.y;
    const gap = 16;
    for (let pass = 0; pass < 10; pass += 1) {
        let hit: CanvasNodeData | null = null;
        let hitPos: Position | null = null;
        for (const other of nodes) {
            if (other.id === annotation.id || other.id === hostId) continue;
            if (!isMindNode(other) && !isDataGroup(other)) continue;
            const op = positions.get(other.id);
            if (!op && other.id !== hostId) {
                // 尚未入 positions 的节点用原始坐标，避免漏检
            }
            const pos = op || other.position;
            const ar = { x, y, width: annotation.width, height: annotation.height };
            const br = { x: pos.x, y: pos.y, width: other.width, height: other.height };
            if (!rectsOverlap(ar, br, gap)) continue;
            hit = other;
            hitPos = pos;
            break;
        }
        if (!hit || !hitPos) break;
        const overlapX = Math.min(x + annotation.width, hitPos.x + hit.width) - Math.max(x, hitPos.x);
        const overlapY = Math.min(y + annotation.height, hitPos.y + hit.height) - Math.max(y, hitPos.y);
        if (overlapY > 0 && overlapY <= overlapX + 8) {
            y = hitPos.y + hit.height + gap;
        } else {
            x = hitPos.x + hit.width + gap;
        }
    }
    return { x, y };
}

/** 无成员的数据组（常被误建成整段流程外框）压成标题条，避免虚线框盖住主链 */
export function compactEmptyDataGroups(nodes: CanvasNodeData[]): CanvasNodeData[] {
    return nodes.map((node) => {
        if (!isDataGroup(node)) return node;
        const members = nodes.filter((item) => item.metadata?.groupId === node.id && item.id !== node.id);
        if (members.length) return node;
        const title = String(node.title || "").trim();
        const width = Math.min(node.width, Math.max(220, title.length * 14 + 48));
        const height = Math.min(node.height, EMPTY_GROUP_HEIGHT);
        if (width === node.width && height === node.height) return node;
        return { ...node, width, height };
    });
}

/** 按 group.metadata.memberIds 补全 groupId；禁止按空间坐标误吸（Agent 堆同一点时会把整张图吸进一个虚线框）。 */
export function inferMissingGroupMembership(nodes: CanvasNodeData[]): CanvasNodeData[] {
    const groups = nodes.filter(isDataGroup);
    if (!groups.length) return nodes;
    const ownerOf = new Map<string, string>();
    for (const group of groups) {
        const raw = (group.metadata as { memberIds?: unknown } | undefined)?.memberIds;
        const ids = Array.isArray(raw) ? raw.map((id) => String(id || "").trim()).filter(Boolean) : [];
        for (const id of ids) ownerOf.set(id, group.id);
    }
    if (!ownerOf.size) return nodes;
    return nodes.map((node) => {
        const groupId = ownerOf.get(node.id);
        if (!groupId || node.metadata?.groupId === groupId) return node;
        return { ...node, metadata: { ...node.metadata, groupId } };
    });
}

/** 数据组成员变更/重排后，按子节点包围盒刷新 group 框 */
export function resizeDataGroupFrames(nodes: CanvasNodeData[]): CanvasNodeData[] {
    const groups = nodes.filter(
        (node) => node.type === "group" && (node.metadata?.groupKind === "data" || Boolean(node.metadata?.groupBundleText)),
    );
    if (!groups.length) return nodes;
    let next = nodes;
    for (const group of groups) {
        const members = next.filter((node) => node.metadata?.groupId === group.id && node.id !== group.id);
        if (members.length < 1) continue;
        const pad = 24;
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const member of members) {
            left = Math.min(left, member.position.x);
            top = Math.min(top, member.position.y);
            right = Math.max(right, member.position.x + member.width);
            bottom = Math.max(bottom, member.position.y + member.height);
        }
        if (!Number.isFinite(left)) continue;
        const frame = {
            position: { x: left - pad, y: top - pad },
            width: Math.max(48, right - left + pad * 2),
            height: Math.max(48, bottom - top + pad * 2),
        };
        next = next.map((node) =>
            node.id === group.id ? { ...node, position: frame.position, width: frame.width, height: frame.height } : node,
        );
    }
    return next;
}

const GROUP_MEMBER_GAP = 28;

function rectsOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, gap = 0) {
    return !(
        a.x + a.width + gap <= b.x ||
        b.x + b.width + gap <= a.x ||
        a.y + a.height + gap <= b.y ||
        b.y + b.height + gap <= a.y
    );
}

/** rectsOverlap 只认扁平矩形；节点坐标在 position 上，直接传 CanvasNodeData 会得到 undefined 恒判重叠 */
function nodeRect(node: CanvasNodeData) {
    return { x: node.position.x, y: node.position.y, width: node.width, height: node.height };
}

function membersHaveOverlap(members: CanvasNodeData[], gap = GROUP_MEMBER_GAP) {
    for (let i = 0; i < members.length; i += 1) {
        for (let j = i + 1; j < members.length; j += 1) {
            if (rectsOverlap(nodeRect(members[i]), nodeRect(members[j]), gap)) return true;
        }
    }
    return false;
}

/**
 * 按组外连线主方向排布组内成员，并解开组内重叠：
 * 上/下入线 → 横排；左/右入线 → 竖排；组内 mind 子节点挂在父题旁侧，避免压在父题上。
 */
export function packDataGroupMembers(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData[] {
    const groups = nodes.filter(
        (node) => node.type === "group" && (node.metadata?.groupKind === "data" || Boolean(node.metadata?.groupBundleText)),
    );
    if (!groups.length) return nodes;
    let next = nodes;
    let byId = new Map(next.map((node) => [node.id, node]));

    for (const group of groups) {
        // canvas.tsx 展开块已按预览绝对坐标落盘，禁止再竖/横平铺打乱左右排布
        if (group.metadata?.canvasExploded) continue;
        const members = next.filter((node) => node.metadata?.groupId === group.id && node.id !== group.id);
        if (members.length < 2) continue;

        const approach = dominantGroupApproach(group, members, connections, byId);
        let axis = resolveGroupPackAxis(group, members, approach, connections, byId);
        const needPack = membersHaveOverlap(members) || members.length >= 3 || Boolean(approach);
        if (!needPack) continue;
        if (!axis) {
            const spanX = Math.max(...members.map((m) => m.position.x + m.width)) - Math.min(...members.map((m) => m.position.x));
            const spanY = Math.max(...members.map((m) => m.position.y + m.height)) - Math.min(...members.map((m) => m.position.y));
            axis = spanY >= spanX ? "vertical" : "horizontal";
        }

        const memberIds = new Set(members.map((m) => m.id));
        const childrenOf = new Map<string, CanvasNodeData[]>();
        const hasParent = new Set<string>();
        for (const conn of connections) {
            if (conn.kind !== "mind") continue;
            if (!memberIds.has(conn.fromNodeId) || !memberIds.has(conn.toNodeId)) continue;
            const child = byId.get(conn.toNodeId);
            if (!child) continue;
            const list = childrenOf.get(conn.fromNodeId) || [];
            list.push(child);
            childrenOf.set(conn.fromNodeId, list);
            hasParent.add(conn.toNodeId);
        }
        for (const list of childrenOf.values()) {
            list.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
        }

        const sortMembers = (list: CanvasNodeData[]) =>
            [...list].sort((a, b) =>
                axis === "vertical"
                    ? a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id)
                    : a.position.x - b.position.x || a.position.y - b.position.y || a.id.localeCompare(b.id),
            );

        let roots = sortMembers(members.filter((m) => !hasParent.has(m.id)));
        // 组内成环 / 人人有父时原先直接跳过，叠堆会一直留着 → 退化为整组平铺
        if (!roots.length) {
            roots = sortMembers(members);
            childrenOf.clear();
        }

        const originX = Math.min(...members.map((m) => m.position.x));
        const originY = Math.min(...members.map((m) => m.position.y));
        const positions = new Map<string, Position>();

        if (axis === "vertical") {
            let cursorY = originY;
            for (const root of roots) {
                if (positions.has(root.id)) continue;
                const blockH = layoutGroupCluster(root, originX, cursorY, "vertical", childrenOf, positions);
                cursorY += blockH + GROUP_MEMBER_GAP;
            }
        } else {
            let cursorX = originX;
            for (const root of roots) {
                if (positions.has(root.id)) continue;
                const blockW = layoutGroupCluster(root, cursorX, originY, "horizontal", childrenOf, positions);
                cursorX += blockW + GROUP_MEMBER_GAP;
            }
        }

        // 未进树的成员（异常环）补到末尾
        for (const member of sortMembers(members)) {
            if (positions.has(member.id)) continue;
            const placed = members.filter((m) => positions.has(m.id));
            const last = placed.length ? positions.get(placed[placed.length - 1].id)! : null;
            const lastNode = placed.length ? placed[placed.length - 1] : null;
            positions.set(member.id, {
                x: last && axis === "horizontal" ? last.x + (lastNode?.width || 0) + GROUP_MEMBER_GAP : last ? last.x : originX,
                y: last && axis === "vertical" ? last.y + (lastNode?.height || 0) + GROUP_MEMBER_GAP : last ? last.y : originY,
            });
        }

        // 仍重叠则强制按主轴再平铺一遍（忽略树边），保证组内可读
        const packedMembers = members.map((m) => ({ ...m, position: positions.get(m.id) || m.position }));
        if (membersHaveOverlap(packedMembers)) {
            if (axis === "vertical") {
                let cursorY = originY;
                for (const member of sortMembers(members)) {
                    positions.set(member.id, { x: originX, y: cursorY });
                    cursorY += member.height + GROUP_MEMBER_GAP;
                }
            } else {
                let cursorX = originX;
                for (const member of sortMembers(members)) {
                    positions.set(member.id, { x: cursorX, y: originY });
                    cursorX += member.width + GROUP_MEMBER_GAP;
                }
            }
        }

        next = next.map((node) => {
            const pos = positions.get(node.id);
            return pos ? { ...node, position: pos } : node;
        });
        byId = new Map(next.map((node) => [node.id, node]));
    }

    return next;
}

/** 主轴排根节点；组内子题挂在父旁侧（竖排→右侧，横排→下方），避免叠在父题上；已排过的节点不再递归（防组内成环栈溢出） */
function layoutGroupCluster(
    node: CanvasNodeData,
    x: number,
    y: number,
    axis: "horizontal" | "vertical",
    childrenOf: Map<string, CanvasNodeData[]>,
    positions: Map<string, Position>,
): number {
    if (positions.has(node.id)) return axis === "vertical" ? node.height : node.width;
    positions.set(node.id, { x, y });
    const kids = (childrenOf.get(node.id) || []).filter((kid) => !positions.has(kid.id));
    if (!kids.length) return axis === "vertical" ? node.height : node.width;

    if (axis === "vertical") {
        let childY = y;
        let maxBottom = y + node.height;
        let maxRight = x + node.width;
        for (const kid of kids) {
            if (positions.has(kid.id)) continue;
            const kidX = x + node.width + GROUP_MEMBER_GAP;
            const blockH = layoutGroupCluster(kid, kidX, childY, axis, childrenOf, positions);
            childY += blockH + GROUP_MEMBER_GAP;
            maxBottom = Math.max(maxBottom, childY - GROUP_MEMBER_GAP);
            maxRight = Math.max(maxRight, kidX + kid.width);
        }
        return Math.max(node.height, maxBottom - y);
    }

    let childX = x;
    let maxRight = x + node.width;
    let maxBottom = y + node.height;
    for (const kid of kids) {
        if (positions.has(kid.id)) continue;
        const kidY = y + node.height + GROUP_MEMBER_GAP;
        const blockW = layoutGroupCluster(kid, childX, kidY, axis, childrenOf, positions);
        childX += blockW + GROUP_MEMBER_GAP;
        maxRight = Math.max(maxRight, childX - GROUP_MEMBER_GAP);
        maxBottom = Math.max(maxBottom, kidY + kid.height);
    }
    return Math.max(node.width, maxRight - x);
}

function dominantGroupApproach(
    group: CanvasNodeData,
    members: CanvasNodeData[],
    connections: CanvasConnection[],
    byId: Map<string, CanvasNodeData>,
): Cardinal | null {
    const inside = new Set(members.map((m) => m.id));
    inside.add(group.id);
    const scores: Record<Cardinal, number> = { top: 0, bottom: 0, left: 0, right: 0 };
    const gcx = group.position.x + group.width / 2;
    const gcy = group.position.y + group.height / 2;

    for (const conn of connections) {
        const fromIn = inside.has(conn.fromNodeId);
        const toIn = inside.has(conn.toNodeId);
        if (fromIn === toIn) continue;
        const external = byId.get(fromIn ? conn.toNodeId : conn.fromNodeId);
        if (!external) continue;
        const ecx = external.position.x + external.width / 2;
        const ecy = external.position.y + external.height / 2;
        const dx = gcx - ecx;
        const dy = gcy - ecy;
        if (Math.abs(dx) >= Math.abs(dy)) {
            scores[dx >= 0 ? "left" : "right"] += 1;
        } else {
            scores[dy >= 0 ? "top" : "bottom"] += 1;
        }
    }

    let best: Cardinal | null = null;
    let bestScore = 0;
    (Object.keys(scores) as Cardinal[]).forEach((key) => {
        if (scores[key] > bestScore) {
            bestScore = scores[key];
            best = key;
        }
    });
    return bestScore > 0 ? best : null;
}

function resolveGroupPackAxis(
    group: CanvasNodeData,
    members: CanvasNodeData[],
    approach: Cardinal | null,
    connections: CanvasConnection[],
    byId: Map<string, CanvasNodeData>,
): "horizontal" | "vertical" | null {
    if (approach === "top" || approach === "bottom") return "horizontal";
    if (approach === "left" || approach === "right") return "vertical";

    let parentsAbove = 0;
    for (const member of members) {
        const parentEdge = connections.find((conn) => conn.kind === "mind" && conn.toNodeId === member.id);
        const parent = parentEdge ? byId.get(parentEdge.fromNodeId) : null;
        if (!parent || parent.id === group.id) continue;
        if (parent.position.y + parent.height / 2 < member.position.y + member.height / 2) parentsAbove += 1;
    }
    const minX = Math.min(...members.map((m) => m.position.x));
    const maxX = Math.max(...members.map((m) => m.position.x + m.width));
    const minY = Math.min(...members.map((m) => m.position.y));
    const maxY = Math.max(...members.map((m) => m.position.y + m.height));
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    if (parentsAbove >= Math.ceil(members.length / 2) && spanY > spanX * 1.25) return "horizontal";
    return null;
}

/** 组框与组外节点重叠时，把组外枢纽沿穿透较小轴推开；其它数据组成员不单独推，改推其整组。 */
export function separateGroupExternalOverlaps(nodes: CanvasNodeData[]): CanvasNodeData[] {
    const groups = nodes.filter(
        (node) => node.type === "group" && (node.metadata?.groupKind === "data" || Boolean(node.metadata?.groupBundleText)),
    );
    if (!groups.length) return nodes;
    let next = nodes.map((node) => ({ ...node, position: { ...node.position } }));

    const membersByGroup = new Map<string, string[]>();
    for (const node of next) {
        const gid = node.metadata?.groupId ? String(node.metadata.groupId) : "";
        if (!gid || node.id === gid) continue;
        const list = membersByGroup.get(gid) || [];
        list.push(node.id);
        membersByGroup.set(gid, list);
    }

    const shiftNode = (id: string, dx: number, dy: number) => {
        if (!dx && !dy) return;
        const index = next.findIndex((node) => node.id === id);
        if (index < 0) return;
        const node = next[index];
        next[index] = { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } };
    };

    const shiftGroupBundle = (groupId: string, dx: number, dy: number) => {
        shiftNode(groupId, dx, dy);
        for (const memberId of membersByGroup.get(groupId) || []) shiftNode(memberId, dx, dy);
    };

    for (const group of groups) {
        const memberIds = new Set(membersByGroup.get(group.id) || []);
        memberIds.add(group.id);
        const frame = next.find((node) => node.id === group.id);
        if (!frame) continue;
        const pad = 16;
        const box = {
            x: frame.position.x - pad,
            y: frame.position.y - pad,
            width: frame.width + pad * 2,
            height: frame.height + pad * 2,
        };

        for (let i = 0; i < next.length; i += 1) {
            const node = next[i];
            if (memberIds.has(node.id)) continue;
            // 其它组的叶子不单独推挤（否则 pack 结果会被打散叠成一团）
            const otherGid = node.metadata?.groupId ? String(node.metadata.groupId) : "";
            if (otherGid && otherGid !== group.id) continue;
            if (!rectsOverlap(box, nodeRect(node), 0)) continue;

            const nx1 = node.position.x;
            const ny1 = node.position.y;
            const nx2 = nx1 + node.width;
            const ny2 = ny1 + node.height;
            const bx1 = box.x;
            const by1 = box.y;
            const bx2 = bx1 + box.width;
            const by2 = by1 + box.height;
            const overlapLeft = nx2 - bx1;
            const overlapRight = bx2 - nx1;
            const overlapTop = ny2 - by1;
            const overlapBottom = by2 - ny1;
            const pushX = overlapLeft < overlapRight ? -overlapLeft - 8 : overlapRight + 8;
            const pushY = overlapTop < overlapBottom ? -overlapTop - 8 : overlapBottom + 8;
            const dx = Math.abs(pushX) <= Math.abs(pushY) ? pushX : 0;
            const dy = Math.abs(pushX) <= Math.abs(pushY) ? 0 : pushY;

            if (node.type === "group" && (node.metadata?.groupKind === "data" || node.metadata?.groupBundleText)) {
                shiftGroupBundle(node.id, dx, dy);
            } else {
                shiftNode(node.id, dx, dy);
            }
        }
    }

    return next;
}

/** 本批 ops 是否触及导图结构（需自动重排） */
export function mindOpsNeedLayout(
    ops: Array<{ type?: string; nodeType?: string; metadata?: Record<string, unknown>; patch?: Record<string, unknown> }>,
) {
    return ops.some((op) => {
        if (!op?.type) return false;
        if (op.type === "connect_nodes") return true;
        if (op.type === "add_node" && (op.nodeType === "mind-node" || op.nodeType === "group")) return true;
        if (op.type === "update_node") {
            const meta = { ...(op.patch?.metadata as object | undefined), ...(op.metadata || {}) } as Record<string, unknown>;
            if (meta.content !== undefined || meta.groupId !== undefined || meta.memberIds !== undefined) return true;
            if (meta.mindShape !== undefined || meta.fontSize !== undefined || meta.mindKind !== undefined) return true;
        }
        return false;
    });
}

export function applyMindLayoutPositions(nodes: CanvasNodeData[], positions: Map<string, Position>): CanvasNodeData[] {
    if (!positions.size) return nodes;
    return nodes.map((node) => {
        const next = positions.get(node.id);
        return next ? { ...node, position: next } : node;
    });
}

/** pack / 组框调整后再消一轮重叠（含组内成员与并入导图的普通节点） */
export function separateAllMindOverlaps(nodes: CanvasNodeData[], connections: CanvasConnection[] = []): CanvasNodeData[] {
    const positions = new Map(nodes.map((node) => [node.id, { ...node.position }]));
    const linked = connections.length ? mindLinkedEmbeddableIds(nodes, connections) : new Set<string>();
    const spineIds = connections.length ? verticalMindSpineIds(nodes, connections) : new Set<string>();
    separateOverlappingPositions(nodes, hubSizeMap(nodes), positions, linked, spineIds);
    return applyMindLayoutPositions(nodes, positions);
}

/** 几何上「在父下方」：消重叠后略偏仍认作竖链，避免判成旁侧而跳过居中 */
function isGeometricallyBelow(parent: CanvasNodeData, child: CanvasNodeData) {
    const parentCx = parent.position.x + parent.width / 2;
    const parentCy = parent.position.y + parent.height / 2;
    const childCx = child.position.x + child.width / 2;
    const childCy = child.position.y + child.height / 2;
    const dx = childCx - parentCx;
    const dy = childCy - parentCy;
    return dy > 0 && Math.abs(dy) >= Math.abs(dx) * 0.55;
}

/** 竖链主轴节点：消重叠时禁止被旁侧块横向挤歪 */
function verticalMindSpineIds(nodes: CanvasNodeData[], connections: CanvasConnection[]): Set<string> {
    const ids = new Set<string>();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const linked = mindLinkedEmbeddableIds(nodes, connections);
    const hubs = nodes.filter((node) => isFlowHub(node) || linked.has(node.id));
    const hubIds = new Set(hubs.map((node) => node.id));

    const addBelowPair = (parent: CanvasNodeData, child: CanvasNodeData) => {
        if (!isGeometricallyBelow(parent, child)) return;
        ids.add(parent.id);
        ids.add(child.id);
    };

    for (const root of mindMapRoots(nodes, connections)) {
        const queue = [root.id];
        while (queue.length) {
            const id = queue.shift()!;
            const parent = byId.get(id);
            if (!parent) continue;
            const children = mindChildrenOf(id, nodes, connections).filter(
                (child) => !isAnnotationNode(child) && !child.metadata?.groupId,
            );
            for (const child of children) queue.push(child.id);
            const below = children.filter((child) => isGeometricallyBelow(parent, child));
            if (below.length === 1) addBelowPair(parent, below[0]);
        }
    }

    for (const hub of hubs) {
        const targets = new Map<string, CanvasNodeData>();
        for (const conn of connections) {
            if (conn.kind !== "mind" || conn.fromNodeId !== hub.id) continue;
            let toId = conn.toNodeId;
            if (!hubIds.has(toId)) {
                const leaf = byId.get(toId);
                const groupId = leaf?.metadata?.groupId ? String(leaf.metadata.groupId) : "";
                if (groupId && hubIds.has(groupId)) toId = groupId;
                else if (!leaf || !isMindNode(leaf) || leaf.metadata?.groupId) continue;
            }
            const child = byId.get(toId);
            if (!child || child.id === hub.id) continue;
            targets.set(toId, child);
        }
        const below = [...targets.values()].filter((child) => isGeometricallyBelow(hub, child));
        const belowFree = below.filter((child) => isMindNode(child) && !isDataGroup(child) && !child.metadata?.groupId);
        const target = belowFree.length === 1 ? belowFree[0] : below.length === 1 && isDataGroup(below[0]) ? below[0] : null;
        if (target) addBelowPair(hub, target);
    }
    return ids;
}

/**
 * 消重叠后把「唯一下方子题」的主链重新水平居中，避免竖线歪、端口判成左右绕圈。
 * 旁侧分支不计入「多向下方」；多子题横排簇不改。
 */
export function recenterVerticalMindSpines(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData[] {
    const next = new Map(nodes.map((node) => [node.id, { ...node, position: { ...node.position } }]));
    const roots = mindMapRoots(nodes, connections);
    for (const root of roots) {
        const queue = [root.id];
        while (queue.length) {
            const id = queue.shift()!;
            const parent = next.get(id);
            if (!parent) continue;
            const children = mindChildrenOf(id, nodes, connections).filter(
                (child) => !isAnnotationNode(child) && !child.metadata?.groupId,
            );
            for (const child of children) queue.push(child.id);
            // 有左右分支时仍居中唯一的下方子题（旧逻辑 children.length!==1 会跳过整条竖链）
            const below = children
                .map((child) => next.get(child.id))
                .filter((child): child is CanvasNodeData => Boolean(child))
                .filter((child) => isGeometricallyBelow(parent, child));
            if (below.length !== 1) continue;
            const child = below[0];
            const parentCx = parent.position.x + parent.width / 2;
            child.position = { x: parentCx - child.width / 2, y: child.position.y };
        }
    }

    // 流程枢纽：父→下方子枢纽居中；旁侧数据组不阻塞竖链居中；并入导图的普通节点也算枢纽
    const linked = mindLinkedEmbeddableIds(nodes, connections);
    const hubs = nodes.filter((node) => isFlowHub(node) || linked.has(node.id));
    const hubIds = new Set(hubs.map((node) => node.id));
    for (const hub of hubs) {
        const parent = next.get(hub.id);
        if (!parent) continue;
        const targets = new Map<string, CanvasNodeData>();
        for (const conn of connections) {
            if (conn.kind !== "mind" || conn.fromNodeId !== hub.id) continue;
            let toId = conn.toNodeId;
            if (!hubIds.has(toId)) {
                const leaf = next.get(toId);
                const groupId = leaf?.metadata?.groupId ? String(leaf.metadata.groupId) : "";
                if (groupId && hubIds.has(groupId)) toId = groupId;
                else if (!leaf || !isMindNode(leaf) || leaf.metadata?.groupId) continue;
            }
            const child = next.get(toId);
            if (!child || child.id === hub.id) continue;
            targets.set(toId, child);
        }
        const parentCx = parent.position.x + parent.width / 2;
        const below = [...targets.values()].filter((child) => isGeometricallyBelow(parent, child));
        // 旁侧组不计入「多向下方」：只居中唯一的下方自由主题（或唯一下方组）
        const belowFree = below.filter((child) => isMindNode(child) && !isDataGroup(child) && !child.metadata?.groupId);
        const recenterTarget =
            belowFree.length === 1 ? belowFree[0] : below.length === 1 && isDataGroup(below[0]) ? below[0] : null;
        if (!recenterTarget) continue;
        const child = recenterTarget;
        const prevX = child.position.x;
        const nextX = parentCx - child.width / 2;
        if (Math.abs(nextX - prevX) < 0.5) continue;
        child.position = { x: nextX, y: child.position.y };
        if (isDataGroup(child)) {
            const dx = nextX - prevX;
            for (const member of nodes) {
                if (member.metadata?.groupId !== child.id || member.id === child.id) continue;
                const cur = next.get(member.id);
                if (!cur) continue;
                cur.position = { x: cur.position.x + dx, y: cur.position.y };
            }
        }
    }

    return nodes.map((node) => next.get(node.id) || node);
}
