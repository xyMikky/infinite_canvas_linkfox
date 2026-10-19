import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const MAX_BUNDLE_CHARS = 120_000;

export function collectGroupChildNodes(groupId: string, nodes: CanvasNodeData[]) {
    return nodes.filter((node) => node.type !== CanvasNodeType.Group && node.metadata?.groupId === groupId);
}

export function nodeTextForBundle(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Group) {
        return (node.metadata?.content || node.metadata?.prompt || "").trim();
    }
    return "";
}

export function canBundleNodeAsText(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Group) return false;
    return Boolean(nodeTextForBundle(node));
}

export function buildGroupBundleText(children: CanvasNodeData[]) {
    const parts: string[] = [];
    let total = 0;
    for (const child of children) {
        const body = nodeTextForBundle(child);
        if (!body) continue;
        const title = (child.title || "").trim() || child.id;
        const block = `【${title}】\n${body}`;
        if (total + block.length + (parts.length ? 2 : 0) > MAX_BUNDLE_CHARS) {
            const remain = MAX_BUNDLE_CHARS - total - (parts.length ? 2 : 0);
            if (remain > 32) parts.push(`${block.slice(0, remain)}\n…`);
            break;
        }
        parts.push(block);
        total += block.length + (parts.length > 1 ? 2 : 0);
    }
    return parts.join("\n\n");
}

export function isDataGroup(group: CanvasNodeData, nodes: CanvasNodeData[]) {
    if (group.type !== CanvasNodeType.Group) return false;
    if (group.metadata?.groupKind === "data" || group.metadata?.groupBundleText) {
        return collectGroupChildNodes(group.id, nodes).some(canBundleNodeAsText) || Boolean(group.metadata?.groupBundleText || group.metadata?.content);
    }
    return collectGroupChildNodes(group.id, nodes).some(canBundleNodeAsText);
}

export function resolveGroupBundleText(group: CanvasNodeData, nodes: CanvasNodeData[]) {
    const children = collectGroupChildNodes(group.id, nodes);
    const live = buildGroupBundleText(children);
    if (live) return live;
    return (group.metadata?.groupBundleText || group.metadata?.content || "").trim();
}

/** 为 Agent 快照注入数据组聚合文本（不改动画布 state） */
export function withGroupBundleContent(nodes: CanvasNodeData[]): CanvasNodeData[] {
    return nodes.map((node) => {
        if (node.type !== CanvasNodeType.Group) return node;
        const content = resolveGroupBundleText(node, nodes);
        if (!content) return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                content,
                groupKind: node.metadata?.groupKind || "data",
                groupBundleText: node.metadata?.groupBundleText || content,
            },
        };
    });
}

export function suggestDataGroupTitle(children: CanvasNodeData[], nodes: CanvasNodeData[], fallback: string) {
    const parentIds = children.map((child) => child.metadata?.excelParentId).filter((id): id is string => Boolean(id));
    if (parentIds.length && parentIds.every((id) => id === parentIds[0])) {
        const parent = nodes.find((node) => node.id === parentIds[0]);
        const name = (parent?.title || "").trim();
        if (name) return name.slice(0, 48);
    }
    return fallback;
}
