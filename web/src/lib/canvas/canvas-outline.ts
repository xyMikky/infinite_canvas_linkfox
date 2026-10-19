import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

/** 仅生成侧栏层级，不改变画布分组、连线或节点位置。 */
export function buildCanvasOutline(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const groupById = new Map<string, string>();
    for (const node of nodes) {
        const groupId = node.metadata?.groupId;
        if (groupId && groupId !== node.id && byId.get(groupId)?.type === CanvasNodeType.Group) groupById.set(node.id, groupId);
    }
    for (const group of nodes) {
        if (group.type !== CanvasNodeType.Group || !Array.isArray(group.metadata?.memberIds)) continue;
        for (const id of group.metadata.memberIds) {
            if (id !== group.id && byId.has(id) && !groupById.has(id)) groupById.set(id, group.id);
        }
    }
    const parentById = new Map(groupById);
    for (const connection of connections) {
        if (connection.kind !== "mind" && connection.kind !== "annotation") continue;
        let from = connection.fromNodeId;
        let to = connection.toNodeId;
        if (!byId.has(from) || !byId.has(to)) continue;
        // 跨组关系挂到整组；同组导图继续按父子主题展开。
        const fromGroup = groupById.get(from);
        const toGroup = groupById.get(to);
        if (fromGroup !== toGroup) {
            from = fromGroup || from;
            to = toGroup || to;
        }
        if (groupById.has(to) && groupById.get(to) !== groupById.get(from)) continue;
        if (from !== to && (!parentById.has(to) || parentById.get(to) === groupById.get(to))) parentById.set(to, from);
    }
    // 导图允许回连、多父节点；侧栏每个节点只出现一次，环中的一个节点作为根。
    const done = new Set<string>();
    for (const node of nodes) {
        const path = new Set<string>();
        let id: string | undefined = node.id;
        while (id && !done.has(id)) {
            if (path.has(id)) {
                parentById.delete(id);
                break;
            }
            path.add(id);
            id = parentById.get(id);
        }
        for (const visited of path) done.add(visited);
    }
    const roots: CanvasNodeData[] = [];
    const childrenById = new Map<string, CanvasNodeData[]>();
    for (const node of nodes) {
        const parentId = parentById.get(node.id);
        if (!parentId) roots.push(node);
        else {
            const siblings = childrenById.get(parentId) || [];
            siblings.push(node);
            childrenById.set(parentId, siblings);
        }
    }
    const order = (a: CanvasNodeData, b: CanvasNodeData) => a.position.y - b.position.y || a.position.x - b.position.x;
    roots.sort(order);
    for (const children of childrenById.values()) children.sort(order);
    return { roots, childrenById, parentById };
}
