import { create } from "zustand";
import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { ALL_LIBRARY_GROUPS, applyLibraryGroupAction, emptyLibraryGroups, readLibraryGroups, type LibraryGroupAction, type LibraryGroupData, type LibraryScope } from "@/lib/library-groups";
import { canvasDatabase, updateCanvasRecord } from "@/services/canvas-indexeddb";

const STORAGE_KEY = "infinite-canvas:library_groups";
type LibraryGroupStore = {
    data: LibraryGroupData;
    selected: Record<LibraryScope, string>;
    hydrated: boolean;
    loading: boolean;
    pending: number;
    revision: number;
    error: string;
    hydrate: () => Promise<void>;
    select: (scope: LibraryScope, id: string) => void;
    createGroup: (scope: LibraryScope, name: string) => Promise<string>;
    renameGroup: (scope: LibraryScope, id: string, name: string) => Promise<void>;
    removeGroup: (scope: LibraryScope, id: string) => Promise<void>;
    moveItems: (scope: LibraryScope, keys: string[], groupId: string) => Promise<void>;
};

export const useLibraryGroupStore = create<LibraryGroupStore>((set, get) => {
    // 每次操作在同一事务里读取最新分类再修改，避免旧窗口覆盖另一个窗口的分组。
    const commit = async (scope: LibraryScope, action: LibraryGroupAction) => {
        if (!get().hydrated) throw new Error(i18n.t("libraryGroups.readFailed"));
        set((state) => ({ pending: state.pending + 1 }));
        try {
            const data = await updateCanvasRecord<LibraryGroupData>(STORAGE_KEY, (current) => applyLibraryGroupAction(readLibraryGroups(current), scope, action));
            set((state) => ({
                data,
                revision: state.revision + 1,
                selected: Object.fromEntries(Object.entries(state.selected).map(([key, id]) => [key, id === ALL_LIBRARY_GROUPS || data[key as LibraryScope].groups.some((group) => group.id === id) ? id : ""])) as Record<LibraryScope, string>,
            }));
        } finally {
            set((state) => ({ pending: state.pending - 1 }));
        }
    };
    return {
        data: emptyLibraryGroups(),
        selected: { assets: ALL_LIBRARY_GROUPS, prompts: ALL_LIBRARY_GROUPS },
        hydrated: false,
        loading: false,
        pending: 0,
        revision: 0,
        error: "",
        hydrate: async () => {
            if (get().hydrated || get().loading) return;
            set({ loading: true, error: "" });
            try {
                const data = readLibraryGroups(await canvasDatabase.getItem(STORAGE_KEY));
                set((state) => ({ data, hydrated: true, revision: state.revision + 1 }));
            } catch {
                set({ error: i18n.t("libraryGroups.readFailed") });
            } finally {
                set({ loading: false });
            }
        },
        select: (scope, id) => set((state) => ({ selected: { ...state.selected, [scope]: id } })),
        createGroup: async (scope, name) => {
            const id = `group_${nanoid()}`;
            await commit(scope, { type: "create", id, name });
            return id;
        },
        renameGroup: (scope, id, name) => commit(scope, { type: "rename", id, name }),
        removeGroup: (scope, id) => commit(scope, { type: "remove", id }),
        moveItems: (scope, keys, groupId) => commit(scope, { type: "move", keys, groupId }),
    };
});
