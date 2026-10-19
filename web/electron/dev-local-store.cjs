const fs = require("node:fs");
const path = require("node:path");
const send = require("send");
const { createCanvasProjectStorage, writeAtomically } = require("./canvas-project-storage.cjs");

const API_PREFIX = "/api/dev-local-store";
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";

function isLoopbackRemoteAddress(addr) {
    const value = String(addr || "").replace(/^::ffff:/i, "");
    return value === "127.0.0.1" || value === "::1" || value === "localhost";
}

function rejectUnlessLoopback(req, res) {
    if (isLoopbackRemoteAddress(req.socket?.remoteAddress)) return false;
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "dev-local-store 仅允许本机访问" }));
    return true;
}

function sendJson(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

function encodeKey(key) {
    return Buffer.from(String(key), "utf8").toString("base64url");
}

function decodeKey(name) {
    return Buffer.from(String(name), "base64url").toString("utf8");
}

function ensureDirs(rootDir) {
    fs.mkdirSync(rootDir, { recursive: true });
    fs.mkdirSync(path.join(rootDir, "blobs"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "kv"), { recursive: true });
}

function kvFilePath(rootDir, key) {
    if (key === CANVAS_STORE_KEY) return path.join(rootDir, "projects.json");
    return path.join(rootDir, "kv", `${encodeKey(key)}.json`);
}

function blobFilePath(rootDir, key) {
    return path.join(rootDir, "blobs", encodeKey(key));
}

function safeResolveUnder(rootDir, filePath) {
    const resolved = path.resolve(filePath);
    const root = path.resolve(rootDir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
    return resolved;
}

function parsePath(url) {
    const raw = String(url || "").split("?")[0] || "";
    if (!raw.startsWith(API_PREFIX)) return null;
    const rest = raw.slice(API_PREFIX.length) || "/";
    return rest.split("/").filter(Boolean).map((part) => {
        try {
            return decodeURIComponent(part);
        } catch {
            return part;
        }
    });
}

/**
 * @param {{ rootDir: string }} options
 */
function createDevLocalStoreMiddleware(options) {
    const rootDir = path.resolve(options.rootDir);
    ensureDirs(rootDir);
    const projects = createCanvasProjectStorage(rootDir);

    return (req, res, next) => {
        const parts = parsePath(req.url || "");
        if (!parts) {
            next();
            return;
        }
        if (rejectUnlessLoopback(req, res)) return;

        const method = String(req.method || "GET").toUpperCase();
        void (async () => {
            try {
                if (parts.length === 1 && parts[0] === "status" && method === "GET") {
                    sendJson(res, 200, { ok: true, root: rootDir });
                    return;
                }

                if (parts[0] === "canvas-backups" && method === "GET") {
                    if (parts.length === 1) sendJson(res, 200, projects.list());
                    else {
                        const raw = projects.backup(parts[1]);
                        res.setHeader("Content-Type", "application/json; charset=utf-8");
                        res.end(raw);
                    }
                    return;
                }
                if (parts[0] === "canvas-backups" && parts.length === 2 && method === "POST") {
                    if (req.headers["content-type"] !== "application/json") {
                        sendJson(res, 415, { ok: false, error: "恢复请求必须使用 application/json" });
                        return;
                    }
                    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
                        sendJson(res, 403, { ok: false, error: "禁止跨站恢复请求" });
                        return;
                    }
                    projects.restore(parts[1]);
                    sendJson(res, 200, { ok: true });
                    return;
                }

                if (parts.length === 1 && parts[0] === "blobs" && method === "GET") {
                    const dir = path.join(rootDir, "blobs");
                    const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
                    const keys = [];
                    for (const name of names) {
                        try {
                            keys.push(decodeKey(name));
                        } catch {
                            // skip
                        }
                    }
                    sendJson(res, 200, { keys });
                    return;
                }

                if (parts[0] === "kv" && parts.length >= 2) {
                    const key = parts.slice(1).join("/");
                    const filePath = safeResolveUnder(rootDir, kvFilePath(rootDir, key));
                    if (!filePath) {
                        sendJson(res, 400, { ok: false, error: "invalid key" });
                        return;
                    }
                    if (method === "GET") {
                        if (key === CANVAS_STORE_KEY) {
                            const result = projects.read(req.headers["x-canvas-version"]);
                            res.setHeader("ETag", result.revision);
                            res.setHeader("Cache-Control", "no-store");
                            res.setHeader("Content-Type", "application/json; charset=utf-8");
                            res.statusCode = result.raw === null ? 404 : 200;
                            res.end(result.raw);
                            return;
                        }
                        if (!fs.existsSync(filePath)) {
                            res.statusCode = 404;
                            res.end("");
                            return;
                        }
                        res.statusCode = 200;
                        res.setHeader("Content-Type", "application/json; charset=utf-8");
                        res.end(fs.readFileSync(filePath));
                        return;
                    }
                    if (method === "PUT") {
                        const body = await readBody(req);
                        if (key === CANVAS_STORE_KEY) {
                            res.setHeader("ETag", projects.write(body, req.headers["if-match"], req.headers["x-canvas-version"], req.headers["x-canvas-allow-empty"] === "true"));
                            sendJson(res, 200, { ok: true });
                            return;
                        }
                        ensureDirs(rootDir);
                        fs.mkdirSync(path.dirname(filePath), { recursive: true });
                        writeAtomically(filePath, body);
                        sendJson(res, 200, { ok: true });
                        return;
                    }
                    if (method === "DELETE") {
                        if (key === CANVAS_STORE_KEY) {
                            sendJson(res, 405, { ok: false, error: "画布主文件禁止直接删除，请使用带版本校验的项目删除操作" });
                            return;
                        }
                        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                        sendJson(res, 200, { ok: true });
                        return;
                    }
                }

                if (parts[0] === "blob" && parts.length >= 2) {
                    const key = parts.slice(1).join("/");
                    const filePath = safeResolveUnder(rootDir, blobFilePath(rootDir, key));
                    if (!filePath) {
                        sendJson(res, 400, { ok: false, error: "invalid key" });
                        return;
                    }
                    if (method === "GET" || method === "HEAD") {
                        if (!fs.existsSync(filePath)) {
                            res.statusCode = 404;
                            res.end("");
                            return;
                        }
                        res.setHeader("Content-Type", "application/octet-stream");
                        send(req, path.basename(filePath), { root: path.dirname(filePath), cacheControl: false })
                            .on("error", (error) => {
                                if (res.headersSent) res.destroy(error);
                                else sendJson(res, error.statusCode || 500, { ok: false, error: "本地素材读取失败" });
                            })
                            .pipe(res);
                        return;
                    }
                    if (method === "PUT") {
                        const body = await readBody(req);
                        ensureDirs(rootDir);
                        fs.writeFileSync(filePath, body);
                        sendJson(res, 200, { ok: true });
                        return;
                    }
                    if (method === "DELETE") {
                        if (projects.references(key)) {
                            sendJson(res, 409, { ok: false, error: "素材仍被画布或恢复备份引用，已保留" });
                            return;
                        }
                        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                        sendJson(res, 200, { ok: true });
                        return;
                    }
                }

                sendJson(res, 404, { ok: false, error: "not found" });
            } catch (error) {
                sendJson(res, error.status || 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
        })();
    };
}

module.exports = {
    createDevLocalStoreMiddleware,
    CANVAS_STORE_KEY,
};
