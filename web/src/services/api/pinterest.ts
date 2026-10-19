/** Pinterest 以图找图：与 Eagle 插件同源的扩展接口，经本地 /api/pinterest 代理避开 CORS */
const PINTEREST_PROXY_BASE = "/api/pinterest";
/** i.pinimg.com 无 CORS 头，缩略图展示与结果下载统一走本地代理 */
const PINIMG_PROXY_BASE = "/api/pinimg";

export type PinterestPin = {
    id: string;
    title: string;
    description: string;
    mediumUrl: string;
    largeUrl: string;
    width: number;
    height: number;
};

export function pinterestPinPageUrl(pin: PinterestPin) {
    return `https://www.pinterest.com/pin/${pin.id}/`;
}

function toPinimgProxyUrl(url: string) {
    return url.replace(/^https?:\/\/i\.pinimg\.com/i, PINIMG_PROXY_BASE);
}

type RawPin = {
    id?: string | number;
    title?: string;
    description?: string;
    image_medium_url?: string;
    image_large_url?: string;
    image_medium_size_pixels?: { width?: number; height?: number };
};

/** 整图搜索（区域取全图），返回视觉相似的 Pin 列表；传入上一页的 bookmark 可翻页。page_size / bookmark 位置与 Eagle 插件一致 */
export async function pinterestVisualSearch(image: Blob, pageSize = 60, bookmark = ""): Promise<{ pins: PinterestPin[]; bookmark: string }> {
    const formData = new FormData();
    formData.append("image", image);
    formData.append("x", "0");
    formData.append("y", "0");
    formData.append("w", "1");
    formData.append("h", "1");
    formData.append("page_size", String(pageSize));
    const query = bookmark ? `?bookmark=${encodeURIComponent(bookmark)}` : "";
    const res = await fetch(`${PINTEREST_PROXY_BASE}/v3/visual_search/extension/image/${query}`, {
        method: "PUT",
        body: formData,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = (await res.json()) as { status?: string; message?: string; data?: RawPin[]; bookmark?: string };
    if (result.status !== "success" || !Array.isArray(result.data)) throw new Error(result.message || "response error");
    const pins = result.data
        .filter((item) => item?.image_medium_url && item.id != null && String(item.id))
        .map((item) => ({
            id: String(item.id),
            title: String(item.title || "").trim(),
            description: String(item.description || "").trim(),
            mediumUrl: toPinimgProxyUrl(String(item.image_medium_url)),
            largeUrl: toPinimgProxyUrl(String(item.image_large_url || item.image_medium_url)),
            width: item.image_medium_size_pixels?.width || 0,
            height: item.image_medium_size_pixels?.height || 0,
        }));
    // "-end-" 是 Pinterest 的结束标记
    const next = typeof result.bookmark === "string" && result.bookmark !== "-end-" ? result.bookmark : "";
    return { pins, bookmark: next };
}

/** 下载结果图：优先原图（originals），失败退回大图 */
export async function fetchPinterestPinImage(pin: PinterestPin): Promise<Blob> {
    const originals = pin.largeUrl.replace(/\/\d+x(\d+)?\//g, "/originals/");
    const candidates = originals !== pin.largeUrl
        ? [originals, originals.replace(/\.jpg(\?|$)/i, ".png$1"), originals.replace(/\.png(\?|$)/i, ".jpg$1"), pin.largeUrl]
        : [pin.largeUrl];
    for (const url of candidates) {
        try {
            const res = await fetch(url);
            if (res.ok) return await res.blob();
        } catch {
            // try next
        }
    }
    throw new Error("download failed");
}

/** Pinterest 接口对大图/PNG 兼容差：统一压成 ≤maxEdge 边长的 JPEG 再上传 */
export async function blobToSearchJpeg(blob: Blob, maxEdge = 1280): Promise<Blob> {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!jpeg) throw new Error("convert failed");
    return jpeg;
}
