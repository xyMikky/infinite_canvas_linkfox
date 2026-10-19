const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

function applyInstalledDataDir(app, backupRoots = [process.env.LOCALAPPDATA, process.env.ProgramData].filter(Boolean).map(root => path.join(root, "InfiniteCanvas", "upgrade-backups"))) {
    if (!app.isPackaged || process.platform !== "win32") return;
    const installDir = path.dirname(app.getPath("exe"));
    const installHash = createHash("sha256").update(path.resolve(installDir).toLowerCase()).digest("hex");
    for (const root of backupRoots) {
        const guard = path.join(root, `pending-${installHash}.json`);
        if (fs.existsSync(guard) && JSON.parse(fs.readFileSync(guard, "utf8")).completed !== true) throw new Error(`上次升级尚未完成，请先恢复数据。独立备份位于：${root}`);
    }
    const pointer = path.join(installDir, "data-dir.txt");
    let dir;
    if (fs.existsSync(pointer)) {
        dir = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(pointer)).trim();
        if (!dir || !path.isAbsolute(dir) || !fs.existsSync(dir)) throw new Error(`登记的数据目录不可用：${dir || pointer}`);
    } else {
        const installed = path.join(installDir, "data");
        const original = app.getPath("userData");
        const hasData = candidate => ["IndexedDB", "Local Storage", "canvas-data"].some(name => fs.existsSync(path.join(candidate, name)));
        if (hasData(installed) && hasData(original) && path.resolve(installed) !== path.resolve(original)) throw new Error(`发现两份数据目录，请先确认要使用哪一份：\n${installed}\n${original}`);
        dir = hasData(original) ? original : installed;
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    app.setPath("userData", dir);
    const marker = path.join(dir, ".infinite-canvas-userdata");
    if (!fs.existsSync(marker)) fs.writeFileSync(marker, "InfiniteCanvas userData\n", "utf8");
}

module.exports = { applyInstalledDataDir };
