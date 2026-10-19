import RBush from "rbush";

export type CanvasSpatialBounds = {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
};

export type CanvasSpatialItem = CanvasSpatialBounds & { id: string };

/** 视口四周额外预渲染的屏幕像素边距（会按缩放换算到世界坐标）。 */
export const CANVAS_VIEWPORT_RENDER_BUFFER_SCREEN_PX = 720;
/** 相对视口长边的世界坐标边距比例（每侧）。 */
export const CANVAS_VIEWPORT_RENDER_BUFFER_RATIO = 0.4;
/** 世界坐标边距下限，避免高缩放过小。 */
export const CANVAS_VIEWPORT_RENDER_BUFFER_MIN_WORLD = 280;

export function resolveViewportRenderPadding(viewportK: number, width: number, height: number) {
    const k = Math.max(viewportK, 0.05);
    const byScreen = CANVAS_VIEWPORT_RENDER_BUFFER_SCREEN_PX / k;
    const byRatio = (Math.max(width, height) / k) * CANVAS_VIEWPORT_RENDER_BUFFER_RATIO;
    return Math.max(CANVAS_VIEWPORT_RENDER_BUFFER_MIN_WORLD, byScreen, byRatio);
}

export function getViewportBounds(viewport: { x: number; y: number; k: number }, width: number, height: number, padding = CANVAS_VIEWPORT_RENDER_BUFFER_MIN_WORLD): CanvasSpatialBounds {
    const viewLeft = -viewport.x / viewport.k - padding;
    const viewTop = -viewport.y / viewport.k - padding;
    const viewRight = viewLeft + width / viewport.k + padding * 2;
    const viewBottom = viewTop + height / viewport.k + padding * 2;
    return { minX: viewLeft, minY: viewTop, maxX: viewRight, maxY: viewBottom };
}

export function buildCanvasSpatialIndex(items: CanvasSpatialItem[]) {
    const tree = new RBush<CanvasSpatialItem>();
    if (items.length) tree.load(items);
    return tree;
}

export function intersectsBounds(a: CanvasSpatialBounds, b: CanvasSpatialBounds) {
    return a.maxX > b.minX && a.minX < b.maxX && a.maxY > b.minY && a.minY < b.maxY;
}
