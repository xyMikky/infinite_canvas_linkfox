import type { FolderPreviewSource } from "@/lib/canvas/folder-preview-cache";

export const FOLDER_PREVIEW_URL_PREFIX = "/__canvas_folder_preview__/";

function normalizePath(path: string) {
    return path.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/{2,}/g, "/");
}

function mimeForName(name: string) {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    const map: Record<string, string> = {
        html: "text/html;charset=utf-8",
        htm: "text/html;charset=utf-8",
        css: "text/css;charset=utf-8",
        js: "text/javascript;charset=utf-8",
        mjs: "text/javascript;charset=utf-8",
        cjs: "text/javascript;charset=utf-8",
        json: "application/json;charset=utf-8",
        svg: "image/svg+xml",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        ico: "image/x-icon",
        woff: "font/woff",
        woff2: "font/woff2",
        ttf: "font/ttf",
        otf: "font/otf",
        md: "text/markdown;charset=utf-8",
        markdown: "text/markdown;charset=utf-8",
        txt: "text/plain;charset=utf-8",
        csv: "text/csv;charset=utf-8",
        xml: "application/xml;charset=utf-8",
        wasm: "application/wasm",
        map: "application/json;charset=utf-8",
    };
    return map[ext] || "application/octet-stream";
}

export function toArrayBuffer(data: ArrayBuffer | ArrayBufferView | number[]): ArrayBuffer {
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    }
    if (Array.isArray(data)) return new Uint8Array(data).buffer;
    return new Uint8Array(0).buffer;
}

function assetUrl(folderId: string, path: string) {
    const segments = normalizePath(path).split("/").filter(Boolean).map(encodeURIComponent).join("/");
    return `${self.location.origin}${FOLDER_PREVIEW_URL_PREFIX}${encodeURIComponent(folderId)}/${segments}`;
}

let swReady: Promise<ServiceWorkerRegistration> | null = null;

export function ensureFolderPreviewServiceWorker() {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
        return Promise.reject(new Error("serviceWorker unavailable"));
    }
    if (!swReady) {
        swReady = navigator.serviceWorker
            .register("/folder-preview-sw.js", { scope: FOLDER_PREVIEW_URL_PREFIX })
            .then(async (reg) => {
                await navigator.serviceWorker.ready;
                return reg;
            })
            .catch((error) => {
                swReady = null;
                throw error;
            });
    }
    return swReady;
}

export async function publishFolderPreviewAssets(folderId: string, sources: FolderPreviewSource[]) {
    await ensureFolderPreviewServiceWorker();
    const cacheName = `canvas-fp-${folderId}`;
    const cache = await caches.open(cacheName);
    const existing = await cache.keys();
    await Promise.all(existing.map((request) => cache.delete(request)));

    await Promise.all(
        sources.map(async (source) => {
            const path = normalizePath(source.path);
            if (!path) return;
            const url = assetUrl(folderId, path);
            const body = toArrayBuffer(source.data);
            await cache.put(
                url,
                new Response(body, {
                    headers: {
                        "Content-Type": mimeForName(source.name || path),
                        "Cache-Control": "no-cache",
                    },
                }),
            );
        }),
    );
}

export function folderPreviewEntryUrl(folderId: string, htmlPath: string) {
    return `${FOLDER_PREVIEW_URL_PREFIX}${encodeURIComponent(folderId)}/${normalizePath(htmlPath)
        .split("/")
        .filter(Boolean)
        .map(encodeURIComponent)
        .join("/")}`;
}
