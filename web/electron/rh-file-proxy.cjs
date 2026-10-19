const https = require("node:https");
const { getPinterestAgent } = require("./system-proxy.cjs");

function isAllowedRhFileUrl(value) {
    try {
        const target = new URL(value);
        if (target.protocol !== "https:") return false;
        const host = target.hostname.toLowerCase();
        return host.endsWith("myqcloud.com") || host.endsWith("runninghub.cn") || host.endsWith("runninghub.ai") || host.includes("rh-images") || host.includes("rh-videos");
    } catch {
        return false;
    }
}

function handleRhFileProxy(req, res) {
    const raw = req.url || "";
    if (!raw.startsWith("/api/rh-file")) return false;
    const target = new URL(raw, "http://127.0.0.1").searchParams.get("url") || "";
    if (!isAllowedRhFileUrl(target)) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("invalid RunningHub file url");
        return true;
    }
    const dest = new URL(target);
    const headers = { ...req.headers, host: dest.host };
    delete headers.origin;
    delete headers.referer;
    const upstream = https.request(
        dest,
        { method: "GET", headers, agent: getPinterestAgent() || undefined },
        (upstreamRes) => {
            res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
            upstreamRes.pipe(res);
        },
    );
    upstream.on("error", (error) => {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`RH file proxy error: ${error.message}`);
    });
    upstream.end();
    return true;
}

module.exports = { handleRhFileProxy, isAllowedRhFileUrl };
