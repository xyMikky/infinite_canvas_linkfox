/** 浏览器端预览 PDF / Adobe Illustrator (.ai) / EPS：优先 PDF 兼容体，其次内嵌位图预览。 */

/** PDF 截断后缺 xref/EOF 时浏览器常白屏，尽量给足体积 */
const MAX_INLINE_BYTES = 16_000_000;

function indexOfBytes(haystack: Uint8Array, needle: number[], from = 0) {
    outer: for (let i = from; i <= haystack.length - needle.length; i += 1) {
        for (let j = 0; j < needle.length; j += 1) {
            if (haystack[i + j] !== needle[j]) continue outer;
        }
        return i;
    }
    return -1;
}

function toDataUrl(mime: string, bytes: Uint8Array) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        const slice = bytes.subarray(i, i + chunk);
        binary += String.fromCharCode.apply(null, slice as unknown as number[]);
    }
    return `data:${mime};base64,${btoa(binary)}`;
}

function extractPdfSlice(bytes: Uint8Array): Uint8Array | null {
    const start = indexOfBytes(bytes, [0x25, 0x50, 0x44, 0x46]); // %PDF
    if (start < 0) return null;
    return bytes.subarray(start);
}

function extractJpeg(bytes: Uint8Array): Uint8Array | null {
    const start = indexOfBytes(bytes, [0xff, 0xd8, 0xff]);
    if (start < 0) return null;
    const end = indexOfBytes(bytes, [0xff, 0xd9], start + 3);
    if (end < 0) return null;
    return bytes.subarray(start, end + 2);
}

function extractPng(bytes: Uint8Array): Uint8Array | null {
    const start = indexOfBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (start < 0) return null;
    const endMarker = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
    const end = indexOfBytes(bytes, endMarker, start + 8);
    if (end < 0) return null;
    return bytes.subarray(start, end + endMarker.length);
}

export type VectorPreviewResult =
    | { kind: "pdf"; content: string; truncated: boolean }
    | { kind: "image"; content: string; truncated: boolean }
    | null;

/** @deprecated 使用 VectorPreviewResult */
export type AiEpsPreviewResult = VectorPreviewResult;

export function isAiEpsFileName(name: string) {
    return /\.(ai|eps)$/i.test(name);
}

export function isVectorPreviewFileName(name: string) {
    return /\.(pdf|ai|eps)$/i.test(name);
}

export function isVectorPreviewFile(file: File) {
    return isVectorPreviewFileName(file.name) || file.type === "application/pdf";
}

export async function parseVectorPreview(file: File): Promise<VectorPreviewResult> {
    if (!isVectorPreviewFile(file)) return null;
    const limit = Math.min(file.size, MAX_INLINE_BYTES);
    const truncated = file.size > limit;
    const buffer = limit < file.size ? await file.slice(0, limit).arrayBuffer() : await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const pdf = extractPdfSlice(bytes);
    if (pdf && pdf.length > 32) {
        return { kind: "pdf", content: toDataUrl("application/pdf", pdf), truncated };
    }

    // 纯 PDF 无 %PDF 头时无法预览；AI/EPS 再尝试内嵌预览图
    if (!isAiEpsFileName(file.name)) return null;

    const png = extractPng(bytes);
    if (png) return { kind: "image", content: toDataUrl("image/png", png), truncated };

    const jpeg = extractJpeg(bytes);
    if (jpeg) return { kind: "image", content: toDataUrl("image/jpeg", jpeg), truncated };

    return null;
}

export async function parseAiEpsPreview(file: File): Promise<VectorPreviewResult> {
    if (!isAiEpsFileName(file.name)) return null;
    return parseVectorPreview(file);
}
