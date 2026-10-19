import { getImageBlob, resolveImageUrl } from "@/services/image-storage";
import type { PhotopeaLayerImage } from "@/stores/canvas/use-photopea-layer-store";
import type { CanvasNodeData } from "@/types/canvas";

/** 与图片节点显示规则一致，优先使用批次中当前主图。 */
export function photopeaNodeImageSource(node: CanvasNodeData): PhotopeaLayerImage {
    const meta = node.metadata;
    const images = meta?.images || [];
    const primary = images.find((image) => image.id === (meta?.primaryImageId || images[0]?.id));
    return { url: primary?.content || meta?.content || "", storageKey: primary?.storageKey || meta?.storageKey, title: node.title };
}

export async function readPhotopeaImageBlob(image: PhotopeaLayerImage): Promise<Blob> {
    // 开发端磁盘响应是 application/octet-stream；图片类型标签缺失不代表文件不可读取。
    const stored = image.storageKey ? await getImageBlob(image.storageKey) : null;
    if (stored?.size) return stored;
    const url = await resolveImageUrl(image.storageKey, image.url);
    if (!url) throw new Error("photopea-image-read");
    const response = await fetch(url);
    if (!response.ok) throw new Error("photopea-image-read");
    const blob = await response.blob();
    if (!blob.size) throw new Error("photopea-image-read");
    return blob;
}
