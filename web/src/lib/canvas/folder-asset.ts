import { buildAddFolderNodeOp } from "@/components/canvas/nodes/folder-node";
import localforage from "localforage";
import { readThumbnail } from "@/services/asset-thumbnail";
import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { persistDroppedFolder } from "@/lib/canvas/folder-desktop-storage";
import type { DroppedFolderBundle } from "@/lib/canvas/folder-drop";
import { loadFolderPreviewSourceBuffer, loadFolderPreviewSources, restoreFolderPreviewSources, stashFolderPreviewSources, upsertFolderPreviewSource } from "@/lib/canvas/folder-preview-cache";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore, type FolderAsset, type FolderAssetData } from "@/stores/use-asset-store";
import { useConfigStore } from "@/stores/use-config-store";
import type { CanvasFolderEntry, CanvasNodeData } from "@/types/canvas";

const folderImages = localforage.createInstance({ name: "infinite-canvas", storeName: "asset_folder_images" });
const folderImageKey = (id: string, path: string) => JSON.stringify([id, path]);

export async function saveFolderAssetImages(id: string, items: Array<{ path: string; file: File }>) {
    for (const item of items) {
        if (isFolderImageFileName(item.file.name)) await folderImages.setItem(folderImageKey(id, item.path), item.file);
    }
}

export async function readFolderAssetThumbnail(asset: FolderAsset, path: string, signal: AbortSignal) {
    return readThumbnail(`folder-v1:${asset.id}:${asset.updatedAt}:${path}`, async () => {
        const data = await resolveFolderAssetFileBuffer(asset, path);
        return data ? new Blob([data], { type: imageMimeFromName(path) }) : null;
    }, signal);
}

export function folderAssetPreviewKey(assetId: string) {
    return `asset-folder:${assetId}`;
}

export function isFolderImageFileName(name: string) {
    return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(name);
}

function imageMimeFromName(name: string) {
    if (/\.png$/i.test(name)) return "image/png";
    if (/\.jpe?g$/i.test(name)) return "image/jpeg";
    if (/\.gif$/i.test(name)) return "image/gif";
    if (/\.webp$/i.test(name)) return "image/webp";
    if (/\.bmp$/i.test(name)) return "image/bmp";
    if (/\.avif$/i.test(name)) return "image/avif";
    return "image/png";
}

function joinDiskPath(root: string, relative: string) {
    const rel = relative.replace(/\\/g, "/").replace(/^\/+/, "");
    const base = root.replace(/[/\\]+$/, "");
    const full = `${base}/${rel}`.replace(/\\/g, "/");
    return /^[A-Za-z]:/.test(full) ? full.replace(/\//g, "\\") : full;
}

/** 资产文件夹内某一层的子项（目录优先） */
export function childrenOfFolderAsset(entries: CanvasFolderEntry[], parentPath: string): CanvasFolderEntry[] {
    const prefix = parentPath ? `${parentPath}/` : "";
    return entries
        .filter((entry) => {
            if (!parentPath) return !entry.path.includes("/");
            if (!entry.path.startsWith(prefix)) return false;
            const rest = entry.path.slice(prefix.length);
            return Boolean(rest) && !rest.includes("/");
        })
        .sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
}

/** 只引用电脑其它目录的大型文件夹，删除分组时必须保留，不能删原目录。 */
export function isLinkedExternalFolderAsset(asset: FolderAsset) {
    return asset.data.storageMode === "reference" && Boolean(String(asset.data.localPath || "").trim());
}

async function purgeFolderAssetOwnedStorage(asset: FolderAsset) {
    const keys: string[] = [];
    await folderImages.iterate((_value, key) => {
        try {
            const parsed = JSON.parse(key) as unknown;
            if (Array.isArray(parsed) && parsed[0] === asset.id) keys.push(key);
        } catch { /* 忽略坏键 */ }
    });
    for (const key of keys) await folderImages.removeItem(key);
    const dataPath = String(asset.data.dataPath || "").trim();
    const dataRoot = String(useConfigStore.getState().config.canvasDataDir || "").trim();
    const desktop = window.desktopAPI;
    if (desktop?.isDesktop && dataPath && dataRoot) await desktop.deleteDirectory(dataPath, dataRoot);
}

/** 删除分组时清掉本项目保存的素材；外链文件夹留下。 */
export async function purgeOwnedAssetsInGroup(memberIds: string[]) {
    const byId = new Map(useAssetStore.getState().assets.map((asset) => [asset.id, asset]));
    for (const id of memberIds) {
        const asset = byId.get(id);
        if (!asset) continue;
        if (asset.kind === "folder" && isLinkedExternalFolderAsset(asset)) continue;
        if (asset.kind === "folder") await purgeFolderAssetOwnedStorage(asset);
        useAssetStore.getState().removeAsset(asset.id);
    }
}

/** 从文件夹资产中移除一项及其子路径，不删除电脑上的原文件夹。 */
export function removeFolderAssetEntry(asset: FolderAsset, targetPath: string) {
    const prefix = `${targetPath}/`;
    const removed = asset.data.entries.filter((entry) => entry.path === targetPath || entry.path.startsWith(prefix));
    if (!removed.length) return;
    const entries = asset.data.entries.filter((entry) => entry.path !== targetPath && !entry.path.startsWith(prefix));
    const removedBytes = removed.reduce((sum, entry) => sum + (entry.size || 0), 0);
    useAssetStore.getState().updateAsset(asset.id, {
        data: {
            ...asset.data,
            entries,
            entryCount: entries.length,
            totalBytes: Math.max(0, (asset.data.totalBytes || 0) - removedBytes),
            topLevelDirs: entries.filter((entry) => entry.kind === "directory" && !entry.path.includes("/")).map((entry) => entry.name),
        },
    });
}

async function readFolderAssetFileFromDisk(asset: FolderAsset, relativePath: string): Promise<ArrayBuffer | null> {
    const root = String(asset.data.dataPath || asset.data.localPath || "").trim();
    const desktop = window.desktopAPI;
    if (!desktop?.isDesktop || !root || !desktop.readFile) return null;
    const result = await desktop.readFile(joinDiskPath(root, relativePath));
    if (!result.ok || !result.dataBase64) return null;
    const binary = atob(result.dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

/** 读取资产文件夹内文件二进制：预览缓存 → 磁盘路径 */
export async function resolveFolderAssetFileBuffer(asset: FolderAsset, relativePath: string): Promise<ArrayBuffer | null> {
    const original = await folderImages.getItem<Blob>(folderImageKey(asset.id, relativePath));
    if (original?.size) return original.arrayBuffer();
    const key = folderAssetPreviewKey(asset.id);
    const cached = await loadFolderPreviewSourceBuffer(key, relativePath);
    const expectedSize = asset.data.entries.find((entry) => entry.path === relativePath)?.size;
    if (cached?.byteLength && (!expectedSize || cached.byteLength === expectedSize)) return cached;
    const fromDisk = await readFolderAssetFileFromDisk(asset, relativePath);
    if (!fromDisk?.byteLength) throw new Error("原文件未完整保存，请重新选择原文件夹恢复图片");
    if (isFolderImageFileName(relativePath)) {
        await folderImages.setItem(folderImageKey(asset.id, relativePath), new Blob([fromDisk]));
        return fromDisk;
    }
    await upsertFolderPreviewSource(key, { path: relativePath, name: relativePath.split("/").pop() || relativePath, data: fromDisk });
    return fromDisk;
}

/** 生成缩略图用的临时 object URL（调用方负责 revoke） */
export async function resolveFolderAssetImageObjectUrl(asset: FolderAsset, relativePath: string, fileName: string): Promise<string | null> {
    const buf = await resolveFolderAssetFileBuffer(asset, relativePath);
    if (!buf) return null;
    return URL.createObjectURL(new Blob([new Uint8Array(buf)], { type: imageMimeFromName(fileName) }));
}

/** 将文件夹内图片转为可插入画布的 image payload */
export async function folderAssetFileToImagePayload(asset: FolderAsset, relativePath: string, fileName: string): Promise<InsertAssetPayload | null> {
    const buf = await resolveFolderAssetFileBuffer(asset, relativePath);
    if (!buf) return null;
    const uploaded = await uploadImage(new Blob([new Uint8Array(buf)], { type: imageMimeFromName(fileName) }));
    return { kind: "image", dataUrl: uploaded.url, title: fileName, storageKey: uploaded.storageKey };
}

function folderDataFromBundle(bundle: DroppedFolderBundle, persist: { mode: "copy" | "reference"; localPath: string; dataPath: string; totalBytes: number }): FolderAssetData {
    return {
        folderName: bundle.folderName,
        entries: bundle.entries,
        truncated: bundle.truncated,
        topLevelDirs: bundle.topLevelDirs,
        entryCount: bundle.entries.length,
        totalBytes: persist.totalBytes || bundle.totalBytes || 0,
        storageMode: persist.mode,
        localPath: persist.localPath || "",
        dataPath: persist.dataPath || "",
        skill: bundle.skill,
    };
}

/** 将项目文件夹快照写入「我的资产」，并缓存可预览源文件 */
export async function addFolderAssetFromBundle(bundle: DroppedFolderBundle): Promise<string> {
    const store = useAssetStore.getState();
    const { canvasDataDir } = useConfigStore.getState().config;
    const id = store.addAsset({
        kind: "folder",
        title: bundle.folderName,
        coverUrl: "",
        tags: [],
        source: "folder",
        data: folderDataFromBundle(bundle, {
            mode: "copy",
            localPath: bundle.localRootPath || "",
            dataPath: "",
            totalBytes: bundle.totalBytes || 0,
        }),
    });

    const persist = await persistDroppedFolder({
        nodeId: `asset-${id}`,
        folder: bundle,
        canvasDataDir: canvasDataDir || "",
    });
    store.updateAsset(id, { data: folderDataFromBundle(bundle, persist) });

    if (bundle.previewCandidates?.length) {
        await saveFolderAssetImages(id, bundle.previewCandidates);
        await stashFolderPreviewSources(folderAssetPreviewKey(id), bundle.previewCandidates.filter((item) => !isFolderImageFileName(item.file.name)));
    }
    return id;
}

/** 文件夹节点入库：复用目录保存流程，源文件缓存另存到资产自己的 key。 */
export async function addFolderAssetFromNode(node: CanvasNodeData): Promise<string> {
    const meta = node.metadata || {};
    const sources = await loadFolderPreviewSources(node.id);
    // 浏览器只有文件列表并不代表原件完整，禁止把缺失内容当成功入库。
    if (!window.desktopAPI?.isDesktop) {
        const sourceByPath = new Map(sources.map((source) => [source.path, source]));
        const missing = (meta.folderEntries || []).filter((entry) => entry.kind === "file" && isFolderImageFileName(entry.name) && (!sourceByPath.get(entry.path)?.data.byteLength || (entry.size && sourceByPath.get(entry.path)?.data.byteLength !== entry.size)));
        if (missing.length) throw new Error(`文件夹有 ${missing.length} 张图片原件未完整保存，请重新拖入原文件夹后再存入资产库`);
    }
    const id = await addFolderAssetFromBundle({
        folderName: meta.folderName || node.title,
        entries: meta.folderEntries || [],
        truncated: Boolean(meta.folderTruncated),
        topLevelDirs: meta.folderTopLevelDirs || [],
        totalBytes: meta.folderTotalBytes || 0,
        // 已复制的目录优先从数据目录读取，避免原目录移动后无法再入库。
        localRootPath: meta.folderDataPath || meta.folderLocalPath || "",
        previewCandidates: [],
        ...(meta.folderSkillName ? { skill: {
            name: meta.folderSkillName,
            displayName: meta.folderSkillDisplayName || meta.folderSkillName,
            description: meta.folderSkillDescription || "",
        } } : {}),
    });
    if (sources.length) await restoreFolderPreviewSources(folderAssetPreviewKey(id), sources);
    return id;
}

/** 将文件夹资产落到画布为文件夹节点 */
export async function buildFolderNodeOpFromAsset(asset: FolderAsset, position: { x: number; y: number }) {
    const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const sources = await loadFolderPreviewSources(folderAssetPreviewKey(asset.id));
    const restoredSources = [...sources];
    for (const entry of asset.data.entries) {
        if (entry.kind !== "file" || !isFolderImageFileName(entry.name)) continue;
        const original = await folderImages.getItem<Blob>(folderImageKey(asset.id, entry.path));
        if (!original) continue;
        const old = restoredSources.findIndex((source) => source.path === entry.path);
        if (old >= 0) restoredSources.splice(old, 1);
        restoredSources.push({ path: entry.path, name: entry.name, data: await original.arrayBuffer() });
    }
    if (restoredSources.length) await restoreFolderPreviewSources(id, restoredSources);

    let storageMode = asset.data.storageMode;
    let localPath = asset.data.localPath || "";
    let dataPath = asset.data.dataPath || "";
    let totalBytes = asset.data.totalBytes || 0;

    if (!dataPath && localPath) {
        const { canvasDataDir } = useConfigStore.getState().config;
        const persist = await persistDroppedFolder({
            nodeId: id,
            folder: {
                folderName: asset.data.folderName,
                entries: asset.data.entries,
                truncated: asset.data.truncated,
                topLevelDirs: asset.data.topLevelDirs || [],
                previewCandidates: [],
                skill: asset.data.skill,
                totalBytes,
                localRootPath: localPath,
            },
            canvasDataDir: canvasDataDir || "",
        });
        storageMode = persist.mode;
        localPath = persist.localPath || localPath;
        dataPath = persist.dataPath || "";
        totalBytes = persist.totalBytes || totalBytes;
    }

    return buildAddFolderNodeOp({
        id,
        folderName: asset.data.folderName || asset.title,
        entries: asset.data.entries || [],
        truncated: asset.data.truncated,
        topLevelDirs: asset.data.topLevelDirs,
        skill: asset.data.skill,
        position,
        storageMode,
        localPath,
        dataPath,
        totalBytes,
    });
}
