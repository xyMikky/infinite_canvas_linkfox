const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

function writeAtomically(filePath, body) {
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, body, { flush: true });
        fs.renameSync(temporary, filePath);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

function fail(message, status = 409) { throw Object.assign(new Error(message), { status }); }
function parse(raw) {
    let data;
    try { data = JSON.parse(raw.toString("utf8")); } catch { fail("画布文件无法解析，已保留原文件", 400); }
    if (!data || (data.version !== undefined && data.version !== 0) || !Array.isArray(data.state?.projects)) fail("无法识别画布格式或版本，已停止保存", 400);
    const ids = new Set();
    for (const project of data.state.projects) {
        if (!project || typeof project.id !== "string" || ids.has(project.id) || !Array.isArray(project.nodes) || !Array.isArray(project.connections)) fail("画布数据不完整，已停止保存", 400);
        ids.add(project.id);
    }
    return data.state.projects;
}
const revision = raw => raw === null ? '"missing"' : `"${createHash("sha256").update(raw).digest("hex")}"`;
const nodeCount = projects => projects.reduce((sum, project) => sum + project.nodes.length, 0);

function createCanvasProjectStorage(root) {
    const currentPath = path.join(root, "projects.json");
    const historyDir = path.join(root, "projects-history");
    const previousPath = path.join(root, "projects.backup.json");
    fs.mkdirSync(historyDir, { recursive: true });
    let lastCheckpoint = 0;
    const historyNames = () => fs.readdirSync(historyDir).filter(name => /^[\w.-]+\.json$/.test(name));
    const hasBackup = () => fs.existsSync(previousPath) || historyNames().length > 0;
    function keep(id, raw) {
        if (!parse(raw).length) return;
        const target = path.join(historyDir, id + ".json");
        if (!fs.existsSync(target)) writeAtomically(target, raw);
    }
    function read(version = "legacy") {
        const raw = fs.existsSync(currentPath) ? fs.readFileSync(currentPath) : null;
        if (raw === null && hasBackup()) fail("画布主文件缺失，但发现恢复备份，请先恢复数据");
        if (raw !== null) {
            parse(raw);
            keep(`upgrade-${String(version).replace(/[^\w.-]/g, "_").slice(0, 64)}`, raw);
        }
        return { raw, revision: revision(raw) };
    }
    function write(raw, expected, version, allowEmpty = false) {
        const next = parse(raw);
        if (!expected) fail("旧页面未携带保存版本，请更新页面后保存", 428);
        const current = read(version);
        if (current.raw?.equals(raw)) return current.revision;
        if (current.revision !== expected) fail("其他窗口已保存更新的画布，已阻止覆盖", 412);
        if (current.raw !== null) {
            const previous = parse(current.raw);
            if (previous.length && !next.length && !allowEmpty) fail("未明确执行删除，已阻止空列表覆盖全部画布", 422);
            if (previous.length) {
                writeAtomically(previousPath, current.raw);
                if (Date.now() - lastCheckpoint >= 300_000 || next.length < previous.length || nodeCount(next) < nodeCount(previous)) {
                    keep(`history-${Date.now()}-${randomUUID()}`, current.raw);
                    lastCheckpoint = Date.now();
                }
            }
        }
        writeAtomically(currentPath, raw);
        for (const item of list().filter(item => item.id.startsWith("history-")).slice(20)) fs.unlinkSync(path.join(historyDir, item.id + ".json"));
        return revision(raw);
    }
    function backup(id) {
        if (!/^[\w.-]+$/.test(id)) fail("无效备份标识", 400);
        const file = id === "previous" ? previousPath : path.join(historyDir, id + ".json");
        if (!fs.existsSync(file)) fail("备份不存在", 404);
        const raw = fs.readFileSync(file);
        parse(raw);
        return raw;
    }
    function list() {
        const names = historyNames().map(name => name.slice(0, -5));
        if (fs.existsSync(previousPath)) names.push("previous");
        return names.flatMap(id => {
            try {
                const projects = parse(backup(id));
                const file = id === "previous" ? previousPath : path.join(historyDir, id + ".json");
                return [{ id, createdAt: fs.statSync(file).mtime.toISOString(), projects: projects.length, nodes: nodeCount(projects) }];
            } catch { return []; } // 损坏的原件继续保留，不影响其它备份恢复，也不参与历史淘汰。
        }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    function references(key) {
        const contains = value => {
            if (typeof value === "string") return value === key;
            return value && typeof value === "object" && Object.values(value).some(contains);
        };
        if (fs.existsSync(currentPath) && contains(parse(fs.readFileSync(currentPath)))) return true;
        const ids = historyNames().map(name => name.slice(0, -5));
        if (fs.existsSync(previousPath)) ids.push("previous");
        return ids.some(id => contains(parse(backup(id))));
    }
    function restore(id) {
        const projects = parse(backup(id));
        let current = [];
        if (fs.existsSync(currentPath)) {
            const raw = fs.readFileSync(currentPath);
            writeAtomically(path.join(historyDir, `before-restore-${randomUUID()}.original`), raw);
            try { current = parse(raw); } catch { /* 用户显式选择恢复，原件已另存 */ }
        }
        const copies = projects.map(project => ({ ...project, id: randomUUID(), title: `${project.title}（恢复副本）`, updatedAt: new Date().toISOString() }));
        writeAtomically(currentPath, JSON.stringify({ state: { projects: [...copies, ...current] }, version: 0 }));
    }
    return { read, write, backup, list, references, restore };
}

module.exports = { createCanvasProjectStorage, writeAtomically };
