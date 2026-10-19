import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

/** Electron 拖入文件的绝对路径；新版 Electron 无 File.path，须经 preload 的 webUtils。浏览器环境为空。 */
export function fileLocalPath(file: File) {
    try {
        const viaDesktop = window.desktopAPI?.getPathForFile?.(file);
        if (typeof viaDesktop === "string" && viaDesktop.trim()) return viaDesktop.trim();
    } catch {
        /* 非桌面环境 */
    }
    const path = (file as File & { path?: string }).path;
    return typeof path === "string" && path.trim() ? path.trim() : "";
}

/** 由文件绝对路径 + webkitRelativePath 反推文件夹根路径 */
export function inferLocalRootPath(folderName: string, file: File) {
    const abs = fileLocalPath(file).replace(/\\/g, "/");
    if (!abs) return "";
    const rel = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
    const parts = rel.split("/").filter(Boolean);
    if (parts[0] === folderName && parts.length > 1) {
        const suffix = parts.join("/");
        if (abs.endsWith(suffix)) {
            const root = abs.slice(0, abs.length - suffix.length).replace(/\/$/, "");
            return root.endsWith(`/${folderName}`) ? root : `${root}/${folderName}`.replace(/\/+/g, "/");
        }
        const idx = abs.lastIndexOf(`/${folderName}/`);
        if (idx >= 0) return abs.slice(0, idx + folderName.length + 1).replace(/\/$/, "");
        if (abs.endsWith(`/${folderName}`)) return abs;
    }
    const idx = abs.lastIndexOf(`/${folderName}/`);
    if (idx >= 0) return abs.slice(0, idx + folderName.length + 1).replace(/\/$/, "");
    if (abs.endsWith(`/${folderName}`)) return abs;
    const parent = abs.includes("/") ? abs.slice(0, abs.lastIndexOf("/")) : "";
    if (parent.endsWith(`/${folderName}`)) return parent;
    return "";
}

/** 从拖入 FileList 批量反推各根目录的绝对路径（Electron 拖文件夹时 dataTransfer.files 更可靠）。 */
export function inferLocalRootPathsFromFiles(files: File[]) {
    const roots = new Map<string, string>();
    for (const file of files) {
        const rel = (file.webkitRelativePath || "").replace(/\\/g, "/");
        if (!rel.includes("/")) continue;
        const root = rel.split("/").filter(Boolean)[0];
        if (!root || roots.has(root)) continue;
        const resolved = inferLocalRootPath(root, file);
        if (resolved) roots.set(root, resolved);
    }
    return roots;
}

/** 读取文件夹节点对应的磁盘根路径：优先原始本机路径，其次复制到数据目录的路径。 */
export function resolveFolderDiskPath(metadata?: Pick<CanvasNodeMetadata, "folderLocalPath" | "folderDataPath"> | null) {
    if (!metadata) return "";
    return String(metadata.folderLocalPath || metadata.folderDataPath || "").trim();
}

export function resolveFolderDiskPathFromNode(node?: Pick<CanvasNodeData, "metadata"> | null) {
    return resolveFolderDiskPath(node?.metadata);
}

/** 拼出 SKILL.md 绝对路径（若传入的是目录）。 */
export function resolveSkillMdPath(diskPath: string) {
    const trimmed = diskPath.trim().replace(/[/\\]+$/, "");
    if (!trimmed) return "";
    if (/skill\.md$/i.test(trimmed)) return trimmed;
    const sep = trimmed.includes("\\") ? "\\" : "/";
    return `${trimmed}${sep}SKILL.md`;
}

/** 给 Codex / 生图上下文用的文件夹说明：强调绝对路径，避免按逻辑名在工作区根目录搜索。 */
export function folderDiskPathPromptBlock(input: {
    folderName: string;
    diskPath?: string;
    entryCount?: number;
    truncated?: boolean;
    topLevelDirs?: string[];
    skillDescription?: string;
    fileList?: string;
    extra?: string;
}) {
    const name = input.folderName.trim() || "文件夹";
    const diskPath = (input.diskPath || "").trim();
    const count = input.entryCount ?? 0;
    const lines = [`【画布文件夹：${name}${count ? `（节点内快照 ${count} 项` : ""}${input.truncated ? "，已截断" : ""}${count ? "）" : ""}】`];
    if (input.truncated) {
        lines.push("注意：拖入时仅缓存了前 500 条目录项供界面展示；下方「一级子目录」或绝对路径才是完整清单。");
    }
    if (input.skillDescription?.trim()) lines.push(`说明：${input.skillDescription.trim()}`);
    if (diskPath) {
        lines.push(`本地绝对路径：${diskPath}`);
        lines.push("请直接读取该绝对路径下的文件（含子目录）；不要把文件夹名当成工作区根目录下的相对路径去搜索。");
        if (input.truncated || (input.topLevelDirs?.length ?? 0) > 0) {
            lines.push("桌面版发送消息时会预读各子 Skill 的 SKILL.md 摘要注入下文；Codex 工作区沙箱通常无法直接访问工作区外绝对路径，请勿仅凭目录名声称「无正文」。");
        }
        if (input.truncated) {
            lines.push("因节点内清单已截断，深入某一 Skill 时读取对应子目录下的 SKILL.md 与 references/。");
        }
        if (/skill\.md$/i.test(diskPath) || input.skillDescription) {
            lines.push(`SKILL 入口：${resolveSkillMdPath(diskPath)}`);
        }
    } else {
        lines.push("（未记录本机绝对路径：请使用下方文件列表或节点内已注入的正文，不要臆测磁盘路径。）");
        if (input.truncated) lines.push("（且无磁盘路径时，截断后未入库的部分 Codex 无法访问，请改用桌面版拖入或只拖单个 Skill 文件夹。）");
    }
    const topLevel = (input.topLevelDirs || []).filter(Boolean);
    if (topLevel.length) {
        lines.push(`一级子目录（共 ${topLevel.length} 个）：\n${topLevel.map((dir) => `- ${dir}`).join("\n")}`);
    }
    if (input.fileList?.trim()) lines.push(input.fileList.trim());
    if (input.extra?.trim()) lines.push(input.extra.trim());
    return lines.join("\n");
}
