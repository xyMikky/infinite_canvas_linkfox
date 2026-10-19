/* 画布文件夹 HTML 工程预览：拦截 /__canvas_folder_preview__/:folderId/* 并从 Cache 返回 */
const PREFIX = "/__canvas_folder_preview__/";

self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (!url.pathname.startsWith(PREFIX)) return;

    event.respondWith(
        (async () => {
            const rest = url.pathname.slice(PREFIX.length);
            const slash = rest.indexOf("/");
            if (slash <= 0) return new Response("Missing folder id", { status: 400 });
            const folderId = decodeURIComponent(rest.slice(0, slash));
            const cache = await caches.open(`canvas-fp-${folderId}`);
            const exact = await cache.match(event.request);
            if (exact) return exact;
            const clean = await cache.match(url.origin + url.pathname);
            if (clean) return clean;
            // 兼容未编码/已编码两种 put 方式
            const filePath = decodeURIComponent(rest.slice(slash + 1));
            const alt = `${url.origin}${PREFIX}${encodeURIComponent(folderId)}/${filePath
                .split("/")
                .filter(Boolean)
                .map(encodeURIComponent)
                .join("/")}`;
            const altHit = await cache.match(alt);
            if (altHit) return altHit;
            return new Response(`Folder preview asset not found: ${filePath}`, {
                status: 404,
                headers: { "Content-Type": "text/plain;charset=utf-8" },
            });
        })(),
    );
});
