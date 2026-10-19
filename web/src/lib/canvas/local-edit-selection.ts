import type { LocalEditRatioName } from "@/lib/canvas/banana-local-edit";

export type CanvasImageMaskEditPayload = {
    /** 原图 + 画笔合成后的图 */
    paintedDataUrl: string;
    /** 用户框选区域（像素） */
    selection: { x: number; y: number; w: number; h: number };
    /** 归一化框选，供节点叠层 */
    selectionNorm: { x: number; y: number; width: number; height: number };
    /** 框选比例预设，供智能裁剪 force_ratio */
    forceRatio: LocalEditRatioName;
};

export type CropRect = { x: number; y: number; width: number; height: number };
export type ResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";
export const LOCAL_EDIT_RATIO_PRESETS = ["auto", "original", "1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
export type RatioPreset = typeof LOCAL_EDIT_RATIO_PRESETS[number];
export const DEFAULT_LOCAL_EDIT_RATIO: RatioPreset = "1:1";

export function defaultCropForRatio(image: { width: number; height: number } | null, preset: RatioPreset = DEFAULT_LOCAL_EDIT_RATIO): CropRect {
    const base = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
    if (!image) return base;
    const ratio = resolveRatio(preset, image);
    return ratio ? fitCropToRatio(base, ratio, image) : base;
}

export function moveCrop(crop: CropRect, dx: number, dy: number): CropRect {
    return { ...crop, x: clamp(crop.x + dx, 0, 1 - crop.width), y: clamp(crop.y + dy, 0, 1 - crop.height) };
}

export function cropToPixelRect(crop: CropRect, image: { width: number; height: number }, aspectRatio: number | null) {
    let x = Math.round(crop.x * image.width);
    let y = Math.round(crop.y * image.height);
    let width = Math.max(1, Math.round(crop.width * image.width));
    let height = Math.max(1, Math.round(crop.height * image.height));
    if (aspectRatio && aspectRatio > 0) {
        const heightFromWidth = Math.max(1, Math.round(width / aspectRatio));
        const widthFromHeight = Math.max(1, Math.round(height * aspectRatio));
        if (Math.abs(heightFromWidth - height) <= Math.abs(widthFromHeight - width)) height = heightFromWidth;
        else width = widthFromHeight;
        if (x + width > image.width) x = Math.max(0, image.width - width);
        if (y + height > image.height) y = Math.max(0, image.height - height);
        width = Math.min(width, image.width - x);
        height = Math.min(height, image.height - y);
        if (aspectRatio >= 1) height = Math.max(1, Math.round(width / aspectRatio));
        else width = Math.max(1, Math.round(height * aspectRatio));
        if (x + width > image.width) x = Math.max(0, image.width - width);
        if (y + height > image.height) y = Math.max(0, image.height - height);
        width = Math.min(width, image.width - x);
        height = Math.min(height, image.height - y);
    }
    return { x, y, width, height };
}

export function resizeCrop(crop: CropRect, dx: number, dy: number, handle: ResizeHandle, aspectRatio: number | null, box: { width: number; height: number }, minSize = 0.06): CropRect {
    const right0 = crop.x + crop.width;
    const bottom0 = crop.y + crop.height;
    let left = crop.x;
    let top = crop.y;
    let right = right0;
    let bottom = bottom0;

    if (!aspectRatio) {
        if (handle.includes("e")) right = clamp(right0 + dx, left + minSize, 1);
        if (handle.includes("w")) left = clamp(crop.x + dx, 0, right - minSize);
        if (handle.includes("s")) bottom = clamp(bottom0 + dy, top + minSize, 1);
        if (handle.includes("n")) top = clamp(crop.y + dy, 0, bottom - minSize);
        return { x: left, y: top, width: right - left, height: bottom - top };
    }

    // 归一化坐标系下的宽高比，拖拽全程锚定对边/对角，避免中途切换轴向导致比例跳变
    const normalizedRatio = aspectRatio * (box.height / box.width);
    const anchorX = handle.includes("w") ? right0 : handle.includes("e") ? crop.x : crop.x + crop.width / 2;
    const anchorY = handle.includes("n") ? bottom0 : handle.includes("s") ? crop.y : crop.y + crop.height / 2;
    const pointerX = handle.includes("w") ? crop.x + dx : handle.includes("e") ? right0 + dx : anchorX;
    const pointerY = handle.includes("n") ? crop.y + dy : handle.includes("s") ? bottom0 + dy : anchorY;
    const edgeOnly = handle.length === 1;

    let width: number;
    let height: number;
    if (edgeOnly && (handle === "e" || handle === "w")) {
        width = Math.max(minSize, Math.abs(pointerX - anchorX));
        height = width / normalizedRatio;
    } else if (edgeOnly) {
        height = Math.max(minSize, Math.abs(pointerY - anchorY));
        width = height * normalizedRatio;
    } else {
        const rawW = Math.max(minSize, Math.abs(pointerX - anchorX));
        const rawH = Math.max(minSize, Math.abs(pointerY - anchorY));
        // 取能覆盖指针位移的最小等比框，拖拽连续、不跳档
        width = Math.max(rawW, rawH * normalizedRatio);
        height = width / normalizedRatio;
    }

    const maxWidth = handle.includes("w") ? anchorX : handle.includes("e") ? 1 - anchorX : Math.min(anchorX, 1 - anchorX) * 2;
    const maxHeight = handle.includes("n") ? anchorY : handle.includes("s") ? 1 - anchorY : Math.min(anchorY, 1 - anchorY) * 2;
    const scale = Math.min(1, maxWidth / Math.max(width, 1e-6), maxHeight / Math.max(height, 1e-6));
    width *= scale;
    height *= scale;

    if (handle.includes("w")) {
        right = anchorX;
        left = anchorX - width;
    } else if (handle.includes("e")) {
        left = anchorX;
        right = anchorX + width;
    } else {
        left = anchorX - width / 2;
        right = anchorX + width / 2;
    }
    if (handle.includes("n")) {
        bottom = anchorY;
        top = anchorY - height;
    } else if (handle.includes("s")) {
        top = anchorY;
        bottom = anchorY + height;
    } else {
        top = anchorY - height / 2;
        bottom = anchorY + height / 2;
    }

    left = clamp(left, 0, 1 - minSize);
    top = clamp(top, 0, 1 - minSize);
    right = clamp(right, left + minSize, 1);
    bottom = clamp(bottom, top + minSize, 1);
    width = right - left;
    height = bottom - top;
    // 贴边后仍保持比例：以仍可伸展的方向收缩
    if (width / height > normalizedRatio) width = height * normalizedRatio;
    else height = width / normalizedRatio;
    if (handle.includes("w")) left = right - width;
    else if (handle.includes("e")) right = left + width;
    else {
        left = anchorX - width / 2;
        right = left + width;
    }
    if (handle.includes("n")) top = bottom - height;
    else if (handle.includes("s")) bottom = top + height;
    else {
        top = anchorY - height / 2;
        bottom = top + height;
    }
    left = clamp(left, 0, 1 - width);
    top = clamp(top, 0, 1 - height);
    return { x: left, y: top, width, height };
}

export function resolveRatio(preset: string, image: { width: number; height: number } | null) {
    if (preset === "auto" || preset === "free") return null;
    if (preset === "original") return image && image.height > 0 ? image.width / image.height : null;
    const [width, height] = preset.split(":").map(Number);
    return width > 0 && height > 0 ? width / height : null;
}

export function forceRatioFromPreset(preset: string): LocalEditRatioName {
    // auto / 原图：生图比例用 auto；智能裁剪 force_ratio 用 Auto
    if (preset === "auto" || preset === "free" || preset === "original") return "Auto";
    const supported: LocalEditRatioName[] = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
    return supported.includes(preset as LocalEditRatioName) ? (preset as LocalEditRatioName) : "1:1";
}

export function fitCropToRatio(crop: CropRect, ratio: number, image: { width: number; height: number }): CropRect {
    const normalizedRatio = ratio * (image.height / image.width);
    let width = crop.width;
    let height = width / normalizedRatio;
    if (height > crop.height) {
        height = crop.height;
        width = height * normalizedRatio;
    }
    if (width > 1) {
        width = 1;
        height = width / normalizedRatio;
    }
    if (height > 1) {
        height = 1;
        width = height * normalizedRatio;
    }
    return {
        x: clamp(crop.x + (crop.width - width) / 2, 0, 1 - width),
        y: clamp(crop.y + (crop.height - height) / 2, 0, 1 - height),
        width,
        height,
    };
}

export function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export function formatRatio(width: number, height: number) {
    const divisor = gcd(width, height);
    return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

export function gcd(a: number, b: number): number {
    return b ? gcd(b, a % b) : Math.max(1, a);
}

export function createLocalEditPayload(paintedDataUrl: string, crop: CropRect, image: { width: number; height: number }, preset: RatioPreset): CanvasImageMaskEditPayload {
    const pixels = cropToPixelRect(crop, image, resolveRatio(preset, image));
    return {
        paintedDataUrl,
        selection: { x: pixels.x, y: pixels.y, w: pixels.width, h: pixels.height },
        selectionNorm: { x: pixels.x / image.width, y: pixels.y / image.height, width: pixels.width / image.width, height: pixels.height / image.height },
        forceRatio: forceRatioFromPreset(preset),
    };
}
