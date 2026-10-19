export type CanvasNodeContentLod = "shell" | "full";

/** 内容生命周期独立于透明度：缩到 28% 以下才允许释放。 */
export const CANVAS_NODE_LOD_HIDE_SCALE = 0.28;
/** 放大进入淡入区时立即恢复内容。 */
export const CANVAS_NODE_LOD_SHOW_SCALE = 0.32;
export const CANVAS_NODE_LOD_RELEASE_MS = 600;
/** 首次进入画布时的媒体预览分界；往返缩放采用 8% / 12% 滞回。 */
export const CANVAS_NODE_LOD_MEDIA_SCALE = 0.1;

/** 纯壳态结束、开始交叉淡入的缩放。 */
export const CANVAS_NODE_LOD_BLEND_SHELL_END = 0.32;
/** 交叉淡入结束、纯完整内容的缩放。 */
export const CANVAS_NODE_LOD_BLEND_FULL_START = 0.48;

export type CanvasNodeLodVisual = {
    contentLod: CanvasNodeContentLod;
    shellOpacity: number;
    fullOpacity: number;
};

/** 按缩放与上一档计算内容生命周期，临界点往返时保持原挂载状态。 */
export function resolveCanvasNodeLod(scale: number, previous: CanvasNodeContentLod = "full"): CanvasNodeContentLod {
    if (scale < CANVAS_NODE_LOD_HIDE_SCALE) return "shell";
    if (scale > CANVAS_NODE_LOD_SHOW_SCALE) return "full";
    return previous;
}

export function resolveCanvasNodeLodMedia(scale: number, previous = scale >= CANVAS_NODE_LOD_MEDIA_SCALE) {
    if (scale <= 0.08) return false;
    if (scale >= 0.12) return true;
    return previous;
}

/** 渲染用的粗分档：淡入区只分前后半段，真实透明度由 applyCanvasNodeLodOpacity 逐帧写到各层元素。 */
export function resolveCanvasNodeLodPhase(scale: number): CanvasNodeLodVisual {
    const blend = resolveCanvasNodeLodBlend(scale);
    if (blend.shellOpacity === 1 || blend.fullOpacity === 1) return blend;
    return blend.contentLod === "shell" ? { contentLod: "shell", shellOpacity: 0.75, fullOpacity: 0.25 } : { contentLod: "full", shellOpacity: 0.25, fullOpacity: 0.75 };
}

type LodLayerKind = "shell" | "full";
// 不能用画布层上的继承 CSS 变量：每写一次都会让整棵节点树重算样式。只改登记过的淡入层自身的 opacity。
const lodLayers = new Map<HTMLElement, LodLayerKind>();
let liveBlend = resolveCanvasNodeLodBlend(1);

function lodLayerRef(kind: LodLayerKind) {
    return (element: HTMLElement | null) => {
        if (!element) return;
        lodLayers.set(element, kind);
        return () => {
            lodLayers.delete(element);
        };
    };
}

export const canvasNodeShellLayerRef = lodLayerRef("shell");
export const canvasNodeFullLayerRef = lodLayerRef("full");

/** 当前实际缩放下的淡入透明度，节点重渲染时直接使用，避免与逐帧写入的值来回跳。 */
export function canvasNodeLiveLodOpacity(kind: LodLayerKind) {
    return kind === "shell" ? liveBlend.shellOpacity : liveBlend.fullOpacity;
}

/** 缩放时逐帧更新淡入层透明度，不触发 React 渲染；数值未变时不写 DOM。 */
export function applyCanvasNodeLodOpacity(scale: number) {
    const blend = resolveCanvasNodeLodBlend(scale);
    if (blend.shellOpacity === liveBlend.shellOpacity && blend.fullOpacity === liveBlend.fullOpacity) return;
    liveBlend = blend;
    const shell = String(blend.shellOpacity);
    const full = String(blend.fullOpacity);
    lodLayers.forEach((kind, element) => {
        element.style.opacity = kind === "shell" ? shell : full;
    });
}

/** 按缩放计算壳态/完整内容的交叉淡入（无滞回，缩放连续变化）。 */
export function resolveCanvasNodeLodBlend(scale: number): CanvasNodeLodVisual {
    if (scale <= CANVAS_NODE_LOD_BLEND_SHELL_END) {
        return { contentLod: "shell", shellOpacity: 1, fullOpacity: 0 };
    }
    if (scale >= CANVAS_NODE_LOD_BLEND_FULL_START) {
        return { contentLod: "full", shellOpacity: 0, fullOpacity: 1 };
    }
    const t = (scale - CANVAS_NODE_LOD_BLEND_SHELL_END) / (CANVAS_NODE_LOD_BLEND_FULL_START - CANVAS_NODE_LOD_BLEND_SHELL_END);
    return {
        contentLod: t < 0.5 ? "shell" : "full",
        shellOpacity: 1 - t,
        fullOpacity: t,
    };
}
