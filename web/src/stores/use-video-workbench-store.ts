import { create } from "zustand";

import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type GeneratedVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

export type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    video?: GeneratedVideo;
    error?: string;
};

type Updater<T> = T | ((value: T) => T);

function resolveUpdater<T>(value: Updater<T>, previous: T): T {
    return typeof value === "function" ? (value as (input: T) => T)(previous) : value;
}

/** 视频创作台的会话状态：放全局 store，切换路由后进行中的任务与结果不丢失 */
type VideoWorkbenchStore = {
    prompt: string;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    results: GenerationResult[];
    running: boolean;
    startedAt: number;
    previewLogId: string;
    setPrompt: (value: string) => void;
    setReferences: (value: Updater<ReferenceImage[]>) => void;
    setVideoReferences: (value: Updater<ReferenceVideo[]>) => void;
    setAudioReferences: (value: Updater<ReferenceAudio[]>) => void;
    setResults: (value: Updater<GenerationResult[]>) => void;
    setRunning: (value: boolean) => void;
    setStartedAt: (value: Updater<number>) => void;
    setPreviewLogId: (value: string) => void;
};

export const useVideoWorkbenchStore = create<VideoWorkbenchStore>((set) => ({
    prompt: "",
    references: [],
    videoReferences: [],
    audioReferences: [],
    results: [],
    running: false,
    startedAt: 0,
    previewLogId: "",
    setPrompt: (prompt) => set({ prompt }),
    setReferences: (value) => set((state) => ({ references: resolveUpdater(value, state.references) })),
    setVideoReferences: (value) => set((state) => ({ videoReferences: resolveUpdater(value, state.videoReferences) })),
    setAudioReferences: (value) => set((state) => ({ audioReferences: resolveUpdater(value, state.audioReferences) })),
    setResults: (value) => set((state) => ({ results: resolveUpdater(value, state.results) })),
    setRunning: (running) => set({ running }),
    setStartedAt: (value) => set((state) => ({ startedAt: resolveUpdater(value, state.startedAt) })),
    setPreviewLogId: (previewLogId) => set({ previewLogId }),
}));
