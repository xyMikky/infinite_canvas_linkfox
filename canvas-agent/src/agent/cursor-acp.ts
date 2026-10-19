import { spawn, type ChildProcess } from "node:child_process";

import { logger } from "../utils/logger.js";
import { errorMessage } from "../utils/value.js";
import { extractAssistantText, mergeAssistantText } from "./assistant-text.js";
import type { AgentCollaborationMode, AgentEmit } from "./types.js";

type JsonRecord = Record<string, unknown>;
type AcpMode = { id: string; name?: string };
type AskOption = { id: string; label: string };
type AskQuestion = { id: string; prompt: string; options: AskOption[]; allowMultiple?: boolean };
type PendingAsk = { rpcId: number; title?: string; questions: AskQuestion[] };
type PendingRpc = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type AcpSpawn = () => ChildProcess;

export type CursorAcpHooks = {
    emit: AgentEmit;
    threadId: string;
    turnId: string;
    clientId: string;
};

/** 把 Cursor ACP 的选择题映射成面板已有的问答卡。 */
export function mapAskQuestions(title: string | undefined, questions: AskQuestion[]) {
    return questions.map((question) => ({
        id: question.id,
        header: title || undefined,
        question: question.prompt,
        isOther: false,
        options: question.options.map((option) => ({ label: option.label, value: option.id })),
    })).filter((question) => question.id && question.question);
}

/** 把面板提交的选项（可能是文案）还原成 ACP 的 option id。 */
export function mapAskAnswers(questions: AskQuestion[], answers: Record<string, string[]>) {
    return questions.map((question) => {
        const values = answers[question.id] || [];
        const selectedOptionIds = values.flatMap((value) => {
            const option = question.options.find((item) => item.id === value || item.label === value);
            return option ? [option.id] : [];
        });
        return { questionId: question.id, selectedOptionIds };
    });
}

/** 从 ACP 会话返回的模式列表里挑 plan / agent。 */
export function pickAcpModeId(modes: AcpMode[], wanted: AgentCollaborationMode) {
    if (wanted === "plan") {
        return modes.find((item) => /plan|architect/i.test(item.id) || /plan|architect/i.test(item.name || ""))?.id || "plan";
    }
    return modes.find((item) => /^(agent|code|default)$/i.test(item.id) || /agent|code|default/i.test(item.name || ""))?.id
        || modes.find((item) => !/plan|ask|architect/i.test(item.id))?.id
        || "agent";
}

function asRecord(value: unknown): JsonRecord {
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function textOf(value: unknown): string {
    return extractAssistantText(value);
}

function askQuestionsOf(value: unknown): AskQuestion[] {
    return (Array.isArray(value) ? value : []).flatMap((item) => {
        const question = asRecord(item);
        const id = String(question.id || "");
        const prompt = String(question.prompt || question.question || "");
        const options = (Array.isArray(question.options) ? question.options : []).flatMap((entry) => {
            const option = asRecord(entry);
            const optionId = String(option.id || option.value || "");
            const label = String(option.label || optionId);
            return optionId && label ? [{ id: optionId, label }] : [];
        });
        return id && prompt ? [{ id, prompt, options, allowMultiple: Boolean(question.allowMultiple) }] : [];
    });
}

function planMarkdown(params: JsonRecord) {
    const overview = String(params.overview || "").trim();
    const plan = String(params.plan || "").trim();
    const todos = Array.isArray(params.todos) ? params.todos : [];
    const steps = todos.flatMap((item) => {
        const todo = asRecord(item);
        const content = String(todo.content || todo.step || "").trim();
        return content ? [`- ${content}`] : [];
    });
    return [overview, plan, steps.length ? ["## 步骤", ...steps].join("\n") : ""].filter(Boolean).join("\n\n");
}

/** 长驻 Cursor `agent acp`，用来做规划问答和方案确认。 */
export class CursorAcpClient {
    sessionId = "";
    busy = false;
    private child: ChildProcess | null = null;
    private nextId = 1;
    private buffer = "";
    private modes: AcpMode[] = [];
    private pending = new Map<number, PendingRpc>();
    private asks = new Map<string, PendingAsk>();
    private hooks: CursorAcpHooks | null = null;
    private assistant = "";
    private thought = "";
    private assistantItemId = "";

    constructor(private readonly spawnAcp: AcpSpawn) {}

    get alive() {
        return Boolean(this.child && !this.child.killed);
    }

    async ensure() {
        if (this.alive) return;
        this.child = this.spawnAcp();
        this.child.stdout?.on("data", (chunk) => this.read(String(chunk)));
        this.child.stderr?.on("data", (chunk) => {
            const text = String(chunk);
            if (this.hooks) this.hooks.emit("agent_log", { text, threadId: this.hooks.threadId });
        });
        this.child.on("error", (error) => this.failAll(errorMessage(error)));
        this.child.on("close", () => this.failAll("Cursor ACP 已退出"));
        await this.request("initialize", {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
            clientInfo: { name: "infinite-canvas", version: "1" },
        }, 20000);
        try {
            await this.request("authenticate", { methodId: "cursor_login" }, 15000);
        } catch (error) {
            logger.warn("Cursor ACP authenticate skipped", { error: errorMessage(error) });
        }
    }

    async openSession(cwd: string, mcp: { command: string; args: string[]; env: Record<string, string> }, existingId?: string) {
        await this.ensure();
        if (this.sessionId) return this.sessionId;
        const mcpServers = [{ name: "infinite-canvas", command: mcp.command, args: mcp.args, env: Object.entries(mcp.env).map(([name, value]) => ({ name, value })) }];
        if (existingId) {
            try {
                await this.request("session/resume", { sessionId: existingId, cwd, mcpServers }, 15000);
                this.sessionId = existingId;
                return existingId;
            } catch (error) {
                logger.warn("Cursor ACP session/resume failed", { error: errorMessage(error), sessionId: existingId });
                try {
                    await this.request("session/load", { sessionId: existingId, cwd, mcpServers }, 20000);
                    this.sessionId = existingId;
                    return existingId;
                } catch (loadError) {
                    logger.warn("Cursor ACP session/load failed", { error: errorMessage(loadError), sessionId: existingId });
                }
            }
        }
        const result = asRecord(await this.request("session/new", { cwd, mcpServers }, 20000));
        this.sessionId = String(result.sessionId || "");
        const modeState = asRecord(result.modes);
        const rawModes = Array.isArray(modeState.availableModes) ? modeState.availableModes : Array.isArray(result.availableModes) ? result.availableModes : [];
        this.modes = rawModes.flatMap((item) => {
            const mode = asRecord(item);
            const id = String(mode.id || "");
            return id ? [{ id, name: String(mode.name || id) }] : [];
        });
        if (!this.sessionId) throw new Error("Cursor ACP 没有返回 sessionId");
        return this.sessionId;
    }

    async setCollaborationMode(mode: AgentCollaborationMode) {
        if (!this.sessionId) return;
        const modeId = pickAcpModeId(this.modes, mode);
        try {
            await this.request("session/set_mode", { sessionId: this.sessionId, modeId }, 10000);
        } catch (error) {
            logger.warn("Cursor ACP set_mode failed", { error: errorMessage(error), modeId });
        }
    }

    async prompt(text: string, hooks: CursorAcpHooks) {
        if (this.busy) throw new Error("Cursor 正在运行，请稍后再试");
        this.busy = true;
        this.hooks = hooks;
        this.assistant = "";
        this.thought = "";
        this.assistantItemId = `cursor-msg-${hooks.turnId}`;
        try {
            await this.request("session/prompt", {
                sessionId: this.sessionId,
                prompt: [{ type: "text", text }],
            }, 0);
        } finally {
            this.busy = false;
            if (this.thought.trim()) {
                this.emitItem("item.completed", { id: `cursor-thought-${hooks.turnId}`, type: "reasoning", text: this.thought });
            }
            if (this.assistant.trim()) {
                this.emitItem("item.completed", { id: this.assistantItemId, type: "agent_message", text: this.assistant });
            }
            this.hooks = null;
        }
        return this.assistant;
    }

    cancel() {
        if (this.sessionId) this.notify("session/cancel", { sessionId: this.sessionId });
        for (const [requestId, ask] of this.asks) {
            this.respond(ask.rpcId, { outcome: { outcome: "cancelled" } });
            this.emitResolved(requestId);
        }
        this.asks.clear();
    }

    resolveUserInput(requestId: string, answers: Record<string, string[]>) {
        const ask = this.asks.get(requestId);
        if (!ask) return false;
        const mapped = mapAskAnswers(ask.questions, answers);
        const answered = mapped.some((item) => item.selectedOptionIds.length);
        this.respond(ask.rpcId, {
            outcome: answered
                ? { outcome: "answered", answers: mapped }
                : { outcome: "skipped" },
        });
        this.asks.delete(requestId);
        this.emitResolved(requestId);
        return true;
    }

    hasAsk(requestId: string) {
        return this.asks.has(requestId);
    }

    dispose() {
        this.cancel();
        const child = this.child;
        this.failAll("Cursor ACP 已关闭");
        try {
            if (process.platform === "win32" && child?.pid) spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
            else child?.kill("SIGTERM");
        } catch {
            /* ignore */
        }
        this.child = null;
        this.sessionId = "";
    }

    private read(chunk: string) {
        this.buffer += chunk;
        const lines = this.buffer.split(/\r?\n/);
        this.buffer = lines.pop() || "";
        for (const line of lines) this.consume(line);
    }

    private consume(line: string) {
        if (!line.trim()) return;
        let message: JsonRecord;
        try {
            message = JSON.parse(line) as JsonRecord;
        } catch {
            this.hooks?.emit("agent_log", { text: line, threadId: this.hooks.threadId });
            return;
        }
        const id = message.id;
        if (id !== undefined && (message.result !== undefined || message.error)) {
            const pending = this.pending.get(Number(id));
            if (!pending) return;
            this.pending.delete(Number(id));
            if (message.error) pending.reject(new Error(textOf(message.error) || "Cursor ACP 请求失败"));
            else pending.resolve(message.result);
            return;
        }
        const method = String(message.method || "");
        if (!method) return;
        if (method === "session/update") return this.onUpdate(asRecord(message.params));
        if (id === undefined) return;
        const params = asRecord(message.params);
        if (method === "session/request_permission") {
            this.respond(Number(id), { outcome: { outcome: "selected", optionId: "allow-once" } });
            return;
        }
        if (method === "cursor/ask_question" || method.endsWith("/ask_question")) {
            this.onAsk(Number(id), params);
            return;
        }
        if (method === "cursor/create_plan" || method.endsWith("/create_plan")) {
            this.onCreatePlan(params);
            this.respond(Number(id), { outcome: { outcome: "accepted" } });
            return;
        }
        if (method === "cursor/update_todos" || method.endsWith("/update_todos")) {
            this.onTodos(params);
            this.respond(Number(id), { outcome: { outcome: "accepted", todos: params.todos || [] } });
            return;
        }
        this.respond(Number(id), { outcome: { outcome: "cancelled" } });
    }

    private onUpdate(params: JsonRecord) {
        const update = asRecord(params.update);
        const kind = String(update.sessionUpdate || "");
        if (kind === "agent_message_chunk") {
            const piece = textOf(update.content);
            if (!piece) return;
            const next = mergeAssistantText(this.assistant, piece, "delta");
            if (next === this.assistant) return;
            if (next.startsWith(this.assistant)) {
                const delta = next.slice(this.assistant.length);
                this.assistant = next;
                if (delta) this.emitItem("item.updated", { id: this.assistantItemId, type: "agent_message", delta });
                return;
            }
            this.assistant = next;
            this.emitItem("item.updated", { id: this.assistantItemId, type: "agent_message", text: next });
            return;
        }
        if (kind === "agent_thought_chunk") {
            const piece = textOf(update.content);
            if (!piece || !this.hooks) return;
            this.thought += piece;
            this.emitItem("item.updated", { id: `cursor-thought-${this.hooks.turnId}`, type: "reasoning", delta: piece });
            return;
        }
        if (kind === "tool_call" || kind === "tool_call_update") {
            const label = String(update.title || update.kind || update.toolCallId || "tool");
            const status = String(update.status || "") === "completed" ? "completed" : "in_progress";
            this.emitItem("item.updated", {
                id: `cursor-tool-${this.hooks?.turnId || "turn"}-${update.toolCallId || label}`,
                type: "command_execution",
                command: label,
                status,
            });
            return;
        }
        if (kind === "plan") this.emitPlan(update);
        if (kind === "current_mode_update") {
            const modeId = String(update.modeId || "");
            if (modeId && !this.modes.some((item) => item.id === modeId)) this.modes.push({ id: modeId, name: modeId });
        }
    }

    private onAsk(rpcId: number, params: JsonRecord) {
        const questions = askQuestionsOf(params.questions || params);
        const requestId = String(params.toolCallId || rpcId);
        const title = String(params.title || "").trim();
        this.asks.set(requestId, { rpcId, title, questions });
        logger.info("Cursor ask_question", { requestId, questionCount: questions.length });
        this.hooks?.emit("codex_approval", {
            requestId,
            method: "item/tool/requestUserInput",
            threadId: this.hooks.threadId,
            turnId: this.hooks.turnId,
            reason: title,
            questions: mapAskQuestions(title, questions),
        });
    }

    private onCreatePlan(params: JsonRecord) {
        const markdown = planMarkdown(params);
        if (!markdown.trim() || !this.hooks) return;
        this.emitItem("item.completed", {
            id: `cursor-plan-${this.hooks.turnId}`,
            type: "plan",
            text: markdown,
        });
    }

    private onTodos(params: JsonRecord) {
        const todos = Array.isArray(params.todos) ? params.todos : [];
        const plan = todos.map((item) => {
            const todo = asRecord(item);
            return { step: String(todo.content || todo.step || ""), status: String(todo.status || "pending") };
        }).filter((item) => item.step);
        if (!plan.length || !this.hooks) return;
        this.hooks.emit("agent_event", {
            type: "plan.updated",
            threadId: this.hooks.threadId,
            turnId: this.hooks.turnId,
            turn_id: this.hooks.turnId,
            sourceClientId: this.hooks.clientId,
            plan,
        });
    }

    private emitPlan(update: JsonRecord) {
        const entries = Array.isArray(update.entries) ? update.entries : [];
        const plan = entries.map((item) => {
            const entry = asRecord(item);
            return { step: String(entry.content || entry.step || ""), status: String(entry.status || "pending") };
        }).filter((item) => item.step);
        if (!plan.length || !this.hooks) return;
        this.hooks.emit("agent_event", {
            type: "plan.updated",
            threadId: this.hooks.threadId,
            turnId: this.hooks.turnId,
            turn_id: this.hooks.turnId,
            sourceClientId: this.hooks.clientId,
            explanation: textOf(update.explanation) || undefined,
            plan,
        });
    }

    private emitItem(kind: "item.updated" | "item.completed", item: JsonRecord) {
        if (!this.hooks) return;
        this.hooks.emit("agent_event", {
            type: kind,
            threadId: this.hooks.threadId,
            turn_id: this.hooks.turnId,
            turnId: this.hooks.turnId,
            sourceClientId: this.hooks.clientId,
            item,
        });
    }

    private emitResolved(requestId: string) {
        this.hooks?.emit("codex_approval_resolved", {
            requestId,
            threadId: this.hooks.threadId,
            turnId: this.hooks.turnId,
        });
    }

    private request(method: string, params?: JsonRecord, timeoutMs = 20000) {
        const id = this.nextId++;
        this.write({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
        return new Promise<unknown>((resolve, reject) => {
            const timer = timeoutMs > 0
                ? setTimeout(() => {
                    this.pending.delete(id);
                    reject(new Error(`Cursor ACP ${method} 超时`));
                }, timeoutMs)
                : null;
            this.pending.set(id, {
                resolve: (value) => {
                    if (timer) clearTimeout(timer);
                    resolve(value);
                },
                reject: (error) => {
                    if (timer) clearTimeout(timer);
                    reject(error);
                },
            });
        });
    }

    private notify(method: string, params?: JsonRecord) {
        this.write({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
    }

    private respond(id: number, result: unknown) {
        this.write({ jsonrpc: "2.0", id, result });
    }

    private write(value: unknown) {
        this.child?.stdin?.write(`${JSON.stringify(value)}\n`);
    }

    private failAll(message: string) {
        this.pending.forEach((item) => item.reject(new Error(message)));
        this.pending.clear();
        for (const [requestId, ask] of this.asks) {
            this.respond(ask.rpcId, { outcome: { outcome: "cancelled" } });
            this.emitResolved(requestId);
        }
        this.asks.clear();
        this.busy = false;
        this.child = null;
    }
}
