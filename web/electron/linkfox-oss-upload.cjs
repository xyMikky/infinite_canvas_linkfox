const https = require("node:https");
const http = require("node:http");
const { URL } = require("node:url");

const LINKFOX_UPSTREAM = "https://tool-gateway.linkfox.com";
const PRESIGN_PATH = "/oss/file/presignedPut";

const EXT_BY_MIME = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/heic": "heic",
};

function requestJson(url, { method = "GET", headers = {}, body, timeout = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const lib = target.protocol === "http:" ? http : https;
        const req = lib.request(
            target,
            {
                method,
                headers,
                timeout,
            },
            (res) => {
                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => {
                    const raw = Buffer.concat(chunks);
                    const text = raw.toString("utf8");
                    let json = null;
                    try {
                        json = text ? JSON.parse(text) : null;
                    } catch {
                        json = null;
                    }
                    resolve({ status: res.statusCode || 0, headers: res.headers, text, json, raw });
                });
            },
        );
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Request timed out"));
        });
        if (body) req.write(body);
        req.end();
    });
}

function putBinary(url, body, contentType) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const lib = target.protocol === "http:" ? http : https;
        const req = lib.request(
            target,
            {
                method: "PUT",
                headers: {
                    "Content-Type": contentType,
                    "Content-Length": body.length,
                    "x-oss-object-acl": "public-read",
                },
                timeout: 120_000,
            },
            (res) => {
                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => {
                    resolve({
                        status: res.statusCode || 0,
                        text: Buffer.concat(chunks).toString("utf8"),
                    });
                });
            },
        );
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Upload timed out"));
        });
        req.write(body);
        req.end();
    });
}

function extensionFromMime(mimeType) {
    return EXT_BY_MIME[(mimeType || "").toLowerCase()] || "png";
}

async function uploadBufferToLinkfoxOss({ apiKey, buffer, contentType }) {
    if (!apiKey) throw new Error("Missing Authorization / API Key");
    if (!buffer?.length) throw new Error("Empty image body");

    const mime = contentType || "image/png";
    const fileExtension = extensionFromMime(mime);
    const presign = await requestJson(`${LINKFOX_UPSTREAM}${PRESIGN_PATH}`, {
        method: "POST",
        headers: {
            Authorization: apiKey,
            "Content-Type": "application/json",
            "User-Agent": "InfiniteCanvas-LinkFox/1.0",
        },
        body: Buffer.from(JSON.stringify({ contentType: mime, fileExtension }), "utf8"),
    });

    if (presign.status === 401 || presign.status === 403) {
        throw new Error("LinkFox authentication failed while requesting upload URL");
    }
    if (presign.json?.errcode && presign.json.errcode !== 200) {
        throw new Error(presign.json.errmsg || presign.json.msg || "Failed to get LinkFox upload URL");
    }
    const uploadUrl = typeof presign.json?.url === "string" ? presign.json.url : "";
    if (!uploadUrl) throw new Error(presign.text || "LinkFox did not return a presigned upload URL");

    const uploaded = await putBinary(uploadUrl, buffer, mime);
    if (uploaded.status !== 200 && uploaded.status !== 201) {
        throw new Error(`OSS upload failed (HTTP ${uploaded.status}): ${uploaded.text || "no body"}`);
    }

    return { url: uploadUrl.split("?")[0] };
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

/**
 * Express/Connect-style middleware: POST /api/linkfox-oss-upload
 * Headers: Authorization = LinkFox API Key
 * Body: raw image bytes (Content-Type: image/*) or JSON { dataUrl }
 */
function createLinkfoxOssUploadMiddleware() {
    return async function linkfoxOssUpload(req, res, next) {
        const pathname = (req.url || "").split("?")[0];
        if (pathname !== "/api/linkfox-oss-upload" && !pathname.endsWith("/api/linkfox-oss-upload")) {
            if (typeof next === "function") return next();
            res.statusCode = 404;
            res.end("Not Found");
            return;
        }
        if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
        }

        try {
            const apiKey = String(req.headers.authorization || "").trim();
            const contentType = String(req.headers["content-type"] || "").toLowerCase();
            const body = await readRequestBody(req);

            let buffer;
            let mime = "image/png";

            if (contentType.includes("application/json")) {
                const payload = JSON.parse(body.toString("utf8") || "{}");
                const dataUrl = typeof payload.dataUrl === "string" ? payload.dataUrl : "";
                const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
                if (!match) throw new Error("Invalid dataUrl");
                mime = match[1] || "image/png";
                buffer = Buffer.from(match[2], "base64");
            } else {
                mime = contentType.split(";")[0].trim() || "image/png";
                if (!mime.startsWith("image/")) mime = "image/png";
                buffer = body;
            }

            const result = await uploadBufferToLinkfoxOss({ apiKey, buffer, contentType: mime });
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify(result));
        } catch (error) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
    };
}

module.exports = {
    uploadBufferToLinkfoxOss,
    createLinkfoxOssUploadMiddleware,
};
