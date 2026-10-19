import i18n from "@/i18n";
import type { ReferenceImage } from "@/types/image";

export function formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return "";
    }
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatDuration(ms: number) {
    const value = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(value / 60);
    const seconds = value % 60;
    return minutes ? i18n.t("common.durationMinutes", { minutes, seconds: String(seconds).padStart(2, "0") }) : i18n.t("common.durationSeconds", { seconds });
}

export function getDataUrlByteSize(dataUrl: string) {
    const base64 = dataUrl.split(",", 2)[1];
    if (!base64) {
        return 0;
    }
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function readFileAsDataUrl(file: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
        reader.readAsDataURL(file);
    });
}

export function readImageMeta(dataUrl: string) {
    return new Promise<{ width: number; height: number; mimeType: string }>((resolve) => {
        const image = new Image();
        const done = () => resolve({ width: image.naturalWidth || 1024, height: image.naturalHeight || 1024, mimeType: dataUrl.match(/^data:([^;]+)/)?.[1] || "image/png" });
        image.onload = done;
        image.onerror = done;
        setTimeout(done, 3000);
        image.src = dataUrl;
    });
}

/**
 * 经 Canvas 重编码去掉 EXIF/XMP（含 Camera Raw 设置），避免部分 JPEG 在 Photoshop 中弹出 Camera Raw。
 * GIF/SVG 保持原样；失败时退回原图。
 */
export async function stripImageMetadata(blob: Blob): Promise<Blob> {
    const type = (blob.type || "").toLowerCase();
    if (!type.startsWith("image/")) return blob;
    if (type === "image/gif" || type === "image/svg+xml" || type.includes("icon")) return blob;
    try {
        const bitmap = await createImageBitmap(blob);
        try {
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, bitmap.width);
            canvas.height = Math.max(1, bitmap.height);
            const ctx = canvas.getContext("2d");
            if (!ctx) return blob;
            ctx.drawImage(bitmap, 0, 0);
            const outType = type === "image/jpeg" || type === "image/jpg" ? "image/jpeg" : "image/png";
            const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outType, outType === "image/jpeg" ? 0.92 : undefined));
            return out && out.size > 0 ? out : blob;
        } finally {
            bitmap.close();
        }
    } catch {
        return blob;
    }
}

export function dataUrlToFile(image: ReferenceImage) {
    const [header, content] = image.dataUrl.split(",", 2);
    const mimeType = header.match(/data:(.*?);base64/)?.[1] || image.type || "image/png";
    const binary = atob(content || "");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], image.name || "reference.png", { type: mimeType });
}
