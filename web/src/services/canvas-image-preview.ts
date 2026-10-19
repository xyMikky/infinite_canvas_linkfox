import { readThumbnail } from "@/services/asset-thumbnail";
import { getImageBlob, resolveImageSourceUrl, resolveImageUrl } from "@/services/image-storage";

/** 0 表示原图；组件只订阅分辨率档位变化。 */
export function canvasImagePreviewEdge(width: number, height: number, scale: number, naturalWidth: number, naturalHeight: number, contain: boolean) {
    const naturalEdge = Math.max(naturalWidth, naturalHeight);
    const fittedEdge = naturalWidth > 0 && naturalHeight > 0
        ? naturalEdge * (contain ? Math.min : Math.max)(width / naturalWidth, height / naturalHeight)
        : Math.max(width, height);
    const pixels = fittedEdge * scale * (window.devicePixelRatio || 1);
    const edge = [480, 960, 1920].find((size) => size >= pixels) || 0;
    return naturalEdge > 0 && edge >= naturalEdge ? 0 : edge;
}

export function readCanvasImageThumbnail(storageKey: string, src: string, edge: number, signal: AbortSignal, naturalWidth = 0, naturalHeight = 0, background = false) {
    return readThumbnail(`canvas-v1:${edge}:${storageKey}`, async () => {
        const original = await getImageBlob(storageKey);
        if (original?.size) return original;
        signal.throwIfAborted();
        const fallback = await resolveImageUrl(storageKey, src);
        if (!fallback) throw new Error("图片原件无法读取");
        const response = await fetch(fallback, { signal });
        if (!response.ok) throw new Error("图片原件无法读取");
        return response.blob();
    }, signal, { maxEdge: edge, diskCache: true, naturalWidth, naturalHeight, background });
}

export async function loadCanvasImagePreview(storageKey: string | undefined, src: string, edge: number, signal: AbortSignal, naturalWidth = 0, naturalHeight = 0) {
    signal.throwIfAborted();
    let owned = false;
    let url = "";
    if (edge && storageKey) {
        const blob = await readCanvasImageThumbnail(storageKey, src, edge, signal, naturalWidth, naturalHeight);
        signal.throwIfAborted();
        url = URL.createObjectURL(blob);
        owned = true;
    } else {
        url = await resolveImageSourceUrl(storageKey, src);
    }
    try {
        signal.throwIfAborted();
        if (!url) throw new Error("图片原件无法读取");
        const image = new Image();
        image.decoding = "async";
        image.src = url;
        await image.decode();
        signal.throwIfAborted();
        return { url, owned };
    } catch (error) {
        if (owned) URL.revokeObjectURL(url);
        throw error;
    }
}
