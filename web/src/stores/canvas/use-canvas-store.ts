import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import {
    DEV_CANVAS_STORE_KEY,
    ensureDevLocalStore,
    getDevLocalKv,
    migrateCanvasStoreToDevLocalIfNeeded,
    setDevLocalKv,
} from "@/services/dev-local-store";
import { getImageBlobFromIndexedDb } from "@/services/image-storage";
import { getMediaBlobFromIndexedDb } from "@/services/file-storage";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { parseCanvasSnapshot, readCanvasIndexedDb, writeCanvasIndexedDb } from "@/services/canvas-persistence";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    hydrationError: boolean;
    storageError: string;
    savePending: boolean;
    retrySave: () => Promise<void>;
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let queuedPersistState: PersistedCanvasState | null = null;
let pendingWrite: (() => Promise<void>) | null = null;
let flushing: Promise<void> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let storageReady = false;
let explicitDelete = false;

function flushCanvasStorage(): Promise<void> {
    if (writeTimer !== null) clearTimeout(writeTimer);
    writeTimer = null;
    if (flushing) return flushing;
    if (!storageReady || !pendingWrite) return Promise.resolve();
    flushing = (async () => {
        while (pendingWrite && storageReady) {
            const write = pendingWrite;
            pendingWrite = null;
            try {
                await write();
            } catch (error) {
                pendingWrite ||= write;
                console.error("画布保存失败", error);
                useCanvasStore.setState({ storageError: error instanceof Error ? error.message : "画布保存失败，请保留页面并导出当前画布。", savePending: true });
                break;
            }
        }
    })().finally(() => {
        flushing = null;
        if (!pendingWrite) useCanvasStore.setState({ storageError: "", savePending: false });
    });
    return flushing;
}

if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", (event) => {
        if (!pendingWrite && !flushing) return;
        void flushCanvasStorage();
        event.preventDefault();
        event.returnValue = "";
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") void flushCanvasStorage();
    });
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        storageReady = false;
        const useDisk = await ensureDevLocalStore();
        let value: string | null = null;
        if (useDisk) {
            value = await migrateCanvasStoreToDevLocalIfNeeded({
                readIdbCanvasStore: readCanvasIndexedDb,
                readIdbBlob: async (key) => {
                    if (key.startsWith("image:")) return getImageBlobFromIndexedDb(key);
                    return getMediaBlobFromIndexedDb(key);
                },
            });
            if (!value) value = await getDevLocalKv(name === DEV_CANVAS_STORE_KEY ? DEV_CANVAS_STORE_KEY : name);
        } else {
            value = await readCanvasIndexedDb();
        }
        if (value === null) {
            storageReady = true;
            return null;
        }
        const parsed = parseCanvasSnapshot(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        storageReady = true;
        return parsed;
    },
    setItem: (name, value) => {
        if (!storageReady) return;
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        const allowEmpty = explicitDelete;
        explicitDelete = false;
        pendingWrite = async () => {
            const raw = JSON.stringify(value);
            if (await ensureDevLocalStore()) await setDevLocalKv(name, raw, allowEmpty);
            else await writeCanvasIndexedDb(raw, allowEmpty);
        };
        if (!useCanvasStore.getState().savePending) useCanvasStore.setState({ savePending: true });
        // 固定短窗口合并流式内容/连续操作，窗口不随编辑延长；内存与离页保护立即生效。
        if (!flushing && writeTimer === null) writeTimer = setTimeout(() => { void flushCanvasStorage(); }, 200);
    },
    removeItem: () => { throw new Error("禁止直接清空画布存储，请通过画布列表删除项目。"); },
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            hydrationError: false,
            storageError: "",
            savePending: false,
            retrySave: flushCanvasStorage,
            projects: [],
            createProject: (title = i18n.t("canvas.project.untitled")) => {
                if (!get().hydrated) throw new Error("画布尚未安全读取，不能创建项目。");
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                if (!get().hydrated) throw new Error("画布尚未安全读取，不能导入项目。");
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || i18n.t("canvas.project.imported"),
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) => set((state) => {
                const project = state.projects.find((item) => item.id === id);
                const nextTitle = title.trim();
                if (!state.hydrated || !project || !nextTitle || project.title === nextTitle) return state;
                return { projects: state.projects.map((item) => item === project ? { ...item, title: nextTitle, updatedAt: new Date().toISOString() } : item) };
            }),
            deleteProjects: (ids) => {
                explicitDelete = true;
                set((state) => {
                    if (!state.hydrated) return state;
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    if (projects.length === state.projects.length) return state;
                    return { projects };
                });
                explicitDelete = false;
            },
            replaceProjects: (projects) => {
                if (!get().hydrated) throw new Error("画布尚未安全读取，不能覆盖项目。");
                parseCanvasSnapshot(JSON.stringify({ state: { projects }, version: 0 }));
                set({ projects });
            },
            updateProject: (id, patch) => set((state) => {
                const project = state.projects.find((item) => item.id === id);
                if (!state.hydrated || !project) return state;
                const changed = (Object.keys(patch) as Array<keyof typeof patch>).some((key) => {
                    if (key === "viewport" && patch.viewport && project.viewport) {
                        return patch.viewport.x !== project.viewport.x || patch.viewport.y !== project.viewport.y || patch.viewport.k !== project.viewport.k;
                    }
                    return patch[key] !== project[key];
                });
                if (!changed) return state;
                return { projects: state.projects.map((item) => item === project ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item) };
            }),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                if (error) console.error("画布读取失败，已暂停保存以保护原始数据", error);
                useCanvasStore.setState({ hydrated: !error, hydrationError: Boolean(error), storageError: error instanceof Error ? error.message : "" });
            },
        },
    ),
);
