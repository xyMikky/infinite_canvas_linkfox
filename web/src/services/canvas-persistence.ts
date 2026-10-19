import { randomId } from "@/lib/utils";
import { APP_VERSION } from "@/constant/env";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { DEV_CANVAS_STORE_KEY, ensureDevLocalStore } from "@/services/dev-local-store";
import { canvasDatabase as database, updateCanvasRecord } from "@/services/canvas-indexeddb";

export type CanvasSnapshot = { state: { projects: CanvasProject[] }; version?: number };
export type CanvasBackup = { id: string; createdAt: string; projects: number; nodes: number };
const prefix = "infinite-canvas:canvas_backup:";
let baseline: string | null | undefined;
let lastCheckpoint = 0;

export function parseCanvasSnapshot(raw: string): CanvasSnapshot {
    const data = JSON.parse(raw) as CanvasSnapshot;
    if (!data || (data.version !== undefined && data.version !== 0) || !Array.isArray(data.state?.projects)) throw new Error("画布数据格式或版本无法识别，已停止写入，请保留原文件。");
    const ids = new Set<string>();
    for (const project of data.state.projects) {
        if (!project || typeof project.id !== "string" || ids.has(project.id) || !Array.isArray(project.nodes) || !Array.isArray(project.connections)) throw new Error("画布项目数据不完整，已停止写入。");
        ids.add(project.id);
    }
    return data;
}

async function locked<T>(action: () => Promise<T>): Promise<T> {
    // HTTP 局域网没有 Web Locks；所有主记录写入仍由 IndexedDB 原子比较保护。
    return navigator.locks ? navigator.locks.request(DEV_CANVAS_STORE_KEY, action) : action();
}

async function commitSnapshot(expected: string | null, raw: string) {
    await updateCanvasRecord<string>(DEV_CANVAS_STORE_KEY, current => {
        if (current !== expected && current !== raw) throw new Error("其他窗口已修改画布，当前修改尚未保存。请先导出当前画布，再重新读取，避免覆盖。");
        return raw;
    });
}

async function keepBackup(id: string, raw: string) {
    if (!parseCanvasSnapshot(raw).state.projects.length) return;
    const key = prefix + id;
    await updateCanvasRecord<{ raw: string; createdAt: string }>(key, current => current ?? { raw, createdAt: new Date().toISOString() });
}

export async function readCanvasIndexedDb(): Promise<string | null> {
    baseline = undefined;
    return locked(async () => {
        let raw = await database.getItem<string>(DEV_CANVAS_STORE_KEY);
        if (raw === null && (await database.keys()).some(key => key.startsWith(prefix))) throw new Error("画布主记录缺失，但发现恢复备份。请先下载备份，不能直接创建空列表。");
        const legacy = window.localStorage.getItem(DEV_CANVAS_STORE_KEY);
        // 旧版可能曾写入 localStorage；只复制缺失的主记录，绝不删除旧原件。
        if (legacy !== null) {
            parseCanvasSnapshot(legacy);
            await keepBackup("legacy-localstorage", legacy);
            if (raw === null) {
                await commitSnapshot(null, legacy);
                raw = legacy;
            }
        }
        if (raw !== null) {
            parseCanvasSnapshot(raw);
            await keepBackup(`upgrade-${APP_VERSION}`, raw);
        }
        baseline = raw;
        return raw;
    });
}

export async function writeCanvasIndexedDb(raw: string, allowEmpty = false) {
    const next = parseCanvasSnapshot(raw);
    await locked(async () => {
        const current = await database.getItem<string>(DEV_CANVAS_STORE_KEY);
        if (baseline === undefined) throw new Error("画布尚未读取完成，已阻止保存。");
        if (current === raw) { baseline = raw; return; }
        if (current !== baseline) throw new Error("其他窗口已修改画布，当前修改尚未保存。请先导出当前画布，再重新读取，避免覆盖。");
        if (current !== null) {
            const previous = parseCanvasSnapshot(current);
            if (previous.state.projects.length && !next.state.projects.length && !allowEmpty) throw new Error("未明确执行删除，已阻止空列表覆盖全部画布。");
            const nodeCount = (data: CanvasSnapshot) => data.state.projects.reduce((sum, project) => sum + project.nodes.length, 0);
            if (Date.now() - lastCheckpoint >= 300_000 || next.state.projects.length < previous.state.projects.length || nodeCount(next) < nodeCount(previous)) {
                await keepBackup(`history-${Date.now()}-${randomId()}`, current);
                lastCheckpoint = Date.now();
            }
        }
        await commitSnapshot(current, raw);
        baseline = raw;
        // 升级原件长期保留，正常历史保留最近 20 份；备份完成前不得覆盖主记录。
        const history = (await database.keys()).filter(key => key.startsWith(prefix + "history-")).sort().reverse();
        for (const key of history.slice(20)) await database.removeItem(key);
    });
}

export async function listCanvasBackups(): Promise<CanvasBackup[]> {
    if (await ensureDevLocalStore()) {
        const res = await fetch("/api/dev-local-store/canvas-backups", { cache: "no-store" });
        if (!res.ok) throw new Error("读取画布备份失败");
        return res.json();
    }
    const backups: CanvasBackup[] = [];
    await database.iterate<{ raw: string; createdAt: string }, void>((value, key) => {
        if (!key.startsWith(prefix)) return;
        try {
            const data = parseCanvasSnapshot(value.raw);
            backups.push({ id: key.slice(prefix.length), createdAt: value.createdAt, projects: data.state.projects.length, nodes: data.state.projects.reduce((sum, project) => sum + project.nodes.length, 0) });
        } catch { /* 损坏原件保留，其它有效备份仍可恢复 */ }
    });
    return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readCanvasBackup(id: string): Promise<CanvasProject[]> {
    let raw: string;
    if (await ensureDevLocalStore()) {
        const res = await fetch(`/api/dev-local-store/canvas-backups/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!res.ok) throw new Error("读取画布备份失败");
        raw = await res.text();
    } else {
        const value = await database.getItem<{ raw: string }>(prefix + id);
        if (!value) throw new Error("备份不存在");
        raw = value.raw;
    }
    return parseCanvasSnapshot(raw).state.projects;
}

export async function restoreCanvasBackup(id: string) {
    if (await ensureDevLocalStore()) {
        const res = await fetch(`/api/dev-local-store/canvas-backups/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (!res.ok) throw new Error("恢复失败，原始数据已保留。");
        return;
    }
    const projects = await readCanvasBackup(id);
    await locked(async () => {
        const raw = await database.getItem<string>(DEV_CANVAS_STORE_KEY);
        let current: CanvasProject[] = [];
        if (raw !== null) {
            // 无论能否解析，先保留恢复前原件。
            await database.setItem(`infinite-canvas:canvas_original:${randomId()}`, raw);
            try { current = parseCanvasSnapshot(raw).state.projects; } catch { /* 用户显式从备份恢复 */ }
        }
        const copies = projects.map(project => ({ ...project, id: randomId(), title: `${project.title}（恢复副本）`, updatedAt: new Date().toISOString() }));
        await commitSnapshot(raw, JSON.stringify({ state: { projects: [...copies, ...current] }, version: 0 }));
    });
}
