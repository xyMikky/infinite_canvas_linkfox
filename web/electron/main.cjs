const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createLinkfoxOssUploadMiddleware } = require("./linkfox-oss-upload.cjs");
const { createKlingCliMiddleware, stopKlingCliProcesses } = require("./kling-cli-host.cjs");
const { createDreaminaCliMiddleware, stopDreaminaCliProcesses } = require("./dreamina-cli-host.cjs");
const { createLocalAgentMiddleware, stopLocalAgent } = require("./local-agent-host.cjs");
const { getPinterestAgent } = require("./system-proxy.cjs");
const { handleRhFileProxy } = require("./rh-file-proxy.cjs");
const { ensureLanFirewallRule, removeLanFirewallRule } = require("./lan-firewall.cjs");
const { handleRoomHttp, attachRoomWebSocket } = require("./canvas-room-server.cjs");
const { listLanShareUrls: buildLanShareUrls } = require("./lan-share-urls.cjs");
const { applyInstalledDataDir } = require("./installed-data-dir.cjs");

let dataDirectoryError = null;
try { applyInstalledDataDir(app); }
catch (error) { dataDirectoryError = error; }
if (app.isPackaged && !dataDirectoryError) process.env.INFINITE_CANVAS_AGENT_HOME = path.join(app.getPath("userData"), "agent");
if (app.isPackaged && !dataDirectoryError) process.env.INFINITE_CANVAS_AGENT_HOME = path.join(app.getPath("userData"), "agent");

const IO_DIR_MARKER = ".infinite-canvas-io-dir";

/** 记录 Input/Output 路径供卸载读取，并在目录内写入标记（无标记则卸载不会清理该目录）。 */
function persistIoPaths(inputPath, outputPath) {
    const input = typeof inputPath === "string" ? inputPath.trim() : "";
    const output = typeof outputPath === "string" ? outputPath.trim() : "";
    const body = `${input}\n${output}\n`;
    const targets = [path.join(app.getPath("userData"), "io-paths.txt")];
    if (app.isPackaged) {
        try {
            targets.push(path.join(path.dirname(app.getPath("exe")), "io-paths.txt"));
        } catch {
            // ignore
        }
    }
    for (const file of targets) {
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, body, "utf8");
        } catch (error) {
            console.error("[io-paths] 写入失败", file, error);
        }
    }
    for (const dir of [input, output]) {
        if (!dir) continue;
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, IO_DIR_MARKER), "InfiniteCanvas IO directory\n", "utf8");
        } catch (error) {
            console.error("[io-paths] 标记失败", dir, error);
        }
    }
}

const handleLinkfoxOssUpload = createLinkfoxOssUploadMiddleware();
const handleKlingCli = createKlingCliMiddleware({ isPackaged: app.isPackaged });
const handleDreaminaCli = createDreaminaCliMiddleware({ isPackaged: app.isPackaged });
const handleLocalAgent = createLocalAgentMiddleware({ isPackaged: app.isPackaged, allowNpxFallback: !app.isPackaged });

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json",
};

const LINKFOX_UPSTREAM = "https://tool-gateway.linkfox.com";
const LINKFOX_PROXY_PREFIX = "/api/linkfox";
const RUNNINGHUB_UPSTREAM = "https://www.runninghub.ai/openapi/v2";
const RUNNINGHUB_PROXY_PREFIX = "/api/runninghub";
const RUNNINGHUB_CN_UPSTREAM = "https://www.runninghub.cn/openapi/v2";
const RUNNINGHUB_CN_PROXY_PREFIX = "/api/runninghub-cn";
const RUNNINGHUB_CN_TASK_PREFIX = "/api/rh-cn-task";
const RUNNINGHUB_CN_TASK_UPSTREAM = "https://www.runninghub.cn";
const PINTEREST_UPSTREAM = "https://api.pinterest.com";
const PINTEREST_PROXY_PREFIX = "/api/pinterest";
const PINIMG_UPSTREAM = "https://i.pinimg.com";
const PINIMG_PROXY_PREFIX = "/api/pinimg";

/** 固定本机端口：IndexedDB / localforage 按 origin（含端口）隔离，随机端口会导致重启后画布丢失。 */
const DESKTOP_UI_PORT = 17370;
const LAN_SHARE_FILE = "lan-share.txt";

let mainWindow = null;
let staticServer = null;
let lanShareEnabled = false;
let lanShareTask = Promise.resolve();

function clearPersistedLanShare() {
    try {
        fs.unlinkSync(path.join(app.getPath("userData"), LAN_SHARE_FILE));
    } catch {
        // 旧版曾写入该文件；开关不再持久化
    }
}

function desktopListenHost(enabled) {
    return enabled ? "0.0.0.0" : "127.0.0.1";
}

/** 局域网共享只服务静态画布；Agent / CLI 等敏感 API 仅本机环回可访问 */
function isLoopbackRemoteAddress(addr) {
    const value = String(addr || "").replace(/^::ffff:/i, "");
    return value === "127.0.0.1" || value === "::1" || value === "localhost";
}

function rejectUnlessLoopback(req, res) {
    if (isLoopbackRemoteAddress(req.socket?.remoteAddress)) return false;
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "敏感接口仅允许本机访问" }));
    return true;
}

function listLanShareUrls(sharePath = "/canvas") {
    return buildLanShareUrls(DESKTOP_UI_PORT, sharePath);
}

async function lanShareFirewall(enabled) {
    if (!enabled) {
        await removeLanFirewallRule(DESKTOP_UI_PORT);
        return { firewallOk: true };
    }
    const result = await ensureLanFirewallRule(DESKTOP_UI_PORT);
    return result.ok ? { firewallOk: true } : { firewallOk: false, firewallError: result.error };
}

function lanShareInfo(enabled, extra = {}) {
    return {
        ok: true,
        enabled,
        port: DESKTOP_UI_PORT,
        urls: enabled ? listLanShareUrls() : [],
        ...extra,
    };
}

function stopStaticServer() {
    return new Promise((resolve) => {
        if (!staticServer) {
            resolve();
            return;
        }
        const server = staticServer;
        staticServer = null;
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        if (typeof server.closeAllConnections === "function") server.closeAllConnections();
        server.close(done);
        setTimeout(done, 1500);
    });
}

async function setLanShareEnabledNow(enabled) {
    const next = Boolean(enabled);
    if (next === lanShareEnabled && staticServer) {
        const firewall = await lanShareFirewall(next);
        return lanShareInfo(next, firewall);
    }
    const distRoot = getDistRoot();
    await stopStaticServer();
    const { server } = await startStaticServer(distRoot, desktopListenHost(next));
    staticServer = server;
    lanShareEnabled = next;
    const firewall = await lanShareFirewall(next);
    return lanShareInfo(next, firewall);
}

function setLanShareEnabled(enabled) {
    lanShareTask = lanShareTask.then(
        () => setLanShareEnabledNow(enabled),
        () => setLanShareEnabledNow(enabled),
    );
    return lanShareTask;
}

function getDistRoot() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, "dist");
    }
    return path.join(__dirname, "..", "dist");
}

function proxyUpstream(req, res, pathname, proxyPrefix, upstreamBase, label, agent) {
    const upstreamPath = pathname.slice(proxyPrefix.length) || "/";
    const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    // 上游带基础路径（如 /openapi/v2）时必须保留：new URL("/query", base) 会把它整段丢掉
    const base = new URL(upstreamBase);
    const target = new URL(`${base.pathname.replace(/\/+$/, "")}${upstreamPath}${search}`, base.origin);
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
        const body = Buffer.concat(chunks);
        const headers = { ...req.headers, host: target.host };
        delete headers["origin"];
        delete headers["referer"];
        const upstream = https.request(
            target,
            {
                method: req.method,
                headers,
                agent: agent || undefined,
            },
            (upstreamRes) => {
                res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
                upstreamRes.pipe(res);
            },
        );
        upstream.on("error", (error) => {
            res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(`${label} proxy error: ${error.message}`);
        });
        if (body.length) upstream.write(body);
        upstream.end();
    });
}

function startStaticServer(root, host) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            try {
                const rawUrl = req.url || "/";
                const pathname = decodeURIComponent(rawUrl.split("?")[0].split("#")[0] || "/");
                if (pathname.startsWith("/api/rooms")) {
                    const query = new URL(rawUrl, "http://127.0.0.1").searchParams;
                    void handleRoomHttp(req, res, pathname, query, {
                        listLanShareUrls: (sharePath) => listLanShareUrls(sharePath),
                    });
                    return;
                }
                if (pathname === "/api/linkfox-oss-upload") {
                    handleLinkfoxOssUpload(req, res);
                    return;
                }
                if (pathname.startsWith("/api/local-agent/") || pathname.startsWith("/api/agent-proxy")) {
                    if (rejectUnlessLoopback(req, res)) return;
                    void handleLocalAgent(req, res, () => {
                        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
                        res.end("Not Found");
                    });
                    return;
                }
                if (pathname.startsWith("/api/kling-cli/")) {
                    if (rejectUnlessLoopback(req, res)) return;
                    void handleKlingCli(req, res, () => {
                        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
                        res.end("Not Found");
                    });
                    return;
                }
                if (pathname.startsWith("/api/dreamina-cli/")) {
                    if (rejectUnlessLoopback(req, res)) return;
                    void handleDreaminaCli(req, res, () => {
                        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
                        res.end("Not Found");
                    });
                    return;
                }
                if (pathname === "/api/linkfox-v3" || pathname.startsWith("/api/linkfox-v3/")) {
                    proxyUpstream(req, res, pathname, "/api/linkfox-v3", "https://ai-api.linkfox.com", "LinkFox V3");
                    return;
                }
                if (pathname === LINKFOX_PROXY_PREFIX || pathname.startsWith(`${LINKFOX_PROXY_PREFIX}/`)) {
                    proxyUpstream(req, res, pathname, LINKFOX_PROXY_PREFIX, LINKFOX_UPSTREAM, "LinkFox");
                    return;
                }
                if (handleRhFileProxy(req, res)) return;
                if (pathname === RUNNINGHUB_CN_TASK_PREFIX || pathname.startsWith(`${RUNNINGHUB_CN_TASK_PREFIX}/`)) {
                    proxyUpstream(req, res, pathname, RUNNINGHUB_CN_TASK_PREFIX, RUNNINGHUB_CN_TASK_UPSTREAM, "RunningHub CN Task", getPinterestAgent());
                    return;
                }
                if (pathname === RUNNINGHUB_CN_PROXY_PREFIX || pathname.startsWith(`${RUNNINGHUB_CN_PROXY_PREFIX}/`)) {
                    proxyUpstream(req, res, pathname, RUNNINGHUB_CN_PROXY_PREFIX, RUNNINGHUB_CN_UPSTREAM, "RunningHub CN", getPinterestAgent());
                    return;
                }
                if (pathname === RUNNINGHUB_PROXY_PREFIX || pathname.startsWith(`${RUNNINGHUB_PROXY_PREFIX}/`)) {
                    proxyUpstream(req, res, pathname, RUNNINGHUB_PROXY_PREFIX, RUNNINGHUB_UPSTREAM, "RunningHub", getPinterestAgent());
                    return;
                }
                if (pathname === PINTEREST_PROXY_PREFIX || pathname.startsWith(`${PINTEREST_PROXY_PREFIX}/`)) {
                    proxyUpstream(req, res, pathname, PINTEREST_PROXY_PREFIX, PINTEREST_UPSTREAM, "Pinterest", getPinterestAgent());
                    return;
                }
                if (pathname === PINIMG_PROXY_PREFIX || pathname.startsWith(`${PINIMG_PROXY_PREFIX}/`)) {
                    proxyUpstream(req, res, pathname, PINIMG_PROXY_PREFIX, PINIMG_UPSTREAM, "Pinterest CDN", getPinterestAgent());
                    return;
                }
                let filePath = path.join(root, pathname === "/" ? "index.html" : pathname);
                const relative = path.relative(root, filePath);
                if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
                    throw Object.assign(new Error("页面资源不存在"), { code: "ENOENT" });
                }

                if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
                    if (path.extname(pathname)) throw Object.assign(new Error("页面资源不存在"), { code: "ENOENT" });
                    filePath = path.join(root, "index.html");
                }

                // 完整读取成功后再返回响应，异步文件错误也由下方 catch 处理。
                const content = await fsp.readFile(filePath);
                if (res.destroyed) return;
                const ext = path.extname(filePath).toLowerCase();
                res.writeHead(200, {
                    "Content-Type": MIME[ext] || "application/octet-stream",
                    "Cache-Control": ext === ".html" ? "no-store" : "no-cache",
                });
                res.end(content);
            } catch (error) {
                if (res.destroyed) return;
                if (res.headersSent) { res.destroy(); return; }
                res.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
                res.end(error.code === "ENOENT" ? "页面资源不存在，请重新启动应用。" : "页面资源读取失败，请重新启动应用。");
            }
        });

        attachRoomWebSocket(server);

        const listenHost = host || "127.0.0.1";
        server.once("error", (error) => {
            if (error && error.code === "EADDRINUSE") {
                reject(new Error(`桌面端固定端口已被占用：${listenHost}:${DESKTOP_UI_PORT}\n请关闭占用该端口的进程后重试。`));
                return;
            }
            reject(error);
        });
        server.listen(DESKTOP_UI_PORT, listenHost, () => {
            resolve({ server, port: DESKTOP_UI_PORT, host: listenHost });
        });
    });
}

async function createWindow() {
    const distRoot = getDistRoot();
    if (!fs.existsSync(path.join(distRoot, "index.html"))) {
        throw new Error(`未找到前端构建产物：${distRoot}\n请先执行 npm run build`);
    }

    clearPersistedLanShare();
    lanShareEnabled = false;
    const { server, port } = await startStaticServer(distRoot, desktopListenHost(false));
    staticServer = server;

    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        title: "无限画布",
        icon: path.join(__dirname, "icon.ico"),
        autoHideMenuBar: true,
        backgroundColor: "#0f0f0f",
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: false,
        },
    });

    // 只刷新 HTTP 资源缓存；保留原 origin、IndexedDB 和画布用户数据。
    await mainWindow.webContents.session.clearCache().catch(error => console.warn("[startup] 页面缓存刷新失败", error));
    await mainWindow.loadURL(`http://127.0.0.1:${port}/canvas`);

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

async function directorySize(dirPath, maxBytes = 0) {
    let total = 0;
    const stack = [dirPath];
    while (stack.length) {
        const current = stack.pop();
        let entries = [];
        try {
            entries = await fsp.readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (entry.isFile()) {
                try {
                    total += (await fsp.stat(full)).size;
                } catch {
                    // skip
                }
                // 超过复制上限即可停止，避免为「是否复制」扫完整 10G+ 目录
                if (maxBytes > 0 && total > maxBytes) return total;
            }
        }
    }
    return total;
}

function registerDesktopIpc() {
    ipcMain.handle("desktop:select-directory", async () => {
        const result = await dialog.showOpenDialog(mainWindow || undefined, {
            properties: ["openDirectory", "createDirectory"],
        });
        if (result.canceled || !result.filePaths[0]) return "";
        return result.filePaths[0];
    });
    ipcMain.handle("desktop:default-canvas-data-dir", () => path.join(app.getPath("userData"), "canvas-data"));
    ipcMain.handle("desktop:user-data-dir", () => app.getPath("userData"));
    ipcMain.handle("desktop:set-io-paths", (_event, inputPath, outputPath) => {
        persistIoPaths(inputPath, outputPath);
        return { ok: true };
    });
    ipcMain.handle("desktop:get-lan-share", async () => {
        const firewall = lanShareEnabled ? await lanShareFirewall(true) : { firewallOk: true };
        return lanShareInfo(lanShareEnabled, firewall);
    });
    ipcMain.handle("desktop:set-lan-share", async (_event, enabled) => {
        try {
            return await setLanShareEnabled(enabled);
        } catch (error) {
            return {
                ok: false,
                enabled: lanShareEnabled,
                port: DESKTOP_UI_PORT,
                urls: lanShareEnabled ? listLanShareUrls() : [],
                error: error instanceof Error ? error.message : String(error),
            };
        }
    });
    ipcMain.handle("desktop:dir-size", async (_event, dirPath, maxBytes) => {
        if (!dirPath || typeof dirPath !== "string") return 0;
        try {
            const stat = await fsp.stat(dirPath);
            if (!stat.isDirectory()) return stat.size || 0;
            const limit = Number(maxBytes);
            return await directorySize(dirPath, Number.isFinite(limit) && limit > 0 ? limit : 0);
        } catch {
            return 0;
        }
    });
    ipcMain.handle("desktop:copy-dir", async (_event, src, dest) => {
        try {
            if (!src || !dest) return { ok: false, error: "invalid path" };
            await fsp.mkdir(path.dirname(dest), { recursive: true });
            await fsp.cp(src, dest, { recursive: true, force: true, errorOnExist: false });
            return { ok: true };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    ipcMain.handle("desktop:delete-dir", async (_event, dirPath, allowedRoot) => {
        try {
            if (!dirPath || !allowedRoot || typeof dirPath !== "string" || typeof allowedRoot !== "string") return { ok: false, error: "invalid path" };
            const target = path.resolve(dirPath);
            const root = path.resolve(allowedRoot);
            if (target === root || !target.startsWith(root + path.sep)) return { ok: false, error: "outside data dir" };
            const parts = path.relative(root, target).split(path.sep);
            if (parts[0] !== "folders" || parts.length !== 2 || !String(parts[1]).startsWith("asset-")) return { ok: false, error: "not a project folder copy" };
            await fsp.rm(target, { recursive: true, force: true });
            return { ok: true };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    ipcMain.handle("desktop:read-file", async (_event, filePath) => {
        try {
            if (!filePath || typeof filePath !== "string") return { ok: false, error: "invalid path" };
            const buf = await fsp.readFile(filePath);
            return { ok: true, dataBase64: buf.toString("base64"), bytes: buf.length };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    /** 递归列出目录内文件（相对路径），供 Codex 联网产物挂回画布 */
    ipcMain.handle("desktop:list-directory", async (_event, dirPath) => {
        try {
            if (!dirPath || typeof dirPath !== "string") return { ok: false, error: "invalid path", entries: [] };
            const root = path.resolve(dirPath);
            const entries = [];
            const walk = async (dir, prefix = "", depth = 0) => {
                if (depth > 4 || entries.length >= 200) return;
                const items = await fsp.readdir(dir, { withFileTypes: true });
                for (const item of items) {
                    if (item.name.startsWith(".") || entries.length >= 200) continue;
                    const relative = prefix ? `${prefix}/${item.name}` : item.name;
                    if (item.isDirectory()) {
                        await walk(path.join(dir, item.name), relative, depth + 1);
                        continue;
                    }
                    const info = await fsp.stat(path.join(dir, item.name)).catch(() => null);
                    if (info?.isFile()) entries.push({ path: relative, size: info.size });
                }
            };
            await walk(root);
            return { ok: true, entries };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error), entries: [] };
        }
    });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });

    app.whenReady().then(async () => {
        if (dataDirectoryError) {
            dialog.showErrorBox("画布数据目录无法安全打开", `${dataDirectoryError.message}\n\n已停止启动，原数据没有改动。请检查磁盘、目录权限或使用新版安装器修复数据目录登记。`);
            app.quit();
            return;
        }
        registerDesktopIpc();
        try {
            await createWindow();
        } catch (error) {
            console.error(error);
            dialog.showErrorBox("画布启动失败", error instanceof Error ? error.message : String(error));
            app.quit();
        }

        app.on("activate", async () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                await createWindow();
            }
        });
    });
}

app.on("before-quit", () => {
    stopKlingCliProcesses();
    stopDreaminaCliProcesses();
    stopLocalAgent();
});

app.on("window-all-closed", () => {
    if (staticServer) {
        staticServer.close();
        staticServer = null;
    }
    if (process.platform !== "darwin") app.quit();
});

void pathToFileURL;
