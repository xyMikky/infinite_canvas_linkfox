import type { AgentSkillSummary } from "@/services/api/canvas-agent";
import type { CodexSkillDragPayload } from "@/components/canvas/nodes/codex-skill-node";

type FileSystemEntryLike = {
    isFile: boolean;
    isDirectory: boolean;
    name: string;
    fullPath?: string;
    file?: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
    createReader?: () => {
        readEntries: (success: (entries: FileSystemEntryLike[]) => void, error?: (error: DOMException) => void) => void;
    };
};

export type ParsedSkillBundle = {
    folderName: string;
    skillMdText: string;
    name: string;
    description: string;
    instructions: string;
    displayName: string;
};

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type CapturedSkillDrop = {
    /** drop 同步阶段立刻取出的 FileSystemEntry（异步后再读 DataTransfer 会失效） */
    entries: FileSystemEntryLike[];
    /** 同步拷贝的 FileList */
    files: File[];
};

/** 必须在 drop 事件同步回调内调用，否则浏览器会清空 DataTransfer */
export function captureSkillDropPayload(dataTransfer: DataTransfer): CapturedSkillDrop {
    return {
        entries: getDataTransferEntries(dataTransfer),
        files: Array.from(dataTransfer.files || []),
    };
}

/** @deprecated 使用 captureSkillDropPayload；保留别名避免调用方漂移 */
export const captureSkillDropSnapshot = captureSkillDropPayload;

/** 从资源管理器拖入的「整个 Skill 文件夹」或 SKILL.md 解析出可入库内容 */
export async function collectDroppedSkillBundles(payload: CapturedSkillDrop | DataTransfer): Promise<ParsedSkillBundle[]> {
    const captured: CapturedSkillDrop = "entries" in payload && Array.isArray(payload.entries)
        ? payload
        : captureSkillDropPayload(payload as DataTransfer);
    const { entries, files } = captured;
    const bundles: ParsedSkillBundle[] = [];

    if (entries.length) {
        for (const entry of entries) {
            if (entry.isDirectory) {
                const dirFiles = await readDirectoryFiles(entry);
                const skillMd = findSkillMdFile(dirFiles);
                if (!skillMd) continue;
                const text = await skillMd.file.text().catch(() => "");
                const parsed = parseSkillMarkdown(text, entry.name);
                if (parsed) bundles.push(parsed);
                continue;
            }
            if (entry.isFile && /^skill\.md$/i.test(entry.name)) {
                const file = await readEntryFile(entry);
                if (!file) continue;
                const text = await file.text().catch(() => "");
                const folderHint = guessFolderFromRelativePath(file.webkitRelativePath) || stripMdName(entry.name);
                const parsed = parseSkillMarkdown(text, folderHint);
                if (parsed) bundles.push(parsed);
            }
        }
        if (bundles.length) return bundles;
    }

    // 回退：仅有 FileList（无 directory entry）时，按文件列表拼装
    if (!files.length) return [];

    const byRoot = new Map<string, File[]>();
    for (const file of files) {
        const parts = (file.webkitRelativePath || file.name).split(/[/\\]/).filter(Boolean);
        const root = parts.length > 1 ? parts[0] : "__root__";
        const list = byRoot.get(root) || [];
        list.push(file);
        byRoot.set(root, list);
    }
    for (const [root, group] of byRoot) {
        const skillMd = group.find((file) => /^skill\.md$/i.test(file.name));
        if (!skillMd) continue;
        const text = await skillMd.text().catch(() => "");
        const parsed = parseSkillMarkdown(text, root === "__root__" ? "" : root);
        if (parsed) bundles.push(parsed);
    }
    return bundles;
}

export function matchParsedSkillToInstalled(bundle: ParsedSkillBundle, skills: AgentSkillSummary[]): CodexSkillDragPayload {
    const matched = skills.find((skill) => skill.name === bundle.name);
    if (matched) {
        return {
            name: matched.name,
            path: matched.path,
            displayName: matched.interface?.displayName || matched.name,
            description: matched.interface?.shortDescription || matched.shortDescription || matched.description || "",
            enabled: matched.enabled,
        };
    }
    return {
        name: bundle.name,
        path: bundle.name,
        displayName: bundle.displayName,
        description: bundle.description,
        enabled: true,
    };
}

export function parseSkillMarkdown(raw: string, folderName = ""): ParsedSkillBundle | null {
    const text = raw.replace(/^\uFEFF/, "");
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    const front = fm?.[1] || "";
    const body = (fm?.[2] ?? text).trim();
    const nameFromFm = readYamlString(front, "name");
    const folder = folderName.trim();
    const name = (nameFromFm && SKILL_NAME_RE.test(nameFromFm) ? nameFromFm : "")
        || (SKILL_NAME_RE.test(folder) ? folder : "");
    if (!name) return null;
    const description = readYamlString(front, "description")
        || readYamlBlock(front, "description")
        || `${name} skill`;
    const displayName = readYamlString(front, "title")
        || readYamlString(front, "displayName")
        || name;
    return {
        folderName: folder || name,
        skillMdText: text,
        name,
        description: description.slice(0, 1024),
        instructions: body || description,
        displayName,
    };
}

function getDataTransferEntries(dataTransfer: DataTransfer): FileSystemEntryLike[] {
    const items = dataTransfer.items;
    if (!items?.length) return [];
    const entries: FileSystemEntryLike[] = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }).webkitGetAsEntry?.();
        if (entry) entries.push(entry);
    }
    return entries;
}

async function readDirectoryFiles(root: FileSystemEntryLike, prefix = ""): Promise<Array<{ path: string; file: File }>> {
    if (!root.isDirectory || !root.createReader) return [];
    const reader = root.createReader();
    const children: FileSystemEntryLike[] = [];
    // readEntries 可能分批返回，需循环读到空数组
    for (;;) {
        const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
            reader.readEntries(resolve, reject);
        });
        if (!batch.length) break;
        children.push(...batch);
    }
    const out: Array<{ path: string; file: File }> = [];
    for (const child of children) {
        const path = prefix ? `${prefix}/${child.name}` : child.name;
        if (child.isFile) {
            const file = await readEntryFile(child);
            if (file) out.push({ path, file });
        } else if (child.isDirectory) {
            out.push(...(await readDirectoryFiles(child, path)));
        }
    }
    return out;
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

function findSkillMdFile(files: Array<{ path: string; file: File }>) {
    const exact = files.find((item) => /(^|\/)skill\.md$/i.test(item.path.replace(/\\/g, "/")));
    if (exact) return exact;
    return files.find((item) => /^skill\.md$/i.test(item.file.name)) || null;
}

function guessFolderFromRelativePath(relativePath?: string) {
    const parts = (relativePath || "").split(/[/\\]/).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 2] : "";
}

function stripMdName(name: string) {
    return name.replace(/\.md$/i, "");
}

function readYamlString(front: string, key: string) {
    const match = front.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"));
    if (!match) return "";
    return match[1].trim().replace(/^["']|["']$/g, "");
}

function readYamlBlock(front: string, key: string) {
    const match = front.match(new RegExp(`^${key}:\\s*[>|]\\s*\\n((?:\\s{2,}.+\\n?)+)`, "mi"));
    if (!match) return "";
    return match[1]
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s{2,}/, "").trim())
        .filter(Boolean)
        .join(" ")
        .trim();
}
