import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { AGENT_PROMPT, CONFIG_DIR } from "../config.js";
import type { JsonRecord } from "../utils/value.js";
import type { AgentCollaborationMode } from "./types.js";

const modesFile = path.join(CONFIG_DIR, "agent-thread-modes.json");
const threadModes: Record<string, "chat" | "default"> = (() => {
    try { return JSON.parse(readFileSync(modesFile, "utf8")); } catch { return {}; }
})();

export const threadContextMode = (threadId: string) => threadModes[threadId] || "default";

export function rememberThreadMode(threadId: string, mode: AgentCollaborationMode) {
    const context = mode === "chat" ? "chat" : "default";
    if (!threadId || threadModes[threadId] === context) return;
    threadModes[threadId] = context;
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(modesFile, JSON.stringify(threadModes));
}

/** 只覆盖本线程的上下文设置，不修改用户的 Codex 全局配置。 */
export function lightweightCodexConfig(config: JsonRecord, skillPaths: string[]) {
    const disabled = (value: unknown): Record<string, { enabled: false }> => Object.fromEntries(Object.keys(value || {}).map((name) => [name, { enabled: false }]));
    return {
        project_doc_max_bytes: 0,
        developer_instructions: "",
        include_collaboration_mode_instructions: false,
        include_apps_instructions: false,
        include_environment_context: false,
        skills: { include_instructions: false, bundled: { enabled: false }, config: skillPaths.map((path) => ({ path, enabled: false })) },
        features: { plugins: false, apps: false, memories: false, memory_tool: false, multi_agent: false, multi_agent_v2: false },
        mcp_servers: { "infinite-canvas": { enabled: false as const }, ...disabled(config.mcp_servers) },
        plugins: disabled(config.plugins),
        orchestrator: { skills: { enabled: false }, mcp: { enabled: false } },
    };
}

/** Cursor 没有关闭本地规则发现的开关，使用不含项目规则/全局 Skill 的独立 HOME。Windows 登录仍沿用 APPDATA 凭据。 */
export function cursorChatEnvironment() {
    const home = path.join(CONFIG_DIR, "light-chat", "cursor");
    const cwd = path.join(home, "workspace");
    mkdirSync(cwd, { recursive: true });
    // 只沿用模型选择；不复制规则、Skill、插件、MCP 或用户提示词配置。
    const cursorConfig = path.join(home, ".cursor");
    mkdirSync(cursorConfig, { recursive: true });
    const readJson = (file: string) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; } };
    const original = readJson(path.join(process.env.CURSOR_CONFIG_DIR || path.join(os.homedir(), ".cursor"), "cli-config.json"));
    const file = path.join(cursorConfig, "cli-config.json");
    const local = { version: 1, editor: { vimMode: false }, permissions: { allow: [], deny: [] }, ...readJson(file) };
    const previous = JSON.stringify(local);
    for (const key of ["model", "selectedModel", "modelParameters", "maxMode"]) {
        if (original[key] !== undefined) local[key] = original[key];
    }
    if (JSON.stringify(local) !== previous) writeFileSync(file, JSON.stringify(local));
    return { cwd, env: { HOME: home, USERPROFILE: home, CURSOR_CONFIG_DIR: path.join(home, ".cursor"), CURSOR_DATA_DIR: path.join(home, ".cursor") } };
}

export function cursorTurnPrompt(prompt: string, mode?: AgentCollaborationMode) {
    return mode === "chat" ? prompt.trim() : `${AGENT_PROMPT}\n\n用户请求：${prompt.trim()}`;
}

/** 显式选择的 Skill 单独随本条发送，不自动装载它所在目录的其它技能。 */
export function withSelectedSkill(prompt: string, skill?: { name: string; path: string }) {
    if (!skill) return prompt;
    return `${prompt}\n\n<selected_skill name=${JSON.stringify(skill.name)} path=${JSON.stringify(skill.path)}>\n${readFileSync(skill.path, "utf8")}\n</selected_skill>`;
}
