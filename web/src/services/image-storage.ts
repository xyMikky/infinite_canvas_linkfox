import localforage from "localforage";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { resolveRoomMediaUrl, syncRoomMediaIfActive } from "@/lib/canvas/room/room-media-context";
import { readImageMeta, stripImageMetadata } from "@/lib/image-utils";
import { deleteDevLocalBlob, ensureDevLocalStore, getDevLocalBlob, getDevLocalMediaUrl, listDevLocalBlobs, setDevLocalBlob } from "@/services/dev-local-store";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
const objectUrls = new Map<string, string>();
const pendingImageBlobs = new Map<string, Promise<Blob | null>>();
const pendingImageUrls = new Map<string, Promise<string>>();

/** 仅读 IndexedDB，供开发端落盘迁移使用（避免走磁盘适配层）。 */
export async function getImageBlobFromIndexedDb(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const raw = typeof input === "string" ? await (await fetch(input)).blob() : input;
    // 去掉供应商 JPEG 中可能触发 PS Camera Raw 的元数据
    const blob = await stripImageMetadata(raw);
    const storageKey = `image:${nanoid()}`;
    await persistImageBlob(storageKey, blob);
    void syncRoomMediaIfActive(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

export function persistableImageUrl(fallback = "") {
    return fallback.startsWith("blob:") ? "" : fallback;
}

export function peekResolvedImageUrl(storageKey?: string) {
    return (storageKey && objectUrls.get(storageKey)) || "";
}

/** 开发端恢复节点只取可用原件地址，避免在显示缩略图前预读整张画布的原图。 */
export async function resolveImageSourceUrl(storageKey?: string, fallback = "") {
    const cached = peekResolvedImageUrl(storageKey);
    if (cached) return cached;
    if (storageKey && !resolveRoomMediaUrl(storageKey)) {
        const diskUrl = await getDevLocalMediaUrl(storageKey);
        if (diskUrl) return diskUrl;
    }
    // 磁盘缺失时沿用 IndexedDB 恢复并回写原件，不能使用过期 blob 地址。
    return resolveImageUrl(storageKey, fallback);
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return persistableImageUrl(fallback);
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    let pending = pendingImageUrls.get(storageKey);
    if (!pending) {
        pending = loadImageUrl(storageKey);
        pendingImageUrls.set(storageKey, pending);
        void pending.finally(() => pendingImageUrls.delete(storageKey)).catch(() => {});
    }
    return (await pending) || persistableImageUrl(fallback);
}

async function loadImageUrl(storageKey: string) {
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
    const blob = await getImageBlob(storageKey);
    if (!blob?.size) return "";
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export function getImageBlob(storageKey: string) {
    let pending = pendingImageBlobs.get(storageKey);
    if (!pending) {
        pending = readImageBlob(storageKey);
        pendingImageBlobs.set(storageKey, pending);
        void pending.finally(() => pendingImageBlobs.delete(storageKey)).catch(() => {});
    }
    return pending;
}

async function readImageBlob(storageKey: string) {
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

export async function setImageBlob(storageKey: string, blob: Blob) {
    await persistImageBlob(storageKey, blob);
    void syncRoomMediaIfActive(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    if (image.dataUrl?.startsWith("data:")) return image.dataUrl;
    if (image.storageKey) {
        const blob = await getImageBlob(image.storageKey);
        if (blob?.size) return blobToDataUrl(blob);
    }
    const url = persistableImageUrl(image.dataUrl || image.url || "") || (await resolveImageUrl(image.storageKey, ""));
    if (!url) return "";
    if (url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
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

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    await Promise.all([
        imageLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
        videoLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
    ]);
    const unused = new Set<string>();
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.add(key);
    });
    if (await ensureDevLocalStore()) {
        for (const key of await listDevLocalBlobs()) {
            if (key.startsWith("image:") && !usedKeys.has(key)) unused.add(key);
        }
    }
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === "string" && item.startsWith("image:") && (key === "storageKey" || key.endsWith("StorageKey"))) keys.add(item);
        else if (Array.isArray(item)) item.forEach((child) => collectImageStorageKeys(child, keys));
        else collectImageStorageKeys(item, keys);
    }
    return keys;
}

async function persistImageBlob(storageKey: string, blob: Blob) {
    if (await ensureDevLocalStore()) await setDevLocalBlob(storageKey, blob);
    await store.setItem(storageKey, blob);
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
        reader.readAsDataURL(blob);
    });
}
