import localforage from "localforage";
import { nanoid } from "nanoid";

import { resolveRoomMediaUrl, syncRoomMediaIfActive } from "@/lib/canvas/room/room-media-context";
import { deleteDevLocalBlob, ensureDevLocalStore, getDevLocalBlob, getDevLocalMediaUrl, listDevLocalBlobs, setDevLocalBlob } from "@/services/dev-local-store";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
const objectUrls = new Map<string, string>();

/** 仅读 IndexedDB，供开发端落盘迁移使用。 */
export async function getMediaBlobFromIndexedDb(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const storageKey = `${prefix}:${nanoid()}`;
    await persistMediaBlob(storageKey, blob);
    void syncRoomMediaIfActive(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
    return { url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta };
}

function persistableFallback(fallback: string) {
    return fallback.startsWith("blob:") ? "" : fallback;
}

async function persistMediaBlob(storageKey: string, blob: Blob) {
    if (await ensureDevLocalStore()) await setDevLocalBlob(storageKey, blob);
    await store.setItem(storageKey, blob);
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    const safeFallback = persistableFallback(fallback);
    if (!storageKey) return safeFallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const roomUrl = resolveRoomMediaUrl(storageKey);
    if (roomUrl) {
        try {
            const res = await fetch(roomUrl);
            if (res.ok) {
                const blob = await res.blob();
                if (blob.size) {
                    const url = URL.createObjectURL(blob);
                    objectUrls.set(storageKey, url);
                    return url;
                }
            }
        } catch {
            // fall through
        }
    }
    const diskUrl = await getDevLocalMediaUrl(storageKey);
    if (diskUrl) return diskUrl;
    const blob = await getMediaBlob(storageKey);
    if (!blob?.size) return safeFallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getMediaBlob(storageKey: string) {
    if (await ensureDevLocalStore()) {
        const disk = await getDevLocalBlob(storageKey);
        if (disk?.size) return disk;
        const idb = await store.getItem<Blob>(storageKey);
        if (idb?.size) {
            await setDevLocalBlob(storageKey, idb).catch(() => {});
            return idb;
        }
        return null;
    }
    return store.getItem<Blob>(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    await persistMediaBlob(storageKey, blob);
    void syncRoomMediaIfActive(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    const useDisk = await ensureDevLocalStore();
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            if (useDisk) await deleteDevLocalBlob(key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedMedia(usedData: unknown) {
    const usedKeys = collectMediaStorageKeys(usedData);
    await videoLogStore.iterate((value) => {
        collectMediaStorageKeys(value, usedKeys);
    });
    const unused = new Set<string>();
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.add(key);
    });
    if (await ensureDevLocalStore()) {
        for (const key of await listDevLocalBlobs()) {
            if (!key.startsWith("image:") && !usedKeys.has(key)) unused.add(key);
        }
    }
    await deleteStoredMedia(unused);
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === "string" && item.includes(":") && (key === "storageKey" || key.endsWith("StorageKey"))) keys.add(item);
        else if (Array.isArray(item)) item.forEach((child) => collectMediaStorageKeys(child, keys));
        else collectMediaStorageKeys(item, keys);
    }
    return keys;
}

export async function readVideoFileMeta(file: Blob) {
    const url = URL.createObjectURL(file);
    try {
        return await readVideoMeta(url);
    } finally {
        URL.revokeObjectURL(url);
    }
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
