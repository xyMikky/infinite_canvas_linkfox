const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { applySystemProxyEnv } = require("./system-proxy.cjs");

const MAX_BODY_BYTES = 80 * 1024 * 1024;
const activeProcesses = new Map();
const resourceUrls = new Map();

function resolveKlingRuntime(isPackaged) {
    const nodeName = process.platform === "win32" ? "node.exe" : "node";
    const packageRoot = isPackaged
        ? path.join(process.resourcesPath, "kling-cli", "package")
        : path.join(__dirname, "..", "node_modules", "@klingai", "cli-cn");
    const entry = path.join(packageRoot, "dist", "cli.js");
    const bundledNode = isPackaged
        ? path.join(process.resourcesPath, "canvas-agent", nodeName)
        : path.join(__dirname, "runtime", nodeName);
    const node = fs.existsSync(bundledNode) ? bundledNode : process.versions.electron ? "" : process.execPath;
    return { node, entry, packageRoot };
}

function klingBinDir(isPackaged) {
    return isPackaged
        ? path.join(process.resourcesPath, "kling-cli", "bin")
        : path.join(__dirname, "..", "node_modules", ".bin");
}

function klingRuntimeEnv(isPackaged, env = process.env) {
    const runtime = resolveKlingRuntime(isPackaged);
    const currentPath = String(env.PATH || env.Path || "");
    const nextPath = [klingBinDir(isPackaged), currentPath].filter(Boolean).join(path.delimiter);
    return applySystemProxyEnv({
        ...env,
        PATH: nextPath,
        Path: nextPath,
        KLING_NONINTERACTIVE: "1",
        KLING_CLI_ENTRY: runtime.entry,
        KLING_NODE_BINARY: runtime.node,
    });
}

function killProcess(child) {
    if (!child || child.exitCode != null) return;
    if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        return;
    }
    child.kill("SIGTERM");
}

function stopKlingCliProcesses() {
    for (const child of activeProcesses.values()) killProcess(child);
    activeProcesses.clear();
}

function isProcessRunning(child) {
    if (!child?.pid) return false;
    try {
        process.kill(child.pid, 0);
        return true;
    } catch {
        return false;
    }
}

function loginEnv(isPackaged) {
    const env = klingRuntimeEnv(isPackaged);
    for (const key of Object.keys(env)) {
        const upper = key.toUpperCase();
        if (upper === "__CFBUNDLEIDENTIFIER" || upper === "CLAUDE" || upper.startsWith("CLAUDE_") || upper === "CURSOR" || upper.startsWith("CURSOR_") || upper === "VSCODE" || upper.startsWith("VSCODE_")) {
            delete env[key];
        }
    }
    return env;
}

function startDetachedLogin(isPackaged) {
    const current = activeProcesses.get("login");
    if (isProcessRunning(current)) return Promise.resolve(current.pid);
    activeProcesses.delete("login");
    const runtime = resolveKlingRuntime(isPackaged);
    if (!runtime.node || !fs.existsSync(runtime.node)) return Promise.reject(new Error("未找到内置 Node 运行时"));
    if (!fs.existsSync(runtime.entry)) return Promise.reject(new Error("未找到内置可灵 CLI"));
    const monitorCode = [
        'const { spawn } = require("node:child_process");',
        "setTimeout(() => {",
        '  const child = spawn(process.argv[1], [process.argv[2], "login", "--quiet"], { env: process.env, stdio: "ignore", windowsHide: true });',
        '  child.once("error", () => process.exit(1));',
        '  child.once("exit", (code) => process.exit(code == null ? 1 : code));',
        "}, 150);",
    ].join("\n");
    const launcherCode = [
        'const { spawn } = require("node:child_process");',
        'const child = spawn(process.argv[1], ["-e", process.argv[2], process.argv[1], process.argv[3]], { detached: true, env: process.env, stdio: "ignore", windowsHide: true });',
        "process.stdout.write(String(child.pid || 0));",
        "child.unref();",
    ].join("\n");
    return new Promise((resolve, reject) => {
        const launcher = spawn(runtime.node, ["-e", launcherCode, runtime.node, monitorCode, runtime.entry], {
            env: loginEnv(isPackaged),
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true,
        });
        let output = "";
        launcher.stdout.on("data", (chunk) => {
            output += chunk.toString();
        });
        launcher.once("error", reject);
        launcher.once("exit", (code) => {
            const pid = Number(output.trim());
            if (code !== 0 || !Number.isInteger(pid) || pid <= 0) {
                reject(new Error("无法启动可灵授权进程"));
                return;
            }
            activeProcesses.set("login", { pid });
            resolve(pid);
        });
    });
}

function runKling(isPackaged, args, options = {}) {
    const runtime = resolveKlingRuntime(isPackaged);
    if (!runtime.node || !fs.existsSync(runtime.node)) return Promise.reject(new Error("未找到内置 Node 运行时"));
    if (!fs.existsSync(runtime.entry)) return Promise.reject(new Error("未找到内置可灵 CLI"));
    const requestId = options.requestId || crypto.randomUUID();
    return new Promise((resolve, reject) => {
        const child = spawn(runtime.node, [runtime.entry, ...args, "--quiet"], {
            cwd: runtime.packageRoot,
            env: klingRuntimeEnv(isPackaged),
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        activeProcesses.set(requestId, child);
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > 32_000) stderr = stderr.slice(-32_000);
        });
        child.once("error", (error) => {
            activeProcesses.delete(requestId);
            reject(error);
        });
        child.once("exit", (code) => {
            activeProcesses.delete(requestId);
            if (code === 130) {
                reject(new Error("操作已取消"));
                return;
            }
            let payload = null;
            try {
                payload = stdout.trim() ? JSON.parse(stdout.trim()) : null;
            } catch {
                // handled below
            }
            if (code !== 0 || !payload) {
                reject(new Error(safeCliError(payload, stderr, code)));
                return;
            }
            if (payload.ok === false) {
                reject(new Error(safeCliError(payload, stderr, code)));
                return;
            }
            resolve({ requestId, payload });
        });
    });
}

function safeCliError(payload, stderr, code) {
    const record = payload && typeof payload === "object" ? payload : {};
    const message = String(record.message || record.error || record.body?.message || "").trim();
    if (message) return sanitizeCliText(message).slice(0, 1000);
    const clean = sanitizeCliText(stderr);
    return clean.slice(-1000) || `可灵 CLI 退出（${code ?? -1}）`;
}

function sanitizeCliText(value) {
    return String(value || "")
        .replace(/https?:\/\/\S+/g, "[授权地址]")
        .replace(/(?:[A-Za-z]:\\|\/)[^\r\n]*?\.kling[^\r\n\s]*/gi, "[凭据路径]")
        .replace(/[A-Za-z0-9_-]{24,}/g, "[敏感信息]")
        .trim();
}

async function readJsonBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) throw new Error("请求内容过大");
        chunks.push(chunk);
    }
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJson(res, body, status = 200) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

function bodyOf(payload) {
    return payload && typeof payload === "object" && payload.body && typeof payload.body === "object" ? payload.body : payload;
}

function generationIdOf(value) {
    const body = bodyOf(value) || {};
    return String(body.generationId || body.generation_id || "").trim();
}

function addLocalResourceUrls(value) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(addLocalResourceUrls);
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = addLocalResourceUrls(item);
    if (Array.isArray(value.works)) {
        result.works = value.works.map((work) => {
            if (!work || typeof work !== "object") return work;
            const remote = String(work.urlWithoutWatermark || work.url_without_watermark || work.url || "").trim();
            if (!remote) return work;
            const resourceId = crypto.randomUUID();
            resourceUrls.set(resourceId, remote);
            return { ...work, localUrl: `/api/kling-cli/resource/${resourceId}` };
        });
    }
    return result;
}

function commandArgs(input) {
    const command = String(input.command || "").trim();
    if (!["text_to_image", "image_to_image", "text_to_video", "image_to_video"].includes(command)) throw new Error("不支持的可灵生成命令");
    const model = String(input.model || "").trim();
    if (!model) throw new Error("请选择可灵模型");
    const prompt = String(input.prompt || "").trim();
    if (!prompt) throw new Error("请输入提示词");
    const args = [command, "--model", model];
    for (const file of input.imagePaths || []) args.push("--image", file);
    if (input.tailImagePath) args.push("--tailImage", input.tailImagePath);
    for (const [key, raw] of Object.entries(input.arguments || {})) {
        if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key) || raw == null || raw === "") continue;
        args.push(`--${key}`, String(raw));
    }
    args.push(prompt);
    return args;
}

async function materializeImages(images) {
    if (!Array.isArray(images) || !images.length) return { dir: "", paths: [] };
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "infinite-canvas-kling-"));
    const paths = [];
    for (let index = 0; index < images.length; index += 1) {
        const value = String(images[index] || "");
        const match = /^data:([^;,]+)?;base64,(.+)$/s.exec(value);
        if (!match) throw new Error("可灵参考图必须是本地图片数据");
        const ext = match[1]?.includes("webp") ? "webp" : match[1]?.includes("jpeg") ? "jpg" : "png";
        const file = path.join(dir, `reference-${index + 1}.${ext}`);
        await fsp.writeFile(file, Buffer.from(match[2], "base64"));
        paths.push(file);
    }
    return { dir, paths };
}

async function proxyResource(req, res, url) {
    const client = url.startsWith("https:") ? https : http;
    client
        .get(url, { headers: { "User-Agent": "InfiniteCanvas-Kling/1.0" } }, (upstream) => {
            if ((upstream.statusCode || 500) >= 300 && upstream.headers.location) {
                proxyResource(req, res, new URL(upstream.headers.location, url).toString());
                upstream.resume();
                return;
            }
            res.statusCode = upstream.statusCode || 502;
            for (const name of ["content-type", "content-length", "cache-control"]) {
                if (upstream.headers[name]) res.setHeader(name, upstream.headers[name]);
            }
            upstream.pipe(res);
        })
        .on("error", (error) => writeJson(res, { ok: false, error: error.message }, 502));
}

function createKlingCliMiddleware({ isPackaged = false } = {}) {
    return async (req, res, next) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (!url.pathname.startsWith("/api/kling-cli/")) return next();
        try {
            if (req.method === "GET" && url.pathname === "/api/kling-cli/status") {
                const runtime = resolveKlingRuntime(isPackaged);
                if (!runtime.node || !fs.existsSync(runtime.entry)) {
                    writeJson(res, { ok: false, available: false, desktop: isPackaged });
                    return;
                }
                const version = JSON.parse(await fsp.readFile(path.join(runtime.packageRoot, "package.json"), "utf8")).version || "";
                const loginProcess = activeProcesses.get("login");
                const loginRunning = isProcessRunning(loginProcess);
                if (loginProcess && !loginRunning) activeProcesses.delete("login");
                try {
                    const identity = bodyOf((await runKling(isPackaged, ["who_am_i"])).payload);
                    activeProcesses.delete("login");
                    writeJson(res, { ok: true, available: true, loggedIn: true, loginRunning: false, version, identity: addLocalResourceUrls(identity) });
                } catch {
                    writeJson(res, { ok: true, available: true, loggedIn: false, loginRunning, version });
                }
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/kling-cli/login") {
                const pid = await startDetachedLogin(isPackaged);
                writeJson(res, { ok: true, started: true, pid });
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/kling-cli/logout") {
                const result = await runKling(isPackaged, ["logout"]);
                writeJson(res, { ok: true, body: bodyOf(result.payload) });
                return;
            }
            if (req.method === "GET" && url.pathname === "/api/kling-cli/models") {
                const result = await runKling(isPackaged, ["who_am_i"]);
                writeJson(res, { ok: true, body: bodyOf(result.payload) });
                return;
            }
            if (req.method === "GET" && url.pathname === "/api/kling-cli/account") {
                const result = await runKling(isPackaged, ["account"]);
                writeJson(res, { ok: true, body: bodyOf(result.payload) });
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/kling-cli/generate") {
                const input = await readJsonBody(req);
                const materialized = await materializeImages(input.images);
                try {
                    const args = commandArgs({ ...input, imagePaths: materialized.paths, tailImagePath: "" });
                    const result = await runKling(isPackaged, args, { requestId: String(input.requestId || crypto.randomUUID()) });
                    const body = bodyOf(result.payload);
                    const generationId = generationIdOf(body);
                    if (!generationId) throw new Error("可灵未返回 generationId");
                    writeJson(res, { ok: true, requestId: result.requestId, body });
                } finally {
                    if (materialized.dir) await fsp.rm(materialized.dir, { recursive: true, force: true }).catch(() => undefined);
                }
                return;
            }
            if (req.method === "GET" && url.pathname.startsWith("/api/kling-cli/task/")) {
                const generationId = decodeURIComponent(url.pathname.slice("/api/kling-cli/task/".length));
                if (!generationId) throw new Error("缺少 generationId");
                const result = await runKling(isPackaged, ["query_tasks", generationId]);
                writeJson(res, { ok: true, body: addLocalResourceUrls(bodyOf(result.payload)) });
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/kling-cli/cancel") {
                const input = await readJsonBody(req);
                const requestId = String(input.requestId || "");
                const child = activeProcesses.get(requestId);
                if (child) killProcess(child);
                writeJson(res, { ok: true, canceled: Boolean(child) });
                return;
            }
            if (req.method === "GET" && url.pathname.startsWith("/api/kling-cli/resource/")) {
                const resourceId = url.pathname.slice("/api/kling-cli/resource/".length);
                const remote = resourceUrls.get(resourceId);
                if (!remote) {
                    writeJson(res, { ok: false, error: "资源已过期" }, 404);
                    return;
                }
                await proxyResource(req, res, remote);
                return;
            }
            writeJson(res, { ok: false, error: "Not Found" }, 404);
        } catch (error) {
            writeJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
        }
    };
}

module.exports = {
    createKlingCliMiddleware,
    klingBinDir,
    klingRuntimeEnv,
    resolveKlingRuntime,
    stopKlingCliProcesses,
};
