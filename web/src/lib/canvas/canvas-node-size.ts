export function fitNodeSize(width: number, height: number, maxWidth = 640, maxHeight = 640) {
    const w = Math.max(1, Number.isFinite(width) ? width : 1);
    const h = Math.max(1, Number.isFinite(height) ? height : 1);
    const safeMaxWidth = Math.max(1, Number.isFinite(maxWidth) ? maxWidth : 640);
    const safeMaxHeight = Math.max(1, Number.isFinite(maxHeight) ? maxHeight : 640);
    const scale = Math.min(1, safeMaxWidth / w, safeMaxHeight / h);
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export function nodeSizeFromRatio(size: string, baseWidth: number, baseHeight: number) {
    const match = size?.match(/^(\d+)(?:x|:)(\d+)/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const ratio = width / Math.max(1, height);
    if (ratio < 0.25 || ratio > 4) return { width: baseWidth, height: baseHeight };
    return ratio >= baseWidth / baseHeight ? { width: baseWidth, height: baseWidth / ratio } : { width: baseHeight * ratio, height: baseHeight };
}
