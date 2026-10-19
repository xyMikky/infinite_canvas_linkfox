import { APP_VERSION } from "@/constant/env";

const API_PREFIX = "/api/dev-local-store";

export const DEV_CANVAS_STORE_KEY = "infinite-canvas:canvas_store";

type DevLocalStatus = { ok: true; root: string } | { ok: false };

let probed: Promise<boolean> | null = null;
let enabled = false;
let canvasRevision: string | null = null;

async function probe(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
        const res = await fetch(`${API_PREFIX}/status`, { method: "GET", cache: "no-store" });
        if (!res.ok) throw new Error(`本地画布存储不可用：${res.status}`);
        const data = (await res.json()) as DevLocalStatus;
        if (!data?.ok) throw new Error("本地画布存储不可用");
        return true;
    } catch (error) {
        // 开发端磁盘是权威来源，服务异常不能被当成一份新的空浏览器存储。
        if (import.meta.env.DEV) throw error;
        return false;
    }
}

/** Vite 开发中间件可用时返回 true；静态部署 / Electron 打包环境为 false。 */
export function ensureDevLocalStore(): Promise<boolean> {
    if (!probed) {
        probed = probe().then((ok) => {
            enabled = ok;
            return ok;
        }).catch((error) => {
            probed = null;
            throw error;
        });
    }
    return probed;
}

export function isDevLocalStoreEnabled() {
    return enabled;
}

export async function getDevLocalKv(key: string): Promise<string | null> {
    if (!(await ensureDevLocalStore())) return null;
    const res = await fetch(`${API_PREFIX}/kv/${encodeURIComponent(key)}`, { method: "GET", cache: "no-store", headers: { "X-Canvas-Version": APP_VERSION } });
    if (res.status === 404) {
        if (key === DEV_CANVAS_STORE_KEY) canvasRevision = '"missing"';
        return null;
    }
    if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(typeof detail?.error === "string" ? detail.error : `本地画布读取失败（${res.status}），请保留原数据。`);
    }
    if (key === DEV_CANVAS_STORE_KEY) canvasRevision = res.headers.get("ETag");
    return res.text();
}

export async function setDevLocalKv(key: string, value: string, allowEmpty = false): Promise<void> {
    if (!(await ensureDevLocalStore())) return;
    if (key === DEV_CANVAS_STORE_KEY && !canvasRevision) throw new Error("画布存储服务尚未就绪，请重启开发服务后重新读取。");
    const res = await fetch(`${API_PREFIX}/kv/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json; charset=utf-8", ...(key === DEV_CANVAS_STORE_KEY ? { "If-Match": canvasRevision!, "X-Canvas-Version": APP_VERSION, "X-Canvas-Allow-Empty": String(allowEmpty) } : {}) },
        body: value,
    });
    if (res.status === 409 || res.status === 412) throw new Error("其他窗口已修改画布，当前修改尚未保存。请先导出当前画布，再重新读取，避免覆盖。");
    if (res.status === 422) throw new Error("未明确执行删除，已阻止空列表覆盖全部画布。");
    if (!res.ok) throw new Error(`画布保存失败：${res.status}，请保留当前页面并导出画布。`);
    if (key === DEV_CANVAS_STORE_KEY) canvasRevision = res.headers.get("ETag");
}

export async function getDevLocalBlob(key: string): Promise<Blob | null> {
    if (!(await ensureDevLocalStore())) return null;
    const res = await fetch(`${API_PREFIX}/blob/${encodeURIComponent(key)}`, { method: "GET", cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`dev-local-store blob get failed: ${res.status}`);
    return res.blob();
}

/** 预览只确认磁盘原件存在，视频由浏览器按 Range 读取，不阻塞画布恢复。 */
export async function getDevLocalMediaUrl(key: string): Promise<string | null> {
    if (!(await ensureDevLocalStore())) return null;
    const url = `${API_PREFIX}/blob/${encodeURIComponent(key)}`;
    const res = await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`本地视频读取失败（${res.status}），请重试。`);
    return new URL(url, window.location.href).href;
}

export async function setDevLocalBlob(key: string, blob: Blob): Promise<void> {
    if (!(await ensureDevLocalStore())) return;
    const res = await fetch(`${API_PREFIX}/blob/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": blob.type || "application/octet-stream" },
        body: blob,
    });
    if (!res.ok) throw new Error(`dev-local-store blob put failed: ${res.status}`);
}

export async function deleteDevLocalBlob(key: string): Promise<void> {
    if (!(await ensureDevLocalStore())) return;
    const res = await fetch(`${API_PREFIX}/blob/${encodeURIComponent(key)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`dev-local-store blob delete failed: ${res.status}`);
}

export async function listDevLocalBlobs(): Promise<string[]> {
    if (!(await ensureDevLocalStore())) return [];
    const res = await fetch(`${API_PREFIX}/blobs`, { method: "GET", cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { keys?: string[] };
    return Array.isArray(data.keys) ? data.keys : [];
}

function collectStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === "string" && item.includes(":") && (key === "storageKey" || key.endsWith("StorageKey"))) keys.add(item);
        else if (Array.isArray(item)) item.forEach((child) => collectStorageKeys(child, keys));
        else collectStorageKeys(item, keys);
    }
    return keys;
}

type MigrateBlobReader = (key: string) => Promise<Blob | null | undefined>;

let migrated = false;

/**
 * 磁盘尚无 projects 文件且 IndexedDB 仍有画布时，一次性拷到 data/canvas-dev。
 * 迁移后以磁盘为准，不再回写 IndexedDB。
 */
export async function migrateCanvasStoreToDevLocalIfNeeded(params: {
    readIdbCanvasStore: () => Promise<string | null>;
    readIdbBlob: MigrateBlobReader;
}): Promise<string | null> {
    if (!(await ensureDevLocalStore()) || migrated) {
        return getDevLocalKv(DEV_CANVAS_STORE_KEY);
    }
    const existing = await getDevLocalKv(DEV_CANVAS_STORE_KEY);
    if (existing !== null) {
        migrated = true;
        return existing;
    }

    const idbRaw = await params.readIdbCanvasStore();
    if (idbRaw === null) {
        migrated = true;
        return existing;
    }
    const parsed = JSON.parse(idbRaw) as { state?: { projects?: unknown[] } };
    const projects = parsed.state?.projects;
    if (!Array.isArray(projects)) throw new Error("画布项目数据格式无效");
    if (projects.length === 0) {
        migrated = true;
        return existing;
    }

    await setDevLocalKv(DEV_CANVAS_STORE_KEY, idbRaw);
    const keys = collectStorageKeys(projects);
    await Promise.all(
        [...keys].map(async (key) => {
            try {
                const blob = await params.readIdbBlob(key);
                if (blob && blob.size > 0) await setDevLocalBlob(key, blob);
            } catch {
                // 单文件失败不阻断迁移
            }
        }),
    );
    migrated = true;
    return idbRaw;
}
