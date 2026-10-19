import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

/** 选中数据组外框时，展开为组内全部成员（含嵌套组）。 */
export function expandCanvasSelectionIds(selectedIds: string[], nodes: CanvasNodeData[]): string[] {
    if (!selectedIds.length) return selectedIds;
    const expanded = new Set(selectedIds);
    const queue = [...selectedIds];
    while (queue.length) {
        const id = queue.pop()!;
        const group = nodes.find((node) => node.id === id);
        if (!group || group.type !== CanvasNodeType.Group) continue;
        for (const child of nodes) {
            if (child.metadata?.groupId !== id || expanded.has(child.id)) continue;
            expanded.add(child.id);
            if (child.type === CanvasNodeType.Group) queue.push(child.id);
        }
    }
    return [...expanded];
}
