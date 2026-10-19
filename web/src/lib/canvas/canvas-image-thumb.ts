/** 图片加载完成后的淡入时长（毫秒）。 */
export const CANVAS_IMAGE_FADE_MS = 280;

let imagePreviewScale: number | undefined;
let pendingScale = 1;
let scaleTimer: number | undefined;
const scaleListeners = new Set<() => void>();

export const getCanvasImagePreviewScale = () => imagePreviewScale;
export function subscribeCanvasImagePreviewScale(listener: () => void) {
    scaleListeners.add(listener);
    return () => { scaleListeners.delete(listener); };
}

/** 最多每 100ms 通知图片档位，持续缩放也能升级，其他画布组件不参与更新。 */
export function publishCanvasImagePreviewScale(scale: number) {
    pendingScale = scale;
    if (!scaleListeners.size) {
        imagePreviewScale = scale;
        return;
    }
    if (scaleTimer !== undefined || imagePreviewScale === scale) return;
    scaleTimer = window.setTimeout(() => {
        scaleTimer = undefined;
        imagePreviewScale = pendingScale;
        scaleListeners.forEach((listener) => listener());
    }, 100);
}

/** 先画一帧透明，再触发 opacity 过渡（避免缓存图同步 onLoad 看不到淡入）。 */
export function scheduleOpacityFadeIn(onReveal: () => void) {
    requestAnimationFrame(() => {
        requestAnimationFrame(onReveal);
    });
}
