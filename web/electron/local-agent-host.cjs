const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { klingRuntimeEnv } = require("./kling-cli-host.cjs");
const { dreaminaRuntimeEnv } = require("./dreamina-cli-host.cjs");
const { cursorExtraBinDirs, cursorRuntimeEnv, resolveCursorCliBinary } = require("./cursor-cli-host.cjs");
const { applySystemProxyEnv } = require("./system-proxy.cjs");

function cliRuntimeEnv(isPackaged, env = process.env) {
    return dreaminaRuntimeEnv(isPackaged, klingRuntimeEnv(isPackaged, cursorRuntimeEnv(isPackaged, env)));
}

const DEFAULT_AGENT_URL = "http://127.0.0.1:17371";
/** 与 canvas-agent 的 CONFIG_DIR 一致：桌面安装版由 main.cjs 设到安装目录 data\agent。 */
function agentHomeDir() {
    return process.env.INFINITE_CANVAS_AGENT_HOME?.trim() || path.join(os.homedir(), ".infinite-canvas");
}

function configFile() {
    return path.join(agentHomeDir(), "canvas-agent.json");
}

/** @type {import("node:child_process").ChildProcess | null} */
let trackedAgent = null;

function resolveAgentRoot(isPackaged) {
    if (isPackaged) return path.join(process.resourcesPath, "canvas-agent");
    return path.resolve(__dirname, "..", "..", "canvas-agent");
}

function getAgentEntry(agentRoot) {
    return path.join(agentRoot, "dist", "index.js");
}

function detectCodexInstalled() {
    const resolved = resolveSystemCodexBinary();
    if (resolved?.binary) return { installed: true, source: "binary", path: resolved.binary };

    const home = os.homedir();
    const markers = [path.join(home, ".codex", "auth.json"), path.join(home, ".codex", "config.toml")];
    if (process.platform === "win32") {
        const local = process.env.LOCALAPPDATA || "";
        markers.push(path.join(local, "Programs", "Codex", "Codex.exe"), path.join(local, "Programs", "codex", "Codex.exe"));
        markers.push(...listOpenAiCodexBinaries());
    } else if (process.platform === "darwin") {
        markers.push("/Applications/Codex.app", path.join(home, "Applications", "Codex.app"));
    }

    for (const marker of markers) {
        if (marker && fs.existsSync(marker)) return { installed: true, source: "marker", path: marker };
    }
    return { installed: false, source: "" };
}

function detectCursorCliInstalled(isPackaged = false) {
    const bundled = resolveCursorCliBinary(isPackaged);
    if (bundled) return { installed: true, path: bundled, source: "bundled" };
    const names = process.platform === "win32"
        ? ["agent.cmd", "agent.exe", "cursor-agent.cmd", "cursor-agent.exe"]
        : ["agent", "cursor-agent"];
    const env = withAugmentedPath(process.env);
    const extra = getExtraBinDirs();
    for (const name of names) {
        for (const dir of extra) {
            const candidate = path.join(dir, name);
            if (fs.existsSync(candidate)) return { installed: true, path: candidate };
        }
        try {
            const cmd = process.platform === "win32" ? "where" : "which";
            const found = execFileSync(cmd, [name], { encoding: "utf8", windowsHide: true, env })
                .trim()
                .split(/\r?\n/)
                .map((line) => line.trim())
                .find((line) => line && fs.existsSync(line));
            if (found) return { installed: true, path: found };
        } catch {
            // next name
        }
    }
    return { installed: false, path: "" };
}

function getExtraBinDirs() {
    const home = os.homedir();
    const dirs = [path.join(home, ".local", "bin"), path.join(home, ".cursor", "bin")];
    dirs.push(...cursorExtraBinDirs());
    if (process.platform === "win32") {
        const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
        const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
        dirs.push(path.join(appData, "npm"), path.join(local, "npm"), "C:\\Program Files\\nodejs");
    } else {
        dirs.push(path.join(home, ".npm-global", "bin"), "/usr/local/bin");
    }
    return dirs.filter((dir) => dir && fs.existsSync(dir));
}

function listOpenAiCodexBinaries() {
    const local = process.env.LOCALAPPDATA || "";
    const binRoot = path.join(local, "OpenAI", "Codex", "bin");
    if (!local || !fs.existsSync(binRoot)) return [];
    try {
        return fs
            .readdirSync(binRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(binRoot, entry.name, "codex.exe"))
            .filter((file) => fs.existsSync(file))
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    } catch {
        return [];
    }
}

function resolveSystemCodexBinary() {
    const override = (process.env.CODEX_NATIVE_BINARY || "").trim();
    if (override && fs.existsSync(override)) return { binary: override };

    const env = withAugmentedPath(process.env);
    try {
        const cmd = process.platform === "win32" ? "where" : "which";
        const out = execFileSync(cmd, ["codex"], { encoding: "utf8", windowsHide: true, env }).trim();
        const first = out.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
        if (first && fs.existsSync(first)) return { binary: first };
    } catch {
        // continue
    }

    const desktop = listOpenAiCodexBinaries();
    if (desktop[0]) return { binary: desktop[0] };
    return null;
}

function resolveNodeBinary(isPackaged) {
    const runtimeName = process.platform === "win32" ? "node.exe" : "node";
    const bundled = path.join(__dirname, "runtime", runtimeName);
    if (fs.existsSync(bundled)) return bundled;

    if (isPackaged) {
        const fromAgent = path.join(process.resourcesPath, "canvas-agent", runtimeName);
        if (fs.existsSync(fromAgent)) return fromAgent;
        const fromResources = path.join(process.resourcesPath, "electron", "runtime", runtimeName);
        if (fs.existsSync(fromResources)) return fromResources;
    }

    if (!process.versions.electron && process.execPath && fs.existsSync(process.execPath)) {
        return process.execPath;
    }

    try {
        if (process.platform === "win32") {
            const out = execFileSync("where", ["node"], { encoding: "utf8", windowsHide: true }).trim();
            const first = out.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
            if (first && fs.existsSync(first)) return first;
        } else {
            const out = execFileSync("which", ["node"], { encoding: "utf8" }).trim();
            if (out && fs.existsSync(out)) return out;
        }
    } catch {
        // continue
    }
    return null;
}

function withAugmentedPath(env) {
    const next = { ...env };
    const pathKey = process.platform === "win32" && next.Path && !next.PATH ? "Path" : "PATH";
    const current = String(next.PATH || next.Path || "");
    const extras = [];
    if (process.platform === "win32") {
        const local = process.env.LOCALAPPDATA || "";
        const appData = process.env.APPDATA || "";
        if (local) extras.push(path.join(local, "Programs", "Codex"), path.join(local, "OpenAI", "Codex", "bin"));
        extras.push(...listOpenAiCodexBinaries().map((file) => path.dirname(file)));
        if (appData) extras.push(path.join(appData, "npm"));
    } else {
        extras.push("/usr/local/bin", path.join(os.homedir(), ".npm-global", "bin"));
    }
    const augmented = [...extras, ...current.split(path.delimiter)].filter(Boolean).join(path.delimiter);
    next.PATH = augmented;
    next[pathKey] = augmented;
    return next;
}

function trackLocalAgent(child) {
    trackedAgent = child || null;
    if (!child) return;
    child.once("exit", () => {
        if (trackedAgent === child) trackedAgent = null;
    });
}

function stopLocalAgent() {
    const child = trackedAgent;
    trackedAgent = null;
    if (!child || child.killed) return;
    try {
        if (process.platform === "win32" && child.pid) {
            spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        } else {
            child.kill("SIGTERM");
        }
    } catch {
        // ignore
    }
}

function readLocalAgentConnectInfo() {
    try {
        const data = JSON.parse(fs.readFileSync(configFile(), "utf8"));
        const url = String(data.url || DEFAULT_AGENT_URL).trim().replace(/\/$/, "");
        const token = String(data.token || "").trim();
        if (!url || !token) return null;
        return { url, token };
    } catch {
        return null;
    }
}

function isLocalAgentReady(timeoutMs = 1500) {
    return new Promise((resolve) => {
        const req = http.get(`${DEFAULT_AGENT_URL}/config`, { timeout: timeoutMs }, (res) => {
            let raw = "";
            res.on("data", (chunk) => {
                raw += chunk;
            });
            res.on("end", () => {
                try {
                    const data = JSON.parse(raw);
                    resolve(Boolean(data?.ok));
                } catch {
                    resolve(false);
                }
            });
        });
        req.on("timeout", () => {
            req.destroy();
            resolve(false);
        });
        req.on("error", () => resolve(false));
    });
}

function spawnLogFile() {
    return path.join(agentHomeDir(), "logs", "agent-spawn.log");
}

function openSpawnLog() {
    const file = spawnLogFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `\n--- ${new Date().toISOString()} ---\n`);
    return fs.openSync(file, "a");
}

function readSpawnLogTail(maxLines = 12) {
    try {
        const lines = fs.readFileSync(spawnLogFile(), "utf8").trimEnd().split(/\r?\n/);
        return lines.slice(-maxLines).join("\n").trim();
    } catch {
        return "";
    }
}

function waitChildExit(child, ms) {
    return new Promise((resolve) => {
        if (!child) return resolve({ code: -1, error: "no process" });
        if (child.exitCode != null || child.killed) return resolve({ code: child.exitCode ?? -1 });
        const finish = (result) => {
            clearTimeout(timer);
            child.off("exit", onExit);
            child.off("error", onError);
            resolve(result);
        };
        const timer = setTimeout(() => finish(null), ms);
        const onExit = (code, signal) => finish({ code, signal });
        const onError = (error) => finish({ code: -1, error: error instanceof Error ? error.message : String(error) });
        child.once("exit", onExit);
        child.once("error", onError);
    });
}

function readJsonBody(req) {
    return new Promise((resolve) => {
        if (req.body && typeof req.body === "object") return resolve(req.body);
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
            } catch {
                resolve({});
            }
        });
        req.on("error", () => resolve({}));
    });
}

let lastSpawnedCursorApiKey = "";

function spawnLocalAgent({ isPackaged = false, allowNpxFallback = false, cursorApiKey = "" } = {}) {
    const agentRoot = resolveAgentRoot(isPackaged);
    const useSource = !isPackaged && fs.existsSync(path.join(agentRoot, "src", "index.ts"));
    const entry = useSource ? path.join(agentRoot, "src", "index.ts") : getAgentEntry(agentRoot);
    const tsx = path.join(agentRoot, "node_modules", "tsx", "dist", "loader.mjs");
    if (useSource && !fs.existsSync(tsx)) throw new Error("缺少 Agent 开发依赖，请在 canvas-agent 目录运行 npm install --include=dev");
    const logFd = openSpawnLog();
    if (!fs.existsSync(entry)) {
        if (!allowNpxFallback) {
            fs.closeSync(logFd);
            throw new Error(`未找到内置 Agent：${entry}`);
        }
        const npxEnv = applySystemProxyEnv(cliRuntimeEnv(false, withAugmentedPath(process.env)));
        if (cursorApiKey) npxEnv.CURSOR_API_KEY = cursorApiKey;
        const child = spawn("npx -y @basketikun/canvas-agent", {
            cwd: path.resolve(__dirname, ".."),
            env: npxEnv,
            detached: true,
            stdio: ["ignore", logFd, logFd],
            shell: true,
            windowsHide: true,
        });
        fs.closeSync(logFd);
        child.unref();
        trackLocalAgent(child);
        return { mode: "npx", child };
    }

    const nodeBin = resolveNodeBinary(isPackaged);
    // 必须用真正的 node 跑 Agent；用 InfiniteCanvas.exe + ELECTRON_RUN_AS_NODE 时，
    // Agent 内部再 spawn(process.execPath) 会弹出多个画布窗口。
    if (!nodeBin) {
        fs.closeSync(logFd);
        throw new Error("未找到可用的 Node 运行时，无法启动内置 Agent");
    }
    const env = applySystemProxyEnv(cliRuntimeEnv(isPackaged, withAugmentedPath(process.env)));
    const codex = resolveSystemCodexBinary();
    if (codex?.binary) env.CODEX_NATIVE_BINARY = codex.binary;
    const cursorBin = resolveCursorCliBinary(isPackaged);
    if (cursorBin) env.CURSOR_CLI_BIN = cursorBin;
    if (cursorApiKey) env.CURSOR_API_KEY = cursorApiKey;
    // 直接注册 loader；tsx CLI 会另起未设置 windowsHide 的 Node，导致 Windows 弹黑窗。
    const child = spawn(nodeBin, useSource ? ["--import", pathToFileURL(tsx).href, entry] : [entry], {
        cwd: agentRoot,
        env,
        detached: true,
        stdio: ["ignore", logFd, logFd],
        windowsHide: true,
    });
    fs.closeSync(logFd);
    child.unref();
    trackLocalAgent(child);
    return { mode: "bundled", child, entry, nodeBin };
}

function writeJson(res, body, status = 200) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

const AGENT_PROXY_PREFIX = "/api/agent-proxy";

/** 同源代理到本机 canvas-agent（17371）：局域网访客经共享端口使用主机 Codex，支持 SSE 流式。 */
function handleAgentProxy(req, res) {
    const rawUrl = req.url || "/";
    if (rawUrl !== AGENT_PROXY_PREFIX && !rawUrl.startsWith(`${AGENT_PROXY_PREFIX}/`) && !rawUrl.startsWith(`${AGENT_PROXY_PREFIX}?`)) return false;
    const targetPath = rawUrl.slice(AGENT_PROXY_PREFIX.length) || "/";
    const target = new URL(targetPath, DEFAULT_AGENT_URL);
    const headers = { ...req.headers, host: target.host };
    delete headers.origin;
    delete headers.referer;
    const upstream = http.request(target, { method: req.method, headers }, (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
    });
    upstream.on("error", (error) => {
        if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: `agent proxy error: ${error.message}` }));
    });
    req.pipe(upstream);
    res.on("close", () => upstream.destroy());
    return true;
}

/** Express/connect 风格中间件；挂到 Vite 或 Electron 本地静态服务。 */
function createLocalAgentMiddleware({ isPackaged = false, allowNpxFallback = false } = {}) {
    return async (req, res, next) => {
        try {
            if (handleAgentProxy(req, res)) return;
            const url = new URL(req.url || "/", "http://127.0.0.1");
            const pathname = url.pathname;

            if (pathname === "/api/local-agent/codex-status" && req.method === "GET") {
                const codex = detectCodexInstalled();
                writeJson(res, { ok: true, installed: codex.installed, source: codex.source || "" });
                return;
            }

            if (pathname === "/api/local-agent/cursor-status" && req.method === "GET") {
                writeJson(res, { ok: true, ...detectCursorCliInstalled(isPackaged) });
                return;
            }

            if (pathname === "/api/local-agent/config" && req.method === "GET") {
                if (!(await isLocalAgentReady())) {
                    writeJson(res, { ok: false }, 503);
                    return;
                }
                const info = readLocalAgentConnectInfo();
                if (!info) {
                    writeJson(res, { ok: false, error: "missing local agent config" }, 503);
                    return;
                }
                writeJson(res, { ok: true, ...info });
                return;
            }

            if (pathname === "/api/local-agent/start" && req.method === "POST") {
                const body = await readJsonBody(req);
                const cursorApiKey = String(body.cursorApiKey || "").trim();
                if (await isLocalAgentReady()) {
                    if (!cursorApiKey || cursorApiKey === lastSpawnedCursorApiKey) {
                        writeJson(res, { ok: true, alreadyRunning: true });
                        return;
                    }
                    stopLocalAgent();
                    const deadline = Date.now() + 3000;
                    while (Date.now() < deadline && await isLocalAgentReady()) {
                        await new Promise((resolve) => setTimeout(resolve, 200));
                    }
                }
                const spawned = spawnLocalAgent({ isPackaged, allowNpxFallback, cursorApiKey });
                lastSpawnedCursorApiKey = cursorApiKey;
                const died = await waitChildExit(spawned.child, 2000);
                if (died) {
                    const detail = died.error || `退出码 ${died.code ?? "?"}${died.signal ? ` / ${died.signal}` : ""}`;
                    const log = readSpawnLogTail();
                    writeJson(res, { ok: false, error: log ? `本地 Agent 启动失败（${detail}）\n${log}` : `本地 Agent 启动失败（${detail}）` }, 500);
                    return;
                }
                writeJson(res, { ok: true, alreadyRunning: false });
                return;
            }

            if (typeof next === "function") next();
            else {
                res.statusCode = 404;
                res.end("Not Found");
            }
        } catch (error) {
            writeJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
        }
    };
}

module.exports = {
    DEFAULT_AGENT_URL,
    resolveAgentRoot,
    detectCodexInstalled,
    readLocalAgentConnectInfo,
    isLocalAgentReady,
    spawnLocalAgent,
    waitChildExit,
    stopLocalAgent,
    createLocalAgentMiddleware,
};
