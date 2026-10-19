/** 画布本地图像模糊（原尺寸处理，非零结果导出为 PNG data URL）。 */

export type ImageBlurMethod = "gaussian" | "box" | "motionH" | "motionV" | "radial";

export type ImageBlurOptions = {
    method: ImageBlurMethod;
    /** 模糊强度：高斯/盒状为半径像素；运动为拖尾长度；径向为采样强度。 */
    amount: number;
};

export type BlurPreviewSource = {
    canvas: HTMLCanvasElement;
    width: number;
    height: number;
    /** 相对原图像素的缩放，用于把强度换算到预览尺寸 */
    scale: number;
};

export const IMAGE_BLUR_AMOUNT = { min: 0, max: 20, step: 0.01, default: 5 };

export function clampBlurAmount(amount: number) {
    return Math.round(Math.max(IMAGE_BLUR_AMOUNT.min, Math.min(IMAGE_BLUR_AMOUNT.max, amount)) * 100) / 100;
}

export async function blurImageDataUrl(dataUrl: string, options: ImageBlurOptions, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const amount = clampBlurAmount(options.amount);
    // 零强度保留原始图片，避免不必要的解码、重绘与编码。
    if (amount === 0) return dataUrl;
    const image = await loadImage(dataUrl);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("blur canvas unavailable");
    ctx.drawImage(image, 0, 0);
    applyBlur(ctx, canvas.width, canvas.height, { ...options, amount });
    return canvas.toDataURL("image/png");
}

/** 按预览区域的物理像素准备源图，调整强度时复用；小图不放大采样。 */
export async function createBlurPreviewSource(dataUrl: string, size: { width: number; height: number }, signal?: AbortSignal): Promise<BlurPreviewSource> {
    const image = await loadImage(dataUrl);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const srcW = image.naturalWidth || image.width;
    const srcH = image.naturalHeight || image.height;
    const scale = Math.min(1, size.width / srcW, size.height / srcH);
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("blur canvas unavailable");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, width, height);
    return { canvas, width, height, scale };
}

/** 把模糊结果直接画到目标 canvas，避免 toDataURL 编码延迟。 */
export function paintBlurPreview(source: BlurPreviewSource, target: HTMLCanvasElement, options: ImageBlurOptions) {
    if (target.width !== source.width) target.width = source.width;
    if (target.height !== source.height) target.height = source.height;
    const ctx = target.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("blur canvas unavailable");
    ctx.clearRect(0, 0, source.width, source.height);
    ctx.drawImage(source.canvas, 0, 0);
    // 径向强度本身按画面比例计算，其余方法按原图像素换算；缩略预览保留亚像素精度。
    const scaledAmount = clampBlurAmount(options.amount) * (options.method === "radial" ? 1 : source.scale);
    applyBlur(ctx, source.width, source.height, { ...options, amount: scaledAmount });
}

function applyBlur(ctx: CanvasRenderingContext2D, width: number, height: number, options: ImageBlurOptions) {
    const { amount } = options;
    if (amount <= 0) return;
    if (options.method === "gaussian") {
        blurGaussian(ctx, width, height, amount);
        return;
    }
    const image = ctx.getImageData(0, 0, width, height);
    const blur = (data: Uint8ClampedArray, strength: number) => {
        if (strength <= 0) return;
        if (options.method === "box") boxBlur(data, width, height, strength);
        else if (options.method === "motionH") motionBlur(data, width, height, strength, 1, 0);
        else if (options.method === "motionV") motionBlur(data, width, height, strength, 0, 1);
        else radialBlur(data, width, height, strength);
    };
    // 复用现有整数采样核，在相邻强度结果之间插值，避免小数调整被像素取整吞掉。
    const lower = Math.floor(amount);
    const fraction = amount - lower;
    const upper = fraction ? new Uint8ClampedArray(image.data) : null;
    blur(image.data, lower);
    if (upper) {
        blur(upper, lower + 1);
        for (let i = 0; i < image.data.length; i += 1) image.data[i] += (upper[i] - image.data[i]) * fraction;
    }
    ctx.putImageData(image, 0, 0);
}

let gaussianScratch: HTMLCanvasElement | null = null;

function blurGaussian(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number) {
    // Chromium / Electron 支持 filter 导出；不可用时退回盒状近似
    try {
        if (!gaussianScratch) gaussianScratch = document.createElement("canvas");
        const src = gaussianScratch;
        if (src.width !== width) src.width = width;
        if (src.height !== height) src.height = height;
        const srcCtx = src.getContext("2d");
        if (!srcCtx) throw new Error("no ctx");
        srcCtx.drawImage(ctx.canvas, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.filter = `blur(${radius}px)`;
        ctx.drawImage(src, 0, 0);
        ctx.filter = "none";
        return;
    } catch {
        const image = ctx.getImageData(0, 0, width, height);
        // 三次盒状 ≈ 高斯
        const r = Math.max(1, Math.round(radius / 2));
        boxBlur(image.data, width, height, r);
        boxBlur(image.data, width, height, r);
        boxBlur(image.data, width, height, r);
        ctx.putImageData(image, 0, 0);
    }
}

function boxBlur(data: Uint8ClampedArray, width: number, height: number, radius: number) {
    const r = Math.max(1, radius | 0);
    const temp = new Uint8ClampedArray(data.length);
    blurAxis(data, temp, width, height, r, true);
    blurAxis(temp, data, width, height, r, false);
}

function blurAxis(src: Uint8ClampedArray, dst: Uint8ClampedArray, width: number, height: number, radius: number, horizontal: boolean) {
    const w = width;
    const h = height;
    if (horizontal) {
        for (let y = 0; y < h; y += 1) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let i = -radius; i <= radius; i += 1) {
                const x = clamp(i, 0, w - 1);
                const idx = (y * w + x) * 4;
                r += src[idx];
                g += src[idx + 1];
                b += src[idx + 2];
                a += src[idx + 3];
            }
            const div = radius * 2 + 1;
            for (let x = 0; x < w; x += 1) {
                const out = (y * w + x) * 4;
                dst[out] = r / div;
                dst[out + 1] = g / div;
                dst[out + 2] = b / div;
                dst[out + 3] = a / div;
                const leaveX = clamp(x - radius, 0, w - 1);
                const enterX = clamp(x + radius + 1, 0, w - 1);
                const leave = (y * w + leaveX) * 4;
                const enter = (y * w + enterX) * 4;
                r += src[enter] - src[leave];
                g += src[enter + 1] - src[leave + 1];
                b += src[enter + 2] - src[leave + 2];
                a += src[enter + 3] - src[leave + 3];
            }
        }
        return;
    }
    for (let x = 0; x < w; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let i = -radius; i <= radius; i += 1) {
            const y = clamp(i, 0, h - 1);
            const idx = (y * w + x) * 4;
            r += src[idx];
            g += src[idx + 1];
            b += src[idx + 2];
            a += src[idx + 3];
        }
        const div = radius * 2 + 1;
        for (let y = 0; y < h; y += 1) {
            const out = (y * w + x) * 4;
            dst[out] = r / div;
            dst[out + 1] = g / div;
            dst[out + 2] = b / div;
            dst[out + 3] = a / div;
            const leaveY = clamp(y - radius, 0, h - 1);
            const enterY = clamp(y + radius + 1, 0, h - 1);
            const leave = (leaveY * w + x) * 4;
            const enter = (enterY * w + x) * 4;
            r += src[enter] - src[leave];
            g += src[enter + 1] - src[leave + 1];
            b += src[enter + 2] - src[leave + 2];
            a += src[enter + 3] - src[leave + 3];
        }
    }
}

function motionBlur(data: Uint8ClampedArray, width: number, height: number, length: number, dx: number, dy: number) {
    const steps = Math.max(1, length | 0);
    const src = new Uint8ClampedArray(data);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let i = 0; i < steps; i += 1) {
                const sx = clamp(Math.round(x - dx * i), 0, width - 1);
                const sy = clamp(Math.round(y - dy * i), 0, height - 1);
                const idx = (sy * width + sx) * 4;
                r += src[idx];
                g += src[idx + 1];
                b += src[idx + 2];
                a += src[idx + 3];
            }
            const out = (y * width + x) * 4;
            data[out] = r / steps;
            data[out + 1] = g / steps;
            data[out + 2] = b / steps;
            data[out + 3] = a / steps;
        }
    }
}

function radialBlur(data: Uint8ClampedArray, width: number, height: number, amount: number) {
    const src = new Uint8ClampedArray(data);
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const samples = Math.max(4, Math.min(24, Math.round(amount / 2) + 4));
    const strength = amount / 120;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            const ox = x - cx;
            const oy = y - cy;
            for (let i = 0; i < samples; i += 1) {
                const t = 1 - (i / samples) * strength;
                const sx = clamp(Math.round(cx + ox * t), 0, width - 1);
                const sy = clamp(Math.round(cy + oy * t), 0, height - 1);
                const idx = (sy * width + sx) * 4;
                r += src[idx];
                g += src[idx + 1];
                b += src[idx + 2];
                a += src[idx + 3];
            }
            const out = (y * width + x) * 4;
            data[out] = r / samples;
            data[out + 1] = g / samples;
            data[out + 2] = b / samples;
            data[out + 3] = a / samples;
        }
    }
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("blur image load failed"));
        image.src = src;
    });
}
