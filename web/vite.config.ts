import { createRequire } from "node:module";
import { createReadStream, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { canvasReportRuntime } from "./canvas-report-plugin";

const require = createRequire(import.meta.url);
const { createLinkfoxOssUploadMiddleware } = require("./electron/linkfox-oss-upload.cjs") as {
    createLinkfoxOssUploadMiddleware: () => (req: unknown, res: unknown, next: () => void) => void;
};
const { createKlingCliMiddleware } = require("./electron/kling-cli-host.cjs") as {
    createKlingCliMiddleware: (options?: { isPackaged?: boolean }) => (req: unknown, res: unknown, next: () => void) => void | Promise<void>;
};
const { createDreaminaCliMiddleware } = require("./electron/dreamina-cli-host.cjs") as {
    createDreaminaCliMiddleware: (options?: { isPackaged?: boolean }) => (req: unknown, res: unknown, next: () => void) => void | Promise<void>;
};
const { createLocalAgentMiddleware } = require("./electron/local-agent-host.cjs") as {
    createLocalAgentMiddleware: (options?: { isPackaged?: boolean; allowNpxFallback?: boolean }) => (req: unknown, res: unknown, next: () => void) => void | Promise<void>;
};
const { handlePinterestProxy } = require("./electron/pinterest-proxy.cjs") as {
    handlePinterestProxy: (req: unknown, res: unknown) => boolean;
};
const { handleRhFileProxy } = require("./electron/rh-file-proxy.cjs") as {
    handleRhFileProxy: (req: unknown, res: unknown) => boolean;
};
const { handleRoomHttp, attachRoomWebSocket } = require("./electron/canvas-room-server.cjs") as {
    handleRoomHttp: (
        req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
        pathname: string,
        query: URLSearchParams,
        options?: { listLanShareUrls?: (sharePath: string) => string[] },
    ) => Promise<boolean>;
    attachRoomWebSocket: (server: import("node:http").Server) => unknown;
};
const { listLanShareUrls: buildLanShareUrls } = require("./electron/lan-share-urls.cjs") as {
    listLanShareUrls: (port: number, sharePath?: string) => string[];
};
const { createDevLocalStoreMiddleware } = require("./electron/dev-local-store.cjs") as {
    createDevLocalStoreMiddleware: (options: { rootDir: string }) => (req: unknown, res: unknown, next: () => void) => void;
};

const webDir = dirname(fileURLToPath(import.meta.url));
const canvasDevDataDir = resolve(webDir, "../data/canvas-dev");
const handleDevLocalStore = createDevLocalStoreMiddleware({ rootDir: canvasDevDataDir });
const handleKlingCli = createKlingCliMiddleware({ isPackaged: false });
const handleDreaminaCli = createDreaminaCliMiddleware({ isPackaged: false });
const handleLocalAgent = createLocalAgentMiddleware({ isPackaged: false, allowNpxFallback: true });

function devLanShareUrls(sharePath = "/canvas") {
    return buildLanShareUrls(3000, sharePath);
}

function rejectRemotePrivilegedRequest(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
    const url = req.url || "";
    if (!["/api/kling-cli/", "/api/dreamina-cli/", "/api/local-agent/", "/api/agent-proxy"].some((prefix) => url.startsWith(prefix))) return false;
    const address = String(req.socket?.remoteAddress || "").replace(/^::ffff:/i, "");
    if (address === "127.0.0.1" || address === "::1" || address === "localhost") return false;
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "敏感接口仅允许本机访问" }));
    return true;
}

function canvasRoomServer(): Plugin {
    return {
        name: "canvas-room-server",
        configureServer(server) {
            attachRoomWebSocket(server.httpServer);
            server.middlewares.use((req, res, next) => {
                const url = req.url || "";
                const pathname = decodeURIComponent(url.split("?")[0].split("#")[0] || "/");
                if (!pathname.startsWith("/api/rooms")) {
                    next();
                    return;
                }
                const query = new URL(url, "http://127.0.0.1").searchParams;
                void handleRoomHttp(req as import("node:http").IncomingMessage, res as import("node:http").ServerResponse, pathname, query, {
                    listLanShareUrls: (sharePath) => devLanShareUrls(sharePath),
                });
            });
        },
        configurePreviewServer(server) {
            attachRoomWebSocket(server.httpServer);
            server.middlewares.use((req, res, next) => {
                const url = req.url || "";
                const pathname = decodeURIComponent(url.split("?")[0].split("#")[0] || "/");
                if (!pathname.startsWith("/api/rooms")) {
                    next();
                    return;
                }
                const query = new URL(url, "http://127.0.0.1").searchParams;
                void handleRoomHttp(req as import("node:http").IncomingMessage, res as import("node:http").ServerResponse, pathname, query, {
                    listLanShareUrls: (sharePath) => devLanShareUrls(sharePath),
                });
            });
        },
    };
}

function localAgentStarter(): Plugin {
    return {
        name: "local-agent-starter",
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (rejectRemotePrivilegedRequest(req, res)) return;
                if (String(req.url || "").startsWith("/api/dev-local-store")) {
                    handleDevLocalStore(req, res, next);
                    return;
                }
                if (handlePinterestProxy(req, res)) return;
                if (handleRhFileProxy(req, res)) return;
                const url = req.url || "";
                if (url.startsWith("/api/kling-cli/")) {
                    void handleKlingCli(req, res, next);
                    return;
                }
                if (url.startsWith("/api/dreamina-cli/")) {
                    void handleDreaminaCli(req, res, next);
                    return;
                }
                if (!url.startsWith("/api/local-agent/") && !url.startsWith("/api/agent-proxy")) {
                    next();
                    return;
                }
                void handleLocalAgent(req, res, next);
            });
        },
        configurePreviewServer(server) {
            server.middlewares.use((req, res, next) => {
                if (rejectRemotePrivilegedRequest(req, res)) return;
                if (String(req.url || "").startsWith("/api/dev-local-store")) {
                    handleDevLocalStore(req, res, next);
                    return;
                }
                if (handlePinterestProxy(req, res)) return;
                if (handleRhFileProxy(req, res)) return;
                const url = req.url || "";
                if (url.startsWith("/api/local-agent/") || url.startsWith("/api/agent-proxy")) {
                    void handleLocalAgent(req, res, next);
                    return;
                }
                next();
            });
        },
    };
}

// Expose /plugins/index.json with local plugin files from public/plugins.
// The frontend can discover and list them when enabled; development reads the directory live, while builds emit a static registry.
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `/plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use(createLinkfoxOssUploadMiddleware());
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
        },
        configurePreviewServer(server) {
            server.middlewares.use(createLinkfoxOssUploadMiddleware());
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

// Serve / copy @ffmpeg/core so video clip remux can load wasm without a manual public/ copy.
function ffmpegCoreAssets(): Plugin {
    const coreDir = resolve(webDir, "node_modules/@ffmpeg/core/dist/esm");
    const files = ["ffmpeg-core.js", "ffmpeg-core.wasm"] as const;
    const mime: Record<string, string> = {
        ".js": "text/javascript",
        ".wasm": "application/wasm",
    };
    const serve = (reqUrl: string | undefined, res: { setHeader: (k: string, v: string) => void; statusCode: number; end: (body?: string) => void }, next: () => void) => {
        const pathOnly = (reqUrl || "").split("?")[0] || "";
        if (!pathOnly.startsWith("/ffmpeg/")) return next();
        const name = decodeURIComponent(pathOnly.slice("/ffmpeg/".length));
        if (!files.includes(name as (typeof files)[number])) return next();
        const filePath = resolve(coreDir, name);
        if (!existsSync(filePath)) {
            res.statusCode = 404;
            res.end("ffmpeg asset missing");
            return;
        }
        res.setHeader("Content-Type", mime[extname(name)] || "application/octet-stream");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        createReadStream(filePath).pipe(res as never);
    };
    return {
        name: "ffmpeg-core-assets",
        configureServer(server) {
            server.middlewares.use((req, res, next) => serve(req.url, res, next));
        },
        configurePreviewServer(server) {
            server.middlewares.use((req, res, next) => serve(req.url, res, next));
        },
        writeBundle(options) {
            const outDir = options.dir || resolve(webDir, "dist");
            const dest = resolve(outDir, "ffmpeg");
            mkdirSync(dest, { recursive: true });
            for (const file of files) {
                const from = resolve(coreDir, file);
                if (!existsSync(from)) continue;
                copyFileSync(from, resolve(dest, file));
            }
        },
    };
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [react(), localPluginsManifest(), localAgentStarter(), canvasRoomServer(), ffmpegCoreAssets(), canvasReportRuntime(webDir)],
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
            "cursor/canvas": resolve(webDir, "src/lib/canvas/cursor-canvas-sdk/index.ts"),
        },
    },
    optimizeDeps: {
        exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
    },
    server: {
        port: 3000,
        strictPort: true,
        watch: {
            ignored: ["**/release-*/**"],
        },
        fs: {
            allow: [webDir, resolve(webDir, "..")],
        },
        proxy: {
            // Avoid browser CORS when calling LinkFox from localhost.
            "/api/linkfox-v3": {
                target: "https://ai-api.linkfox.com",
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/api\/linkfox-v3/, ""),
            },
            "/api/linkfox": {
                target: "https://tool-gateway.linkfox.com",
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/api\/linkfox/, ""),
            },
            // 中国站须写在国际站之前，避免 /api/runninghub 前缀误匹配 runninghub-cn
            "/api/runninghub-cn": {
                target: "https://www.runninghub.cn/openapi/v2",
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/api\/runninghub-cn/, ""),
            },
            "/api/runninghub": {
                target: "https://www.runninghub.ai/openapi/v2",
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/api\/runninghub/, ""),
            },
            "/api/rh-cn-task": {
                target: "https://www.runninghub.cn",
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/api\/rh-cn-task/, ""),
            },
        },
    },
    preview: {
        proxy: {
            "/api/linkfox-v3": {
                target: "https://ai-api.linkfox.com",
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/api\/linkfox-v3/, ""),
            },
            "/api/linkfox": {
                target: "https://tool-gateway.linkfox.com",
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/api\/linkfox/, ""),
            },
            "/api/runninghub-cn": {
                target: "https://www.runninghub.cn/openapi/v2",
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/api\/runninghub-cn/, ""),
            },
            "/api/runninghub": {
                target: "https://www.runninghub.ai/openapi/v2",
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/api\/runninghub/, ""),
            },
            "/api/rh-cn-task": {
                target: "https://www.runninghub.cn",
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/api\/rh-cn-task/, ""),
            },
        },
    },
});
