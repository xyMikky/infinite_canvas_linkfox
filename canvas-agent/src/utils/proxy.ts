import { execFileSync } from "node:child_process";

const LOCAL_NO_PROXY = ["localhost", "127.0.0.1", "::1"];

function envProxyUrl(env: NodeJS.ProcessEnv) {
    return (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy || "").trim();
}

function envHasProxy(env: NodeJS.ProcessEnv, name: "HTTP_PROXY" | "HTTPS_PROXY") {
    return Boolean(String(env[name] || env[name.toLowerCase()] || "").trim());
}

/** 把主机:端口补成 URL；已有协议则原样返回。 */
export function normalizeProxyUrl(raw: string) {
    const value = String(raw || "").trim();
    if (!value) return "";
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
    return `http://${value}`;
}

/** 解析 Windows 注册表 ProxyServer 字段。 */
export function parseWindowsProxyServer(value: string) {
    const parts = String(value || "").split(";").map((item) => item.trim()).filter(Boolean);
    if (parts.length === 1 && !parts[0].includes("=")) return normalizeProxyUrl(parts[0]);
    const map: Record<string, string> = {};
    for (const part of parts) {
        const eq = part.indexOf("=");
        if (eq < 0) continue;
        map[part.slice(0, eq).toLowerCase()] = part.slice(eq + 1);
    }
    return normalizeProxyUrl(map.https || map.http || map.socks || "");
}

/** 解析 macOS `scutil --proxy` 输出。 */
export function parseMacScutilProxy(out: string) {
    const field = (name: string) => (out.match(new RegExp(`${name}\\s*:\\s*(.+)`, "i")) || [])[1]?.trim() || "";
    const httpsOn = field("HTTPSEnable") === "1";
    const httpOn = field("HTTPEnable") === "1";
    const host = httpsOn ? field("HTTPSProxy") : httpOn ? field("HTTPProxy") : "";
    const port = httpsOn ? field("HTTPSPort") : httpOn ? field("HTTPPort") : "";
    return host ? normalizeProxyUrl(port ? `${host}:${port}` : host) : "";
}

export function mergeNoProxy(existing: string) {
    const parts = String(existing || "").split(",").map((item) => item.trim()).filter(Boolean);
    const seen = new Set(parts.map((item) => item.toLowerCase()));
    for (const item of LOCAL_NO_PROXY) {
        if (!seen.has(item.toLowerCase())) parts.push(item);
    }
    return parts.join(",");
}

function readWindowsSystemProxy() {
    if (process.platform !== "win32") return "";
    try {
        const out = execFileSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"], { encoding: "utf8", timeout: 3000, windowsHide: true });
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
        return parseMacScutilProxy(execFileSync("scutil", ["--proxy"], { encoding: "utf8", timeout: 3000 }));
    } catch {
        return "";
    }
}

export function resolveSystemProxyUrl(env: NodeJS.ProcessEnv = process.env) {
    return normalizeProxyUrl(envProxyUrl(env)) || readWindowsSystemProxy() || readMacSystemProxy();
}

/** 只改进程环境副本，不写 ~/.codex。已有代理变量不覆盖。 */
export function applySystemProxyEnv(env: NodeJS.ProcessEnv = process.env) {
    const next = { ...env };
    const proxyUrl = resolveSystemProxyUrl(next);
    if (!proxyUrl) return next;
    if (!envHasProxy(next, "HTTP_PROXY")) next.HTTP_PROXY = proxyUrl;
    if (!envHasProxy(next, "HTTPS_PROXY")) next.HTTPS_PROXY = proxyUrl;
    next.NO_PROXY = mergeNoProxy(String(next.NO_PROXY || next.no_proxy || ""));
    return next;
}

export function proxyLogTarget(proxyUrl: string) {
    try {
        const url = new URL(proxyUrl);
        return `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
    } catch {
        return "set";
    }
}
