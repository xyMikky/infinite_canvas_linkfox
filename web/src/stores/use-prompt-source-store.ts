import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

import { createPromptSource, type PromptSource } from "@/services/api/prompt-source-presets";

export type PromptSourceSchedule = {
    intervalMinutes: number;
    lastFetchedAt: string;
};

const PROMPT_SOURCE_STORE_KEY = "infinite-canvas:prompt_source_store_v2";

const defaultSchedule: PromptSourceSchedule = {
    intervalMinutes: 0,
    lastFetchedAt: "",
};

export const PROMPT_SOURCE_INTERVALS = [0, 30, 60, 360, 1440];

type PromptSourceStore = {
    sources: PromptSource[];
    schedule: PromptSourceSchedule;
    addSource: () => PromptSource;
    saveSource: (source: PromptSource) => void;
    removeSource: (id: string) => void;
    clearSources: () => void;
    toggleSource: (id: string, enabled: boolean) => void;
    updateSchedule: <K extends keyof PromptSourceSchedule>(key: K, value: PromptSourceSchedule[K]) => void;
};

/** 预置来源已彻底移除：历史数据里带 builtIn 标记的条目一律丢弃，只保留用户自建来源 */
export function sanitizePromptSources(value: unknown): PromptSource[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item) => item && typeof item === "object" && !(item as { builtIn?: boolean }).builtIn)
        .map((item) => createPromptSource(item as Partial<PromptSource>));
}

/** hydrate 完成前禁止写入，避免覆盖用户已保存的空列表 */
let canWritePersist = false;

const promptSourceStorage: StateStorage = {
    getItem: (name) => localStorage.getItem(name),
    setItem: (name, value) => {
        if (!canWritePersist) return;
        localStorage.setItem(name, value);
    },
    removeItem: (name) => localStorage.removeItem(name),
};

export const usePromptSourceStore = create<PromptSourceStore>()(
    persist(
        (set) => ({
            sources: [],
            schedule: defaultSchedule,
            addSource: () => createPromptSource(),
            saveSource: (source) =>
                set((state) => ({
                    sources: state.sources.some((item) => item.id === source.id)
                        ? state.sources.map((item) => (item.id === source.id ? createPromptSource(source) : item))
                        : [...state.sources, createPromptSource(source)],
                })),
            removeSource: (id) => set((state) => ({ sources: state.sources.filter((item) => item.id !== id) })),
            clearSources: () => set({ sources: [] }),
            toggleSource: (id, enabled) => set((state) => ({ sources: state.sources.map((item) => (item.id === id ? { ...item, enabled } : item)) })),
            updateSchedule: (key, value) => set((state) => ({ schedule: { ...state.schedule, [key]: value } })),
        }),
        {
            name: PROMPT_SOURCE_STORE_KEY,
            storage: createJSONStorage(() => promptSourceStorage),
            partialize: (state) => ({ sources: state.sources, schedule: state.schedule }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<PromptSourceStore>;
                const schedule = { ...defaultSchedule, ...(persistedState.schedule || {}) };
                // 首次安装与用户清空均为空列表；历史遗留的内置来源在此被清掉
                const sources = sanitizePromptSources(persistedState.sources);
                return { ...current, sources, schedule };
            },
            onRehydrateStorage: () => (state) => {
                canWritePersist = true;
                if (!state) return;
                queueMicrotask(() => {
                    usePromptSourceStore.setState({
                        sources: state.sources,
                        schedule: state.schedule,
                    });
                });
            },
        },
    ),
);
