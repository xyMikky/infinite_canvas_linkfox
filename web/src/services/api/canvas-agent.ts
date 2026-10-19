import i18n from "@/i18n";
import { agentOwnerId } from "@/lib/agent/agent-owner-id";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { AgentProvider, AgentReasoningEffort } from "@/stores/use-agent-store";

export function agentEnginePath(provider: AgentProvider, suffix: string) {
    return `/agent/${provider === "cursor" ? "cursor" : "codex"}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

type AgentConfigResponse = { ok?: boolean; protocolVersion?: number; url?: string; token?: string; hasToken?: boolean };

export class AgentApiError<T = unknown> extends Error {
    constructor(readonly status: number, readonly response: T & { code?: string; error?: string; msg?: string }) {
        super(response.error || response.msg || i18n.t("agent.state.requestFailed"));
        this.name = "AgentApiError";
    }
}

export type AgentSkillScope = "user" | "repo" | "system" | "admin";
export type AgentSkillInterface = { displayName?: string | null; shortDescription?: string | null; defaultPrompt?: string | null };
export type AgentSkillSummary = {
    name: string;
    description: string;
    shortDescription?: string | null;
    interface?: AgentSkillInterface | null;
    dependencies?: unknown;
    path: string;
    scope: AgentSkillScope;
    enabled: boolean;
    managed: boolean;
};
export type AgentSkillDetail = {
    name: string;
    description: string;
    instructions: string;
    interface?: AgentSkillInterface | null;
    path: string;
    managed: true;
    revision: string;
};
export type AgentSkillInput = { name?: string; description: string; instructions: string; interface?: AgentSkillInterface | null; expectedRevision?: string };
export type AgentSkillDraft = { name: string; displayName: string; description: string; instructions: string; shortDescription: string; defaultPrompt: string };
export type AgentSkillDraftInput = { source: "conversation" | "canvas"; threadId: string; clientId: string; model?: string; effort?: AgentReasoningEffort };
export type AgentSkillsResponse = { ok?: boolean; data?: AgentSkillSummary[]; errors?: unknown[] };
export type AgentSkillResponse = { ok?: boolean; data?: AgentSkillDetail };
export type AgentSkillDraftResponse = { ok?: boolean; data?: AgentSkillDraft };

export async function postState(endpoint: string, token: string, clientId: string, snapshot: CanvasAgentSnapshot | null) {
    try {
        const response = await fetch(`${endpoint}/canvas/state?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(snapshot ? { ...snapshot, hasCanvas: true } : { hasCanvas: false }),
        });
        return response.ok;
    } catch {
        return false;
    }
}

export async function activateAgentClient(endpoint: string, token: string, clientId: string) {
    try {
        await fetch(`${endpoint}/canvas/activate?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, { method: "POST" });
    } catch {}
}

export async function postToolResult(endpoint: string, token: string, clientId: string, body: { requestId: string; result?: unknown; error?: string }) {
    await fetchAgentJson(endpoint, token, `/canvas/result?clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export async function postCodexApproval(endpoint: string, token: string, requestId: string, decision: "accept" | "acceptForSession" | "decline") {
    await postAgentApproval(endpoint, token, requestId, decision, "codex");
}

export async function postAgentApproval(endpoint: string, token: string, requestId: string, decision: "accept" | "acceptForSession" | "decline", provider: AgentProvider) {
    await fetchAgentJson(endpoint, token, agentEnginePath(provider, "/approval"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, decision }) });
}

export async function postCodexUserInput(endpoint: string, token: string, requestId: string, answers: Record<string, string[]>) {
    await postAgentUserInput(endpoint, token, requestId, answers, "codex");
}

export async function postAgentUserInput(endpoint: string, token: string, requestId: string, answers: Record<string, string[]>, provider: AgentProvider) {
    await fetchAgentJson(endpoint, token, agentEnginePath(provider, "/user-input"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, answers }) });
}

export async function interruptCodexTurn(endpoint: string, token: string, threadId?: string) {
    await fetchAgentJson(endpoint, token, "/agent/codex/interrupt", jsonPost({ threadId }));
}

export async function interruptAgentTurn(endpoint: string, token: string, threadId: string | undefined, provider: AgentProvider) {
    await fetchAgentJson(endpoint, token, agentEnginePath(provider, "/interrupt"), jsonPost({ threadId }));
}

export async function acknowledgeCodexHistory(endpoint: string, token: string, threadId: string, turnIds: string[]) {
    await fetchAgentJson(endpoint, token, "/agent/codex/history/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId, turnIds }) });
}

export async function deleteCodexTurn(endpoint: string, token: string, threadId: string, turnId: string) {
    return fetchAgentJson<{ ok?: boolean; hiddenTurnIds?: string[] }>(
        endpoint,
        token,
        `/agent/codex/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/delete`,
        jsonPost({}),
    );
}

/** 编辑重发：fork 截断到 lastTurnId（含）之前的历史，模型不会再看到后面的回合。 */
export async function forkCodexThread(
    endpoint: string,
    token: string,
    threadId: string,
    body: { lastTurnId?: string; clientId?: string; permissionMode?: string },
) {
    return fetchAgentJson<{
        ok?: boolean;
        workspace?: { activeThreadId?: string };
        conversation?: { revision?: number; conversationId?: string; threadId?: string; status?: string };
        thread?: { id?: string };
        messages?: unknown[];
        settledTurnIds?: string[];
    }>(
        endpoint,
        token,
        `/agent/codex/threads/${encodeURIComponent(threadId)}/fork`,
        jsonPost(body),
    );
}

export async function revealAgentLocalFile(endpoint: string, token: string, path: string) {
    await fetchAgentJson(endpoint, token, "/agent/local-file/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
}

/** 列出 Codex 工作空间内某个产物目录的文件 */
export function listAgentWorkspaceDir(endpoint: string, token: string, path: string) {
    return fetchAgentJson<{ entries?: Array<{ path: string; size: number }> }>(endpoint, token, "/agent/workspace-dir", jsonPost({ path }));
}

/** 读取 Codex 工作空间内的单个产物文件 */
export async function readAgentWorkspaceFile(endpoint: string, token: string, path: string) {
    const res = await fetch(`${endpoint}/agent/workspace-file?token=${encodeURIComponent(token)}`, jsonPost({ path }));
    if (!res.ok) throw new AgentApiError(res.status, { error: "读取产物文件失败" });
    return await res.blob();
}

export function fetchCodexSkills(endpoint: string, token: string, forceReload = false) {
    return fetchAgentJson<AgentSkillsResponse>(endpoint, token, `/agent/codex/skills${forceReload ? "?forceReload=1" : ""}`);
}

export function fetchCursorSkills(endpoint: string, token: string) {
    return fetchAgentJson<AgentSkillsResponse>(endpoint, token, "/agent/cursor/skills");
}

export function fetchCodexSkill(endpoint: string, token: string, name: string) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(name)}`);
}

export function createCodexSkill(endpoint: string, token: string, input: AgentSkillInput) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, "/agent/codex/skills", jsonPost(input));
}

/** 把本地 Skill 文件夹整夹导入工作区 Codex Skills */
export function importCodexSkillFolder(endpoint: string, token: string, sourcePath: string) {
    return fetchAgentJson<{ ok?: boolean; data?: { name: string; path: string } }>(endpoint, token, "/agent/codex/skills/import", jsonPost({ sourcePath }));
}

export function createCodexSkillDraft(endpoint: string, token: string, input: AgentSkillDraftInput) {
    return fetchAgentJson<AgentSkillDraftResponse>(endpoint, token, "/agent/codex/skills/draft", jsonPost(input));
}

export function updateCodexSkill(endpoint: string, token: string, name: string, input: AgentSkillInput) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(name)}`, jsonPost(input));
}

export function deleteCodexSkill(endpoint: string, token: string, name: string, expectedRevision: string) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(name)}/delete`, jsonPost({ expectedRevision }));
}

export function setCodexSkillEnabled(endpoint: string, token: string, skill: Pick<AgentSkillSummary, "name" | "path">, enabled: boolean) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(skill.name)}/enabled`, jsonPost({ ...skill, enabled }));
}

export function fetchAgentWorkspace(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean; workspace?: { workspacePath?: string; inputPath?: string; outputPath?: string; activeThreadId?: string } }>(
        endpoint,
        token,
        "/agent/codex/workspace",
    );
}

export function updateAgentFilePaths(endpoint: string, token: string, inputPath: string, outputPath: string) {
    return fetchAgentJson<{ ok?: boolean; workspace?: { inputPath?: string; outputPath?: string; workspacePath?: string } }>(
        endpoint,
        token,
        "/agent/codex/paths",
        jsonPost({ inputPath, outputPath }),
    );
}

export async function fetchAgentJson<T>(endpoint: string, token: string, path: string, init?: RequestInit) {
    // ownerId 标识当前浏览器，服务端据此隔离各访客的会话与历史
    const url = `${endpoint}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}&ownerId=${encodeURIComponent(agentOwnerId())}`;
    const res = await fetch(url, init);
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; msg?: string };
    if (!res.ok) {
        const staleCursor = res.status === 404 && path.includes("/agent/cursor");
        throw new AgentApiError(res.status, staleCursor
            ? { ...data, error: i18n.t("agent.runtime.cursorAgentOutdated") }
            : data);
    }
    return data;
}

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1", "[::1]"];

/** 页面不是从本机打开（局域网共享）时，把指向 127.0.0.1 的 Agent 地址重写为同源代理，否则访客会连到自己的电脑。 */
export function resolveAgentEndpointForPage(url: string) {
    const endpoint = (url || "").trim().replace(/\/$/, "");
    if (typeof window === "undefined" || LOOPBACK_HOSTS.includes(window.location.hostname)) return endpoint;
    try {
        if (!LOOPBACK_HOSTS.includes(new URL(endpoint).hostname)) return endpoint;
    } catch {
        return endpoint;
    }
    return `${window.location.origin}/api/agent-proxy`;
}

export async function discoverAgentConfig(endpoint: string) {
    try {
        const res = await fetch(`${endpoint}/config`);
        if (!res.ok) return null;
        const data = (await res.json()) as AgentConfigResponse;
        return data.ok ? data : null;
    } catch {
        return null;
    }
}

export type StartLocalAgentResult =
    | { ok: true; alreadyRunning: boolean }
    | { ok: false; unavailable: true }
    | { ok: false; codexMissing: true }
    | { ok: false; error: string };
export type LocalAgentConnectInfo = { url: string; token: string };
export type CodexInstallStatus = { available: boolean; installed: boolean };
export type CursorInstallStatus = { available: boolean; installed: boolean };

export async function fetchCursorInstallStatus(): Promise<CursorInstallStatus> {
    try {
        const res = await fetch("/api/local-agent/cursor-status");
        if (res.status === 404) return { available: false, installed: false };
        const type = res.headers.get("content-type") || "";
        if (!type.includes("application/json")) return { available: false, installed: false };
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; installed?: boolean };
        if (!res.ok || !data.ok) return { available: true, installed: false };
        return { available: true, installed: Boolean(data.installed) };
    } catch {
        return { available: false, installed: false };
    }
}

export async function fetchCodexInstallStatus(): Promise<CodexInstallStatus> {
    try {
        const res = await fetch("/api/local-agent/codex-status");
        if (res.status === 404) return { available: false, installed: false };
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; installed?: boolean };
        if (!res.ok || !data.ok) return { available: true, installed: false };
        return { available: true, installed: Boolean(data.installed) };
    } catch {
        return { available: false, installed: false };
    }
}

export async function startLocalAgent(): Promise<StartLocalAgentResult> {
    try {
        const cursorApiKey = typeof localStorage === "undefined" ? "" : localStorage.getItem("canvas-cursor-api-key") || "";
        const res = await fetch("/api/local-agent/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cursorApiKey }),
        });
        if (res.status === 404) return { ok: false, unavailable: true };
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; alreadyRunning?: boolean; error?: string; codexMissing?: boolean };
        if (data.codexMissing) return { ok: false, codexMissing: true };
        if (!res.ok || !data.ok) return { ok: false, error: data.error || i18n.t("agent.connect.startFailed") };
        return { ok: true, alreadyRunning: Boolean(data.alreadyRunning) };
    } catch {
        return { ok: false, unavailable: true };
    }
}

export async function fetchLocalAgentConnectInfo(): Promise<LocalAgentConnectInfo | null | { unavailable: true }> {
    try {
        const res = await fetch("/api/local-agent/config");
        if (res.status === 404) return { unavailable: true };
        if (!res.ok) return null;
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; token?: string };
        const url = String(data.url || "").trim().replace(/\/$/, "");
        const token = String(data.token || "").trim();
        if (!data.ok || !url || !token) return null;
        return { url: resolveAgentEndpointForPage(url), token };
    } catch {
        return { unavailable: true };
    }
}

function jsonPost(body: unknown): RequestInit {
    return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
