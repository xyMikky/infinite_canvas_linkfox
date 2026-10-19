import { isSiteTool, SITE_TOOL_LABELS } from "@/lib/agent/agent-site-tools";
import i18n from "@/i18n";
import { summarizeCanvasAgentOps, type CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { randomId } from "@/lib/utils";
import { useAgentStore, type AgentAttachment, type AgentChatItem, type AgentEventLog, type AgentTokenUsage } from "@/stores/use-agent-store";
import type { AgentChatAttachment } from "./agent-chat-message";
export const REASONING_PLACEHOLDER = i18n.t("agent.events.analyzing");

export type AgentEventPayload = {
    agent?: string;
    type?: string;
    threadId?: string;
    thread_id?: string;
    turnId?: string;
    turn_id?: string;
    sourceClientId?: string;
    replayed?: boolean;
    item?: AgentEventItem;
    error?: { message?: string };
    message?: string;
    status?: string;
    explanation?: unknown;
    plan?: unknown;
    usage?: Record<string, unknown>;
    duration_ms?: number;
};
export type AgentEventItem = {
    id?: string;
    type?: string;
    text?: unknown;
    delta?: unknown;
    message?: unknown;
    server?: string;
    tool?: string;
    status?: string;
    arguments?: unknown;
    result?: unknown;
    error?: { message?: string };
    command?: unknown;
    cwd?: unknown;
    aggregatedOutput?: unknown;
    exitCode?: unknown;
    durationMs?: unknown;
    contentItems?: unknown;
    content?: unknown;
    success?: unknown;
    changes?: unknown;
    summary?: unknown;
    query?: unknown;
    action?: unknown;
    path?: unknown;
    savedPath?: unknown;
    revisedPrompt?: unknown;
    explanation?: unknown;
};
export type AgentUserDetail = { kind: string; status: string; rows?: Array<{ label: string; value: string }>; output?: string; files?: Array<{ path: string; action?: string }>; tasks?: Array<{ step: string; status: string }>; explanation?: string };

export type AgentLogContext = { endpoint: string; connected: boolean; enabled: boolean; activity: string; waiting: boolean; sending: boolean; messages: number; pendingTool?: string };

export function agentMessageToChatMessage(item: AgentChatItem) {
    return { ...item, meta: item.role === "user" || item.role === "assistant" ? undefined : item.meta, attachments: item.attachments?.map(agentAttachmentToChatAttachment) };
}

export function agentAttachmentToChatAttachment(item: AgentAttachment): AgentChatAttachment {
    const kind =
        item.kind ||
        (item.dataUrl?.startsWith("data:image") || (item.url || "").startsWith("data:image")
            ? "image"
            : item.localPath || item.promptText
              ? "file"
              : item.dataUrl || item.url
                ? "image"
                : "file");
    return {
        id: item.id,
        name: item.name,
        url: item.dataUrl || item.url,
        kind,
        localPath: item.localPath,
    };
}

export function formatAgentEvent(event: AgentEventPayload): Omit<AgentChatItem, "id"> | null {
    const item = event.item;
    if (event.type === "item.completed" && item?.type === "agent_message") return { role: "assistant", title: "Codex", text: stringText(item.text) };
    return null;
}

export function formatAgentActivity(event: AgentEventPayload): Omit<AgentChatItem, "id"> | null {
    const item = event.item;
    if (!item || (event.type !== "item.started" && event.type !== "item.completed")) return null;
    const completed = event.type === "item.completed";
    const status = String(item.status || (completed ? "completed" : "inProgress"));
    const failed = Boolean(item.error?.message) || item.success === false || ["failed", "error"].includes(status);
    const itemStatus = failed ? "failed" : status;
    if (item.type === "reasoning") {
        const text = composeReasoningText(item.summary, item.content, item.text);
        // 完成且无正文：不建空卡（避免随后被 finishEmpty 删掉造成「思考闪一下又没了」）
        if (!text) return null;
        return { role: "tool", title: tr("reasoning"), text, detail: { kind: "reasoning", status: itemStatus } };
    }
    if (item.type === "plan") {
        const text = stringText(item.text) || stringText(item.explanation);
        if (completed && !text && !item.error?.message) return null;
        // 规划正文已生成时，不当成工具失败；方案用规划书卡片展示
        const itemStatus = text && !item.error?.message ? "completed" : failed ? "failed" : status;
        return { role: "tool", title: tr("plan"), text: item.error?.message || text || activityPlaceholder(item.type), detail: { kind: "plan", status: itemStatus, ...(item.error?.message ? { output: item.error.message } : {}) } };
    }
    if (item.type === "command_execution") {
        const command = stringText(item.command);
        const text = command || (completed ? tr(failed ? "commandFailed" : "commandCompleted") : activityPlaceholder(item.type));
        return { role: "tool", title: tr("executeCommand"), text, detail: commandActivityDetail(item, itemStatus) };
    }
    if (item.type === "file_change") {
        const files = activityFiles(item.changes);
        return { role: "tool", title: tr("editFiles"), text: item.error?.message || fileActivitySummary(files, completed), detail: { kind: "file", status: itemStatus, files, ...(item.error?.message ? { output: item.error.message } : {}) } };
    }
    if (item.type === "web_search") {
        return { role: "tool", title: tr("searchWeb"), text: item.error?.message || webSearchSummary(item), detail: { kind: "search", status: itemStatus, rows: webSearchDetailRows(item), ...(item.error?.message ? { output: item.error.message } : {}) } };
    }
    if (item.type === "image_view") return { role: "tool", title: tr("viewImage"), text: item.error?.message || stringText(item.path) || tr(completed ? "imageViewed" : "viewingImage"), detail: { kind: "image", status: itemStatus, ...(item.error?.message ? { output: item.error.message } : {}) } };
    if (item.type === "image_generation") {
        const revised = stringText(item.revisedPrompt).trim();
        const statusText = item.error?.message || tr(completed ? failed ? "imageFailed" : "imageCompleted" : "generatingImage");
        return {
            role: "tool",
            title: tr("imageGeneration"),
            text: revised ? `${statusText}\n${revised}` : statusText,
            detail: { kind: "image", status: itemStatus, savedPath: item.savedPath, ...(revised ? { revisedPrompt: revised } : {}), ...(item.error?.message ? { output: item.error.message } : {}) },
        };
    }
    if (item.type === "context_compaction") return { role: "tool", title: tr("compactContext"), text: item.error?.message || tr(completed ? "contextCompacted" : "compactingContext"), detail: { kind: "context", status: itemStatus, ...(item.error?.message ? { output: item.error.message } : {}) } };
    if (isMcpToolItem(item)) {
        const name = String(item.tool || "");
        return { role: "tool", title: toolName(name), text: completed ? item.error?.message || toolSummary(item) : tr("toolRunning", { action: toolAction(name) }), detail: toolDetail(item, itemStatus) };
    }
    if (item.type === "dynamic_tool_call") {
        const name = String(item.tool || "");
        const title = toolName(name);
        return {
            role: "tool",
            title,
            text: completed ? item.error?.message || readableText(item.contentItems) : tr("toolRunning", { action: toolAction(name) }),
            detail: toolDetail(item, itemStatus),
        };
    }
    if (item.type === "collab_tool_call") return { role: "tool", title: tr("collaboration"), text: item.error?.message || tr(completed ? failed ? "collaborationFailed" : "collaborationCompleted" : "collaborating"), detail: { kind: "tool", status: itemStatus, ...(item.error?.message ? { output: item.error.message } : {}) } };
    return null;
}

export function formatAgentPlan(event: AgentEventPayload): Omit<AgentChatItem, "id"> | null {
    const tasks = planTasks(event.plan);
    if (!tasks.length) return null;
    const completed = tasks.filter((item) => item.status === "completed").length;
    return {
        role: "tool",
        title: tr("progress"),
        text: tr("progressCount", { completed, total: tasks.length }),
        detail: { kind: "todo", status: completed === tasks.length ? "completed" : "inProgress", tasks, explanation: stringText(event.explanation) },
    };
}

function planTasks(value: unknown) {
    return (Array.isArray(value) ? value : []).flatMap((item) => {
        const step = stringText(objectField(item, "step")).trim();
        return step ? [{ step, status: stringText(objectField(item, "status")) || "pending" }] : [];
    });
}

export function turnPlanStatus(detail: unknown, turnStatus?: string) {
    const tasks = planTasks(objectField(detail, "tasks"));
    if (turnStatus === "failed") return "failed";
    if (turnStatus === "interrupted") return "interrupted";
    if (tasks.length && tasks.every((item) => item.status === "completed")) return "completed";
    return turnStatus === "completed" ? "finished" : "inProgress";
}

export function activityDeltaFallback(item: AgentEventItem, delta: string): AgentChatItem {
    if (item.type === "command_execution") return { id: item.id || randomId(), role: "tool", title: tr("executeCommand"), text: activityPlaceholder(item.type), detail: { kind: "command", status: "inProgress", output: delta } };
    return { id: item.id || randomId(), role: "tool", title: item.type === "plan" ? tr("plan") : tr("reasoning"), text: delta, detail: { kind: activityKind(item.type), status: "inProgress" } };
}

export function activityPlaceholder(type?: string) {
    if (type === "plan") return tr("planning");
    if (type === "command_execution") return tr("executingCommand");
    return tr("analyzing");
}

export function activityKind(type?: string) {
    if (type === "command_execution") return "command";
    if (type === "plan") return "plan";
    return "reasoning";
}

export function activityDetail(value: unknown, kind: string, status: string): AgentUserDetail {
    const current = value && typeof value === "object" ? (value as Partial<AgentUserDetail>) : {};
    return { kind, status, rows: current.rows, output: current.output, files: current.files, tasks: current.tasks, explanation: current.explanation };
}

function commandActivityDetail(item: AgentEventItem, status: string): AgentUserDetail {
    const rows = [detailRow(tr("workingDirectory"), item.cwd), detailRow(tr("exitStatus"), item.exitCode), durationDetailRow(item.durationMs)].flatMap((row) => (row ? [row] : []));
    const commandStatus = typeof item.exitCode === "number" && item.exitCode !== 0 ? "failed" : status;
    return { kind: "command", status: commandStatus, rows, output: item.error?.message || stringText(item.aggregatedOutput) };
}

function activityFiles(value: unknown) {
    return (Array.isArray(value) ? value : []).flatMap((change) => {
        const path = stringText(objectField(change, "path"));
        return path ? [{ path, action: changeAction(objectField(change, "kind")) }] : [];
    });
}

function fileActivitySummary(files: Array<{ path: string; action?: string }>, completed: boolean) {
    if (!files.length) return tr(completed ? "filesCompleted" : "preparingFiles");
    if (files.length === 1) return tr(completed ? "fileCompleted" : "editingFile", { action: files[0].action || tr("edit"), path: files[0].path });
    const names = files.slice(0, 3).map((file) => file.path).join(", ");
    return tr(completed ? "filesEdited" : "editingFiles", { count: files.length, names, more: files.length > 3 ? tr("andMore") : "" });
}

function webSearchSummary(item: AgentEventItem) {
    const action = item.action;
    const type = stringText(objectField(action, "type"));
    if (type === "openPage") return tr("openPage", { url: stringText(objectField(action, "url")) });
    if (type === "findInPage") return tr("findInPage", { pattern: stringText(objectField(action, "pattern")) || tr("content") });
    return tr("search", { query: stringText(item.query) || stringText(objectField(action, "query")) || tr("relatedInfo") });
}

function webSearchDetailRows(item: AgentEventItem) {
    const action = item.action;
    return [detailRow(tr("keyword"), item.query || objectField(action, "query")), detailRow(tr("webpage"), objectField(action, "url"))].flatMap((row) => (row ? [row] : []));
}

function readableText(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return value.map(readableText).filter(Boolean).join("\n");
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    // Codex reasoning 段常见：{ type: "summary_text"|"reasoning_text", text } 或仅 text/content
    const direct = record.text ?? record.content ?? record.summary ?? record.message ?? record.value;
    if (typeof direct === "string") return direct.trim();
    if (Array.isArray(direct)) return readableText(direct);
    if (direct && typeof direct === "object") return readableText(direct);
    return "";
}

/** 合并 Codex reasoning 的 summary（可读摘要）与 content（原始思考，若有）。 */
export function composeReasoningText(...parts: unknown[]) {
    const texts = parts.map((part) => readableText(part)).filter(Boolean);
    return texts.filter((text, index) => texts.indexOf(text) === index).join("\n\n");
}

function detailRow(label: string, value: unknown) {
    return value === undefined || value === null || value === "" ? null : { label, value: String(value) };
}

function durationDetailRow(value: unknown) {
    const duration = Number(value || 0);
    return duration > 0 ? { label: tr("duration"), value: tr("seconds", { value: (duration / 1000).toFixed(1) }) } : null;
}

function changeAction(value: unknown) {
    if (value === "add") return tr("add");
    if (value === "delete") return tr("delete");
    return tr("edit");
}

export function parseEventData<T>(event: Event) {
    try {
        return JSON.parse((event as MessageEvent).data) as T;
    } catch {
        return null;
    }
}

export function isCurrentThreadEvent(event: { threadId?: string; thread_id?: string }) {
    const threadId = event.threadId || event.thread_id || "";
    return Boolean(threadId) && threadId === useAgentStore.getState().activeThreadId;
}

/** turn 中线程切换后，activeThreadId 可能尚未同步，仍应接收已跟踪 turn 的事件。 */
export function isTrackedThreadEvent(
    event: { threadId?: string; thread_id?: string; turnId?: string; turn_id?: string },
    activeThreadId: string,
    liveTurnKeys: ReadonlySet<string>,
) {
    const threadId = event.threadId || event.thread_id || "";
    if (!threadId || threadId === activeThreadId) return true;
    const turnId = event.turnId || event.turn_id || "";
    if (turnId && liveTurnKeys.has(`${threadId}\0${turnId}`)) return true;
    // busy 开始时会写入 `${threadId}\0` 占位，换线程期间据此放行
    if (liveTurnKeys.has(`${threadId}\0`)) return true;
    return [...liveTurnKeys].some((key) => key.startsWith(`${threadId}\0`));
}

export function registerLiveAgentTurn(
    event: { replayed?: boolean; threadId?: string; thread_id?: string; turnId?: string; turn_id?: string },
    authoritativeTurns: ReadonlySet<string>,
    liveTurns: Set<string>,
) {
    const threadId = event.threadId || event.thread_id || "";
    const turnId = event.turnId || event.turn_id || "";
    const key = threadId && turnId ? `${threadId}\0${turnId}` : "";
    if (event.replayed && key && authoritativeTurns.has(key)) return false;
    if (key) liveTurns.add(key);
    return true;
}

export function formatLogText(logs: AgentEventLog[], context: AgentLogContext) {
    const head = [
        tr("diagnostics"),
        tr("address", { endpoint: context.endpoint }),
        tr("connection", { connection: tr(context.connected ? "online" : context.enabled ? "connecting" : "disabled"), status: context.activity }),
        tr("messageTool", { messages: context.messages, tool: context.pendingTool ? toolName(context.pendingTool) : tr("none") }),
    ].join("\n");
    const body = logs.map((item) => `${item.time} ${item.title}${item.text && item.text !== item.title ? ` · ${item.text}` : ""}`).join("\n");
    return [head, body || tr("noLogs")].join("\n\n");
}

export function formatLogJson(logs: AgentEventLog[], context: AgentLogContext) {
    return JSON.stringify({ context, logs: logs.map(({ time, title, text, raw }) => ({ time, title, text, raw })) }, null, 2);
}

export function formatAgentEventLog(event: AgentEventPayload) {
    const item = event.item;
    if (event.type === "thread.started") return { title: tr("threadCreated"), text: shortId(event.thread_id) };
    if (event.type === "turn.started") return { title: tr("turnStarted"), text: shortId(event.turn_id) };
    if (event.type === "plan.updated") {
        const tasks = planTasks(event.plan);
        return { title: tr("progressUpdated"), text: tr("progressCount", { completed: tasks.filter((item) => item.status === "completed").length, total: tasks.length }) };
    }
    if (event.type === "turn.completed" && event.status === "failed") return { title: tr("turnFailed"), text: agentErrorView(event.error?.message).text };
    if (event.type === "turn.completed") return { title: tr(event.status === "interrupted" ? "turnStopped" : "turnCompleted"), text: turnSummary(event) };
    if (event.type === "turn.failed" || event.type === "error") return { title: tr("turnFailed"), text: agentErrorView(event.message || event.error?.message).text };
    if (event.type === "item.started" && isMcpToolItem(item)) return { title: tr("toolCalled"), text: toolName(String(item?.tool || "")) };
    if (event.type === "item.completed" && isMcpToolItem(item)) return { title: tr(item.error ? "toolFailed" : "toolCompleted"), text: `${toolName(String(item?.tool || ""))}${item.error?.message ? ` · ${item.error.message}` : ""}` };
    if (event.type === "item.completed" && item?.type === "agent_message") return { title: tr("replyReceived"), text: compactText(stringText(item.text)) };
    return null;
}

function turnSummary(event: AgentEventPayload) {
    return event.duration_ms ? tr("seconds", { value: (event.duration_ms / 1000).toFixed(1) }) : tr("completed");
}

export function agentErrorView(value: unknown) {
    const text = normalizeText(value);
    if (/selected model is at capacity/i.test(text)) return { title: tr("modelBusy"), text: tr("modelBusyDescription") };
    if (/refresh token was revoked|access token could not be refreshed|logged out or signed in to another account/i.test(text)) {
        return { title: i18n.t("agent.runtime.codexAuthExpired"), text: i18n.t("agent.runtime.codexAuthExpiredDescription") };
    }
    return { title: tr("taskFailed"), text: text || tr("taskFailedDescription") };
}

export function eventUsage(event: AgentEventPayload): AgentTokenUsage {
    return {
        input: numberField(event.usage, "input_tokens"),
        cached: numberField(event.usage, "cached_input_tokens"),
        output: numberField(event.usage, "output_tokens"),
    };
}

function shortId(value?: string) {
    return value ? value.slice(0, 8) : "";
}

export function compactText(value: string, maxLength = 120) {
    const text = value.replace(/\s+/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function isConnectionErrorMessage(item: AgentChatItem) {
    return item.role === "error" && /连接失败|无法连接本地 Agent|本地 Agent 连接失败/.test(item.text);
}

export function toolName(name: string) {
    if (name === "imagegen" || name.endsWith("__imagegen")) return tr("tools.generateImage");
    if (name === "view_image" || name.endsWith("__view_image")) return tr("tools.viewImage");
    if (name === "exec" || name === "exec_command" || name.endsWith("__exec_command")) return tr("tools.executeCommand");
    if (name === "apply_patch" || name.endsWith("__apply_patch")) return tr("tools.editFiles");
    if (name === "web__run" || name.endsWith("__web__run")) return tr("tools.searchWeb");
    if (toolTranslationKeys[name]) return tr(`tools.${toolTranslationKeys[name]}`);
    if (isSiteTool(name)) return SITE_TOOL_LABELS[name];
    return name ? tr("toolNamed", { name }) : tr("toolOperation");
}

const toolTranslationKeys: Record<string, string> = {
    canvas_apply_ops: "canvasOps", canvas_get_state: "readCanvas", canvas_get_selection: "readSelection", canvas_export_snapshot: "exportSnapshot", canvas_create_node: "createNode", canvas_create_attachment_nodes: "addAttachments", canvas_create_text_node: "createText", canvas_create_text_nodes: "createTexts", canvas_create_config_node: "createConfig", canvas_create_image_prompt_flow: "createImageFlow", canvas_create_generation_flow: "createGenerationFlow", canvas_generate_text: "generateText", canvas_generate_image: "generateImage", canvas_generate_video: "generateVideo", canvas_generate_audio: "generateAudio", canvas_update_node: "updateNode", canvas_update_node_text: "updateText", canvas_move_nodes: "moveNodes", canvas_resize_node: "resizeNode", canvas_delete_nodes: "deleteNodes", canvas_connect_nodes: "connectNodes", canvas_select_nodes: "selectNodes", canvas_set_viewport: "setViewport", canvas_run_generation: "runGeneration", site_navigate: "openPage",
};

function siteToolSummary(name: string, result: unknown, input: unknown) {
    const data = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    if (name === "site_navigate") return tr("openedRoute", { route: routeName(stringText(objectField(input, "path")) || "/") });
    if (name === "canvas_list_projects") return tr("canvasCount", { count: numberField(data, "total") });
    if (name === "prompts_search") return tr("promptCount", { count: numberField(data, "total") });
    if (name === "assets_list") return tr("assetCount", { count: numberField(data, "total") });
    if (name === "assets_add") return tr("assetAdded");
    if (name === "generation_get_status") {
        const summary = data.summary && typeof data.summary === "object" ? (data.summary as Record<string, unknown>) : {};
        const running = numberField(summary, "running");
        const succeeded = numberField(summary, "succeeded");
        const failed = numberField(summary, "failed");
        // 标明这是「查询快照」，避免被理解成工具仍在跑
        const phase = succeeded > 0 && running === 0 ? tr("generationStatusDone") : running > 0 ? tr("generationStatusRunning") : failed > 0 ? tr("generationStatusFailed") : tr("generationStatusIdle");
        return `${phase} · ${tr("generationStatus", { total: numberField(data, "total"), queued: numberField(summary, "queued"), running, succeeded, failed })}`;
    }
    if (name === "workbench_image_generate" || name === "workbench_video_generate") return typeof data.note === "string" ? data.note : tr("workbenchExecuted");
    if (name === "workbench_image_get_config" || name === "workbench_video_get_config") return tr("workbenchConfigRead");
    return "";
}

function isMcpToolItem(item?: AgentEventItem): item is AgentEventItem & { type: "mcp_tool_call" } {
    return item?.type === "mcp_tool_call";
}

export function toolDetail(item: AgentEventItem | undefined, status: string): AgentUserDetail {
    const name = String(item?.tool || "");
    return { kind: "tool", status, rows: toolInputRows(name, item?.arguments), ...(item?.error?.message ? { output: item.error.message } : {}) };
}

export function toolCallDetail(name: string, input: unknown, status: string, error = ""): AgentUserDetail {
    return { kind: "tool", status, rows: toolInputRows(name, input), ...(error ? { output: error } : {}) };
}

function toolInputRows(name: string, input: unknown) {
    input = parseToolArguments(input);
    if (name === "site_navigate") return [detailRow(tr("targetPage"), routeName(stringText(objectField(input, "path")) || "/"))].flatMap((row) => (row ? [row] : []));
    if (name === "prompts_search") return [detailRow(tr("searchContent"), objectField(input, "query"))].flatMap((row) => (row ? [row] : []));
    if (name === "canvas_create_text_node") return [detailRow(tr("textContent"), objectField(input, "text"))].flatMap((row) => (row ? [row] : []));
    if (name === "canvas_apply_ops") return [detailRow(tr("operationContent"), summarizeCanvasAgentOps((objectField(input, "ops") as CanvasAgentOp[] | undefined) || []))].flatMap((row) => (row ? [row] : []));
    if (name === "canvas_create_attachment_nodes") return [detailRow(tr("imageCount"), Array.isArray(objectField(input, "attachmentIds")) ? (objectField(input, "attachmentIds") as unknown[]).length : 0)].flatMap((row) => (row ? [row] : []));
    return [];
}

export function toolSummary(item?: AgentEventItem) {
    const result = parseToolResult(item?.result);
    const name = String(item?.tool || "");
    if (name === "site_navigate" || isSiteTool(name)) return siteToolSummary(name, result, parseToolArguments(item?.arguments));
    const nodeField = objectField(result, "nodes");
    const connectionField = objectField(result, "connections");
    const nodes = Array.isArray(nodeField) ? nodeField : [];
    const connections = Array.isArray(connectionField) ? connectionField : [];
    if (name === "canvas_get_state") return Array.isArray(nodeField) || Array.isArray(connectionField) ? canvasContentSummary(nodes, connections.length) : tr("canvasRead");
    if (name === "canvas_get_selection") return tr("selectionRead");
    return "";
}

function canvasContentSummary(nodes: unknown[], connections: number) {
    const counts = nodes.reduce<Record<string, number>>((result, node) => {
        const type = stringText(objectField(node, "type")) || "other";
        result[type] = (result[type] || 0) + 1;
        return result;
    }, {});
    const known = new Set(["text", "image", "config", "video", "audio", "group"]);
    const other = Object.entries(counts).reduce((total, [type, count]) => total + (known.has(type) ? 0 : count), 0);
    const parts = [
        counts.text ? tr("textNodes", { count: counts.text }) : "",
        counts.image ? tr("imageNodes", { count: counts.image }) : "",
        counts.config ? tr("configNodes", { count: counts.config }) : "",
        counts.video ? tr("videoNodes", { count: counts.video }) : "",
        counts.audio ? tr("audioNodes", { count: counts.audio }) : "",
        counts.group ? tr("groupNodes", { count: counts.group }) : "",
        other ? tr("otherNodes", { count: other }) : "",
        connections ? tr("connections", { count: connections }) : "",
    ].filter(Boolean);
    return parts.length ? parts.join(i18n.language === "zh-CN" ? "、" : ", ") : tr("emptyCanvas");
}

export function toolAction(name: string) {
    const label = toolName(name);
    return tr("executeTool", { tool: label });
}

export function routeName(path: string) {
    if (path === "/") return tr("routes.home");
    if (path === "/canvas") return tr("routes.canvas");
    if (path.startsWith("/canvas/")) return tr("routes.canvasProject");
    if (path.startsWith("/image")) return tr("routes.image");
    if (path.startsWith("/video")) return tr("routes.video");
    if (path.startsWith("/prompts")) return tr("routes.prompts");
    if (path.startsWith("/assets")) return tr("routes.assets");
    if (path.startsWith("/config")) return tr("routes.config");
    return path;
}

export function workingActivity(item?: AgentChatItem) {
    const status = String(objectField(item?.detail, "status") || "");
    const output = stringText(objectField(item?.detail, "output"));
    const kind = String(objectField(item?.detail, "kind") || "");
    const key = `${item?.id || "waiting"}-${status}-${item?.text || ""}-${output.length}`;
    // 思考进行中：标题用「正在思考」，正文挂上已收到的 reasoning，避免只见计时不见内容
    if (kind === "reasoning" && ["inProgress", "in_progress", "running", "pending", "started"].includes(status)) {
        const detail = isReasoningSummary(item?.text || "") ? item!.text : undefined;
        return { key, text: tr("thinking"), ...(detail ? { detail } : {}) };
    }
    if (item?.role !== "tool") return { key, text: tr("thinking") };
    if (["inProgress", "in_progress", "running", "pending"].includes(status)) return { key, text: tr("operationRunning", { operation: item.title || tr("toolOperation") }) };
    if (item.title === toolName("canvas_get_state")) return { key, text: tr("organizingCanvas") };
    return { key, text: tr("operationCompleted", { operation: item.title || tr("toolOperation") }) };
}

/** 当前回合最近一条进行中的思考摘要（用于底部「正在思考」挂载正文） */
export function latestLiveReasoning(messages: AgentChatItem[]) {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message.role === "user") return;
        if (message.role !== "tool" || objectField(message.detail, "kind") !== "reasoning") continue;
        const status = String(objectField(message.detail, "status") || "");
        if (!["inProgress", "in_progress", "running", "pending", "started"].includes(status)) continue;
        return message;
    }
}

/**
 * 当前用户消息之后最近一条有正文的思考（含已完成）。
 * 生图回合常先 completed 再等 image_gen；只认 inProgress 会导致底部只剩「正在思考」空壳。
 */
export function latestTurnReasoning(messages: AgentChatItem[]) {
    let completed: AgentChatItem | undefined;
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message.role === "user") break;
        if (message.role !== "tool" || objectField(message.detail, "kind") !== "reasoning") continue;
        if (!isReasoningSummary(message.text)) continue;
        const status = String(objectField(message.detail, "status") || "");
        if (["inProgress", "in_progress", "running", "pending", "started"].includes(status)) return message;
        if (!completed) completed = message;
    }
    return completed;
}

/** 当前回合助手可见说明（生图时 Codex 常不发 reasoning item，只发短回复 + COUNT）。 */
export function latestTurnAssistantNote(messages: AgentChatItem[]) {
    let best = "";
    let countNote = "";
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message.role === "user") break;
        if (message.role !== "assistant") continue;
        const text = sanitizeAssistantNote(message.text || "");
        if (!isReasoningSummary(text)) continue;
        // 含 COUNT 的判断说明优先；同回合末尾「已完成… / SAVED」不覆盖
        if (/COUNT\s*[:：]/i.test(text)) {
            countNote = text;
            break;
        }
        if (!best) best = text;
    }
    return countNote || best || undefined;
}

function sanitizeAssistantNote(value: string) {
    return value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => {
            if (!line || line.toUpperCase() === "NONE") return false;
            if (/^SAVED\s*[:：]/i.test(line)) return false;
            if (/^[A-Za-z]:\\.*\.(png|jpe?g|webp|gif)$/i.test(line)) return false;
            if (/generated_images[\\/]/i.test(line) && /\.(png|jpe?g|webp|gif)$/i.test(line)) return false;
            return true;
        })
        .join("\n")
        .trim();
}

export function currentPlanMessage(messages: AgentChatItem[]) {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (isPlanMessage(message)) return message;
        if (message.role === "user") return;
    }
}

export function isPlanMessage(message: AgentChatItem) {
    return message.role === "tool" && objectField(message.detail, "kind") === "todo";
}

export function isPlanDocumentMessage(message: AgentChatItem) {
    return message.role === "tool" && objectField(message.detail, "kind") === "plan";
}

function parseToolResult(result: unknown) {
    const content = objectField(result, "content");
    const text = Array.isArray(content)
        ? content
              .map((item) => objectField(item, "text"))
              .filter((item): item is string => typeof item === "string")
              .join("\n")
        : "";
    try {
        return text ? JSON.parse(text) : result;
    } catch {
        return text || result;
    }
}

export function normalizeText(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (value instanceof Error) return value.message;
    if (value == null) return "";
    return JSON.stringify(value, null, 2);
}

export function stringText(value: unknown) {
    return typeof value === "string" ? value : "";
}

export function objectField(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function numberField(value: unknown, key: string) {
    const field = objectField(value, key);
    return typeof field === "number" ? field : 0;
}

export function promptWithAttachments(text: string, attachments: AgentAttachment[]) {
    return text || (attachments.length ? tr("attachmentPrompt") : "");
}

export function attachmentPayloadBytes(attachments: AgentAttachment[]) {
    return attachments.reduce((total, item) => {
        if (item.kind && item.kind !== "image") return total;
        return total + (item.dataUrl?.length || 0);
    }, 0);
}

export function formatBytes(bytes: number) {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;
}

export function isCanvasWriteTool(name: string) {
    return name === "canvas_apply_ops" || name === "canvas_create_attachment_nodes";
}

function parseToolArguments(value: unknown) {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return {};
    }
}

export function agentMessageId(threadId: string, turnId: string, itemId: string) {
    return `${threadId}:${turnId}:${itemId}`;
}

export function scopeChatItem(item: AgentChatItem, threadId: string, turnId: string) {
    const scopeTurnId = turnId || "pending";
    const prefix = `${threadId || "local"}:${scopeTurnId}:`;
    const sourceItemId = item.itemId || (item.id.startsWith(prefix) ? item.id.slice(prefix.length) : item.id);
    const itemId = item.role === "user" ? "synthetic:user" : sourceItemId;
    return { ...item, id: agentMessageId(threadId || "local", scopeTurnId, itemId), itemId, threadId, turnId };
}

export function bindPendingTurnMessages(messages: AgentChatItem[], threadId: string, turnId: string) {
    // 允许 threadId 尚未写上的本地占位用户消息（Codex 任务发送时常先为空）
    const index = messages.findLastIndex(
        (item) => item.role === "user" && !item.turnId && (!item.threadId || item.threadId === threadId || item.threadId === "local"),
    );
    if (index < 0) return messages;
    return messages.map((item, itemIndex) => (itemIndex === index ? scopeChatItem(item, threadId, turnId) : item));
}

export function upsertAgentMessage(messages: AgentChatItem[], item: AgentChatItem) {
    const index = messages.findIndex((current) => current.id === item.id);
    if (index < 0) return [...messages, item];
    const current = messages[index];
    const next = { ...current, ...item, attachments: item.attachments || current.attachments, historyText: item.historyText || current.historyText };
    return messages.map((message, itemIndex) => itemIndex === index ? next : message);
}

export function isUserInputMessage(item: AgentChatItem) {
    return Boolean(item.detail && typeof item.detail === "object" && (item.detail as { kind?: unknown }).kind === "userInput");
}

/** 把本地问答卡插回提问时的锚点后面，避免回合继续输出后被重排到整段最底部。 */
export function insertAgentMessage(messages: AgentChatItem[], item: AgentChatItem) {
    const index = messages.findIndex((current) => current.id === item.id);
    if (index >= 0) {
        const current = messages[index];
        const next = { ...current, ...item, attachments: item.attachments || current.attachments, historyText: item.historyText || current.historyText };
        return messages.map((message, itemIndex) => itemIndex === index ? next : message);
    }
    const at = insertIndexForMessage(messages, item);
    return [...messages.slice(0, at), item, ...messages.slice(at)];
}

export function lastMessageAnchorInTurn(messages: AgentChatItem[], threadId = "", turnId = "") {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const current = messages[index];
        if (turnId && current.turnId && current.turnId !== turnId) continue;
        if (threadId && current.threadId && current.threadId !== threadId) continue;
        return current.itemId || current.id;
    }
    return "";
}

function userInputAnchorAfterId(item: AgentChatItem) {
    if (!isUserInputMessage(item) || !item.detail || typeof item.detail !== "object") return "";
    return String((item.detail as { anchorAfterId?: unknown }).anchorAfterId || "");
}

function messageAnchorIndex(messages: AgentChatItem[], anchorAfterId: string) {
    if (!anchorAfterId) return -1;
    return messages.findIndex((current) => current.id === anchorAfterId || current.itemId === anchorAfterId);
}

function insertIndexForMessage(messages: AgentChatItem[], item: AgentChatItem) {
    if (!isUserInputMessage(item)) return messages.length;
    const anchorAfterId = userInputAnchorAfterId(item);
    if (anchorAfterId) {
        const anchorIndex = messageAnchorIndex(messages, anchorAfterId);
        if (anchorIndex >= 0) return anchorIndex + 1;
    }
    let lastSameTurn = -1;
    let lastUser = -1;
    let firstPlanInTurn = -1;
    for (let index = 0; index < messages.length; index += 1) {
        const current = messages[index];
        if (item.turnId) {
            if (current.turnId !== item.turnId) continue;
            if (firstPlanInTurn < 0 && isPlanDocumentMessage(current)) firstPlanInTurn = index;
            lastSameTurn = index;
            continue;
        }
        if (current.role === "user") lastUser = index;
        if (lastUser >= 0 && (!item.threadId || !current.threadId || current.threadId === item.threadId)) {
            if (firstPlanInTurn < 0 && isPlanDocumentMessage(current)) firstPlanInTurn = index;
            lastSameTurn = index;
        }
    }
    // 规划书是回合终点：已确认需求应排在 Plan 之前，而不是被重排到 Plan 下面
    if (firstPlanInTurn >= 0) return firstPlanInTurn;
    if (lastSameTurn >= 0) return lastSameTurn + 1;
    return messages.length;
}

/** 写入待绑定的用户消息：按 clientMessageId / 同线程 pending user 去重，避免对话里出现两遍提示词 */
export function appendPendingUserMessage(messages: AgentChatItem[], item: AgentChatItem) {
    return upsertUserChatMessage(messages, { ...item, turnId: item.turnId || "" });
}

/** 用户气泡按 clientMessageId 合并（跨线程/pending→turn），避免本地占位与 SSE 各留一条 */
export function upsertUserChatMessage(messages: AgentChatItem[], item: AgentChatItem) {
    const threadId = item.threadId || "local";
    const clientMessageId = item.clientMessageId || item.id || "";
    const previous = clientMessageId
        ? [...messages].reverse().find((message) => message.role === "user" && message.clientMessageId === clientMessageId)
        : undefined;
    const next = scopeChatItem(
        {
            ...item,
            id: item.id || clientMessageId || randomId(),
            itemId: "synthetic:user",
            clientMessageId: clientMessageId || previous?.clientMessageId,
            text: previous?.text || item.text,
            historyText: previous?.historyText || item.historyText,
            attachments: item.attachments?.length ? item.attachments : previous?.attachments,
        },
        threadId,
        item.turnId || previous?.turnId || "",
    );
    const filtered = messages.filter((message) => {
        if (message.role !== "user") return true;
        if (sameUserBubble(message, next)) return false;
        const sameThread = !message.threadId || message.threadId === threadId || message.threadId === "local";
        if (sameThread && !message.turnId && samePendingAttachments(message.attachments, next.attachments)) return false;
        return true;
    });
    return upsertAgentMessage(filtered, next);
}

function sameUserBubble(left: AgentChatItem, right: AgentChatItem) {
    if (left.role !== "user" || right.role !== "user") return false;
    if (left.id && left.id === right.id) return true;
    if (left.clientMessageId && right.clientMessageId && left.clientMessageId === right.clientMessageId) return true;
    const sameThread = !left.threadId || !right.threadId || left.threadId === right.threadId || left.threadId === "local" || right.threadId === "local";
    if (!sameThread) return false;
    if (left.turnId && right.turnId && left.turnId === right.turnId && left.itemId === "synthetic:user" && right.itemId === "synthetic:user") return true;
    const pending = !left.turnId || left.turnId === "pending" || !right.turnId || right.turnId === "pending";
    return pending && Boolean(left.text) && left.text === right.text && left.itemId === "synthetic:user" && right.itemId === "synthetic:user";
}

function samePendingAttachments(left?: AgentChatItem["attachments"], right?: AgentChatItem["attachments"]) {
    const a = left || [];
    const b = right || [];
    if (!a.length && !b.length) return false;
    if (a.length !== b.length) return false;
    const keys = (items: NonNullable<AgentChatItem["attachments"]>) => items.map((item) => item.id || item.dataUrl || item.name).join("\0");
    return keys(a) === keys(b);
}

function snapshotCoversTurn(messages: AgentChatItem[], turnId: string) {
    return messages.some((item) => item.turnId === turnId && (item.role === "assistant" || item.role === "tool" || isUserInputMessage(item)));
}

export function mergeAgentMessages(snapshot: AgentChatItem[], current: AgentChatItem[], threadId: string, liveTurnKeys: ReadonlySet<string>) {
    let messages = [...snapshot];
    current.filter((item) => item.threadId === threadId).forEach((item) => {
        const live = Boolean(item.turnId && liveTurnKeys.has(`${threadId}\0${item.turnId}`));
        const index = messages.findIndex((message) => message.id === item.id || (item.role === "user" && sameUserBubble(message, item)));
        if (index < 0) {
            const keepLocal = !item.turnId || live || isUserInputMessage(item) || (item.turnId && !snapshotCoversTurn(messages, item.turnId));
            if (keepLocal) messages = insertAgentMessage(messages, item);
            return;
        }
        const history = messages[index];
        const next = live
            ? { ...history, ...item, attachments: item.attachments || history.attachments, historyText: item.historyText || history.historyText }
            : { ...history, attachments: item.attachments || history.attachments, historyText: item.historyText || history.historyText };
        messages = messages.map((message, itemIndex) => itemIndex === index ? next : message);
    });
    return messages;
}

export function normalizeHistoryMessages(messages: AgentChatItem[]) {
    return messages
        .filter((item) => (normalizeText(item.text) || item.role === "tool") && item.itemId && item.threadId && item.turnId)
        .map(({ streamId: _streamId, ...item }) => scopeChatItem({ ...item, text: normalizeText(item.text) } as AgentChatItem, item.threadId!, item.turnId!));
}

export function mergeHistoryAttachments(messages: AgentChatItem[], currentMessages: AgentChatItem[]) {
    const currentUsers = currentMessages.filter((item) => item.role === "user" && item.attachments?.length).reverse();
    return [...messages]
        .reverse()
        .map((item) => {
            if (item.role !== "user") return item;
            let index = item.clientMessageId
                ? currentUsers.findIndex((current) => current.clientMessageId === item.clientMessageId && current.threadId === item.threadId)
                : -1;
            if (index < 0 && item.turnId) index = currentUsers.findIndex((current) => current.turnId === item.turnId && current.threadId === item.threadId);
            if (index < 0) {
                const candidates = currentUsers
                    .map((current, candidateIndex) => ({ current, candidateIndex }))
                    .filter(({ current }) => current.threadId === item.threadId && (current.text === item.text || current.historyText === item.text));
                if (new Set(candidates.map(({ current }) => current.clientMessageId || current.id)).size === 1) index = candidates[0]?.candidateIndex ?? -1;
            }
            if (index < 0) return item;
            const current = currentUsers.splice(index, 1)[0];
            return { ...item, text: current.text, historyText: current.historyText, attachments: current.attachments };
        })
        .reverse();
}

export function reasoningActivityText(items: Record<string, string>, fallback = "") {
    const summaries = Object.values(items).map((item) => item.trim()).filter(isReasoningSummary);
    // Codex 每段思考只回传一行加粗标题，用空行分隔才会逐条换行，而不是挤成一段
    return summaries.join("\n\n").replace(/\n(?!\n)/g, "\n\n") || fallback || REASONING_PLACEHOLDER;
}

export function isReasoningSummary(value = "") {
    const text = value.trim();
    return Boolean(text && text !== REASONING_PLACEHOLDER && text !== "已完成分析");
}

export function mergeStreamText(prefix: string, incoming: string) {
    if (!incoming) return prefix;
    if (!prefix) return incoming;
    if (incoming === prefix || incoming.startsWith(prefix)) return incoming;
    if (prefix.startsWith(incoming)) return prefix;
    if (incoming.length >= 48 && incoming.length < prefix.length && prefix.includes(incoming)) return prefix;
    if (prefix.length >= 48 && prefix.length < incoming.length && incoming.includes(prefix)) return incoming;
    const max = Math.min(prefix.length, incoming.length, 80);
    for (let size = max; size >= 8; size -= 1) {
        if (prefix.endsWith(incoming.slice(0, size))) return prefix + incoming.slice(size);
    }
    const prefixLines = (prefix.match(/\n/g) || []).length;
    const incomingLines = (incoming.match(/\n/g) || []).length;
    if (incomingLines !== prefixLines) return incomingLines > prefixLines ? incoming : prefix;
    if (incoming.length <= 24) {
        if (/\s$/.test(prefix) || /^\s/.test(incoming)) return prefix + incoming;
        if (/[A-Za-z0-9]$/.test(prefix) && /[A-Za-z0-9]/.test(incoming[0] || "")) return `${prefix} ${incoming}`;
        return prefix + incoming;
    }
    return incoming.length >= prefix.length ? incoming : prefix;
}

function tr(key: string, options?: Record<string, unknown>) {
    const path = `agent.events.${key}`;
    const extraPath = `agent.eventExtra.${key}`;
    return i18n.t(i18n.exists(path) ? path : i18n.exists(extraPath) ? extraPath : `agent.eventMore.${key}`, options);
}
