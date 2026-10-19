import { create } from "zustand";

import type { ReferenceImage } from "@/types/image";

export type GeneratedImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
};

export type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    image?: GeneratedImage;
    error?: string;
    taskIndex?: number;
    taskLabel?: string;
    references?: ReferenceImage[];
};

type Updater<T> = T | ((value: T) => T);

function resolveUpdater<T>(value: Updater<T>, previous: T): T {
    return typeof value === "function" ? (value as (input: T) => T)(previous) : value;
}

/** 生图工作台的会话状态：放全局 store，切换路由后进行中的任务与结果不丢失 */
type ImageWorkbenchStore = {
    prompt: string;
    references: ReferenceImage[];
    results: GenerationResult[];
    running: boolean;
    startedAt: number;
    previewLogId: string;
    /** null 表示不限制同时进行的批量任务数。 */
    concurrency: number | null;
    setPrompt: (value: string) => void;
    setReferences: (value: Updater<ReferenceImage[]>) => void;
    setResults: (value: Updater<GenerationResult[]>) => void;
    setRunning: (value: boolean) => void;
    setStartedAt: (value: number) => void;
    setPreviewLogId: (value: string) => void;
    setConcurrency: (value: number | null) => void;
};

export const useImageWorkbenchStore = create<ImageWorkbenchStore>((set) => ({
    prompt: "",
    references: [],
    results: [],
    running: false,
    startedAt: 0,
    previewLogId: "",
    concurrency: null,
    setPrompt: (prompt) => set({ prompt }),
    setReferences: (value) => set((state) => ({ references: resolveUpdater(value, state.references) })),
    setResults: (value) => set((state) => ({ results: resolveUpdater(value, state.results) })),
    setRunning: (running) => set({ running }),
    setStartedAt: (startedAt) => set({ startedAt }),
    setPreviewLogId: (previewLogId) => set({ previewLogId }),
    setConcurrency: (concurrency) => set({ concurrency }),
}));
