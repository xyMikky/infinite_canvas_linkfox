import { copyBlobToSystemClipboard } from "@/lib/clipboard";
import { getImageBlob } from "@/services/image-storage";
import { CODEX_IMAGE_NODE_TYPE } from "@/stores/use-codex-image-job-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function resolveImageSource(node: CanvasNodeData) {
    const meta = node.metadata || {};
    let content = String(meta.content || "").trim();
    let storageKey = String(meta.storageKey || "").trim();
    if (!content && !storageKey && Array.isArray(meta.images)) {
        const primary = (meta.primaryImageId ? meta.images.find((item) => item.id === meta.primaryImageId) : null) || meta.images.find((item) => item.content || item.storageKey);
        if (primary) {
            content = String(primary.content || "").trim();
            storageKey = String(primary.storageKey || "").trim();
        }
    }
    return { content, storageKey };
}

export function isCopyableImageNode(node: CanvasNodeData) {
    if (node.type !== CanvasNodeType.Image && node.type !== CODEX_IMAGE_NODE_TYPE) return false;
    const src = resolveImageSource(node);
    return Boolean(src.content || src.storageKey);
}

/** 把图片节点写入系统剪贴板（PNG）；局域网 HTTP 下走 copy 事件回退。 */
export async function copyNodeImageToSystemClipboard(node: CanvasNodeData, clipboardHtml?: string): Promise<boolean> {
    try {
        const src = resolveImageSource(node);
        let blob: Blob | null = null;
        if (src.storageKey) blob = (await getImageBlob(src.storageKey).catch(() => null)) || null;
        if (!blob && src.content) blob = await (await fetch(src.content)).blob();
        if (!blob || !blob.size) return false;
        const png = blob.type === "image/png" ? blob : await convertBlobToPng(blob);
        if (!png) return false;
        return copyBlobToSystemClipboard(png, "image/png", clipboardHtml);
    } catch {
        return false;
    }
}

async function convertBlobToPng(blob: Blob): Promise<Blob | null> {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
