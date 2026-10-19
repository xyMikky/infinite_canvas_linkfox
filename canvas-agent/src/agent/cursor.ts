import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { cursorChatEnvironment, cursorTurnPrompt, rememberThreadMode, threadContextMode } from "./chat-mode.js";
import { errorMessage } from "../utils/value.js";
import { extractAssistantText } from "./assistant-text.js";
import { CursorTextStream } from "./cursor-text-stream.js";
import { CursorAcpClient } from "./cursor-acp.js";
import { watchCursorOutput } from "./cursor-output-watchdog.js";
import { logger } from "../utils/logger.js";
import {
    deleteCursorHistoryThread,
    listAllCursorHistoryThreads,
    readCursorHistoryThread,
    recordCursorHistoryMessage,
    upsertCursorHistoryThread,
} from "./cursor-history.js";
import type { AgentCollaborationMode, AgentEmit, AgentPermissionMode } from "./types.js";

export type CursorCliStatus = { installed: boolean; loggedIn: boolean; binary: string; detail?: string };
export type CursorThreadSummary = {
    id: string;
    preview: string;
    name?: string | null;
    cwd?: string;
    createdAt: number;
    updatedAt: number;
};
export type CursorConversation = {
    revision: number;
    conversationId: string;
    threadId: string;
    status: "idle" | "ready" | "running";
    mcpStatuses: Record<string, never>;
};

type CursorThread = CursorThreadSummary & { sessionId: string; ownerId: string };

const threads = new Map<string, CursorThread>();
const activeByOwner = new Map<string, string>();
const children = new Map<string, ChildProcess>();
const acpClients = new Map<string, CursorAcpClient>();
const revisions = new Map<string, number>();
let resolvedBinary = "";
let historyHydrated = false;

function hydrateCursorHistory() {
    if (historyHydrated) return;
    historyHydrated = true;
    for (const item of listAllCursorHistoryThreads()) {
        if (!item.preview && !item.messages.length) {
            deleteCursorHistoryThread(item.id, item.ownerId);
            continue;
        }
        if (threads.has(item.id)) continue;
        threads.set(item.id, {
            id: item.id,
            preview: item.preview,
            cwd: item.cwd,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            sessionId: item.sessionId || "",
            ownerId: item.ownerId,
        });
    }
}

function cursorThreadHasContent(thread: CursorThread) {
    return Boolean(thread.preview.trim()) || getCursorThreadMessages(thread.id, thread.ownerId).length > 0;
}

function persistCursorThread(thread: CursorThread, force = false) {
    if (!force && !cursorThreadHasContent(thread)) return;
    upsertCursorHistoryThread({
        id: thread.id,
        ownerId: thread.ownerId,
        preview: thread.preview,
        cwd: thread.cwd,
        sessionId: thread.sessionId,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
    });
}

function pruneEmptyCursorDrafts(ownerId?: string) {
    for (const thread of [...threads.values()]) {
        if (ownerId && thread.ownerId !== ownerId) continue;
        if (activeByOwner.get(thread.ownerId) === thread.id) continue;
        if (cursorThreadHasContent(thread)) continue;
        threads.delete(thread.id);
        deleteCursorHistoryThread(thread.id, thread.ownerId);
    }
}

function bumpRevision(ownerId: string) {
    const next = (revisions.get(ownerId) || 0) + 1;
    revisions.set(ownerId, next);
    return next;
}

function extraBinDirs() {
    if (process.platform === "win32") {
        const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
        const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
        return [
            path.join(local, "cursor-agent"),
            path.join(os.homedir(), ".local", "bin"),
            path.join(os.homedir(), ".cursor", "bin"),
            path.join(appData, "npm"),
            path.join(local, "npm"),
            "C:\\Program Files\\nodejs",
        ];
    }
    return [path.join(os.homedir(), ".local", "bin"), "/usr/local/bin", path.join(os.homedir(), ".npm-global", "bin")];
}

function lookOnPath(name: string) {
    const cmd = process.platform === "win32" ? "where" : "which";
    return new Promise<string>((resolve) => {
        execFile(cmd, [name], { windowsHide: true, timeout: 4000 }, (error, stdout) => {
            if (error) return resolve("");
            const found = String(stdout || "")
                .trim()
                .split(/\r?\n/)
                .map((line) => line.trim())
                .find((line) => line && existsSync(line));
            resolve(found || "");
        });
    });
}

async function resolveCursorBinary() {
    if (resolvedBinary && existsSync(resolvedBinary)) return resolvedBinary;
    const override = String(process.env.CURSOR_CLI_BIN || "").trim();
    if (override && existsSync(override)) {
        resolvedBinary = override;
        return override;
    }
    const names = process.platform === "win32"
        ? ["agent.cmd", "agent.exe", "cursor-agent.cmd", "cursor-agent.exe"]
        : ["agent", "cursor-agent"];
    for (const name of names) {
        const found = await lookOnPath(name);
        if (found) {
            resolvedBinary = found;
            return found;
        }
        for (const dir of extraBinDirs()) {
            const candidate = path.join(dir, name);
            if (existsSync(candidate)) {
                resolvedBinary = candidate;
                return candidate;
            }
        }
    }
    return "";
}

function cursorCliEnv(apiKey?: string) {
    const key = String(apiKey || process.env.CURSOR_API_KEY || "").trim();
    return key ? { ...process.env, CURSOR_API_KEY: key } : { ...process.env };
}

/** 必须直接跑 index.js。Windows 的 agent.cmd 会再开 PowerShell，长提示词会被拼坏并一直挂起。内置包通常没有同目录 node.exe，改用当前 Agent 的 Node。 */
function spawnCursorCli(binary: string, args: string[], cwd?: string, apiKey?: string, stdin: "ignore" | "pipe" = "ignore", thread?: CursorThread) {
    const dir = path.dirname(binary);
    const index = path.join(dir, "index.js");
    const bundledNode = path.join(dir, process.platform === "win32" ? "node.exe" : "node");
    const nodeBin = existsSync(bundledNode) ? bundledNode : process.execPath;
    const useNode = existsSync(index);
    return spawn(useNode ? nodeBin : binary, useNode ? [index, ...args] : args, {
        cwd,
        stdio: [stdin, "pipe", "pipe"],
        shell: false,
        windowsHide: true,
        env: { ...cursorCliEnv(apiKey), ...(thread && threadContextMode(thread.id) === "chat" ? cursorChatEnvironment().env : thread ? cursorMcpEnv(thread) : {}) },
    });
}

function runCli(binary: string, args: string[], cwd?: string, apiKey?: string) {
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        const child = spawnCursorCli(binary, args, cwd, apiKey);
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", (error) => resolve({ code: 1, stdout, stderr: error.message }));
        child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
}

/** 探测本机 Cursor CLI 是否安装、是否已登录。 */
export async function getCursorCliStatus(): Promise<CursorCliStatus> {
    const binary = await resolveCursorBinary();
    if (!binary) return { installed: false, loggedIn: false, binary: "", detail: "未检测到 Cursor CLI（agent / cursor-agent）" };
    const result = await runCli(binary, ["status"]);
    const text = `${result.stdout}\n${result.stderr}`;
    const loggedIn = /logged in|signed in|authenticated|email|account/i.test(text) && !/not logged|unauthenticated|please log in|login required/i.test(text);
    return { installed: true, loggedIn: loggedIn || result.code === 0, binary, detail: text.trim().slice(0, 400) };
}

function cursorThreadBusy(threadId: string) {
    return children.has(threadId) || Boolean(acpClients.get(threadId)?.busy);
}

export function cursorConversation(ownerId: string): CursorConversation {
    const threadId = activeByOwner.get(ownerId) || "";
    const busy = Boolean(threadId && cursorThreadBusy(threadId));
    return {
        revision: revisions.get(ownerId) || 1,
        conversationId: threadId,
        threadId,
        status: busy ? "running" : threadId ? "ready" : "idle",
        mcpStatuses: {},
    };
}

export function listCursorThreads(ownerId: string): CursorThreadSummary[] {
    hydrateCursorHistory();
    pruneEmptyCursorDrafts(ownerId);
    const active = activeByOwner.get(ownerId);
    return [...threads.values()]
        .filter((item) => item.ownerId === ownerId)
        .filter((item) => item.id === active || cursorThreadHasContent(item))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(({ sessionId: _sessionId, ownerId: _ownerId, ...item }) => item);
}

export function getCursorThread(threadId: string) {
    hydrateCursorHistory();
    return threads.get(threadId) || null;
}

export function getCursorThreadMessages(threadId: string, ownerId: string) {
    return readCursorHistoryThread(threadId, ownerId)?.messages || [];
}

export function createCursorThread(ownerId: string, cwd?: string, mode: AgentCollaborationMode = "default"): CursorThread {
    hydrateCursorHistory();
    const id = `cursor:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const thread: CursorThread = { id, sessionId: "", preview: "", createdAt: now, updatedAt: now, ownerId, cwd };
    threads.set(id, thread);
    rememberThreadMode(id, mode);
    activeByOwner.set(ownerId, id);
    bumpRevision(ownerId);
    return thread;
}

/** hello / 新对话：当前还没发言就复用，避免连开一串空历史。 */
export function resetCursorThread(ownerId: string, cwd?: string, mode: AgentCollaborationMode = "default"): CursorThread {
    hydrateCursorHistory();
    pruneEmptyCursorDrafts(ownerId);
    const currentId = activeByOwner.get(ownerId) || "";
    const current = currentId ? threads.get(currentId) : null;
    if (current && current.ownerId === ownerId && !cursorThreadHasContent(current) && threadContextMode(current.id) === (mode === "chat" ? "chat" : "default")) {
        if (cwd && !current.cwd) current.cwd = cwd;
        return current;
    }
    return createCursorThread(ownerId, cwd, mode);
}

export function activateCursorThread(ownerId: string, threadId: string) {
    hydrateCursorHistory();
    const thread = threads.get(threadId);
    if (!thread || thread.ownerId !== ownerId) return null;
    activeByOwner.set(ownerId, threadId);
    bumpRevision(ownerId);
    return thread;
}

export function deleteCursorThread(ownerId: string, threadId: string) {
    hydrateCursorHistory();
    const thread = threads.get(threadId);
    if (!thread || thread.ownerId !== ownerId) return false;
    disposeCursorAcp(threadId);
    interruptCursorTurn(threadId);
    threads.delete(threadId);
    deleteCursorHistoryThread(threadId, ownerId);
    if (activeByOwner.get(ownerId) === threadId) activeByOwner.delete(ownerId);
    bumpRevision(ownerId);
    return true;
}

export function interruptCursorTurn(threadId: string) {
    if (!threadId) return false;
    const printIds = [threadId];
    const acpIds = [threadId];
    let ok = false;
    for (const id of acpIds) {
        const client = acpClients.get(id);
        if (!client?.busy) continue;
        client.cancel();
        ok = true;
    }
    for (const id of printIds) {
        const child = children.get(id);
        if (!child) continue;
        try {
            if (process.platform === "win32" && child.pid) spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
            else child.kill("SIGTERM");
            ok = true;
        } catch {
            /* ignore */
        }
        children.delete(id);
    }
    return ok;
}

export function resolveCursorUserInput(requestId: string, answers: Record<string, string[]>) {
    for (const client of acpClients.values()) {
        if (client.resolveUserInput(requestId, answers)) return true;
    }
    return false;
}

export function resolveCursorApproval(_requestId: string, _decision: string) {
    return false;
}

function disposeCursorAcp(threadId: string) {
    const client = acpClients.get(threadId);
    if (!client) return;
    client.dispose();
    acpClients.delete(threadId);
}

function cursorMcpEnv(thread: CursorThread) {
    return { CANVAS_AGENT_THREAD_ID: thread.id, CANVAS_AGENT_OWNER_ID: thread.ownerId };
}

function canvasAgentMcpCommand() {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    if (fileURLToPath(import.meta.url).endsWith(".ts")) {
        const loader = pathToFileURL(path.join(root, "node_modules", "tsx", "dist", "loader.mjs")).href;
        return { command: process.execPath, args: ["--import", loader, path.join(root, "src", "index.ts"), "mcp"] };
    }
    const entry = path.join(root, "dist", "index.js");
    if (existsSync(entry)) return { command: process.execPath, args: [entry, "mcp"] };
    return { command: "npx", args: ["-y", "@basketikun/canvas-agent", "mcp"] };
}

/** 在画布工作区写入 infinite-canvas MCP，供 Cursor CLI 读取。 */
export function ensureCursorCanvasMcp(workspacePath: string) {
    const dir = path.join(workspacePath, ".cursor");
    const file = path.join(dir, "mcp.json");
    mkdirSync(dir, { recursive: true });
    let current: { mcpServers?: Record<string, unknown> } = {};
    try {
        current = JSON.parse(readFileSync(file, "utf8")) as { mcpServers?: Record<string, unknown> };
    } catch {
        current = {};
    }
    current.mcpServers ||= {};
    if (!current.mcpServers["infinite-canvas"]) {
        current.mcpServers["infinite-canvas"] = canvasAgentMcpCommand();
        writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
    }
}

function emitCursor(emit: AgentEmit, type: string, payload: Record<string, unknown>) {
    emit(type, payload);
}

function emitAgentItem(
    emit: AgentEmit,
    threadId: string,
    turnId: string,
    clientId: string,
    kind: "item.updated" | "item.completed",
    item: Record<string, unknown>,
) {
    emitCursor(emit, "agent_event", {
        type: kind,
        threadId,
        turn_id: turnId,
        turnId,
        sourceClientId: clientId,
        item,
    });
    if (kind !== "item.completed" || item.type !== "agent_message") return;
    const text = String(item.text || "").trim();
    if (!text) return;
    recordCursorHistoryMessage(threadId, {
        id: `${threadId}:${turnId}:${String(item.id || "assistant")}`,
        itemId: String(item.id || "assistant"),
        threadId,
        turnId,
        role: "assistant",
        title: "Cursor",
        text,
    });
}

function toolLabel(event: Record<string, unknown>) {
    const call = event.tool_call;
    if (!call || typeof call !== "object") return String(event.subtype || "tool");
    const key = Object.keys(call as object)[0] || "tool";
    return key.replace(/ToolCall$/, "");
}

function beginCursorTurn(emit: AgentEmit, thread: CursorThread, turnId: string, options: {
    clientId: string;
    messageText?: string;
    messageId?: string;
    prompt: string;
}) {
    const userText = options.messageText || options.prompt;
    emitCursor(emit, "chat_message", {
        threadId: thread.id,
        turnId,
        sourceClientId: options.clientId,
        message: {
            id: `${thread.id}:${turnId}:synthetic:user`,
            itemId: "synthetic:user",
            clientMessageId: options.messageId || "",
            threadId: thread.id,
            turnId,
            role: "user",
            text: userText,
        },
    });
    persistCursorThread(thread, true);
    recordCursorHistoryMessage(thread.id, {
        id: `${thread.id}:${turnId}:synthetic:user`,
        itemId: "synthetic:user",
        clientMessageId: options.messageId || "",
        threadId: thread.id,
        turnId,
        role: "user",
        text: userText,
    });
    emitCursor(emit, "agent_event", { type: "turn.started", threadId: thread.id, turnId, turn_id: turnId, sourceClientId: options.clientId });
    emitCursor(emit, "codex_state", { busy: true, threadId: thread.id, turnId });
}

function finishCursorTurn(emit: AgentEmit, thread: CursorThread, turnId: string, ownerId: string, code: number | null, onFinish?: (threadId: string) => void) {
    emitCursor(emit, "agent_event", { agent: "cursor", type: "turn.completed", thread_id: thread.id, turn_id: turnId, status: code === 0 ? "completed" : code === null ? "interrupted" : "failed" });
    emitCursor(emit, "codex_state", { busy: false, threadId: thread.id, turnId });
    emitCursor(emit, "agent_done", { agent: "cursor", code, threadId: thread.id, turnId });
    bumpRevision(ownerId);
    onFinish?.(thread.id);
}

async function runCursorAcpTurn(
    binary: string,
    fullPrompt: string,
    emit: AgentEmit,
    thread: CursorThread,
    options: {
        ownerId: string;
        clientId: string;
        cwd: string;
        collaborationMode?: AgentCollaborationMode;
        messageText?: string;
        messageId?: string;
        apiKey?: string;
        onFinish?: (threadId: string) => void;
    },
) {
    const turnId = `cursor-turn-${Date.now().toString(36)}`;
    thread.updatedAt = Date.now();
    thread.preview = (options.messageText || "").trim().slice(0, 80);
    thread.cwd = options.cwd;
    persistCursorThread(thread);
    beginCursorTurn(emit, thread, turnId, { clientId: options.clientId, messageText: options.messageText, messageId: options.messageId, prompt: fullPrompt });

    try {
        ensureCursorCanvasMcp(options.cwd);
    } catch {
        /* MCP 配置写失败不挡对话 */
    }

    const apiKey = String(options.apiKey || process.env.CURSOR_API_KEY || "").trim();
    let client = acpClients.get(thread.id);
    if (!client || !client.alive) {
        client = new CursorAcpClient(() => spawnCursorCli(binary, apiKey ? ["--api-key", apiKey, "acp"] : ["acp"], options.cwd, options.apiKey, "pipe", thread));
        acpClients.set(thread.id, client);
    }
    try {
        thread.sessionId = await client.openSession(options.cwd, { ...canvasAgentMcpCommand(), env: cursorMcpEnv(thread) }, thread.sessionId || undefined);
        persistCursorThread(thread);
        await client.setCollaborationMode(options.collaborationMode === "plan" ? "plan" : "default");
    } catch (error) {
        const message = errorMessage(error);
        emitAgentItem(emit, thread.id, turnId, options.clientId, "item.completed", {
            id: `cursor-msg-${turnId}:error`,
            type: "error",
            message: message || "Cursor 规划模式启动失败",
        });
        disposeCursorAcp(thread.id);
        finishCursorTurn(emit, thread, turnId, options.ownerId, 1, options.onFinish);
        return { threadId: thread.id, turnId };
    }
    void client.prompt(fullPrompt, { emit, threadId: thread.id, turnId, clientId: options.clientId }).then(() => {
        finishCursorTurn(emit, thread, turnId, options.ownerId, 0, options.onFinish);
    }).catch((error) => {
        emitAgentItem(emit, thread.id, turnId, options.clientId, "item.completed", {
            id: `cursor-msg-${turnId}:error`,
            type: "error",
            message: errorMessage(error) || "Cursor 规划模式执行失败",
        });
        if (!client.sessionId || !client.alive) disposeCursorAcp(thread.id);
        finishCursorTurn(emit, thread, turnId, options.ownerId, 1, options.onFinish);
    });
    return { threadId: thread.id, turnId };
}

/** 使用 Cursor CLI 执行一轮对话，并把 stream-json 映射成面板已有的 SSE 事件。 */
export async function runCursorTurn(
    prompt: string,
    emit: AgentEmit,
    options: {
        ownerId: string;
        clientId: string;
        threadId?: string;
        cwd: string;
        permissionMode?: AgentPermissionMode;
        collaborationMode?: AgentCollaborationMode;
        messageText?: string;
        messageId?: string;
        apiKey?: string;
        onFinish?: (threadId: string) => void;
    },
) {
    const binary = await resolveCursorBinary();
    if (!binary) throw new Error("未检测到 Cursor CLI，请确认安装包已内置或先执行 npm run fetch:cursor-cli，再 agent login");
    const chat = options.collaborationMode === "chat";
    const fullPrompt = prompt.trim() ? cursorTurnPrompt(prompt, options.collaborationMode) : "";
    if (!fullPrompt) throw new Error("请输入任务内容");

    let thread = options.threadId ? threads.get(options.threadId) : null;
    if (thread && thread.ownerId !== options.ownerId) throw new Error("无权访问该会话");
    if (!thread) thread = createCursorThread(options.ownerId, options.cwd, options.collaborationMode);
    if (threadContextMode(thread.id) !== (chat ? "chat" : "default")) throw new Error("会话模式已变化，请新建对话后重试");
    activeByOwner.set(options.ownerId, thread.id);
    bumpRevision(options.ownerId);

    if (cursorThreadBusy(thread.id)) throw new Error("Cursor 正在运行，请稍后再试");

    const useAcp = !chat && (options.collaborationMode === "plan" || acpClients.has(thread.id));
    if (useAcp) return runCursorAcpTurn(binary, fullPrompt, emit, thread, options);

    try {
        if (!chat) ensureCursorCanvasMcp(options.cwd);
    } catch {
        /* MCP 配置写失败不挡对话 */
    }

    const turnId = `cursor-turn-${Date.now().toString(36)}`;
    const itemId = `cursor-msg-${turnId}`;
    thread.updatedAt = Date.now();
    thread.preview = (options.messageText || prompt).trim().slice(0, 80);
    thread.cwd = options.cwd;
    persistCursorThread(thread);

    const apiKey = String(options.apiKey || process.env.CURSOR_API_KEY || "").trim();
    const cwd = chat ? cursorChatEnvironment().cwd : options.cwd;
    const args = [
        "-p",
        "--output-format", "stream-json",
        "--stream-partial-output",
        "--trust",
        "--force",
        "--workspace", cwd,
    ];
    if (apiKey) args.push("--api-key", apiKey);
    if (thread.sessionId) args.push("--resume", thread.sessionId);
    args.push(fullPrompt);

    beginCursorTurn(emit, thread, turnId, { clientId: options.clientId, messageText: options.messageText, messageId: options.messageId, prompt: fullPrompt });

    const child = spawnCursorCli(binary, args, cwd, options.apiKey, "ignore", thread);
    children.set(thread.id, child);
    const startedAt = Date.now();
    let streamReady = false;

    let emitted = "";
    let pendingStream = "";
    let pumpTimer: ReturnType<typeof setTimeout> | null = null;
    let buffer = "";
    let stderrText = "";
    let failMessage = "";
    let sawAssistant = false;
    const textStream = new CursorTextStream();
    const STREAM_CHARS = 16;
    const STREAM_MS = 16;
    const emitAssistantDelta = (piece: string) => {
        if (!piece) return;
        emitted += piece;
        emitAgentItem(emit, thread.id, turnId, options.clientId, "item.updated", {
            id: itemId,
            type: "agent_message",
            delta: piece,
        });
    };
    const flushStream = (all = false) => {
        if (!pendingStream) return;
        const take = all ? pendingStream.length : Math.min(STREAM_CHARS, pendingStream.length);
        const piece = pendingStream.slice(0, take);
        pendingStream = pendingStream.slice(take);
        emitAssistantDelta(piece);
    };
    const pumpStream = () => {
        pumpTimer = null;
        flushStream(false);
        if (pendingStream) pumpTimer = setTimeout(pumpStream, STREAM_MS);
    };
    const queueAssistant = (text: string) => {
        if (!text) return;
        sawAssistant = true;
        outputWatchdog.stop();
        pendingStream += text;
        if (!pumpTimer) pumpTimer = setTimeout(pumpStream, 0);
    };
    const queuedText = () => emitted + pendingStream;
    const replaceAssistant = (next: string) => {
        if (pumpTimer) {
            clearTimeout(pumpTimer);
            pumpTimer = null;
        }
        pendingStream = "";
        emitted = next;
        emitAgentItem(emit, thread.id, turnId, options.clientId, "item.updated", {
            id: itemId,
            type: "agent_message",
            text: next,
        });
    };
    const applyIncoming = (text: string) => {
        if (!text) return;
        const current = queuedText();
        const next = text;
        if (next === current) return;
        sawAssistant = true;
        outputWatchdog.stop();
        if (next.startsWith(current)) {
            queueAssistant(next.slice(current.length));
            return;
        }
        replaceAssistant(next);
    };
    const drainStream = () => new Promise<void>((resolve) => {
        const tick = () => {
            if (pumpTimer) {
                clearTimeout(pumpTimer);
                pumpTimer = null;
            }
            if (!pendingStream) return resolve();
            flushStream(false);
            setTimeout(tick, STREAM_MS);
        };
        tick();
    });
    const failTurn = (message: string) => {
        if (!children.has(thread.id)) return;
        failMessage = message;
        interruptCursorTurn(thread.id);
    };
    const outputWatchdog = watchCursorOutput((phase) => {
        if (sawAssistant || !children.has(thread.id)) return;
        logger.warn("Cursor CLI timed out", { threadId: thread.id, phase, elapsedMs: Date.now() - startedAt, stderrBytes: stderrText.length });
        failTurn(phase === "startup"
            ? "Cursor 启动超过 60 秒仍未就绪，本轮已停止。请重试；若持续出现，请查看 Agent 日志。"
            : "Cursor 已启动，但连续 75 秒没有新的回复进展，本轮已停止。请重试。");
    });
    let finished = false;
    const finish = (code: number | null) => {
        if (finished) return;
        finished = true;
        outputWatchdog.stop();
        children.delete(thread.id);
        if (buffer.trim()) consumeCliLine(buffer);
        buffer = "";
        applyIncoming(textStream.finish());
        void drainStream().then(() => {
            const assistant = queuedText();
            if (assistant.trim()) {
                emitAgentItem(emit, thread.id, turnId, options.clientId, "item.completed", {
                    id: itemId,
                    type: "agent_message",
                    text: assistant,
                });
            } else {
                const hint = failMessage || stderrText.trim().replace(/\s+/g, " ").slice(0, 400);
                emitAgentItem(emit, thread.id, turnId, options.clientId, "item.completed", {
                    id: `${itemId}:error`,
                    type: "error",
                    message: hint || (code && code !== 0 ? "Cursor CLI 执行失败" : "Cursor 没有返回内容"),
                });
            }
            emitCursor(emit, "codex_state", { busy: false, threadId: thread.id, turnId });
            emitCursor(emit, "agent_done", { agent: "cursor", code, threadId: thread.id, turnId });
            bumpRevision(options.ownerId);
            options.onFinish?.(thread.id);
        });
    };

    const consumeCliLine = (line: string) => {
        if (!line.trim()) return;
        let event: Record<string, unknown>;
        try {
            event = JSON.parse(line) as Record<string, unknown>;
        } catch {
            emitCursor(emit, "agent_log", { text: line, threadId: thread.id });
            return;
        }
        const type = String(event.type || "");
        applyIncoming(textStream.push(event));
        if (type) {
            if (!streamReady) logger.info("Cursor CLI stream ready", { threadId: thread.id, elapsedMs: Date.now() - startedAt, mode: chat ? "chat" : "default" });
            streamReady = true;
            if (!sawAssistant) outputWatchdog.activity();
        }
        if (type === "system" && (event.session_id || event.sessionId)) {
            thread.sessionId = String(event.session_id || event.sessionId);
            persistCursorThread(thread);
        }
        if (type === "thinking" || type === "reasoning") {
            const thought = extractAssistantText(event.message || event);
            if (!thought) return;
            emitAgentItem(emit, thread.id, turnId, options.clientId, "item.updated", {
                id: `cursor-thought-${turnId}`,
                type: "reasoning",
                delta: thought,
            });
            return;
        }
        if (type === "assistant") {
            return;
        }
        if (type === "tool_call") {
            const label = toolLabel(event);
            emitAgentItem(emit, thread.id, turnId, options.clientId, "item.updated", {
                id: `cursor-tool-${turnId}-${label}`,
                type: "command_execution",
                command: label,
                status: event.subtype === "completed" ? "completed" : "in_progress",
            });
        }
    };
    child.stdout?.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) consumeCliLine(line);
    });
    child.stderr?.on("data", (chunk) => {
        const text = chunk.toString();
        stderrText += text;
        emitCursor(emit, "agent_log", { text, threadId: thread.id });
        if (/Authentication required|invalid api key|unauthorized|login required/i.test(text)) {
            failTurn("Cursor 鉴权失败，请检查 API Key 后重试。");
        }
    });
    child.on("error", (error) => {
        emitCursor(emit, "agent_error", { message: errorMessage(error), threadId: thread.id, turnId });
        finish(1);
    });
    child.on("close", (code) => finish(code));

    return { threadId: thread.id, turnId };
}
