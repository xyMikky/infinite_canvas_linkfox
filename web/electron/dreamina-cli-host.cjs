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
const loginState = { deviceCode: "", verificationUri: "", userCode: "", startedAt: 0 };

function resolveDreaminaBinary(isPackaged) {
    const name = process.platform === "win32" ? "dreamina.exe" : "dreamina";
    if (isPackaged) {
        const packaged = path.join(process.resourcesPath, "dreamina-cli", name);
        if (fs.existsSync(packaged)) return packaged;
    }
    const local = path.join(__dirname, "dreamina-cli", name);
    if (fs.existsSync(local)) return local;
    return "";
}

function dreaminaBinDir(isPackaged) {
    return isPackaged ? path.join(process.resourcesPath, "dreamina-cli") : path.join(__dirname, "dreamina-cli");
}

function dreaminaRuntimeEnv(isPackaged, env = process.env) {
    const currentPath = String(env.PATH || env.Path || "");
    const nextPath = [dreaminaBinDir(isPackaged), currentPath].filter(Boolean).join(path.delimiter);
    return applySystemProxyEnv({
        ...env,
        PATH: nextPath,
        Path: nextPath,
        DREAMINA_NONINTERACTIVE: "1",
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

function stopDreaminaCliProcesses() {
    for (const child of activeProcesses.values()) killProcess(child);
    activeProcesses.clear();
}

function writeJson(res, body, status = 200) {
    const payload = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(payload);
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error("请求体过大"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            if (!chunks.length) return resolve({});
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch (error) {
                reject(error);
            }
        });
        req.on("error", reject);
    });
}

function runDreamina(isPackaged, args, options = {}) {
    const binary = resolveDreaminaBinary(isPackaged);
    if (!binary) return Promise.reject(new Error("未找到内置即梦 CLI，请先执行 npm run fetch:dreamina-cli"));
    const requestId = options.requestId || crypto.randomUUID();
    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, {
            env: dreaminaRuntimeEnv(isPackaged),
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
            cwd: options.cwd || undefined,
        });
        activeProcesses.set(requestId, child);
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.once("error", (error) => {
            activeProcesses.delete(requestId);
            reject(error);
        });
        child.once("exit", (code) => {
            activeProcesses.delete(requestId);
            const text = `${stdout}\n${stderr}`.trim();
            if (code !== 0 && !options.allowNonZero) {
                reject(new Error(extractErrorMessage(text) || `即梦 CLI 退出码 ${code}`));
                return;
            }
            resolve({ stdout: stdout.trim(), stderr: stderr.trim(), text, code: code || 0, body: parseDreaminaOutput(stdout || text) });
        });
    });
}

function extractErrorMessage(text) {
    const line = String(text || "")
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
        .pop();
    return line || "";
}

function parseDreaminaOutput(text) {
    const raw = String(text || "").trim();
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch {
        // continue
    }
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch {
            // continue
        }
    }
    const result = {};
    for (const line of raw.split(/\r?\n/)) {
        const match = /^\s*([A-Za-z0-9_]+)\s*[:=]\s*(.+?)\s*$/.exec(line);
        if (match) result[match[1]] = match[2];
    }
    result._raw = raw;
    return result;
}

function parseDeviceFlow(text) {
    const body = parseDreaminaOutput(text);
    const verificationUri = String(body.verification_uri || body.verificationUri || "").trim() || (String(text).match(/verification_uri:\s*(\S+)/i) || [])[1] || "";
    const userCode = String(body.user_code || body.userCode || "").trim() || (String(text).match(/user_code:\s*(\S+)/i) || [])[1] || "";
    const deviceCode = String(body.device_code || body.deviceCode || "").trim() || (String(text).match(/device_code:\s*(\S+)/i) || [])[1] || "";
    return { verificationUri, userCode, deviceCode, body };
}

async function getLoginStatus(isPackaged) {
    const binary = resolveDreaminaBinary(isPackaged);
    if (!binary) return { available: false, loggedIn: false, loginRunning: Boolean(activeProcesses.get("login")) };
    try {
        const result = await runDreamina(isPackaged, ["user_credit"], { requestId: `credit-${Date.now()}` });
        return { available: true, loggedIn: true, loginRunning: Boolean(activeProcesses.get("login")), account: result.body, version: readBundledVersion(isPackaged) };
    } catch {
        return { available: true, loggedIn: false, loginRunning: Boolean(activeProcesses.get("login")), version: readBundledVersion(isPackaged) };
    }
}

function readBundledVersion(isPackaged) {
    try {
        const file = path.join(dreaminaBinDir(isPackaged), "version.json");
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return null;
    }
}

async function startLogin(isPackaged) {
    const current = activeProcesses.get("login");
    if (current && current.exitCode == null) {
        return { ...loginState, alreadyRunning: true };
    }
    const binary = resolveDreaminaBinary(isPackaged);
    if (!binary) throw new Error("未找到内置即梦 CLI");
    const result = await runDreamina(isPackaged, ["login", "--headless"], { requestId: `login-headless-${Date.now()}`, allowNonZero: true });
    const flow = parseDeviceFlow(`${result.stdout}\n${result.stderr}\n${result.text}`);
    if (!flow.deviceCode) throw new Error(extractErrorMessage(result.text) || "即梦未返回 device_code");
    loginState.deviceCode = flow.deviceCode;
    loginState.verificationUri = flow.verificationUri;
    loginState.userCode = flow.userCode;
    loginState.startedAt = Date.now();
    return flow;
}

async function checkLogin(isPackaged, deviceCode, pollSeconds = 3) {
    const code = String(deviceCode || loginState.deviceCode || "").trim();
    if (!code) throw new Error("缺少 device_code");
    const args = ["login", "checklogin", `--device_code=${code}`, `--poll=${Math.max(1, Math.min(30, Number(pollSeconds) || 3))}`];
    const result = await runDreamina(isPackaged, args, { requestId: `login-check-${Date.now()}`, allowNonZero: true });
    const status = await getLoginStatus(isPackaged);
    return { ...result.body, loggedIn: status.loggedIn, raw: result.text };
}

async function materializeImages(images) {
    if (!Array.isArray(images) || !images.length) return { dir: "", paths: [] };
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "infinite-canvas-dreamina-"));
    const paths = [];
    for (let index = 0; index < images.length; index += 1) {
        const value = String(images[index] || "");
        const match = /^data:([^;,]+)?;base64,(.+)$/s.exec(value);
        if (!match) throw new Error("即梦参考图必须是本地图片数据");
        const ext = match[1]?.includes("webp") ? "webp" : match[1]?.includes("jpeg") ? "jpg" : "png";
        const file = path.join(dir, `reference-${index + 1}.${ext}`);
        await fsp.writeFile(file, Buffer.from(match[2], "base64"));
        paths.push(file);
    }
    return { dir, paths };
}

function buildGenerateArgs(input) {
    const command = String(input.command || "").trim();
    const allowed = new Set(["text2image", "image2image", "text2video", "image2video"]);
    if (!allowed.has(command)) throw new Error("不支持的即梦生成命令");
    const prompt = String(input.prompt || "").trim();
    if (!prompt) throw new Error("请输入提示词");
    const model = String(input.model || "").trim();
    const args = [command, `--prompt=${prompt}`];
    if (model) args.push(`--model_version=${model}`);
    const params = input.arguments && typeof input.arguments === "object" ? input.arguments : {};
    for (const [key, raw] of Object.entries(params)) {
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || raw == null || raw === "") continue;
        if (key === "model_version" || key === "prompt") continue;
        args.push(`--${key}=${String(raw)}`);
    }
    if (command === "image2image") {
        const images = input.imagePaths || [];
        if (!images.length) throw new Error("图生图需要参考图");
        args.push(`--images=${images.join(",")}`);
    }
    if (command === "image2video") {
        const image = (input.imagePaths || [])[0];
        if (!image) throw new Error("图生视频需要参考图");
        args.push(`--image=${image}`);
    }
    return args;
}

function collectResultUrls(body, downloadDir) {
    const urls = [];
    const visit = (value) => {
        if (!value) return;
        if (typeof value === "string") {
            if (/^https?:\/\//i.test(value) || value.startsWith("/api/dreamina-cli/resource/")) urls.push(value);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (typeof value === "object") {
            for (const [key, item] of Object.entries(value)) {
                if (/url|uri|path|file/i.test(key) && typeof item === "string") urls.push(item);
                else visit(item);
            }
        }
    };
    visit(body);
    if (downloadDir && fs.existsSync(downloadDir)) {
        for (const name of fs.readdirSync(downloadDir)) {
            const full = path.join(downloadDir, name);
            if (fs.statSync(full).isFile()) {
                const resourceId = crypto.randomUUID();
                resourceUrls.set(resourceId, full);
                urls.push(`/api/dreamina-cli/resource/${resourceId}`);
            }
        }
    }
    return Array.from(new Set(urls));
}

function proxyResource(req, res, target) {
    if (/^https?:\/\//i.test(target)) {
        const client = target.startsWith("https:") ? https : http;
        client
            .get(target, { headers: { "User-Agent": "InfiniteCanvas-Dreamina/1.0" } }, (upstream) => {
                if ((upstream.statusCode || 500) >= 300 && upstream.headers.location) {
                    proxyResource(req, res, new URL(upstream.headers.location, target).toString());
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
        return;
    }
    if (!fs.existsSync(target)) {
        writeJson(res, { ok: false, error: "资源不存在" }, 404);
        return;
    }
    res.statusCode = 200;
    const ext = path.extname(target).toLowerCase();
    res.setHeader("Content-Type", ext === ".mp4" ? "video/mp4" : ext === ".webm" ? "video/webm" : ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream");
    fs.createReadStream(target).pipe(res);
}

function createDreaminaCliMiddleware({ isPackaged = false } = {}) {
    return async (req, res, next) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (!url.pathname.startsWith("/api/dreamina-cli/")) return next();
        try {
            if (req.method === "GET" && url.pathname === "/api/dreamina-cli/status") {
                writeJson(res, { ok: true, ...(await getLoginStatus(isPackaged)) });
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/dreamina-cli/login") {
                const flow = await startLogin(isPackaged);
                writeJson(res, { ok: true, ...flow });
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/dreamina-cli/login/check") {
                const body = await readJsonBody(req);
                const result = await checkLogin(isPackaged, body.deviceCode || body.device_code, body.poll);
                writeJson(res, { ok: true, ...result });
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/dreamina-cli/logout") {
                await runDreamina(isPackaged, ["logout"]);
                loginState.deviceCode = "";
                writeJson(res, { ok: true });
                return;
            }
            if (req.method === "GET" && url.pathname === "/api/dreamina-cli/account") {
                const result = await runDreamina(isPackaged, ["user_credit"]);
                writeJson(res, { ok: true, body: result.body });
                return;
            }
            if (req.method === "GET" && url.pathname === "/api/dreamina-cli/models") {
                writeJson(res, { ok: true, body: { version: readBundledVersion(isPackaged) } });
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/dreamina-cli/generate") {
                const input = await readJsonBody(req);
                const requestId = String(input.requestId || crypto.randomUUID());
                const material = await materializeImages(input.images);
                try {
                    const args = buildGenerateArgs({ ...input, imagePaths: material.paths });
                    const result = await runDreamina(isPackaged, args, { requestId });
                    const submitId = String(result.body.submit_id || result.body.submitId || "").trim();
                    if (!submitId) throw new Error(result.text || "即梦未返回 submit_id");
                    writeJson(res, { ok: true, body: { ...result.body, submit_id: submitId, submitId } });
                } finally {
                    if (material.dir) await fsp.rm(material.dir, { recursive: true, force: true }).catch(() => {});
                }
                return;
            }
            if (req.method === "GET" && url.pathname.startsWith("/api/dreamina-cli/task/")) {
                const submitId = decodeURIComponent(url.pathname.slice("/api/dreamina-cli/task/".length));
                const downloadDir = await fsp.mkdtemp(path.join(os.tmpdir(), "infinite-canvas-dreamina-out-"));
                try {
                    const result = await runDreamina(isPackaged, ["query_result", `--submit_id=${submitId}`, `--download_dir=${downloadDir}`]);
                    const urls = collectResultUrls(result.body, downloadDir);
                    writeJson(res, { ok: true, body: { ...result.body, urls, localUrls: urls } });
                } catch (error) {
                    await fsp.rm(downloadDir, { recursive: true, force: true }).catch(() => {});
                    throw error;
                }
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/dreamina-cli/cancel") {
                const body = await readJsonBody(req);
                const child = activeProcesses.get(String(body.requestId || ""));
                if (child) killProcess(child);
                writeJson(res, { ok: true });
                return;
            }
            if (req.method === "GET" && url.pathname.startsWith("/api/dreamina-cli/resource/")) {
                const resourceId = url.pathname.slice("/api/dreamina-cli/resource/".length);
                const target = resourceUrls.get(resourceId);
                if (!target) {
                    writeJson(res, { ok: false, error: "资源不存在或已过期" }, 404);
                    return;
                }
                proxyResource(req, res, target);
                return;
            }
            writeJson(res, { ok: false, error: "未知即梦接口" }, 404);
        } catch (error) {
            writeJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
        }
    };
}

module.exports = {
    createDreaminaCliMiddleware,
    dreaminaRuntimeEnv,
    dreaminaBinDir,
    resolveDreaminaBinary,
    stopDreaminaCliProcesses,
};
