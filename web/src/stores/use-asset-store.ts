import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import type { CanvasFolderEntry } from "@/types/canvas";
import type { FolderSkillSummary } from "@/lib/canvas/folder-drop";
import { localForageStorage } from "@/lib/localforage-storage";
import { resolveMediaUrl } from "@/services/file-storage";

export type AssetKind = "text" | "image" | "video" | "folder";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type FolderAssetData = {
    folderName: string;
    entries: CanvasFolderEntry[];
    truncated?: boolean;
    topLevelDirs?: string[];
    entryCount: number;
    totalBytes: number;
    storageMode: "copy" | "reference";
    localPath: string;
    dataPath: string;
    skill?: FolderSkillSummary;
};
export type FolderAsset = AssetBase<"folder"> & { data: FolderAssetData };
export type Asset = TextAsset | ImageAsset | VideoAsset | FolderAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
let storageReady = false;

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        storageReady = false;
        const value = await localForageStorage.getItem(name);
        if (value === null) { storageReady = true; return null; }
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        if (!Array.isArray(parsed?.state?.assets)) throw new Error("资产数据无法读取，已停止保存。");
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (asset) => {
                if (asset.kind === "folder") return asset;
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                return asset;
            }),
        );
        storageReady = true;
        return parsed;
    },
    setItem: (name, value) => storageReady ? localForageStorage.setItem(name, JSON.stringify(value)) : undefined,
    removeItem: (name) => storageReady ? localForageStorage.removeItem(name) : undefined,
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: (id) =>
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    get().cleanupImages({ assets });
                    return { assets };
                }),
            replaceAssets: (assets) => set({ assets }),
            // 当前内存列表无法证明素材未被旧窗口、历史快照或进行中的上传引用。
            // 在可恢复的素材回收站实现前，删除节点/资产只解除引用，不自动删原文件。
            cleanupImages: () => {},
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                if (error) console.error("资产读取失败，已暂停保存", error);
                useAssetStore.setState({ hydrated: !error });
            },
        },
    ),
);
