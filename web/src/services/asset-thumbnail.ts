import localforage from "localforage";
import type { ImageAsset } from "@/stores/use-asset-store";
import { getImageBlob, persistableImageUrl } from "@/services/image-storage";
import { ensureDevLocalStore, getDevLocalBlob, setDevLocalBlob } from "@/services/dev-local-store";

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "asset_thumbnails" });
type ThumbnailJob = { priority: number; run: () => void };
const pending = new Map<string, { promise: Promise<Blob>; job: ThumbnailJob }>();
const queue: ThumbnailJob[] = [];
let active = 0;
let backgroundActive = 0;
const memoryCache = new Map<string, Blob>();
let memoryBytes = 0;

function drainQueue() {
    queue.sort((a, b) => a.priority - b.priority);
    while (active < 2) {
        // 后台预取最多占一路，给刚进入屏幕的图片留出解码位置。
        const index = queue.findIndex((job) => job.priority === 0 || backgroundActive === 0);
        if (index < 0) return;
        queue.splice(index, 1)[0].run();
    }
}

function rememberThumbnail(key: string, blob: Blob) {
    memoryBytes -= memoryCache.get(key)?.size || 0;
    memoryCache.delete(key);
    memoryCache.set(key, blob);
    memoryBytes += blob.size;
    while (memoryCache.size > 128 || memoryBytes > 24 * 1024 * 1024) {
        const oldest = memoryCache.keys().next().value!;
        memoryBytes -= memoryCache.get(oldest)!.size;
        memoryCache.delete(oldest);
    }
}

// 原件不进入全局 URL 缓存；最多同时生成两张，缓存命中直接返回。
export function readAssetThumbnail(asset: ImageAsset, signal: AbortSignal): Promise<Blob> {
    const key = `v1:${asset.data.storageKey || `${asset.id}:${asset.updatedAt}`}`;
    return readThumbnail(key, async () => asset.data.storageKey ? getImageBlob(asset.data.storageKey) : (await fetch(persistableImageUrl(asset.data.dataUrl), { signal })).blob(), signal);
}

export function readThumbnail(key: string, readSource: () => Promise<Blob | null>, signal: AbortSignal, options: { maxEdge?: number; diskCache?: boolean; naturalWidth?: number; naturalHeight?: number; background?: boolean } = {}): Promise<Blob> {
    if (signal.aborted) return Promise.reject(signal.reason);
    const memory = memoryCache.get(key);
    if (memory) {
        rememberThumbnail(key, memory);
        return Promise.resolve(memory);
    }
    const existing = pending.get(key);
    if (existing) {
        if (!options.background) {
            existing.job.priority = 0;
            drainQueue();
        }
        return existing.promise.catch((error) => {
            signal.throwIfAborted();
            if (error instanceof DOMException && error.name === "AbortError") {
                if (pending.get(key) === existing) pending.delete(key);
                return readThumbnail(key, readSource, signal, options);
            }
            throw error;
        }).then((blob) => {
            signal.throwIfAborted();
            return blob;
        });
    }
    const job: ThumbnailJob = { priority: options.background ? 1 : 0, run: () => {} };
    const task = (async () => {
        // 缓存读取不占生成队列，避免已有缩略图被前面的原图解码挡住。
        const diskCache = options.diskCache && await ensureDevLocalStore();
        const diskKey = `thumbnail:${key}`;
        const cached = diskCache ? await getDevLocalBlob(diskKey) : await store.getItem<Blob>(key);
        signal.throwIfAborted();
        if (cached) {
            rememberThumbnail(key, cached);
            return cached;
        }
        return new Promise<Blob>((resolve, reject) => {
            const cancelQueued = () => {
                const index = queue.indexOf(job);
                if (index >= 0) queue.splice(index, 1);
                reject(signal.reason);
            };
            job.run = () => {
                signal.removeEventListener("abort", cancelQueued);
                active++;
                const background = job.priority > 0;
                if (background) backgroundActive++;
                void (async () => {
                    signal.throwIfAborted();
                    const source = await readSource();
                    if (!source?.size) throw new Error("图片原件无法读取");
                    signal.throwIfAborted();
                    const maxEdge = options.maxEdge || 480;
                    const width = options.naturalWidth || 0;
                    const height = options.naturalHeight || 0;
                    const resize: ImageBitmapOptions = width > 0 && height > 0
                        ? { resizeQuality: "medium", ...(width >= height ? { resizeWidth: Math.min(width, maxEdge) } : { resizeHeight: Math.min(height, maxEdge) }) }
                        : {};
                    const bitmap = await createImageBitmap(source, resize);
                    try {
                        signal.throwIfAborted();
                        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
                        const canvas = document.createElement("canvas");
                        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
                        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                        canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                        const blob = await new Promise<Blob>((done, fail) => canvas.toBlob((value) => value ? done(value) : fail(new Error("缩略图生成失败")), "image/webp", 0.8));
                        signal.throwIfAborted();
                        rememberThumbnail(key, blob);
                        // 缩略图是可再生缓存，先交给节点显示，落盘不阻塞后面的图片。
                        void (diskCache ? setDevLocalBlob(diskKey, blob) : store.setItem(key, blob))
                            .catch((error) => console.warn("缩略图缓存写入失败", error));
                        return blob;
                    } finally { bitmap.close(); }
                })().then(resolve, reject).finally(() => {
                    active--;
                    if (background) backgroundActive--;
                    drainQueue();
                });
            };
            queue.push(job);
            signal.addEventListener("abort", cancelQueued, { once: true });
            drainQueue();
        });
    })();
    pending.set(key, { promise: task, job });
    void task.finally(() => { if (pending.get(key)?.promise === task) pending.delete(key); }).catch(() => {});
    return task;
}
