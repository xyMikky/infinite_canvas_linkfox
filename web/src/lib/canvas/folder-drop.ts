import type { CanvasFolderEntry } from "@/types/canvas";
import { captureSkillDropPayload, parseSkillMarkdown, type CapturedSkillDrop } from "@/lib/canvas/codex-skill-drop";
import { fileLocalPath, inferLocalRootPath } from "@/lib/canvas/folder-disk-path";
import { isFolderSourceFileName } from "@/lib/canvas/folder-preview-cache";

export type CapturedDropSnapshot = CapturedSkillDrop;

export type FolderSkillSummary = {
    name: string;
    displayName: string;
    description: string;
};

export type DroppedFolderBundle = {
    folderName: string;
    entries: CanvasFolderEntry[];
    truncated: boolean;
    totalBytes: number;
    localRootPath: string;
    topLevelDirs: string[];
    previewCandidates: Array<{ path: string; file: File }>;
    skill?: FolderSkillSummary;
};

const MAX_DEPTH = 6;
const MAX_ENTRIES = 500;

type FileSystemEntryLike = {
    isFile: boolean;
    isDirectory: boolean;
    name: string;
    file?: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
    createReader?: () => {
        readEntries: (success: (entries: FileSystemEntryLike[]) => void, error?: (error: DOMException) => void) => void;
    };
};

/** 必须在 drop 同步阶段调用 */
export function captureDropSnapshot(dataTransfer: DataTransfer): CapturedDropSnapshot {
    return captureSkillDropPayload(dataTransfer);
}

/** 从资源管理器拖入的目录 → 相对路径文件树快照（不读文件正文） */
export async function collectDroppedFolders(snapshot: CapturedDropSnapshot): Promise<DroppedFolderBundle[]> {
    const bundles: DroppedFolderBundle[] = [];
    const { entries, files } = snapshot;

    if (entries.length) {
        for (const entry of entries) {
            if (!entry.isDirectory) continue;
            const built = await buildFolderTree(entry as FileSystemEntryLike, entry.name);
            bundles.push(built);
        }
        if (bundles.length) return bundles;
    }

    // 回退：仅有 FileList 且带 webkitRelativePath（部分环境）
    if (!files.length) return [];
    const byRoot = new Map<string, File[]>();
    for (const file of files) {
        const rel = file.webkitRelativePath || "";
        if (!rel.includes("/")) continue;
        const root = rel.split(/[/\\]/).filter(Boolean)[0];
        if (!root) continue;
        const list = byRoot.get(root) || [];
        list.push(file);
        byRoot.set(root, list);
    }
    for (const [root, group] of byRoot) {
        bundles.push(await entriesFromFileList(root, group));
    }
    return bundles;
}

export async function collectDroppedLooseFiles(
    snapshot: CapturedDropSnapshot,
    options: { exclude?: (file: File) => boolean } = {},
): Promise<DroppedFolderBundle[]> {
    const files = snapshot.files.filter((file) => {
        if ((file.webkitRelativePath || "").includes("/")) return false;
        return !options.exclude?.(file);
    });
    return Promise.all(files.map(async (file) => {
        const skill = await skillSummaryFromFile(file, file.name.replace(/\.md$/i, ""));
        return {
            folderName: file.name,
            entries: [{ path: file.name, name: file.name, kind: "file", size: file.size }],
            truncated: false,
            totalBytes: file.size,
            localRootPath: fileLocalPath(file),
            topLevelDirs: [],
            previewCandidates: isFolderSourceFileName(file.name) ? [{ path: file.name, file }] : [],
            ...(skill ? { skill } : {}),
        };
    }));
}

export async function bundleFromDirectoryFileList(files: File[]): Promise<DroppedFolderBundle | null> {
    if (!files.length) return null;
    const firstPath = (files[0].webkitRelativePath || files[0].name).replace(/\\/g, "/");
    const folderName = firstPath.split("/").filter(Boolean)[0] || "folder";
    return entriesFromFileList(folderName, files);
}

async function buildFolderTree(root: FileSystemEntryLike, folderName: string): Promise<DroppedFolderBundle> {
    const entries: CanvasFolderEntry[] = [];
    const previewCandidates: Array<{ path: string; file: File }> = [];
    let truncated = false;
    let totalBytes = 0;
    let localRootPath = "";
    let skill: FolderSkillSummary | undefined;

    const walk = async (dir: FileSystemEntryLike, prefix: string, depth: number) => {
        if (truncated) return;
        if (depth > MAX_DEPTH) {
            truncated = true;
            return;
        }
        if (!dir.isDirectory || !dir.createReader) return;
        const reader = dir.createReader();
        // 分批处理并尽早停止，避免大目录一次读全量阻塞 UI。
        for (;;) {
            if (truncated || entries.length >= MAX_ENTRIES) {
                truncated = true;
                return;
            }
            const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
                reader.readEntries(resolve, reject);
            });
            if (!batch.length) break;
            const children = [...batch].sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            for (const child of children) {
                if (entries.length >= MAX_ENTRIES) {
                    truncated = true;
                    return;
                }
                const childPath = prefix ? `${prefix}/${child.name}` : child.name;
                if (child.isDirectory) {
                    entries.push({ path: childPath, name: child.name, kind: "directory" });
                    await walk(child, childPath, depth + 1);
                    if (truncated) return;
                    continue;
                }
                if (!child.isFile) continue;
                const file = await readEntryFile(child);
                entries.push({ path: childPath, name: child.name, kind: "file", size: file?.size });
                if (!file) continue;
                totalBytes += file.size;
                if (!localRootPath) localRootPath = inferLocalRootPath(folderName, file);
                if (isFolderSourceFileName(child.name)) previewCandidates.push({ path: childPath, file });
                // 仅根目录 SKILL.md 认定为本文件夹 Skill；嵌套（如 .agents/skills/kling-cli）不得盖掉项目文件夹名
                if (!prefix) {
                    const parsed = await skillSummaryFromFile(file, folderName);
                    if (parsed) skill = parsed;
                }
            }
        }
    };

    await walk(root, "", 0);
    return {
        folderName,
        entries,
        truncated,
        totalBytes,
        localRootPath,
        topLevelDirs: entries.filter((entry) => entry.kind === "directory" && !entry.path.includes("/")).map((entry) => entry.name),
        previewCandidates,
        ...(skill ? { skill } : {}),
    };
}

async function entriesFromFileList(folderName: string, files: File[]): Promise<DroppedFolderBundle> {
    const seenDirs = new Set<string>();
    const entries: CanvasFolderEntry[] = [];
    let truncated = false;
    const sorted = [...files].sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
    for (const file of sorted) {
        if (entries.length >= MAX_ENTRIES) {
            truncated = true;
            break;
        }
        const rel = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
        const parts = rel.split("/").filter(Boolean);
        // 去掉根目录名
        const relativeParts = parts[0] === folderName ? parts.slice(1) : parts;
        if (!relativeParts.length) continue;
        for (let i = 0; i < relativeParts.length - 1; i++) {
            const dirPath = relativeParts.slice(0, i + 1).join("/");
            if (seenDirs.has(dirPath)) continue;
            if (dirPath.split("/").length > MAX_DEPTH) {
                truncated = true;
                continue;
            }
            seenDirs.add(dirPath);
            if (entries.length >= MAX_ENTRIES) {
                truncated = true;
                break;
            }
            entries.push({ path: dirPath, name: relativeParts[i], kind: "directory" });
        }
        if (truncated && entries.length >= MAX_ENTRIES) break;
        if (relativeParts.length > MAX_DEPTH) {
            truncated = true;
            continue;
        }
        const path = relativeParts.join("/");
        entries.push({
            path,
            name: relativeParts[relativeParts.length - 1],
            kind: "file",
            size: file.size,
        });
    }
    entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
        return a.path.localeCompare(b.path);
    });
    const skillFile = sorted.find((file) => {
        if (!/^skill\.md$/i.test(file.name)) return false;
        const rel = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
        const parts = rel.split("/").filter(Boolean);
        const relativeParts = parts[0] === folderName ? parts.slice(1) : parts;
        return relativeParts.length === 1;
    });
    const skill = skillFile ? await skillSummaryFromFile(skillFile, folderName) : undefined;
    return {
        folderName,
        entries,
        truncated,
        totalBytes: sorted.reduce((total, file) => total + file.size, 0),
        localRootPath: inferLocalRootPath(folderName, sorted[0]),
        topLevelDirs: entries.filter((entry) => entry.kind === "directory" && !entry.path.includes("/")).map((entry) => entry.name),
        previewCandidates: sorted
            .filter((file) => isFolderSourceFileName(file.name))
            .map((file) => ({
                path: (file.webkitRelativePath || file.name).replace(/\\/g, "/").split("/").slice(1).join("/") || file.name,
                file,
            })),
        ...(skill ? { skill } : {}),
    };
}

async function skillSummaryFromFile(file: File, folderName: string) {
    if (!/^skill\.md$/i.test(file.name)) return undefined;
    const parsed = parseSkillMarkdown(await file.text().catch(() => ""), folderName);
    return parsed
        ? { name: parsed.name, displayName: parsed.displayName, description: parsed.description }
        : undefined;
}

function readEntryFile(entry: FileSystemEntryLike) {
    if (!entry.isFile || !entry.file) return Promise.resolve<File | null>(null);
    return new Promise<File | null>((resolve) => {
        entry.file?.(
            (file) => resolve(file),
            () => resolve(null),
        );
    });
}
