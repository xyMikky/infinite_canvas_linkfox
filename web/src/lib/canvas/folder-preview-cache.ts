import localforage from "localforage";

import { resolveRoomFolderFileUrl } from "@/lib/canvas/room/room-media-context";
import { isVectorPreviewFileName, parseVectorPreview } from "@/lib/canvas/ai-eps-preview";
import { parseDocumentFile, type ExcelSheetPreview } from "@/lib/canvas/document-drop";
import { isModel3dFileName } from "@/lib/canvas/model-3d-preview";
import { resolveFolderDiskPathFromNode } from "@/lib/canvas/folder-disk-path";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export type FolderPreviewKind = "markdown" | "html" | "excel" | "csv" | "text" | "pdf" | "image" | "canvasTsx" | "model3d";

export function isCanvasTsxFileName(name: string) {
    return /(?:^|[\\/.])canvas\.tsx$/i.test(name);
}

/** Excel/CSV 解析结构版本：解析能力升级后旧缓存自动失效重解析 */
const SHEET_PARSE_VERSION = 2;

export type FolderPreviewFile = {
    path: string;
    name: string;
    kind: FolderPreviewKind;
    content?: string;
    sheets?: ExcelSheetPreview[];
    truncated?: boolean;
    sheetParseVersion?: number;
};

export type FolderPreviewSource = {
    path: string;
    name: string;
    data: ArrayBuffer;
};

const MAX_SOURCE_FILES = 500;
const MAX_SOURCE_BYTES = 2_500_000;
/** JS/CSS/HTML 放宽，避免 echarts 等被截断导致正文空白 */
const MAX_CODE_SOURCE_BYTES = 16_000_000;
/** Excel 为 zip 二进制，截断后无法解析；单独放宽上限 */
const MAX_EXCEL_SOURCE_BYTES = 32_000_000;
/** 单文件夹源文件总上限；过大易占满内存（IndexedDB 仍可落盘）。 */
const MAX_TOTAL_SOURCE_BYTES = 48_000_000;
/** 内存里最多保留几个文件夹的源文件；其余只留 IndexedDB。 */
const MAX_SOURCE_MEMORY_FOLDERS = 1;

function maxBytesForFileName(name: string) {
    if (/\.(xlsx|xls)$/i.test(name)) return MAX_EXCEL_SOURCE_BYTES;
    if (isModel3dFileName(name)) return MAX_EXCEL_SOURCE_BYTES;
    if (/\.(js|mjs|cjs|css|html|htm|ai|eps|pdf|tsx)$/i.test(name) || isCanvasTsxFileName(name)) return MAX_CODE_SOURCE_BYTES;
    return MAX_SOURCE_BYTES;
}

/** zip/二进制不可截断缓存，否则 XLSX 等解析必失败 */
function mustStoreWholeFile(name: string) {
    return /\.(xlsx|xls|pdf|ai|eps|png|jpe?g|gif|webp|bmp|avif|ico)$/i.test(name) || isModel3dFileName(name);
}
/** 智能预览列表里可选的文档类型 */
const PREVIEW_EXT = /\.(md|markdown|html|htm|csv|xlsx|xls|txt|ai|eps|pdf|canvas\.tsx|glb|gltf|obj|stl|ply|fbx|dae|3mf|pcd|vtk)$/i;
/** 明确当作网页工程资源优先缓存的扩展名 */
const SOURCE_EXT =
    /\.(md|markdown|html|htm|css|js|mjs|cjs|json|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|otf|txt|csv|tsv|xlsx|xls|map|wasm|xml|geojson|ai|eps|pdf|canvas\.tsx)$/i;
/** 拖入时跳过缓存的大体积/无关类型（仍可出现在文件夹列表，但智能预览不读入） */
const SOURCE_SKIP_EXT =
    /\.(zip|rar|7z|tar|gz|tgz|mp4|mov|webm|avi|mkv|mp3|wav|flac|exe|dmg|psd|sketch|pptx?|docx?|key|numbers|safetensors|ckpt|pt|pth|onnx|gguf|blend)$/i;

const parsedMemory = new Map<string, FolderPreviewFile[]>();
const sourceMemory = new Map<string, FolderPreviewSource[]>();
const parsedStore = localforage.createInstance({ name: "infinite-canvas", storeName: "folder_preview_files" });
const sourceStore = localforage.createInstance({ name: "infinite-canvas", storeName: "folder_preview_sources" });
const imageSourceStore = localforage.createInstance({ name: "infinite-canvas", storeName: "folder_image_originals" });
const isImageSource = (name: string) => /\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i.test(name);
const imageSourceKey = (id: string, path: string) => JSON.stringify([id, path]);

export function isPreviewableFileName(name: string) {
    return isCanvasTsxFileName(name) || PREVIEW_EXT.test(name);
}

/** 拖入文件夹时缓存的文件：网页资源 + 其它小文件（含无扩展名数据），供 HTML 工程相对/绝对路径加载 */
export function isFolderSourceFileName(name: string) {
    if (SOURCE_SKIP_EXT.test(name)) return false;
    return true;
}

function previewPriority(name: string) {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (ext === "html" || ext === "htm" || isCanvasTsxFileName(name)) return 0;
    if (ext === "js" || ext === "mjs" || ext === "cjs" || ext === "css") return 1;
    if (ext === "json" || ext === "md" || ext === "markdown" || ext === "svg" || ext === "geojson") return 2;
    if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif" || ext === "webp" || ext === "ico") return 3;
    if (ext === "ai" || ext === "eps" || ext === "pdf") return 3;
    if (ext === "glb" || ext === "gltf" || ext === "obj" || ext === "stl" || ext === "ply" || ext === "fbx" || ext === "dae" || ext === "3mf" || ext === "pcd" || ext === "vtk") return 3;
    if (ext === "txt" || ext === "csv" || ext === "tsv" || ext === "xml" || ext === "map" || ext === "wasm") return 4;
    if (ext === "woff" || ext === "woff2" || ext === "ttf" || ext === "otf") return 5;
    // Excel 最后，避免占满配额导致 HTML 工程资源未缓存
    if (ext === "xlsx" || ext === "xls") return 8;
    return 6;
}

function depthOf(path: string) {
    return path.split("/").filter(Boolean).length;
}

/** 浅层 + HTML/MD 优先，避免深层大 Excel 占满配额导致根目录 HTML 未缓存 */
export function sortPreviewCandidates<T extends { path: string; name?: string; file?: File }>(items: T[]) {
    return [...items].sort((a, b) => {
        const nameA = a.name || a.file?.name || a.path;
        const nameB = b.name || b.file?.name || b.path;
        const byKind = previewPriority(nameA) - previewPriority(nameB);
        if (byKind) return byKind;
        const byDepth = depthOf(a.path) - depthOf(b.path);
        if (byDepth) return byDepth;
        return a.path.localeCompare(b.path);
    });
}

export async function parseFolderPreviewFile(file: File, path: string): Promise<FolderPreviewFile | null> {
    if (!isPreviewableFileName(file.name)) return null;
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    try {
        if (isVectorPreviewFileName(file.name)) {
            const preview = await parseVectorPreview(file);
            // 无 PDF 兼容体/内嵌预览时仍进列表，界面提示无法预览
            if (!preview) return { path, name: file.name, kind: "pdf", content: "", truncated: true };
            return { path, name: file.name, kind: preview.kind, content: preview.content, truncated: preview.truncated };
        }
        if (isModel3dFileName(file.name)) {
            return { path, name: file.name, kind: "model3d", truncated: file.size > maxBytesForFileName(file.name) };
        }
        if (ext === "html" || ext === "htm") {
            if (file.size > MAX_SOURCE_BYTES) {
                const text = (await file.slice(0, MAX_SOURCE_BYTES).text().catch(() => "")).trim();
                return { path, name: file.name, kind: "html", content: text, truncated: true };
            }
            const content = await file.text().catch(() => "");
            return { path, name: file.name, kind: "html", content, truncated: false };
        }
        if (isCanvasTsxFileName(file.name)) {
            const limit = MAX_CODE_SOURCE_BYTES;
            if (file.size > limit) {
                const text = (await file.slice(0, limit).text().catch(() => "")).trim();
                return { path, name: file.name, kind: "canvasTsx", content: text, truncated: true };
            }
            const content = await file.text().catch(() => "");
            return { path, name: file.name, kind: "canvasTsx", content, truncated: false };
        }
        if (ext === "txt") {
            if (file.size > MAX_SOURCE_BYTES) {
                const text = (await file.slice(0, MAX_SOURCE_BYTES).text().catch(() => "")).trim();
                return { path, name: file.name, kind: "text", content: text, truncated: true };
            }
            const content = await file.text().catch(() => "");
            return { path, name: file.name, kind: "text", content, truncated: false };
        }
        const document = await parseDocumentFile(file);
        if (!document) return null;
        return {
            path,
            name: file.name,
            kind: document.kind,
            content: document.content,
            sheets: document.sheets,
            truncated: document.truncated,
            sheetParseVersion: SHEET_PARSE_VERSION,
        };
    } catch {
        return null;
    }
}

function parsedKey(folderNodeId: string) {
    return `folder-preview:${folderNodeId}`;
}

function sourceKey(folderNodeId: string) {
    return `folder-preview-src:${folderNodeId}`;
}

export async function stashFolderPreviewSources(folderNodeId: string, items: Array<{ path: string; file: File }>) {
    // 图片原件逐文件保存，不受文档预览的单文件/总量配额影响。
    for (const item of items) {
        if (isImageSource(item.file.name)) await imageSourceStore.setItem(imageSourceKey(folderNodeId, item.path), item.file);
    }
    const sources: FolderPreviewSource[] = [];
    let total = 0;
    const hasHtml = items.some((item) => /\.html?$/i.test(item.file.name));
    for (const item of sortPreviewCandidates(items)) {
        if (isImageSource(item.file.name)) continue;
        if (sources.length >= MAX_SOURCE_FILES || total >= MAX_TOTAL_SOURCE_BYTES) break;
        if (!isFolderSourceFileName(item.file.name)) continue;
        // HTML 工程优先保证脚本/数据；跳过大 Excel 证据表
        if (hasHtml && /\.xlsx?$/i.test(item.file.name)) continue;
        try {
            const limit = maxBytesForFileName(item.file.name);
            // Excel/PDF 等二进制截断后无法解析，超限则跳过（桌面端再走磁盘路径）
            if (mustStoreWholeFile(item.file.name) && item.file.size > limit) continue;
            const size = Math.min(item.file.size, limit);
            if (mustStoreWholeFile(item.file.name) && size < item.file.size) continue;
            if (total + size > MAX_TOTAL_SOURCE_BYTES && sources.length) break;
            const data = size < item.file.size ? await item.file.slice(0, size).arrayBuffer() : await item.file.arrayBuffer();
            sources.push({ path: item.path, name: item.file.name, data });
            total += data.byteLength;
        } catch {
            // skip unreadable
        }
    }
    rememberSources(folderNodeId, sources);
    try {
        await sourceStore.setItem(sourceKey(folderNodeId), sources);
    } catch {
        // quota: keep memory
    }
    return sources.length;
}

export async function loadFolderPreviewSources(folderNodeId: string): Promise<FolderPreviewSource[]> {
    const sources = new Map((await loadSources(folderNodeId)).map((source) => [source.path, source]));
    const prefix = `${JSON.stringify([folderNodeId]).slice(0, -1)},`;
    for (const key of await imageSourceStore.keys()) {
        if (!key.startsWith(prefix)) continue;
        const blob = await imageSourceStore.getItem<Blob>(key);
        if (!blob) continue;
        const [, path] = JSON.parse(key) as [string, string];
        sources.set(path, { path, name: path.split("/").pop() || path, data: await blob.arrayBuffer() });
    }
    return [...sources.values()];
}

/** 读取单个源文件二进制；缓存没有时回退磁盘并补进源列表 */
export async function loadFolderPreviewSourceBuffer(folderNodeId: string, path: string): Promise<ArrayBuffer | null> {
    const original = await imageSourceStore.getItem<Blob>(imageSourceKey(folderNodeId, path));
    if (original) return original.arrayBuffer();
    const sources = await loadSources(folderNodeId);
    const hit = sources.find((item) => item.path === path);
    if (hit?.data?.byteLength) return hit.data;
    const roomUrl = resolveRoomFolderFileUrl(folderNodeId, path);
    if (roomUrl) {
        try {
            const res = await fetch(roomUrl);
            if (res.ok) {
                const data = await res.arrayBuffer();
                if (data.byteLength) {
                    const name = path.split("/").pop() || path;
                    await upsertFolderPreviewSource(folderNodeId, { path, name, data });
                    return data;
                }
            }
        } catch {
            // fall through
        }
    }
    const diskFile = await readFolderFileFromDisk(folderNodeId, path);
    if (!diskFile) return null;
    const data = await diskFile.arrayBuffer();
    await upsertFolderPreviewSource(folderNodeId, { path, name: diskFile.name, data });
    return data;
}

export async function upsertFolderPreviewSource(folderNodeId: string, source: FolderPreviewSource) {
    if (isImageSource(source.name)) {
        await imageSourceStore.setItem(imageSourceKey(folderNodeId, source.path), new Blob([source.data]));
        return;
    }
    const current = await loadSources(folderNodeId);
    const next = [...current.filter((item) => item.path !== source.path), source];
    rememberSources(folderNodeId, next);
    try {
        await sourceStore.setItem(sourceKey(folderNodeId), next);
    } catch {
        // quota: keep memory
    }
}

/** 导入画布时写回文件夹源文件（IndexedDB + 内存）。 */
export async function restoreFolderPreviewSources(folderNodeId: string, sources: FolderPreviewSource[]) {
    for (const source of sources) {
        if (isImageSource(source.name)) await imageSourceStore.setItem(imageSourceKey(folderNodeId, source.path), new Blob([source.data]));
    }
    sources = sources.filter((source) => !isImageSource(source.name));
    rememberSources(folderNodeId, sources);
    try {
        await sourceStore.setItem(sourceKey(folderNodeId), sources);
    } catch {
        // quota: keep memory
    }
}

export function folderSourceStorageKey(folderNodeId: string, relativePath: string) {
    return `folder-src:${folderNodeId}:${relativePath}`;
}

export function parseFolderSourceStorageKey(storageKey: string): { folderNodeId: string; path: string } | null {
    if (!storageKey.startsWith("folder-src:")) return null;
    const rest = storageKey.slice("folder-src:".length);
    const split = rest.indexOf(":");
    if (split <= 0) return null;
    return { folderNodeId: rest.slice(0, split), path: rest.slice(split + 1) };
}

/** 释放内存中的源文件（IndexedDB 仍保留），用于物化完成后避免与 blob 双份占用。 */
export function releaseFolderPreviewSourcesMemory(folderNodeId?: string) {
    if (folderNodeId) {
        sourceMemory.delete(folderNodeId);
        return;
    }
    sourceMemory.clear();
}

export async function upsertFolderPreviewFile(folderNodeId: string, file: FolderPreviewFile) {
    const current = await loadParsedFiles(folderNodeId);
    const next = [...current.filter((item) => item.path !== file.path), file];
    parsedMemory.set(folderNodeId, next);
    try {
        await parsedStore.setItem(parsedKey(folderNodeId), next);
    } catch {
        // ignore
    }
}

/** 旧版解析的表格缓存（缺列宽/合并/样式）一律剔除，逼迫走重新解析 */
function dropStaleSheetEntries(files: FolderPreviewFile[]) {
    return files.filter(
        (item) => !((item.kind === "excel" || item.kind === "csv") && (item.sheets || []).length && item.sheetParseVersion !== SHEET_PARSE_VERSION),
    );
}

async function loadParsedFiles(folderNodeId: string): Promise<FolderPreviewFile[]> {
    const cached = parsedMemory.get(folderNodeId);
    if (cached) return cached;
    try {
        const stored = await parsedStore.getItem<FolderPreviewFile[]>(parsedKey(folderNodeId));
        if (stored?.length) {
            const fresh = dropStaleSheetEntries(stored);
            parsedMemory.set(folderNodeId, fresh);
            return fresh;
        }
    } catch {
        // ignore
    }
    return [];
}

function rememberSources(folderNodeId: string, sources: FolderPreviewSource[]) {
    sourceMemory.delete(folderNodeId);
    sourceMemory.set(folderNodeId, sources);
    while (sourceMemory.size > MAX_SOURCE_MEMORY_FOLDERS) {
        const oldest = sourceMemory.keys().next().value;
        if (oldest === undefined || oldest === folderNodeId) break;
        sourceMemory.delete(oldest);
    }
}

async function loadSources(folderNodeId: string): Promise<FolderPreviewSource[]> {
    const cached = sourceMemory.get(folderNodeId);
    if (cached) {
        rememberSources(folderNodeId, cached);
        return cached;
    }
    try {
        const stored = await sourceStore.getItem<FolderPreviewSource[]>(sourceKey(folderNodeId));
        if (stored?.length) {
            rememberSources(folderNodeId, stored);
            return stored;
        }
    } catch {
        // ignore
    }
    return [];
}

export async function loadFolderPreviewFiles(folderNodeId: string): Promise<FolderPreviewFile[]> {
    return loadParsedFiles(folderNodeId);
}

function joinDiskPath(root: string, relative: string) {
    const rel = relative.replace(/\\/g, "/").replace(/^\/+/, "");
    const base = root.replace(/[/\\]+$/, "");
    const full = `${base}/${rel}`.replace(/\\/g, "/");
    return /^[A-Za-z]:/.test(full) ? full.replace(/\//g, "\\") : full;
}

function folderDiskRoot(folderNodeId: string) {
    for (const project of useCanvasStore.getState().projects) {
        const node = project.nodes.find((item) => item.id === folderNodeId);
        if (!node) continue;
        const diskPath = resolveFolderDiskPathFromNode(node);
        if (diskPath) return diskPath;
    }
    return "";
}

async function readFolderFileFromDisk(folderNodeId: string, relativePath: string): Promise<File | null> {
    const desktop = window.desktopAPI;
    const root = folderDiskRoot(folderNodeId);
    if (!desktop?.isDesktop || !root) return null;
    const abs = joinDiskPath(root, relativePath);
    const result = await desktop.readFile(abs);
    if (!result.ok || !result.dataBase64) return null;
    const binary = atob(result.dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const name = relativePath.split("/").pop() || "file";
    return new File([bytes], name);
}

/** 优先已解析缓存，否则从拖入时保存的源文件按需解析；桌面端再回退到数据目录/本机路径 */
export async function resolveFolderPreviewFile(folderNodeId: string, path: string): Promise<FolderPreviewFile | null> {
    const parsed = (await loadParsedFiles(folderNodeId)).find((item) => item.path === path);
    // 旧缓存：空 sheets 的 Excel、仍按纯文本存的 CSV、或解析版本落后（缺列宽/合并/样式），都视为无效并重新解析
    const staleCsv = (parsed?.kind === "csv" || /\.csv$/i.test(path)) && !(parsed?.sheets || []).length;
    const staleExcel = parsed?.kind === "excel" && !(parsed.sheets || []).length;
    if (parsed && !staleCsv && !staleExcel) return parsed;

    const sources = await loadSources(folderNodeId);
    const source = sources.find((item) => item.path === path);
    if (source) {
        const file = new File([source.data], source.name);
        const next = await parseFolderPreviewFile(file, path);
        if (next && !(next.kind === "excel" && !(next.sheets || []).length)) {
            await upsertFolderPreviewFile(folderNodeId, next);
            return next;
        }
        // 源缓存可能曾被截断损坏，继续尝试磁盘完整文件
    }

    const diskFile = await readFolderFileFromDisk(folderNodeId, path);
    if (!diskFile) return null;
    const next = await parseFolderPreviewFile(diskFile, path);
    if (next) await upsertFolderPreviewFile(folderNodeId, next);
    return next;
}

/** @deprecated 兼容旧调用；请用 stashFolderPreviewSources */
export async function stashFolderPreviewFiles(folderNodeId: string, files: FolderPreviewFile[]) {
    parsedMemory.set(folderNodeId, files);
    try {
        await parsedStore.setItem(parsedKey(folderNodeId), files);
    } catch {
        // ignore
    }
}

export async function getFolderPreviewFile(folderNodeId: string, path: string): Promise<FolderPreviewFile | null> {
    return resolveFolderPreviewFile(folderNodeId, path);
}
