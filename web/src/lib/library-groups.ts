import i18n from "@/i18n";
import type { RawPrompt } from "@/services/api/prompt-source-runtime";

export type LibraryScope = "assets" | "prompts";
export type LibraryGroup = { id: string; name: string };
export type LibraryGroups = { groups: LibraryGroup[]; members: Record<string, string> };
export type LibraryGroupData = Record<LibraryScope, LibraryGroups>;
export type LibraryGroupAction =
    | { type: "create" | "rename"; id: string; name: string }
    | { type: "remove"; id: string }
    | { type: "move"; keys: string[]; groupId: string };

export const ALL_LIBRARY_GROUPS = "all";
export function emptyLibraryGroups(): LibraryGroupData {
    return { assets: { groups: [], members: {} }, prompts: { groups: [], members: {} } };
}

export function promptGroupKey(item: { sourceId: string; id: string } & Partial<RawPrompt>) {
    // 来源缺少 ID 时解析器使用 source-0001 这样的序号，分类不能跟随它的数组位置。
    const prefix = `${item.sourceId}-`;
    const numbered = item.sourceId !== "local" && item.id.startsWith(prefix) && /^\d{4,}$/.test(item.id.slice(prefix.length));
    return JSON.stringify(numbered ? [item.sourceId, "content", item.title || "", item.prompt || "", item.description || "", item.coverUrl || "", item.referenceImageUrls || [], item.tags || [], item.preview || "", item.author || "", item.sourceUrl || "", item.imageMode || "", item.imageModel || "", item.imageSize || "", item.imageCount || 0] : [item.sourceId, item.id]);
}

export function matchesLibraryGroup(library: LibraryGroups, key: string, groupId: string) {
    return groupId === ALL_LIBRARY_GROUPS || (library.members[key] || "") === groupId;
}

export function readLibraryGroups(value: unknown): LibraryGroupData {
    if (value === null) return emptyLibraryGroups();
    const data = value as LibraryGroupData;
    for (const scope of ["assets", "prompts"] as const) {
        const library = data?.[scope];
        if (!Array.isArray(library?.groups) || !library.members || typeof library.members !== "object" || Array.isArray(library.members)) throw new Error(i18n.t("libraryGroups.readFailed"));
        const ids = new Set<string>();
        for (const group of library.groups) {
            if (!group || typeof group.id !== "string" || !group.id || group.id === ALL_LIBRARY_GROUPS || ids.has(group.id) || typeof group.name !== "string" || !group.name.trim() || group.name.length > 80) throw new Error(i18n.t("libraryGroups.readFailed"));
            ids.add(group.id);
        }
        if (Object.values(library.members).some((id) => typeof id !== "string" || !ids.has(id))) throw new Error(i18n.t("libraryGroups.readFailed"));
    }
    return data;
}

export function applyLibraryGroupAction(data: LibraryGroupData, scope: LibraryScope, action: LibraryGroupAction): LibraryGroupData {
    const library = data[scope];
    let { groups, members } = library;
    if (action.type === "create" || action.type === "rename") {
        const name = action.name.trim();
        if (!name || name.length > 80) throw new Error(i18n.t("libraryGroups.nameRequired"));
        if (action.type === "rename" && !groups.some((group) => group.id === action.id)) throw new Error(i18n.t("libraryGroups.missing"));
        if (groups.some((group) => group.id !== action.id && group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error(i18n.t("libraryGroups.duplicate"));
        groups = action.type === "create" ? [...groups, { id: action.id, name }] : groups.map((group) => group.id === action.id ? { ...group, name } : group);
    } else if (action.type === "remove") {
        groups = groups.filter((group) => group.id !== action.id);
        members = Object.fromEntries(Object.entries(members).filter(([, id]) => id !== action.id));
    } else {
        if (action.groupId && !groups.some((group) => group.id === action.groupId)) throw new Error(i18n.t("libraryGroups.missing"));
        members = { ...members };
        for (const key of action.keys) {
            if (action.groupId) members[key] = action.groupId;
            else delete members[key];
        }
    }
    return { ...data, [scope]: { groups, members } };
}
