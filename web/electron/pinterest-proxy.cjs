const https = require("node:https");
const { getPinterestAgent } = require("./system-proxy.cjs");

const UPSTREAMS = {
    "/api/pinterest": { base: "https://api.pinterest.com", label: "Pinterest" },
    "/api/pinimg": { base: "https://i.pinimg.com", label: "Pinterest CDN" },
};

function matchPinterestProxy(pathname) {
    if (pathname === "/api/pinterest" || pathname.startsWith("/api/pinterest/")) return { prefix: "/api/pinterest", ...UPSTREAMS["/api/pinterest"] };
    if (pathname === "/api/pinimg" || pathname.startsWith("/api/pinimg/")) return { prefix: "/api/pinimg", ...UPSTREAMS["/api/pinimg"] };
    return null;
}

function handlePinterestProxy(req, res) {
    const pathname = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0] || "/");
    const matched = matchPinterestProxy(pathname);
    if (!matched) return false;

    const upstreamPath = pathname.slice(matched.prefix.length) || "/";
    const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const base = new URL(matched.base);
    const target = new URL(`${base.pathname.replace(/\/+$/, "")}${upstreamPath}${search}`, base.origin);
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
        const body = Buffer.concat(chunks);
        const headers = { ...req.headers, host: target.host };
        delete headers.origin;
        delete headers.referer;
        const upstream = https.request(
            target,
            {
                method: req.method,
                headers,
                agent: getPinterestAgent() || undefined,
            },
            (upstreamRes) => {
                res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
                upstreamRes.pipe(res);
            },
        );
        upstream.on("error", (error) => {
            res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(`${matched.label} proxy error: ${error.message}`);
        });
        if (body.length) upstream.write(body);
        upstream.end();
    });
    return true;
}

module.exports = { handlePinterestProxy, matchPinterestProxy, getPinterestAgent };
