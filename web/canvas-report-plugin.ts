import { resolve } from "node:path";
import { build, type Plugin } from "vite";

/** 同一份离线运行时用于开发预览与安装包导出，不依赖 CDN 或宿主模块地址。 */
export function canvasReportRuntime(webDir: string): Plugin {
    const fileName = "canvas-report-runtime.js";
    let runtime: Promise<string> | undefined;
    let mode = "production";
    let requestPath = `/${fileName}`;
    const compile = () => runtime ||= build({
        configFile: false,
        root: webDir,
        mode,
        publicDir: false,
        logLevel: "error",
        resolve: { alias: { "@": resolve(webDir, "src") } },
        // 宿主开发模式默认启用 jsxDEV，但此独立包使用生产 React，必须一起切到生产 JSX。
        esbuild: { jsx: "automatic", jsxDev: false },
        define: { "process.env.NODE_ENV": '"production"' },
        build: {
            write: false,
            target: "es2022",
            minify: "esbuild",
            lib: { entry: resolve(webDir, "src/lib/canvas/report/reader.tsx"), name: "CanvasReport", formats: ["iife"] },
        },
    }).then((result) => {
        if (!("output" in result) && !Array.isArray(result)) throw new Error("交付运行时未生成");
        const outputs = Array.isArray(result) ? result : [result];
        const chunk = outputs.flatMap((item) => item.output).find((item) => item.type === "chunk" && item.isEntry);
        if (!chunk || chunk.type !== "chunk") throw new Error("交付运行时缺少入口");
        return chunk.code;
    }).catch((error) => { runtime = undefined; throw error; });
    return {
        name: "canvas-report-runtime",
        configResolved(config) {
            mode = config.mode;
            requestPath = new URL(fileName, new URL(config.base, "http://canvas.local/")).pathname;
        },
        configureServer(server) {
            server.watcher.on("change", (path) => {
                if (path.replaceAll("\\", "/").includes("/src/lib/canvas/")) runtime = undefined;
            });
            server.middlewares.use(async (req, res, next) => {
                if (req.url?.split("?")[0] !== requestPath || req.method !== "GET") return next();
                try {
                    const code = await compile();
                    res.setHeader("Content-Type", "text/javascript;charset=utf-8");
                    res.setHeader("Cache-Control", "no-store");
                    res.end(code);
                } catch (error) {
                    res.statusCode = 500;
                    res.end(error instanceof Error ? error.message : "交付运行时生成失败");
                }
            });
        },
        async generateBundle() {
            this.emitFile({ type: "asset", fileName, source: await compile() });
        },
    };
}
