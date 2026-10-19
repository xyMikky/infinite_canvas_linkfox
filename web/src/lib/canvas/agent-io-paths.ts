export function agentIoDirsFromDataDir(dataDir: string) {
    const root = dataDir.trim().replace(/[\\/]+$/, "");
    if (!root) return { input: "", output: "" };
    const sep = /\\/.test(root) || /^[A-Za-z]:/.test(root) ? "\\" : "/";
    return { input: `${root}${sep}input`, output: `${root}${sep}output` };
}

export async function resolveCanvasDataDir(configured = "") {
    const value = configured.trim();
    if (value) return value;
    if (typeof window === "undefined") return "";
    return (await window.desktopAPI?.getDefaultCanvasDataDir?.()) || "";
}

export async function persistAgentIoDirs(configuredDataDir = "") {
    const root = await resolveCanvasDataDir(configuredDataDir);
    const dirs = agentIoDirsFromDataDir(root);
    if ((dirs.input || dirs.output) && typeof window !== "undefined") {
        void window.desktopAPI?.setIoPaths?.(dirs.input, dirs.output).catch(() => undefined);
    }
    return dirs;
}
