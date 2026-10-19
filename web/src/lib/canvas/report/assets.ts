import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import { loadFolderPreviewSourceBuffer, parseFolderSourceStorageKey } from "@/lib/canvas/folder-preview-cache";
import { reportAssetKey } from "./document";

const mimeTypes: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
    avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon", mp4: "video/mp4", webm: "video/webm",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf",
};
export function reportBlobDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("素材读取失败"));
        reader.readAsDataURL(blob);
    });
}

export async function loadReportAsset(reference: string, sourcePath: string, folderId: string, signal: AbortSignal) {
    const key = reportAssetKey(reference, sourcePath);
    let blob: Blob | null = null;
    if (key.startsWith("image:")) blob = await getImageBlob(key);
    else if (/^(media|audio|video):/.test(key)) blob = await getMediaBlob(key);
    else if (key.startsWith("folder-src:")) {
        const source = parseFolderSourceStorageKey(key);
        if (source) {
            const data = await loadFolderPreviewSourceBuffer(source.folderNodeId, reportAssetKey(`/${source.path}`, ""));
            if (data) blob = new Blob([data]);
        }
    }
    else if (/^(https?:|blob:)/i.test(key)) {
        const response = await fetch(key, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), credentials: "omit", referrerPolicy: "no-referrer" });
        if (!response.ok) throw new Error("素材下载失败");
        if (Number(response.headers.get("content-length")) > 20 * 1024 * 1024) throw new Error("单项素材超过 20 MB");
        blob = await response.blob();
    } else if (folderId && !/^[a-z][\w+.-]*:/i.test(key)) {
        const buffer = await loadFolderPreviewSourceBuffer(folderId, key);
        if (buffer) blob = new Blob([buffer]);
    }
    signal.throwIfAborted();
    if (!blob?.size) throw new Error("找不到素材；请重新导入包含素材的文件夹");
    if (blob.size > 20 * 1024 * 1024) throw new Error("单项素材超过 20 MB");
    const extension = key.split(/[?#]/)[0].split(".").pop()?.toLowerCase() || "";
    const mime = mimeTypes[extension] || blob.type;
    if (!/^(image|audio|video|font)\//.test(mime)) throw new Error("交付包仅嵌入图片、音视频及字体素材");
    return { key, dataUrl: await reportBlobDataUrl(blob.slice(0, blob.size, mime)), bytes: blob.size };
}
