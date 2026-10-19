import type { DroppedFolderBundle } from "@/lib/canvas/folder-drop";

export type FolderPersistResult = {
    mode: "copy" | "reference";
    localPath: string;
    dataPath: string;
    totalBytes: number;
    copied: boolean;
};

function joinPath(...parts: string[]) {
    const raw = parts.filter(Boolean).join("/").replace(/\\/g, "/");
    const isWin = /^[A-Za-z]:/.test(raw) || raw.startsWith("//");
    const normalized = raw.replace(/\/+/g, "/");
    if (isWin && /^[A-Za-z]:\//.test(normalized)) {
        return normalized.replace(/\//g, "\\");
    }
    return normalized;
}

/** 提供 maxBytes 时按上限决定是否复制；资产文件夹不设大小上限。 */
export async function persistDroppedFolder(input: {
    nodeId: string;
    folder: DroppedFolderBundle;
    canvasDataDir: string;
    maxBytes?: number;
}): Promise<FolderPersistResult> {
    let totalBytes = input.folder.totalBytes || 0;
    const localPath = (input.folder.localRootPath || "").trim();
    const desktop = window.desktopAPI;
    const truncated = Boolean(input.folder.truncated);

    // 拖入遍历会在约 500 条后截断，totalBytes 可能远小于真实体积；桌面端用本机目录实测再决定是否复制
    if (desktop?.isDesktop && localPath) {
        try {
            const sized = await desktop.getDirectorySize(localPath, input.maxBytes);
            if (sized > 0) totalBytes = sized;
            else if (truncated && input.maxBytes !== undefined) {
                // 截断且测不到体积：宁可只引用，避免把超大目录整夹复制进数据目录
                return { mode: "reference", localPath, dataPath: "", totalBytes, copied: false };
            }
        } catch {
            if (truncated && input.maxBytes !== undefined) return { mode: "reference", localPath, dataPath: "", totalBytes, copied: false };
        }
    }

    if (input.maxBytes !== undefined && totalBytes > input.maxBytes) {
        return { mode: "reference", localPath, dataPath: "", totalBytes, copied: false };
    }

    if (!desktop?.isDesktop || !localPath) {
        // 浏览器或拿不到绝对路径：仍按「可缓存」处理，由调用方 stash IndexedDB
        return { mode: "copy", localPath, dataPath: "", totalBytes, copied: false };
    }

    let dataRoot = (input.canvasDataDir || "").trim();
    if (!dataRoot) {
        dataRoot = (await desktop.getDefaultCanvasDataDir()) || "";
    }
    if (!dataRoot) {
        return { mode: "copy", localPath, dataPath: "", totalBytes, copied: false };
    }

    const dataPath = joinPath(dataRoot, "folders", input.nodeId);
    const result = await desktop.copyDirectory(localPath, dataPath);
    if (!result.ok) {
        return { mode: "reference", localPath, dataPath: "", totalBytes, copied: false };
    }
    return { mode: "copy", localPath, dataPath, totalBytes, copied: true };
}

export function folderCopyLimitBytes(maxMb: number) {
    const mb = Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 500;
    return Math.floor(mb * 1024 * 1024);
}

/** 单文件拖入：永不 copyDirectory（localRoot 是父目录），仅引用本机路径 + IndexedDB 缓存。 */
export function persistDroppedLooseFile(folder: DroppedFolderBundle): FolderPersistResult {
    const totalBytes = folder.totalBytes || 0;
    const localPath = (folder.localRootPath || "").trim();
    return {
        mode: localPath ? "reference" : "copy",
        localPath,
        dataPath: "",
        totalBytes,
        copied: false,
    };
}
