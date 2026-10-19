export const OUTPAINT_MODEL = "runninghub::rhart-image-n-pro/edit";
export const OUTPAINT_RESOLUTION = "2k";
export const OUTPAINT_SIZE = "auto";
export const OUTPAINT_FILL = "#FF00FF";
export const OUTPAINT_MAX_SCALE = 3;
const OUTPAINT_MAX_EDGE = 4096;

export type OutpaintBox = { x: number; y: number; width: number; height: number };

export function outpaintImageRect(maxScale = OUTPAINT_MAX_SCALE): OutpaintBox {
    const size = 1 / maxScale;
    const origin = (1 - size) / 2;
    return { x: origin, y: origin, width: size, height: size };
}

export function defaultOutpaintBox(image: OutpaintBox): OutpaintBox {
    return { ...image };
}

export function containOutpaintBox(box: OutpaintBox, image: OutpaintBox): OutpaintBox {
    let width = Math.min(1, Math.max(image.width, box.width));
    let height = Math.min(1, Math.max(image.height, box.height));
    const placed = placeOutpaintBox({ ...box, width, height }, image);
    width = placed.width;
    height = placed.height;
    let { x, y } = placed;
    if (x > image.x) {
        width = Math.min(1, width + x - image.x);
        x = image.x;
    }
    if (y > image.y) {
        height = Math.min(1, height + y - image.y);
        y = image.y;
    }
    if (x + width < image.x + image.width) width = Math.min(1 - x, image.x + image.width - x);
    if (y + height < image.y + image.height) height = Math.min(1 - y, image.y + image.height - y);
    return { x, y, width, height };
}

export function placeOutpaintBox(box: OutpaintBox, image: OutpaintBox): OutpaintBox {
    const width = Math.min(1, Math.max(image.width, box.width));
    const height = Math.min(1, Math.max(image.height, box.height));
    let x = box.x;
    let y = box.y;
    if (x > image.x) x = image.x;
    if (y > image.y) y = image.y;
    if (x + width < image.x + image.width) x = image.x + image.width - width;
    if (y + height < image.y + image.height) y = image.y + image.height - height;
    x = Math.min(Math.max(0, x), 1 - width);
    y = Math.min(Math.max(0, y), 1 - height);
    return { x, y, width, height };
}

export function outpaintCanvasLayout(imageWidth: number, imageHeight: number, box: OutpaintBox, image: OutpaintBox) {
    const canvasW = Math.max(1, Math.round((box.width / image.width) * imageWidth));
    const canvasH = Math.max(1, Math.round((box.height / image.height) * imageHeight));
    return {
        canvasW,
        canvasH,
        imageX: Math.round(((image.x - box.x) / box.width) * canvasW),
        imageY: Math.round(((image.y - box.y) / box.height) * canvasH),
        imageW: imageWidth,
        imageH: imageHeight,
    };
}

export function formatOutpaintRatio(width: number, height: number) {
    const divisor = gcd(Math.round(width), Math.round(height));
    return `${Math.max(1, Math.round(width / divisor))}:${Math.max(1, Math.round(height / divisor))}`;
}

export function outpaintExpandSides(box: OutpaintBox, image: OutpaintBox) {
    const pads = {
        right: box.x + box.width - (image.x + image.width),
        left: image.x - box.x,
        bottom: box.y + box.height - (image.y + image.height),
        top: image.y - box.y,
    };
    const sides = (["right", "left", "bottom", "top"] as const).filter((side) => pads[side] > 0.01);
    if (!sides.length) return ["right"] as const;
    const max = Math.max(...sides.map((side) => pads[side]));
    return sides.filter((side) => pads[side] >= max * 0.75);
}

export function buildOutpaintPrompt(ratio: string, box: OutpaintBox, image: OutpaintBox) {
    const sides = outpaintExpandSides(box, image);
    const area = joinZh(sides.map((side) => ({ right: "右侧", left: "左侧", top: "上方", bottom: "下方" })[side]));
    const dir = joinZh(sides.map((side) => ({ right: "右", left: "左", top: "上", bottom: "下" })[side]));
    return `[TASK]
这是一次小幅单向画布扩图 (outpainting)。
image 1 是工作图：未涂抹的区域是原照片，${area}被品红色 #FF00FF 涂抹的区域是待补画布。
品红涂抹只是位置标记，不是照片内容，也不是被挡住的原图。
把品红涂抹整块移除，换成该方向上新拍摄出来的像素。

[KEEP]
所有未被品红覆盖的像素保持原机位、原构图、原光线。
主体、颜色、透视、文字、已有物体的位置和数量全部不变。
不重绘、不缩放、不换机位、不镜像。

[FILL]
品红涂抹过的地方，补成同一张照片、同一瞬间、同一支镜头向${dir}多看到的内容。
从原图与品红的交界处自然延续：光线、色温、透视、材质、景深连续。
补全区清晰度、纹理密度、颗粒与相邻原图一致。
已有物体在整张画面中只出现一次，品红区是空间延展，不是把已有内容再贴一遍。

[SEAM]
成品里不再有品红、品红反光、品红雾。
原画布边和涂抹轮廓完全消失，没有矩形色块，没有单独一层补丁，没有贴纸硬边。
若原图边缘正好切在虚化前景上，焦外光斑按原镜头继续，外形是柔和过渡，不是直线裁切。
一次快门的完整照片。

[CAMERA]
最终画面比例为 ${ratio}，与 image 1 画布一致。
原图位置不变，只向${dir}延展。`;
}

export async function composeOutpaintWorkImage(dataUrl: string, box: OutpaintBox, imageRect: OutpaintBox) {
    const image = await loadImage(dataUrl);
    const imageW = image.naturalWidth || image.width;
    const imageH = image.naturalHeight || image.height;
    const layout = outpaintCanvasLayout(imageW, imageH, box, imageRect);
    let { canvasW, canvasH, imageX, imageY } = layout;
    let drawW = imageW;
    let drawH = imageH;
    const longEdge = Math.max(canvasW, canvasH);
    if (longEdge > OUTPAINT_MAX_EDGE) {
        const scale = OUTPAINT_MAX_EDGE / longEdge;
        canvasW = Math.max(1, Math.round(canvasW * scale));
        canvasH = Math.max(1, Math.round(canvasH * scale));
        imageX = Math.round(imageX * scale);
        imageY = Math.round(imageY * scale);
        drawW = Math.max(1, Math.round(imageW * scale));
        drawH = Math.max(1, Math.round(imageH * scale));
    }
    const draw = (fill: string | null) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvasW;
        canvas.height = canvasH;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("outpaint canvas unavailable");
        if (fill) {
            ctx.fillStyle = fill;
            ctx.fillRect(0, 0, canvasW, canvasH);
        } else {
            ctx.clearRect(0, 0, canvasW, canvasH);
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, imageX, imageY, drawW, drawH);
        return canvas.toDataURL("image/png");
    };
    return {
        dataUrl: draw(OUTPAINT_FILL),
        compareDataUrl: draw(null),
        width: canvasW,
        height: canvasH,
        ratio: formatOutpaintRatio(canvasW, canvasH),
        prompt: buildOutpaintPrompt(formatOutpaintRatio(canvasW, canvasH), box, imageRect),
    };
}

function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("failed to load image"));
        image.src = src;
    });
}

function joinZh(items: string[]) {
    if (items.length <= 1) return items[0] || "";
    if (items.length === 2) return `${items[0]}和${items[1]}`;
    return `${items.slice(0, -1).join("、")}和${items[items.length - 1]}`;
}

function gcd(a: number, b: number): number {
    return b ? gcd(b, a % b) : Math.max(1, a);
}
