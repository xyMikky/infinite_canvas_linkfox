import { getNodeDefinition } from "@/lib/canvas/node-registry";
import type { CanvasNodeData } from "@/types/canvas";

/** 只保留已访问的重预览；屏幕外进入 Activity 休眠，避免整份报告提前挂载。 */
export function resolveCanvasNodeVisibility(nodes: CanvasNodeData[], options: {
    visibleIds: ReadonlySet<string>;
    contentIds: ReadonlySet<string>;
    selectedIds: ReadonlySet<string>;
    hiddenIds: ReadonlySet<string>;
    retainedIds: ReadonlySet<string>;
    panelId: string | null;
}) {
    const renderNodes: CanvasNodeData[] = [];
    const activeIds = new Set<string>();
    const retainedIds = new Set<string>();
    for (const node of nodes) {
        if (options.hiddenIds.has(node.id)) continue;
        const active = options.visibleIds.has(node.id) || options.selectedIds.has(node.id) || options.panelId === node.id;
        const visited = options.contentIds.has(node.id) || options.selectedIds.has(node.id) || options.panelId === node.id;
        const retained = (visited || options.retainedIds.has(node.id)) && Boolean(getNodeDefinition(node.type)?.keepContentMounted?.(node));
        if (active) activeIds.add(node.id);
        if (retained) retainedIds.add(node.id);
        if (active || retained) renderNodes.push(node);
    }
    return { renderNodes, activeIds, retainedIds };
}
