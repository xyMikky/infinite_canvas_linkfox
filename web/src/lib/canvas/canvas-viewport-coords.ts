import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

/** 在留好工具栏/侧栏边距的屏幕区域内完整显示节点，不把小内容放大超过 100%。 */
export function fitNodesViewport(nodes: Pick<CanvasNodeData, "position" | "width" | "height">[], area: { x: number; y: number; width: number; height: number }): ViewportTransform {
    const centerX = area.x + area.width / 2;
    const centerY = area.y + area.height / 2;
    if (!nodes.length) return { x: centerX, y: centerY, k: 1 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + node.width);
        maxY = Math.max(maxY, node.position.y + node.height);
    }
    const k = Math.min(1, Math.max(1, area.width) / Math.max(1, maxX - minX), Math.max(1, area.height) / Math.max(1, maxY - minY));
    return { x: centerX - (minX + maxX) / 2 * k, y: centerY - (minY + maxY) / 2 * k, k };
}

export function applyViewportToContext(ctx: CanvasRenderingContext2D, viewport: ViewportTransform, dpr: number) {
    ctx.setTransform(dpr * viewport.k, 0, 0, dpr * viewport.k, dpr * viewport.x, dpr * viewport.y);
}

export function clientToWorld(clientX: number, clientY: number, rect: DOMRect, viewport: ViewportTransform) {
    return {
        x: (clientX - rect.left - viewport.x) / viewport.k,
        y: (clientY - rect.top - viewport.y) / viewport.k,
    };
}
