const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { WebSocketServer } = require("ws");

const OP_LOG_MAX = 500;
const MEDIA_CACHE_MAX_BYTES = 200 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const FOLDER_NODE_TYPE = "folder";

/** @type {Map<string, Room>} */
const rooms = new Map();

/** @typedef {{ type: string; clientId?: string; opId?: string; [key: string]: unknown }} RoomOp */

/**
 * @typedef {object} Room
 * @property {string} roomId
 * @property {string} token
 * @property {string} projectId
 * @property {import('ws').WebSocket | null} hostSocket
 * @property {string | null} hostClientId
 * @property {number} rev
 * @property {{ nodes: object[]; connections: object[]; title: string; backgroundMode: string }} document
 * @property {RoomOp[]} opLog
 * @property {Map<string, { blob: Buffer; mimeType: string; bytes: number }>} mediaCache
 * @property {number} mediaCacheBytes
 * @property {Map<string, import('http').ServerResponse[]>} pendingMedia
 * @property {Set<string>} mediaKeys
 * @property {Map<string, string>} folderIndex
 * @property {Set<import('ws').WebSocket>} sockets
 * @property {Map<import('ws').WebSocket, { clientId: string; role: string }>} socketMeta
 */

function timingSafeEqual(a, b) {
    const aa = Buffer.from(String(a || ""));
    const bb = Buffer.from(String(b || ""));
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

function writeJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(payload);
}

function sanitizeMetadata(meta) {
    if (!meta || typeof meta !== "object") return meta;
    const next = { ...meta };
    if (next.storageKey && typeof next.content === "string" && next.content.startsWith("data:")) {
        delete next.content;
    }
    if (next.status === "loading") {
        next.status = "idle";
    }
    delete next.mindFocusEdit;
    return next;
}

function sanitizeNode(node) {
    if (!node || typeof node !== "object") return node;
    return {
        ...node,
        metadata: node.metadata ? sanitizeMetadata(node.metadata) : node.metadata,
    };
}

function sanitizeDocument(doc) {
    return {
        title: String(doc?.title || ""),
        backgroundMode: String(doc?.backgroundMode || "lines"),
        nodes: Array.isArray(doc?.nodes) ? doc.nodes.map(sanitizeNode) : [],
        connections: Array.isArray(doc?.connections) ? doc.connections : [],
    };
}

function collectMediaKeys(nodes) {
    const keys = new Set();
    for (const node of nodes || []) {
        const sk = node?.metadata?.storageKey;
        if (typeof sk === "string" && sk.trim()) keys.add(sk.trim());
        const images = node?.metadata?.images;
        if (Array.isArray(images)) {
            for (const img of images) {
                if (typeof img?.storageKey === "string" && img.storageKey.trim()) keys.add(img.storageKey.trim());
            }
        }
    }
    return keys;
}

function collectFolderIndex(nodes) {
    /** @type {Map<string, string>} */
    const index = new Map();
    for (const node of nodes || []) {
        if (node?.type !== FOLDER_NODE_TYPE) continue;
        const disk = String(node?.metadata?.folderDataPath || node?.metadata?.folderLocalPath || "").trim();
        if (disk) index.set(node.id, disk);
    }
    return index;
}

function mergeNode(existing, incoming) {
    if (!existing) return incoming;
    const out = { ...existing, ...incoming };
    if (existing.metadata || incoming.metadata) {
        out.metadata = { ...(existing.metadata || {}), ...(incoming.metadata || {}) };
    }
    return out;
}

/** @param {Room} room @param {RoomOp} op */
function applyOp(room, op) {
    const doc = room.document;
    if (op.type === "upsert_nodes" && Array.isArray(op.nodes)) {
        const map = new Map(doc.nodes.map((n) => [n.id, n]));
        for (const raw of op.nodes) {
            const node = sanitizeNode(raw);
            map.set(node.id, mergeNode(map.get(node.id), node));
            const sk = node?.metadata?.storageKey;
            if (typeof sk === "string" && sk) room.mediaKeys.add(sk);
            if (node?.type === FOLDER_NODE_TYPE) {
                const disk = String(node?.metadata?.folderDataPath || node?.metadata?.folderLocalPath || "").trim();
                if (disk) room.folderIndex.set(node.id, disk);
            }
        }
        doc.nodes = [...map.values()];
        return true;
    }
    if (op.type === "remove_nodes" && Array.isArray(op.nodeIds)) {
        const ids = new Set(op.nodeIds);
        doc.nodes = doc.nodes.filter((n) => !ids.has(n.id));
        return true;
    }
    if (op.type === "upsert_connections" && Array.isArray(op.connections)) {
        const map = new Map(doc.connections.map((c) => [c.id, c]));
        for (const conn of op.connections) map.set(conn.id, { ...map.get(conn.id), ...conn });
        doc.connections = [...map.values()];
        return true;
    }
    if (op.type === "remove_connections" && Array.isArray(op.connectionIds)) {
        const ids = new Set(op.connectionIds);
        doc.connections = doc.connections.filter((c) => !ids.has(c.id));
        return true;
    }
    if (op.type === "set_title" && typeof op.title === "string") {
        doc.title = op.title;
        return true;
    }
    if (op.type === "set_background_mode" && typeof op.backgroundMode === "string") {
        doc.backgroundMode = op.backgroundMode;
        return true;
    }
    return false;
}

/** @param {Room} room */
function pushOpLog(room, op, rev) {
    room.opLog.push({ ...op, rev });
    if (room.opLog.length > OP_LOG_MAX) room.opLog.splice(0, room.opLog.length - OP_LOG_MAX);
}

/** @param {Room} room */
function broadcast(room, message, except) {
    const payload = JSON.stringify(message);
    for (const ws of room.sockets) {
        if (ws !== except && ws.readyState === 1) ws.send(payload);
    }
}

/** @param {Room} room */
function broadcastAll(room, message) {
    const payload = JSON.stringify(message);
    for (const ws of room.sockets) {
        if (ws.readyState === 1) ws.send(payload);
    }
}

/** @param {Room} room */
function onlineCount(room) {
    return room.sockets.size;
}

function getRoom(roomId) {
    return rooms.get(roomId) || null;
}

function createRoom({ projectId, document, listLanShareUrls }) {
    const roomId = crypto.randomBytes(8).toString("hex");
    const token = crypto.randomBytes(16).toString("hex");
    const doc = sanitizeDocument(document || {});
    /** @type {Room} */
    const room = {
        roomId,
        token,
        projectId: String(projectId || ""),
        hostSocket: null,
        hostClientId: null,
        rev: 0,
        document: doc,
        opLog: [],
        mediaCache: new Map(),
        mediaCacheBytes: 0,
        pendingMedia: new Map(),
        mediaKeys: collectMediaKeys(doc.nodes),
        folderIndex: collectFolderIndex(doc.nodes),
        sockets: new Set(),
        socketMeta: new Map(),
    };
    rooms.set(roomId, room);
    const sharePath = `/canvas/${room.projectId}?room=${roomId}&token=${token}`;
    const shareUrls = typeof listLanShareUrls === "function" ? listLanShareUrls(sharePath) : [];
    return { room, shareUrls, sharePath };
}

function deleteRoom(roomId, token) {
    const room = rooms.get(roomId);
    if (!room || !timingSafeEqual(room.token, token)) return false;
    broadcastAll(room, { type: "room_closed" });
    for (const ws of room.sockets) {
        try {
            ws.close();
        } catch {
            // ignore
        }
    }
    rooms.delete(roomId);
    return true;
}

/** @param {Room} room @param {string} storageKey @param {Buffer} blob @param {string} mimeType */
function putMediaCache(room, storageKey, blob, mimeType) {
    const prev = room.mediaCache.get(storageKey);
    if (prev) room.mediaCacheBytes -= prev.bytes;
    room.mediaCache.set(storageKey, { blob, mimeType, bytes: blob.length });
    room.mediaCacheBytes += blob.length;
    room.mediaKeys.add(storageKey);
    while (room.mediaCacheBytes > MEDIA_CACHE_MAX_BYTES && room.mediaCache.size) {
        const first = room.mediaCache.keys().next().value;
        const item = room.mediaCache.get(first);
        if (item) room.mediaCacheBytes -= item.bytes;
        room.mediaCache.delete(first);
    }
    const pending = room.pendingMedia.get(storageKey) || [];
    room.pendingMedia.delete(storageKey);
    for (const res of pending) {
        if (!res.headersSent) {
            res.writeHead(200, { "Content-Type": mimeType, "Cache-Control": "private, max-age=3600" });
            res.end(blob);
        }
    }
}

function resolveSafeFile(folderRoot, relativePath) {
    const root = path.resolve(folderRoot);
    const target = path.resolve(root, relativePath.replace(/^[/\\]+/, ""));
    if (!target.startsWith(root + path.sep) && target !== root) return null;
    return target;
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @param {URLSearchParams} query
 * @param {{ listLanShareUrls?: (sharePath: string) => string[] }} options
 */
async function handleRoomHttp(req, res, pathname, query, options = {}) {
    if (pathname === "/api/rooms" && req.method === "POST") {
        try {
            const raw = await readBody(req);
            const body = JSON.parse(raw.toString("utf8") || "{}");
            const { room, shareUrls, sharePath } = createRoom({
                projectId: body.projectId,
                document: body.document,
                listLanShareUrls: options.listLanShareUrls,
            });
            writeJson(res, 200, {
                ok: true,
                roomId: room.roomId,
                token: room.token,
                projectId: room.projectId,
                sharePath,
                shareUrls,
            });
        } catch (error) {
            writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        return true;
    }

    const roomMatch = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(.*))?$/);
    if (!roomMatch) return false;
    const roomId = roomMatch[1];
    const subPath = roomMatch[2] || "";
    const room = rooms.get(roomId);
    const token = query.get("token") || req.headers["x-room-token"] || "";

    if (req.method === "DELETE" && !subPath) {
        if (!room || !timingSafeEqual(room.token, token)) {
            writeJson(res, 403, { ok: false, error: "forbidden" });
            return true;
        }
        deleteRoom(roomId, token);
        writeJson(res, 200, { ok: true });
        return true;
    }

    if (req.method === "GET" && !subPath) {
        if (!room || !timingSafeEqual(room.token, token)) {
            writeJson(res, 403, { ok: false, error: "forbidden" });
            return true;
        }
        writeJson(res, 200, {
            ok: true,
            rev: room.rev,
            online: onlineCount(room),
            document: sanitizeDocument(room.document),
            projectId: room.projectId,
        });
        return true;
    }

    if (!room || !timingSafeEqual(room.token, token)) {
        writeJson(res, 403, { ok: false, error: "forbidden" });
        return true;
    }

    const mediaGet = subPath.match(/^media\/(.+)$/);
    if (req.method === "GET" && mediaGet) {
        const storageKey = decodeURIComponent(mediaGet[1]);
        if (!room.mediaKeys.has(storageKey)) {
            writeJson(res, 404, { ok: false, error: "media not in room" });
            return true;
        }
        const cached = room.mediaCache.get(storageKey);
        if (cached) {
            res.writeHead(200, { "Content-Type": cached.mimeType, "Cache-Control": "private, max-age=3600" });
            res.end(cached.blob);
            return true;
        }
        if (room.hostSocket && room.hostSocket.readyState === 1) {
            const list = room.pendingMedia.get(storageKey) || [];
            list.push(res);
            room.pendingMedia.set(storageKey, list);
            room.hostSocket.send(JSON.stringify({ type: "media_request", storageKey }));
            return true;
        }
        writeJson(res, 503, { ok: false, error: "host offline" });
        return true;
    }

    const mediaPost = subPath.match(/^media\/(.+)$/);
    if (req.method === "POST" && mediaPost) {
        const storageKey = decodeURIComponent(mediaPost[1]);
        const raw = await readBody(req);
        if (raw.length > MAX_FILE_BYTES) {
            writeJson(res, 413, { ok: false, error: "file too large" });
            return true;
        }
        const mimeType = String(req.headers["content-type"] || "application/octet-stream");
        putMediaCache(room, storageKey, raw, mimeType);
        writeJson(res, 200, { ok: true });
        return true;
    }

    const filesMatch = subPath.match(/^files\/([^/]+)\/(.*)$/);
    if (req.method === "GET" && filesMatch) {
        const folderNodeId = decodeURIComponent(filesMatch[1]);
        const rel = decodeURIComponent(filesMatch[2] || "");
        const root = room.folderIndex.get(folderNodeId);
        if (!root) {
            writeJson(res, 404, { ok: false, error: "folder not found" });
            return true;
        }
        const filePath = resolveSafeFile(root, rel);
        if (!filePath) {
            writeJson(res, 403, { ok: false, error: "invalid path" });
            return true;
        }
        try {
            const stat = await fsp.stat(filePath);
            if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
                writeJson(res, 413, { ok: false, error: "file unavailable" });
                return true;
            }
            const ext = path.extname(filePath).toLowerCase();
            const mime =
                {
                    ".html": "text/html",
                    ".htm": "text/html",
                    ".css": "text/css",
                    ".js": "text/javascript",
                    ".json": "application/json",
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".gif": "image/gif",
                    ".webp": "image/webp",
                    ".pdf": "application/pdf",
                    ".md": "text/markdown",
                    ".txt": "text/plain",
                    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    ".xls": "application/vnd.ms-excel",
                    ".csv": "text/csv",
                }[ext] || "application/octet-stream";
            res.writeHead(200, { "Content-Type": mime, "Cache-Control": "private, max-age=300" });
            fs.createReadStream(filePath).pipe(res);
        } catch {
            writeJson(res, 404, { ok: false, error: "file not found" });
        }
        return true;
    }

    writeJson(res, 404, { ok: false, error: "not found" });
    return true;
}

/** @param {import('http').Server} server */
function attachRoomWebSocket(server) {
    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
        if (!match) return;
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
        });
    });

    wss.on("connection", (ws, req) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const roomId = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/)?.[1];
        const token = url.searchParams.get("token") || "";
        const role = url.searchParams.get("role") || "guest";
        const clientId = url.searchParams.get("clientId") || crypto.randomBytes(6).toString("hex");
        const lastRev = Number(url.searchParams.get("lastRev") || 0);

        const room = roomId ? rooms.get(roomId) : null;
        if (!room || !timingSafeEqual(room.token, token)) {
            ws.close(4403, "forbidden");
            return;
        }

        room.sockets.add(ws);
        room.socketMeta.set(ws, { clientId, role });
        if (role === "host") {
            room.hostSocket = ws;
            room.hostClientId = clientId;
        }

        const sendSnapshot = () => {
            ws.send(
                JSON.stringify({
                    type: "snapshot",
                    rev: room.rev,
                    document: sanitizeDocument(room.document),
                    online: onlineCount(room),
                }),
            );
        };

        if (lastRev > 0 && lastRev < room.rev) {
            const missed = room.opLog.filter((op) => op.rev > lastRev);
            if (missed.length && missed[0].rev === lastRev + 1) {
                ws.send(JSON.stringify({ type: "ops", rev: room.rev, ops: missed, online: onlineCount(room) }));
            } else {
                sendSnapshot();
            }
        } else {
            sendSnapshot();
        }

        broadcast(room, { type: "presence", online: onlineCount(room) }, ws);

        ws.on("message", (data) => {
            let msg;
            try {
                msg = JSON.parse(String(data));
            } catch {
                return;
            }

            if (msg.type === "ping") {
                ws.send(JSON.stringify({ type: "pong" }));
                return;
            }

            if (msg.type === "presence") {
                broadcast(room, { type: "presence", online: onlineCount(room), clientId, payload: msg.payload }, ws);
                return;
            }

            if (msg.type === "media_response" && role === "host") {
                const storageKey = String(msg.storageKey || "");
                const b64 = String(msg.dataBase64 || "");
                if (!storageKey || !b64) return;
                const blob = Buffer.from(b64, "base64");
                const mimeType = String(msg.mimeType || "application/octet-stream");
                putMediaCache(room, storageKey, blob, mimeType);
                return;
            }

            if (msg.type === "ops" && Array.isArray(msg.ops)) {
                const applied = [];
                for (const op of msg.ops) {
                    if (!op || typeof op.type !== "string") continue;
                    if (!applyOp(room, op)) continue;
                    room.rev += 1;
                    pushOpLog(room, { ...op, clientId, opId: op.opId }, room.rev);
                    applied.push({ ...op, rev: room.rev });
                    if (op.type === "upsert_nodes" && Array.isArray(op.nodes)) {
                        room.folderIndex = collectFolderIndex(room.document.nodes);
                        for (const k of collectMediaKeys(op.nodes)) room.mediaKeys.add(k);
                    }
                }
                if (!applied.length) return;
                const payload = { type: "ops", rev: room.rev, ops: applied, clientId, online: onlineCount(room) };
                broadcastAll(room, payload);
                return;
            }
        });

        ws.on("close", () => {
            room.sockets.delete(ws);
            room.socketMeta.delete(ws);
            if (room.hostSocket === ws) room.hostSocket = null;
            broadcast(room, { type: "presence", online: onlineCount(room) });
        });
    });

    return wss;
}

module.exports = {
    handleRoomHttp,
    attachRoomWebSocket,
    getRoom,
    createRoom,
    deleteRoom,
    rooms,
};
