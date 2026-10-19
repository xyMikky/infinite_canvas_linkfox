const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { applySystemProxyEnv } = require("./system-proxy.cjs");

function cursorCliDir(isPackaged) {
    return isPackaged ? path.join(process.resourcesPath, "cursor-cli") : path.join(__dirname, "cursor-cli");
}

function firstExisting(paths) {
    return paths.find((item) => item && fs.existsSync(item)) || "";
}

function resolveCursorCliBinary(isPackaged = false) {
    const override = String(process.env.CURSOR_CLI_BIN || "").trim();
    if (override && fs.existsSync(override)) return override;
    const dir = cursorCliDir(isPackaged);
    const names = process.platform === "win32"
        ? ["cursor-agent.exe", "agent.exe", "cursor-agent.cmd", "agent.cmd"]
        : ["cursor-agent", "agent"];
    return firstExisting(names.map((name) => path.join(dir, name)));
}

function cursorExtraBinDirs() {
    const home = os.homedir();
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return [
        path.join(local, "cursor-agent"),
        path.join(home, ".local", "bin"),
        path.join(home, ".cursor", "bin"),
    ];
}

function cursorRuntimeEnv(isPackaged, env = process.env) {
    const currentPath = String(env.PATH || env.Path || "");
    const binary = resolveCursorCliBinary(isPackaged);
    const bundledDir = binary ? path.dirname(binary) : cursorCliDir(isPackaged);
    const nextPath = [bundledDir, ...cursorExtraBinDirs(), currentPath].filter(Boolean).join(path.delimiter);
    return applySystemProxyEnv({
        ...env,
        PATH: nextPath,
        Path: nextPath,
        ...(binary ? { CURSOR_CLI_BIN: binary } : {}),
    });
}

module.exports = {
    cursorCliDir,
    cursorExtraBinDirs,
    cursorRuntimeEnv,
    resolveCursorCliBinary,
};
