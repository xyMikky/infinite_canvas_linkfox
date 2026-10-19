const { execSync } = require("node:child_process");
const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");

const LOCAL_NO_PROXY = ["localhost", "127.0.0.1", "::1"];

function envProxyUrl(env = process.env) {
    return (
        env.HTTPS_PROXY ||
        env.https_proxy ||
        env.HTTP_PROXY ||
        env.http_proxy ||
        env.ALL_PROXY ||
        env.all_proxy ||
        ""
    ).trim();
}

function envHasProxy(env, name) {
    return Boolean(String(env[name] || env[name.toLowerCase()] || "").trim());
}

function normalizeProxyUrl(raw) {
    const value = String(raw || "").trim();
    if (!value) return "";
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
    return `http://${value}`;
}

function parseWindowsProxyServer(value) {
    const parts = String(value || "")
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean);
    if (parts.length === 1 && !parts[0].includes("=")) return normalizeProxyUrl(parts[0]);
    const map = {};
    for (const part of parts) {
        const eq = part.indexOf("=");
        if (eq < 0) continue;
        map[part.slice(0, eq).toLowerCase()] = part.slice(eq + 1);
    }
    return normalizeProxyUrl(map.https || map.http || map.socks || "");
}

function readWindowsSystemProxy() {
    if (process.platform !== "win32") return "";
    try {
        const out = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"', { encoding: "utf8", windowsHide: true });
        if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(out)) return "";
        const match = out.match(/ProxyServer\s+REG_SZ\s+(.+)/i);
        return match ? parseWindowsProxyServer(match[1].trim()) : "";
    } catch {
        return "";
    }
}

function readMacSystemProxy() {
    if (process.platform !== "darwin") return "";
    try {
        const out = execSync("scutil --proxy", { encoding: "utf8", timeout: 3000 });
        const field = (name) => (out.match(new RegExp(`${name}\\s*:\\s*(.+)`, "i")) || [])[1]?.trim() || "";
        const httpsOn = field("HTTPSEnable") === "1";
        const httpOn = field("HTTPEnable") === "1";
        const host = httpsOn ? field("HTTPSProxy") : httpOn ? field("HTTPProxy") : "";
        const port = httpsOn ? field("HTTPSPort") : httpOn ? field("HTTPPort") : "";
        return host ? normalizeProxyUrl(port ? `${host}:${port}` : host) : "";
    } catch {
        return "";
    }
}

function mergeNoProxy(existing) {
    const parts = String(existing || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const seen = new Set(parts.map((item) => item.toLowerCase()));
    for (const item of LOCAL_NO_PROXY) {
        if (!seen.has(item.toLowerCase())) parts.push(item);
    }
    return parts.join(",");
}

function resolveSystemProxyUrl(env = process.env) {
    return normalizeProxyUrl(envProxyUrl(env)) || readWindowsSystemProxy() || readMacSystemProxy();
}

/** 只改传入的进程环境副本，不写 ~/.codex。已有代理变量不覆盖。 */
function applySystemProxyEnv(env = process.env) {
    const next = { ...env };
    const proxyUrl = resolveSystemProxyUrl(next);
    if (!proxyUrl) return next;
    if (!envHasProxy(next, "HTTP_PROXY")) next.HTTP_PROXY = proxyUrl;
    if (!envHasProxy(next, "HTTPS_PROXY")) next.HTTPS_PROXY = proxyUrl;
    next.NO_PROXY = mergeNoProxy(next.NO_PROXY || next.no_proxy);
    return next;
}

let cachedProxyUrl;
let cachedAgent;

class SystemHttpsProxyAgent extends https.Agent {
    constructor(proxyUrl) {
        super({ keepAlive: true });
        this.proxy = new URL(proxyUrl);
    }

    createConnection(options, callback) {
        const host = options.servername || options.host;
        const port = Number(options.port) || 443;
        const proxyPort = Number(this.proxy.port) || (this.proxy.protocol === "https:" ? 443 : 80);
        const headers = { Host: `${host}:${port}` };
        if (this.proxy.username || this.proxy.password) {
            headers["Proxy-Authorization"] = `Basic ${Buffer.from(`${decodeURIComponent(this.proxy.username)}:${decodeURIComponent(this.proxy.password)}`).toString("base64")}`;
        }
        const connectReq = (this.proxy.protocol === "https:" ? https : http).request({
            host: this.proxy.hostname,
            port: proxyPort,
            method: "CONNECT",
            path: `${host}:${port}`,
            headers,
        });
        const done = (error, socket) => {
            if (typeof callback === "function") callback(error, socket);
            else if (error) throw error;
        };
        connectReq.once("connect", (res, socket) => {
            if (res.statusCode !== 200) {
                socket.destroy();
                done(new Error(`Proxy CONNECT ${res.statusCode}`));
                return;
            }
            const tlsSocket = tls.connect({ host, port, socket, servername: host });
            tlsSocket.once("secureConnect", () => done(null, tlsSocket));
            tlsSocket.once("error", done);
        });
        connectReq.once("error", done);
        connectReq.end();
        return undefined;
    }
}

/** 每次按当前环境变量 / 当前用户的系统代理解析；地址变了才换 Agent，不写死端口 */
function getPinterestAgent() {
    const proxyUrl = resolveSystemProxyUrl();
    if (cachedProxyUrl !== proxyUrl) {
        cachedProxyUrl = proxyUrl;
        cachedAgent = proxyUrl ? new SystemHttpsProxyAgent(proxyUrl) : null;
    }
    return cachedAgent;
}

module.exports = { resolveSystemProxyUrl, applySystemProxyEnv, getPinterestAgent };
