import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { syncBuiltinSkills } from "./skills/builtin.js";

export const DEFAULT_PORT = 17371;
const LEGACY_CONFIG_DIR = path.join(os.homedir(), ".infinite-canvas");
/** 桌面安装版由 Electron 指定到安装目录 data\agent；开发端和 npx 仍使用用户目录。 */
export const CONFIG_DIR = path.resolve(process.env.INFINITE_CANVAS_AGENT_HOME?.trim() || LEGACY_CONFIG_DIR);
export const CONFIG_FILE = path.join(CONFIG_DIR, "canvas-agent.json");
copyLegacyConfigDir();
export const VERSION = readPackageVersion();
export const AGENT_PROMPT = fs.readFileSync(new URL("../agent-instructions.md", import.meta.url), "utf8");
const initializedWorkspaces = new Set<string>();

export type SiteWorkspaceConfig = {
    workspacePath: string;
    inputPath?: string;
    outputPath?: string;
    /** 主人（桌面端）的活跃线程 */
    activeThreadId?: string;
    /** 局域网访客各自的活跃线程：ownerId -> threadId */
    guestThreads?: Record<string, string>;
    /** 线程归属：threadId -> ownerId；缺省视为主人 */
    threadOwners?: Record<string, string>;
    pinnedThreadIds?: string[];
};
export type CanvasAgentConfig = { url: string; token: string; origins?: string[]; workspace?: SiteWorkspaceConfig };

/** 读取本地 Canvas Agent 配置，不存在时生成默认配置。 */
export function loadConfig(create = false): CanvasAgentConfig {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as CanvasAgentConfig;
    } catch {
        const config = { url: `http://127.0.0.1:${Number(process.env.PORT) || DEFAULT_PORT}`, token: crypto.randomBytes(18).toString("hex") };
        if (create) saveConfig(config);
        return config;
    }
}

/** 将 Canvas Agent 配置写入用户配置目录。 */
export function saveConfig(config: CanvasAgentConfig) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/** 确保站点级 Codex 工作空间存在并已初始化。 */
export function ensureSiteWorkspace(config: CanvasAgentConfig) {
    const current = config.workspace;
    if (current?.workspacePath) {
        const workspacePath = resolveWorkspacePath(current.workspacePath);
        const workspace: SiteWorkspaceConfig = {
            ...current,
            workspacePath,
            inputPath: normalizeOptionalPath(current.inputPath),
            outputPath: normalizeOptionalPath(current.outputPath),
        };
        ensureDirectory(workspace.inputPath);
        ensureDirectory(workspace.outputPath);
        initializeWorkspace(workspacePath);
        writePathsMarker(workspacePath, workspace);
        return workspace;
    }
    const workspacePath = path.join(CONFIG_DIR, "codex-workspaces", "site");
    config.workspace = { workspacePath };
    initializeWorkspace(workspacePath);
    saveConfig(config);
    return { workspacePath };
}

/** 更新站点级 Codex 工作空间配置。 */
export function updateSiteWorkspace(config: CanvasAgentConfig, patch: Partial<SiteWorkspaceConfig>) {
    const current = ensureSiteWorkspace(config);
    const workspacePath = patch.workspacePath ? resolveWorkspacePath(patch.workspacePath) : current.workspacePath;
    const next: SiteWorkspaceConfig = {
        ...current,
        ...patch,
        workspacePath,
        inputPath: "inputPath" in patch ? normalizeOptionalPath(patch.inputPath) : current.inputPath,
        outputPath: "outputPath" in patch ? normalizeOptionalPath(patch.outputPath) : current.outputPath,
    };
    ensureDirectory(next.inputPath);
    ensureDirectory(next.outputPath);
    config.workspace = next;
    initializeWorkspace(workspacePath);
    writePathsMarker(workspacePath, next);
    saveConfig(config);
    return config.workspace;
}

/** 创建工作空间目录并写入默认 AGENTS.md 与内置 Skill。 */
function initializeWorkspace(workspacePath: string) {
    if (initializedWorkspaces.has(workspacePath)) return;
    fs.mkdirSync(workspacePath, { recursive: true });
    const instructionsFile = path.join(workspacePath, "AGENTS.md");
    const current = fs.existsSync(instructionsFile) ? fs.readFileSync(instructionsFile, "utf8") : "";
    if (!current || current.startsWith("# Infinite Canvas Agent")) fs.writeFileSync(instructionsFile, AGENT_PROMPT);
    try {
        syncBuiltinSkills(workspacePath);
    } catch (error) {
        console.warn("同步内置 Skill 失败", error);
    }
    initializedWorkspaces.add(workspacePath);
}

/** 将用户输入的工作空间路径解析为绝对路径。 */
function resolveWorkspacePath(value: string) {
    if (value === "~") return os.homedir();
    if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
    return path.resolve(value);
}

/** 空字符串视为清除；否则解析为绝对路径。 */
function normalizeOptionalPath(value: string | undefined) {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return resolveWorkspacePath(trimmed);
}

const IO_DIR_MARKER = ".infinite-canvas-io-dir";

function ensureDirectory(dirPath?: string) {
    if (!dirPath) return;
    fs.mkdirSync(dirPath, { recursive: true });
    const marker = path.join(dirPath, IO_DIR_MARKER);
    if (!fs.existsSync(marker)) fs.writeFileSync(marker, "InfiniteCanvas IO directory\n");
}

/** 写入工作区路径标记，供 Codex 读取 input/output 目录；并落盘供卸载读取。 */
function writePathsMarker(workspacePath: string, workspace: SiteWorkspaceConfig) {
    const markerPath = path.join(workspacePath, ".infinite-canvas-paths.json");
    const payload = {
        inputPath: workspace.inputPath || "",
        outputPath: workspace.outputPath || "",
    };
    if (!payload.inputPath && !payload.outputPath) {
        if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
        try {
            fs.writeFileSync(path.join(CONFIG_DIR, "io-paths.txt"), "\n\n");
        } catch {
            // ignore
        }
        return;
    }
    fs.writeFileSync(markerPath, `${JSON.stringify(payload, null, 2)}\n`);
    try {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(path.join(CONFIG_DIR, "io-paths.txt"), `${payload.inputPath}\n${payload.outputPath}\n`);
    } catch {
        // ignore
    }
}

/** 首次使用新目录时复制用户目录里的旧聊天记录与配置（不含日志），旧文件保留；工作空间等路径改指向新目录。 */
function copyLegacyConfigDir() {
    if (CONFIG_DIR === path.resolve(LEGACY_CONFIG_DIR) || fs.existsSync(CONFIG_DIR) || !fs.existsSync(LEGACY_CONFIG_DIR)) return;
    const logs = path.join(LEGACY_CONFIG_DIR, "logs");
    const staging = `${CONFIG_DIR}.copying`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.cpSync(LEGACY_CONFIG_DIR, staging, { recursive: true, filter: (source) => source !== logs });
    fs.renameSync(staging, CONFIG_DIR);
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as CanvasAgentConfig;
        const workspace = config.workspace;
        if (!workspace) return;
        const relocate = (value?: string) => {
            if (!value) return value;
            const relative = path.relative(LEGACY_CONFIG_DIR, path.resolve(value));
            return relative.startsWith("..") || path.isAbsolute(relative) ? value : path.join(CONFIG_DIR, relative);
        };
        config.workspace = { ...workspace, workspacePath: relocate(workspace.workspacePath) || workspace.workspacePath, inputPath: relocate(workspace.inputPath), outputPath: relocate(workspace.outputPath) };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch {
        // 旧配置缺失或损坏时由 loadConfig 重新生成
    }
}

/** 从当前包信息中读取 Canvas Agent 版本号。 */
function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}
