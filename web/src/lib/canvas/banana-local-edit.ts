/** Banana Pro 局部编辑：智能裁剪 / 贴回（对齐 MIKKY BananaSmartCrop / UncropPaste）。 */

import i18n from "@/i18n";

export type LocalEditCropBox = { x: number; y: number; w: number; h: number };

export type LocalEditRatioName = "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9" | "Auto";

export const LOCAL_EDIT_BANANA_MODEL = "runninghub::rhart-image-n-pro/edit";
/** 局部编辑默认分辨率（banana edit 模型默认 1k 偏糊） */
export const LOCAL_EDIT_DEFAULT_RESOLUTION = "2k";

const RATIOS: Record<Exclude<LocalEditRatioName, "Auto">, number> = {
    "1:1": 1,
    "2:3": 2 / 3,
    "3:2": 3 / 2,
    "3:4": 3 / 4,
    "4:3": 4 / 3,
    "4:5": 4 / 5,
    "5:4": 5 / 4,
    "9:16": 9 / 16,
    "16:9": 16 / 9,
    "21:9": 21 / 9,
};

export type SmartCropResult = {
    cropBox: LocalEditCropBox;
    croppedImageDataUrl: string;
    chosenRatio: string;
};

function sniffImageMime(bytes: Uint8Array) {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
    return "";
}

function loadFromUrl(src: string, crossOrigin = false) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        if (crossOrigin) image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
        image.src = src;
    });
}

async function loadImageElement(src: string) {
    if (!src) throw new Error(i18n.t("common.imageReadFailed"));
    const needsCors = /^https?:\/\//i.test(src);
    try {
        return await loadFromUrl(src, needsCors);
    } catch {
        const blob = await (await fetch(src)).blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const mime = (blob.type.split(";")[0] || "").startsWith("image/") ? blob.type.split(";")[0] : sniffImageMime(bytes) || "image/png";
        const typed = blob.type.split(";")[0] === mime ? blob : new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(typed);
        try {
            return await loadFromUrl(url);
        } finally {
            URL.revokeObjectURL(url);
        }
    }
}

function canvasToPngDataUrl(canvas: HTMLCanvasElement) {
    return canvas.toDataURL("image/png");
}

function resolveTargetRatio(forceRatio: LocalEditRatioName, currentRatio: number) {
    if (forceRatio !== "Auto") {
        return { chosenRatioName: forceRatio, targetRatioVal: RATIOS[forceRatio] };
    }
    let chosenRatioName = "1:1";
    let targetRatioVal = 1;
    let closest = Infinity;
    for (const [name, val] of Object.entries(RATIOS)) {
        const diff = Math.abs(val - currentRatio);
        if (diff < closest) {
            closest = diff;
            chosenRatioName = name;
            targetRatioVal = val;
        }
    }
    return { chosenRatioName, targetRatioVal };
}

function expandBoundsToCropBox(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    origW: number,
    origH: number,
    expandFactor: number,
    forceRatio: LocalEditRatioName,
) {
    const boxW = Math.max(1, maxX - minX);
    const boxH = Math.max(1, maxY - minY);
    const padW = Math.floor(boxW * expandFactor);
    const padH = Math.floor(boxH * expandFactor);
    const centerX = Math.floor((minX + maxX) / 2);
    const centerY = Math.floor((minY + maxY) / 2);
    let targetW = boxW + padW * 2;
    let targetH = boxH + padH * 2;

    const { chosenRatioName, targetRatioVal } = resolveTargetRatio(forceRatio, targetW / Math.max(1, targetH));

    if (targetW / Math.max(1, targetH) > targetRatioVal) {
        targetH = targetW / targetRatioVal;
    } else {
        targetW = targetH * targetRatioVal;
    }
    const finalW = Math.floor(targetW);
    const finalH = Math.floor(targetH);

    let x1 = centerX - Math.floor(finalW / 2);
    let y1 = centerY - Math.floor(finalH / 2);
    let x2 = x1 + finalW;
    let y2 = y1 + finalH;

    if (x1 < 0) {
        x2 += Math.abs(x1);
        x1 = 0;
    }
    if (y1 < 0) {
        y2 += Math.abs(y1);
        y1 = 0;
    }
    if (x2 > origW) {
        x1 -= x2 - origW;
        x2 = origW;
    }
    if (y2 > origH) {
        y1 -= y2 - origH;
        y2 = origH;
    }

    x1 = Math.max(0, Math.floor(x1));
    y1 = Math.max(0, Math.floor(y1));
    x2 = Math.min(origW, Math.floor(x2));
    y2 = Math.min(origH, Math.floor(y2));

    let realW = x2 - x1;
    let realH = y2 - y1;
    const actualRatio = realW / Math.max(1, realH);
    if (Math.abs(actualRatio - targetRatioVal) > 0.01) {
        if (actualRatio > targetRatioVal) {
            const newRealW = Math.floor(realH * targetRatioVal);
            const diff = realW - newRealW;
            x1 += Math.floor(diff / 2);
            x2 -= diff - Math.floor(diff / 2);
            realW = x2 - x1;
        } else {
            const newRealH = Math.floor(realW / targetRatioVal);
            const diff = realH - newRealH;
            y1 += Math.floor(diff / 2);
            y2 -= diff - Math.floor(diff / 2);
            realH = y2 - y1;
        }
    }

    return {
        cropBox: { x: x1, y: y1, w: Math.max(1, realW), h: Math.max(1, realH) } satisfies LocalEditCropBox,
        chosenRatio: chosenRatioName,
    };
}

async function cropImageRegion(imageSrc: string, cropBox: LocalEditCropBox, chosenRatio: string): Promise<SmartCropResult> {
    const image = await loadImageElement(imageSrc);
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropBox.w;
    cropCanvas.height = cropBox.h;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) throw new Error("crop canvas unavailable");
    cropCtx.drawImage(image, cropBox.x, cropBox.y, cropBox.w, cropBox.h, 0, 0, cropBox.w, cropBox.h);
    return { cropBox, croppedImageDataUrl: canvasToPngDataUrl(cropCanvas), chosenRatio };
}

/** 按框选区域做 Banana 智能裁剪（扩边 + 强制比例）。selection 为像素坐标。 */
export async function smartCropFromBox(
    imageSrc: string,
    selection: LocalEditCropBox,
    options?: { expandFactor?: number; forceRatio?: LocalEditRatioName },
): Promise<SmartCropResult> {
    const expandFactor = options?.expandFactor ?? 0;
    const forceRatio = options?.forceRatio ?? "1:1";
    const image = await loadImageElement(imageSrc);
    const origW = image.naturalWidth || image.width;
    const origH = image.naturalHeight || image.height;
    const minX = Math.max(0, Math.floor(selection.x));
    const minY = Math.max(0, Math.floor(selection.y));
    const maxX = Math.min(origW - 1, Math.floor(selection.x + selection.w));
    const maxY = Math.min(origH - 1, Math.floor(selection.y + selection.h));
    const { cropBox, chosenRatio } = expandBoundsToCropBox(minX, minY, maxX, maxY, origW, origH, expandFactor, forceRatio);
    return cropImageRegion(imageSrc, cropBox, chosenRatio);
}

/** 将 API 裁剪结果拉伸贴回原图对应区域。 */
export async function uncropPaste(originalSrc: string, processedCropSrc: string, cropBox: LocalEditCropBox, feather = 0): Promise<string> {
    const [original, crop] = await Promise.all([loadImageElement(originalSrc), loadImageElement(processedCropSrc)]);
    const out = document.createElement("canvas");
    out.width = original.naturalWidth || original.width;
    out.height = original.naturalHeight || original.height;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("output canvas unavailable");
    ctx.drawImage(original, 0, 0);

    const { x, y, w, h } = cropBox;
    const resized = document.createElement("canvas");
    resized.width = w;
    resized.height = h;
    const rctx = resized.getContext("2d");
    if (!rctx) throw new Error("resize canvas unavailable");
    rctx.imageSmoothingEnabled = true;
    rctx.imageSmoothingQuality = "high";
    rctx.drawImage(crop, 0, 0, w, h);

    if (feather <= 0) {
        ctx.drawImage(resized, x, y);
        return canvasToPngDataUrl(out);
    }

    const feathered = document.createElement("canvas");
    feathered.width = w;
    feathered.height = h;
    const fctx = feathered.getContext("2d", { willReadFrequently: true });
    if (!fctx) {
        ctx.drawImage(resized, x, y);
        return canvasToPngDataUrl(out);
    }
    fctx.drawImage(resized, 0, 0);
    const img = fctx.getImageData(0, 0, w, h);
    for (let py = 0; py < h; py += 1) {
        for (let px = 0; px < w; px += 1) {
            const dist = Math.min(py, h - 1 - py, px, w - 1 - px);
            const alpha = Math.min(1, dist / feather);
            img.data[(py * w + px) * 4 + 3] = Math.round(alpha * 255);
        }
    }
    fctx.putImageData(img, 0, 0);
    ctx.drawImage(feathered, x, y);
    return canvasToPngDataUrl(out);
}

/** 原图 + 涂抹层合成。 */
export async function compositePaintedImage(originalSrc: string, paintLayerDataUrl: string): Promise<string> {
    const [original, paint] = await Promise.all([loadImageElement(originalSrc), loadImageElement(paintLayerDataUrl)]);
    const canvas = document.createElement("canvas");
    canvas.width = original.naturalWidth || original.width;
    canvas.height = original.naturalHeight || original.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("composite canvas unavailable");
    ctx.drawImage(original, 0, 0);
    ctx.drawImage(paint, 0, 0, canvas.width, canvas.height);
    return canvasToPngDataUrl(canvas);
}
