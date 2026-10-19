import type { CropRect } from "@/lib/canvas/local-edit-selection";

/** 在调用保存回调前同步快照；局部模式只裁绘制层，原图始终完整保留。 */
export function composePaintedCanvas(source: HTMLCanvasElement, paint: HTMLCanvasElement, selection?: CropRect): string {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("paint canvas unavailable");
    context.drawImage(source, 0, 0);
    context.save();
    if (selection) {
        context.beginPath();
        context.rect(selection.x * canvas.width, selection.y * canvas.height, selection.width * canvas.width, selection.height * canvas.height);
        context.clip();
    }
    context.drawImage(paint, 0, 0);
    context.restore();
    return canvas.toDataURL("image/png");
}
