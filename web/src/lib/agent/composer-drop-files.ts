import { fileLocalPath } from "@/lib/canvas/folder-disk-path";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i;
const TEXT_EXT = /\.(md|txt|json|tsx?|jsx?|mjs|cjs|css|scss|less|html?|csv|xml|ya?ml|toml|ini|log|env|svg)$/i;
const MAX_TEXT_CHARS = 80_000;

export function isComposerImageFile(file: File) {
    if (file.type.startsWith("image/")) return true;
    return IMAGE_EXT.test(file.name);
}

export function isComposerTextFile(file: File) {
    if (file.type.startsWith("text/") || file.type === "application/json" || file.type === "application/xml") return true;
    return TEXT_EXT.test(file.name);
}

export function electronFilePath(file: File) {
    return fileLocalPath(file);
}

export async function formatDroppedTextFiles(files: File[]) {
    const parts = await Promise.all(
        files.map(async (file) => {
            const raw = await file.text();
            const body = raw.length > MAX_TEXT_CHARS ? `${raw.slice(0, MAX_TEXT_CHARS)}\n…` : raw;
            return `【${file.name}】\n\`\`\`\n${body}\n\`\`\``;
        }),
    );
    return parts.join("\n\n");
}

export function formatDroppedLocalPaths(files: File[]) {
    return files
        .map((file) => {
            const path = electronFilePath(file);
            return path ? `本地文件：${path}` : `本地文件：${file.name}`;
        })
        .join("\n");
}
