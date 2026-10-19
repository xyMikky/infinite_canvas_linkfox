import crypto from "node:crypto";
import type { ServerResponse } from "node:http";

import type { AgentAttachment } from "../agent/types.js";
import { logger } from "../utils/logger.js";
import { requestIdText } from "../utils/value.js";
import { buildCanvasToolRequest, fitAttachmentNodeSize } from "./operations.js";
import type { ToolName } from "./schemas.js";
import { compactCanvasState, compactConnection, compactNode, expandSelectionNodeIds, isToolName, mindMapsForSelection, parseToolInput } from "./tools.js";
import type { CanvasSnapshot } from "./types.js";

type PendingRequest = { clientId: string; resolve: (value: unknown) => void; reject: (error: Error) => void };
type TurnAttachment = { clientId: string; id: string; name: string; type: string; size: number; width: number; height: number; dataUrl: string };
type ReplayEvent = { type: string; payload: Record<string, unknown> };
export type CodexState = { busy: boolean; threadId: string; turnId: string };
export type McpStartupState = "starting" | "ready" | "failed" | "cancelled";
export type ConversationState = {
    revision: number;
    conversationId: string;
    threadId: string;
    status: "idle" | "preparing" | "ready" | "warning" | "running" | "failed";
    mcpStatuses: Record<string, { status: McpStartupState; error?: string | null; failureReason?: string | null }>;
    sourceClientId?: string;
    error?: string;
};
type McpInventoryItem = { name: string; authStatus?: string };
type OwnerConversation = { state: ConversationState; inventoryComplete: boolean; preparedThreadId: string };
type RunningTurn = { turnId: string; ownerId: string; clientId: string };
export const AGENT_PROTOCOL_VERSION = 9;
/** 桌面端固定身份；未记录归属的历史线程都视为主人的 */
export const HOST_OWNER_ID = "host";

const SITE_TOOLS = new Set<ToolName>([
    "site_navigate",
    "canvas_list_projects",
    "workbench_image_get_config",
    "workbench_image_generate",
    "workbench_video_get_config",
    "workbench_video_generate",
    "prompts_search",
    "assets_list",
    "assets_add",
    "generation_get_status",
]);

/** 管理网页画布连接、状态、附件和工具请求。 */
export class CanvasSession {
    private clients = new Map<string, ServerResponse>();
    private clientOwners = new Map<string, string>();
    private clientFocusOrder = new Map<string, number>();
    private pending = new Map<string, PendingRequest>();
    private pendingApprovals = new Map<string, Record<string, unknown>>();
    private canvasStates = new Map<string, CanvasSnapshot>();
    private turnAttachments = new Map<string, TurnAttachment>();
    private codexReplayEvents = new Map<string, ReplayEvent>();
    private codexReplayActiveItems = new Set<string>();
    private mutationOwners = new Set<string>();
    private activeClientId = "";
    /** 每条运行中线程绑定的发起网页：threadId -> clientId */
    private turnClients = new Map<string, string>();
    private focusSequence = 0;
    /** 运行中的 Codex turn：threadId -> turn 信息 */
    private runningTurns = new Map<string, RunningTurn>();
    /** 线程归属：threadId -> ownerId；缺省视为主人 */
    private threadOwners = new Map<string, string>();
    /** 每个所有者（浏览器）各自的对话状态 */
    private conversations = new Map<string, OwnerConversation>();

    constructor(hostActiveThreadId = "", threadOwners: Record<string, string> = {}) {
        this.ownerConversation(HOST_OWNER_ID, hostActiveThreadId);
        Object.entries(threadOwners).forEach(([threadId, ownerId]) => this.threadOwners.set(threadId, ownerId));
    }

    /** 解析当前应接收画布工具调用的网页：优先正在运行的 turn 绑定，避免局域网多人时落到主机。 */
    private resolveToolClientId(preferredThreadId = "", ownerId = "") {
        if (preferredThreadId) {
            if (ownerId && this.threadOwner(preferredThreadId) !== ownerId) throw new Error("无权访问该会话");
            const bound = this.turnClients.get(preferredThreadId) || this.runningTurns.get(preferredThreadId)?.clientId || "";
            if (bound && this.hasClient(bound, this.threadOwner(preferredThreadId))) return bound;
            throw new Error("发起任务的网页已断开，请重新连接后再试");
        }
        const running = [...this.runningTurns.entries()].filter(([, turn]) => !ownerId || turn.ownerId === ownerId);
        const runningClientIds = running
            .map(([threadId, running]) => this.turnClients.get(threadId) || running.clientId)
            .filter((clientId): clientId is string => Boolean(clientId && this.hasClient(clientId, ownerId)));
        const unique = [...new Set(runningClientIds)];
        if (unique.length === 1 && runningClientIds.length === running.length) return unique[0];
        if (running.length) return "";
        const bound = [...new Set(this.turnClients.values())].filter((clientId) => this.hasClient(clientId, ownerId));
        if (bound.length === 1) return bound[0];
        if (bound.length > 1) return "";
        return this.hasClient(this.activeClientId, ownerId) ? this.activeClientId : "";
    }

    /** 获取当前 turn 绑定或最近激活的网页客户端。 */
    private get targetClientId() {
        return this.resolveToolClientId();
    }

    /** 返回 Canvas Agent 当前连接状态。 */
    health() {
        const hasCanvas = [...this.canvasStates].some(([clientId, state]) => this.clients.has(clientId) && (state as Record<string, unknown>).hasCanvas !== false);
        return { ok: true, protocolVersion: AGENT_PROTOCOL_VERSION, hasCanvas, clients: this.clients.size, codexBusy: this.codexBusy, runningThreads: this.runningTurns.size };
    }

    /** 返回是否有任意 Codex turn 正在执行。 */
    get codexBusy() {
        return this.runningTurns.size > 0;
    }

    /** 返回指定线程是否有运行中的 turn。 */
    threadBusy(threadId: string) {
        return Boolean(threadId && this.runningTurns.has(threadId));
    }

    /** 返回指定线程的 Codex 运行状态快照。 */
    codexStateFor(threadId: string): CodexState {
        const running = threadId ? this.runningTurns.get(threadId) : undefined;
        return { busy: Boolean(running), threadId, turnId: running?.turnId || "" };
    }

    /** 返回线程归属；未记录视为主人。 */
    threadOwner(threadId: string) {
        return this.threadOwners.get(threadId) || HOST_OWNER_ID;
    }

    /** 已写入的归属；未登记时返回 undefined（与 threadOwner 的 host 缺省不同）。 */
    recordedThreadOwner(threadId: string) {
        return this.threadOwners.get(threadId);
    }

    /** 记录线程归属（仅进程内路由；持久化由调用方负责）。 */
    setThreadOwner(threadId: string, ownerId: string) {
        if (threadId && ownerId) this.threadOwners.set(threadId, ownerId);
    }

    /** 取得（或懒创建）所有者的对话记录。 */
    private ownerConversation(ownerId: string, seedThreadId = ""): OwnerConversation {
        let record = this.conversations.get(ownerId);
        if (!record) {
            record = {
                state: {
                    revision: 1,
                    conversationId: seedThreadId || crypto.randomUUID(),
                    threadId: seedThreadId,
                    status: seedThreadId ? "ready" : "idle",
                    mcpStatuses: {},
                },
                inventoryComplete: false,
                preparedThreadId: "",
            };
            this.conversations.set(ownerId, record);
        }
        return record;
    }

    /** 返回指定所有者对话的权威快照。 */
    conversationSnapshot(ownerId: string, seedThreadId = ""): ConversationState {
        const { state } = this.ownerConversation(ownerId, seedThreadId);
        return { ...state, mcpStatuses: { ...state.mcpStatuses } };
    }

    /** 原子开始一次新建或恢复对话流程。 */
    beginConversation(ownerId: string, options: { threadId?: string; conversationId?: string; sourceClientId?: string } = {}) {
        const record = this.ownerConversation(ownerId);
        record.inventoryComplete = false;
        record.preparedThreadId = "";
        return this.updateConversation(ownerId, {
            conversationId: options.conversationId || options.threadId || crypto.randomUUID(),
            threadId: options.threadId || "",
            status: "preparing",
            mcpStatuses: {},
            sourceClientId: options.sourceClientId,
            error: undefined,
        });
    }

    /** 记录预热阶段单个 MCP 服务的启动状态；MCP 服务全局共享，作用于所有正在预热的对话。 */
    updateConversationMcp(name: string, status: McpStartupState, error?: string | null, failureReason?: string | null) {
        if (!name) return;
        this.conversations.forEach((record, ownerId) => {
            if (record.state.status !== "preparing") return;
            this.updateConversation(ownerId, { mcpStatuses: { ...record.state.mcpStatuses, [name]: { status, error, failureReason } } });
            if (record.inventoryComplete && record.preparedThreadId) this.completeConversationPreparation(ownerId, record.preparedThreadId);
        });
    }

    /** 用 app-server 的完整 MCP 清单补齐未发送逐项通知的服务；作用于所有正在预热的对话。 */
    completeConversationMcpInventory(services: McpInventoryItem[]) {
        this.conversations.forEach((record, ownerId) => {
            if (record.state.status !== "preparing") return;
            const mcpStatuses = { ...record.state.mcpStatuses };
            services.filter((item) => item.name).forEach((item) => {
                const current = mcpStatuses[item.name];
                if (current?.status === "failed" || current?.status === "cancelled") return;
                mcpStatuses[item.name] = item.authStatus === "notLoggedIn"
                    ? { status: "failed", error: "MCP 服务未登录", failureReason: "reauthenticationRequired" }
                    : { status: "ready" };
            });
            record.inventoryComplete = true;
            this.updateConversation(ownerId, { mcpStatuses });
        });
    }

    /** MCP 清单读取结束后提交线程和最终可发送状态。 */
    completeConversationPreparation(ownerId: string, threadId: string, requireCanvas = true) {
        const record = this.ownerConversation(ownerId);
        record.preparedThreadId = threadId;
        if (!requireCanvas) {
            record.inventoryComplete = true;
            return this.updateConversation(ownerId, { threadId, status: "ready", mcpStatuses: {}, error: undefined });
        }
        const statuses = record.state.mcpStatuses;
        const hasPending = !record.inventoryComplete || Object.values(statuses).some((item) => item.status === "starting");
        const requiredFailure = statuses["infinite-canvas"]?.status !== "ready";
        const hasFailure = Object.values(statuses).some((item) => item.status === "failed" || item.status === "cancelled");
        const requiredFailureDetail = statuses["infinite-canvas"]?.error;
        return this.updateConversation(ownerId, {
            threadId,
            status: hasPending ? "preparing" : requiredFailure ? "failed" : hasFailure ? "warning" : "ready",
            error: requiredFailure ? `Infinite Canvas MCP 初始化失败${requiredFailureDetail ? `：${requiredFailureDetail}` : ""}` : undefined,
        });
    }

    /** 将创建线程或读取 MCP 清单的失败保存为不可发送状态。 */
    failConversationPreparation(ownerId: string, error: string) {
        const record = this.ownerConversation(ownerId);
        record.inventoryComplete = false;
        record.preparedThreadId = "";
        return this.updateConversation(ownerId, { status: "failed", error });
    }

    /** 切换到无需重新预热的既有状态，例如删除当前对话后的空状态。 */
    activateConversation(ownerId: string, threadId: string, sourceClientId?: string) {
        const record = this.ownerConversation(ownerId);
        record.inventoryComplete = false;
        record.preparedThreadId = "";
        return this.updateConversation(ownerId, {
            conversationId: threadId || crypto.randomUUID(),
            threadId,
            status: threadId ? "ready" : "idle",
            mcpStatuses: {},
            sourceClientId,
            error: undefined,
        });
    }

    markConversationRunning(ownerId: string, threadId: string) {
        const record = this.ownerConversation(ownerId);
        if (!threadId || threadId !== record.state.threadId || !["ready", "warning"].includes(record.state.status)) return this.conversationSnapshot(ownerId);
        return this.updateConversation(ownerId, { status: "running" });
    }

    /** turn 进行中 Codex 自动换新线程时，仅更新 threadId，不重置 MCP 与 ready 状态。 */
    retargetConversationThread(ownerId: string, threadId: string, sourceClientId?: string) {
        const record = this.ownerConversation(ownerId);
        if (!threadId || record.state.threadId === threadId) return this.conversationSnapshot(ownerId);
        return this.updateConversation(ownerId, { threadId, sourceClientId });
    }

    finishConversationRun(ownerId: string, threadId: string) {
        const record = this.ownerConversation(ownerId);
        // 换线程后 onFinish 可能仍带旧 threadId；只要当前仍是 running，就按归属结束，避免卡死
        if (record.state.status !== "running") return this.conversationSnapshot(ownerId);
        if (threadId && record.state.threadId && threadId !== record.state.threadId) {
            logger.warn("finishConversationRun thread mismatch; finishing active conversation anyway", { ownerId, finishedThreadId: threadId, activeThreadId: record.state.threadId });
        }
        const hasFailure = Object.values(record.state.mcpStatuses).some((item) => item.status === "failed" || item.status === "cancelled");
        return this.updateConversation(ownerId, { status: hasFailure ? "warning" : "ready" });
    }

    /** 判断网页客户端是否仍连接到当前 Agent。 */
    hasClient(clientId: string, ownerId = "") {
        return this.clients.has(clientId) && (!ownerId || this.clientOwners.get(clientId) === ownerId);
    }

    /** 读取指定网页上报的画布，避免提炼时受最近焦点或其他标签页影响。 */
    canvasStateForClient(clientId: string) {
        return this.clients.has(clientId) ? this.canvasStates.get(clientId) || null : null;
    }

    /** 原子取得指定所有者的 Codex 写操作权限；同所有者的运行中 turn 或未完成写操作会阻塞。 */
    beginCodexMutation(ownerId: string, activeThreadId = "") {
        if (this.mutationOwners.has(ownerId) || this.threadBusy(activeThreadId)) return false;
        this.mutationOwners.add(ownerId);
        return true;
    }

    /** 释放指定所有者的 Codex 写操作权限。 */
    endCodexMutation(ownerId: string) {
        this.mutationOwners.delete(ownerId);
    }

    /** 返回刷新后仍需展示的 Codex 权限请求。 */
    get codexPendingApprovals() {
        return [...this.pendingApprovals.values()];
    }

    /** 跟踪需要跨页面重连恢复的 Codex 权限请求。 */
    trackCodexEvent(type: string, payload: Record<string, unknown>) {
        const requestId = requestIdText(payload.requestId);
        if (type === "codex_approval" && requestId) this.pendingApprovals.set(requestId, payload);
        if (type === "codex_approval_resolved" && requestId) this.pendingApprovals.delete(requestId);
        if (type === "agent_error") {
            const threadId = String(payload.threadId || payload.thread_id || "");
            if (!threadId) return this.pendingApprovals.clear();
            this.pendingApprovals.forEach((approval, key) => {
                if (String(approval.threadId || approval.thread_id || "") === threadId) this.pendingApprovals.delete(key);
            });
        }
    }

    /** 同步占用线程；重复发送不得覆盖原任务的运行状态。 */
    tryBeginThreadTurn(threadId: string, ownerId: string, clientId: string) {
        if (!threadId || this.threadBusy(threadId)) return false;
        this.beginThreadTurn(threadId, ownerId, clientId);
        return true;
    }

    /** 标记线程开始运行 turn，清除其历史重放并向所属浏览器广播运行状态。 */
    beginThreadTurn(threadId: string, ownerId: string, clientId = "", options: { preserveReplay?: boolean } = {}) {
        if (!threadId) return;
        if (!options.preserveReplay) this.clearThreadReplay(threadId);
        this.runningTurns.set(threadId, { turnId: "", ownerId, clientId });
        this.emitCodexState(threadId);
    }

    /** 记录线程当前运行的 turnId 并广播。 */
    updateThreadTurn(threadId: string, turnId: string) {
        const running = this.runningTurns.get(threadId);
        if (!running || running.turnId === turnId) return;
        const turnChanged = Boolean(running.turnId && turnId);
        running.turnId = turnId;
        if (turnChanged) this.clearThreadReplay(threadId);
        this.emitCodexState(threadId);
    }

    /** 恢复线程失败自动换新线程时，把运行标记迁移到新线程。 */
    retargetThreadTurn(fromThreadId: string, toThreadId: string) {
        const running = this.runningTurns.get(fromThreadId);
        if (!running || fromThreadId === toThreadId) return;
        this.runningTurns.delete(fromThreadId);
        this.runningTurns.set(toThreadId, running);
        this.turnClients.delete(fromThreadId);
        if (running.clientId) this.turnClients.set(toThreadId, running.clientId);
        this.emitCodexState(toThreadId);
    }

    /** 结束线程运行状态并向所属浏览器广播。 */
    endThreadTurn(threadId: string) {
        const running = this.runningTurns.get(threadId);
        if (!running) return;
        this.runningTurns.delete(threadId);
        this.turnClients.delete(threadId);
        this.emitOwner(running.ownerId || this.threadOwner(threadId), "codex_state", { busy: false, threadId, turnId: running.turnId });
    }

    private emitCodexState(threadId: string) {
        const state = this.codexStateFor(threadId);
        const running = this.runningTurns.get(threadId);
        logger.debug("Codex state changed", state);
        this.emitOwner(running?.ownerId || this.threadOwner(threadId), "codex_state", state);
    }

    /** 清除指定线程的断线重放缓存。 */
    clearThreadReplay(threadId: string) {
        if (!threadId) return;
        this.codexReplayEvents.forEach((event, key) => {
            if (String(event.payload.threadId || event.payload.thread_id || "") !== threadId) return;
            this.codexReplayEvents.delete(key);
            this.codexReplayActiveItems.delete(key);
        });
    }

    /** 权威历史已覆盖指定 turn 后，清理其断线重放事件。 */
    acknowledgeCodexHistory(threadId: string, turnIds: string[]) {
        const acknowledged = new Set(turnIds.filter(Boolean));
        if (!threadId || !acknowledged.size) return;
        this.codexReplayEvents.forEach((event, key) => {
            const eventThreadId = String(event.payload.threadId || event.payload.thread_id || "");
            const eventTurnId = String(event.payload.turnId || event.payload.turn_id || "");
            if (eventThreadId === threadId && acknowledged.has(eventTurnId)) {
                this.codexReplayEvents.delete(key);
                this.codexReplayActiveItems.delete(key);
            }
        });
    }

    /** 建立网页与 Canvas Agent 之间的 SSE 连接。 */
    openEvents(url: URL, res: ServerResponse, ownerId = HOST_OWNER_ID, activeThreadId = "") {
        const clientId = url.searchParams.get("clientId") || crypto.randomUUID();
        const statusOnly = url.searchParams.get("role") === "status";
        logger.info("SSE client connected", { clientId, ownerId, statusOnly });
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        });
        // 尽快刷出响应头，避免经代理时 SSE 被缓冲
        if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") (res as { flushHeaders: () => void }).flushHeaders();
        if (!statusOnly) {
            this.clients.set(clientId, res);
            this.clientOwners.set(clientId, ownerId);
            if (!this.clientFocusOrder.has(clientId)) this.clientFocusOrder.set(clientId, 0);
            if (!this.activeClientId) {
                this.activeClientId = clientId;
                this.clientFocusOrder.set(clientId, ++this.focusSequence);
            }
        }
        const pendingApprovals = this.codexPendingApprovals.filter((item) => {
            const threadId = String(item.threadId || item.thread_id || "");
            return !threadId || threadId === activeThreadId;
        });
        sendEvent(res, "hello", { ok: true, protocolVersion: AGENT_PROTOCOL_VERSION, clientId, workspace: { activeThreadId }, conversation: this.conversationSnapshot(ownerId, activeThreadId), codex: this.codexStateFor(activeThreadId), pendingApprovals });
        if (!statusOnly && activeThreadId) {
            this.codexReplayEvents.forEach((event) => {
                if (String(event.payload.threadId || event.payload.thread_id || "") === activeThreadId) sendEvent(res, event.type, event.payload);
            });
        }
        const timer = setInterval(() => sendEvent(res, "ping", { time: Date.now() }), 15000);
        res.on("close", () => {
            clearInterval(timer);
            logger.info("SSE client disconnected", { clientId, statusOnly });
            if (statusOnly || this.clients.get(clientId) !== res) return;
            this.clients.delete(clientId);
            this.clientOwners.delete(clientId);
            this.clientFocusOrder.delete(clientId);
            this.canvasStates.delete(clientId);
            this.pending.forEach((item, requestId) => {
                if (item.clientId !== clientId) return;
                this.pending.delete(requestId);
                item.reject(new Error("请求页面已断开"));
            });
            if (this.activeClientId === clientId) this.activeClientId = [...this.clients.keys()].sort((a, b) => (this.clientFocusOrder.get(b) || 0) - (this.clientFocusOrder.get(a) || 0))[0] || "";
        });
    }

    private updateConversation(ownerId: string, patch: Partial<Omit<ConversationState, "revision">>) {
        const record = this.ownerConversation(ownerId);
        record.state = { ...record.state, ...patch, revision: record.state.revision + 1 };
        const snapshot = this.conversationSnapshot(ownerId);
        this.emitOwner(ownerId, "conversation_changed", snapshot);
        return snapshot;
    }

    /** 保存指定网页上报的最新画布快照。 */
    updateState(body: unknown, clientId?: string) {
        const targetClientId = clientId || this.activeClientId;
        if (!targetClientId || !this.clients.has(targetClientId)) return;
        const state = { ...((body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>), clientId: targetClientId } as CanvasSnapshot;
        this.canvasStates.set(targetClientId, state);
        logger.debug("Canvas state updated", { clientId: targetClientId, nodes: state.nodes?.length || 0, connections: state.connections?.length || 0 });
    }

    /** 将指定网页设为最近激活的工具目标。 */
    activateClient(clientId: string) {
        if (!this.clients.has(clientId)) throw new Error("当前网页未连接");
        this.activeClientId = clientId;
        this.clientFocusOrder.set(clientId, ++this.focusSequence);
        logger.debug("Canvas client activated", { clientId });
    }

    /** 将指定线程的 Agent turn 固定绑定到发起网页。 */
    bindClient(threadId: string, clientId: string) {
        if (!this.clients.has(clientId)) throw new Error("当前网页未连接");
        this.turnClients.set(threadId, clientId);
        const running = this.runningTurns.get(threadId);
        if (running) running.clientId = clientId;
        logger.debug("Canvas client bound to turn", { threadId, clientId });
    }

    /** 解除指定线程 turn 的网页绑定。 */
    releaseClient(threadId: string) {
        this.turnClients.delete(threadId);
        logger.debug("Canvas client released from turn", { threadId });
    }

    /** 保存当前 turn 可用的图片附件并返回安全引用。 */
    setTurnAttachments(clientId: string, attachments: AgentAttachment[]) {
        this.clearTurnAttachments(clientId);
        return attachments.flatMap((item, index) => {
            if (!item.dataUrl?.startsWith("data:image/")) return [];
            const id = item.id?.trim() || `attachment-${crypto.randomUUID()}`;
            const attachment: TurnAttachment = {
                clientId,
                id,
                name: item.name?.trim() || `图片 ${index + 1}`,
                type: item.type?.startsWith("image/") ? item.type : item.dataUrl.match(/^data:([^;]+)/)?.[1] || "image/png",
                size: positiveNumber(item.size, 0),
                width: positiveNumber(item.width, 1024),
                height: positiveNumber(item.height, 1024),
                dataUrl: item.dataUrl,
            };
            this.turnAttachments.set(id, attachment);
            const canvasNodeId = String(item.canvasNodeId || "").trim() || (id.startsWith("canvas-") ? id.slice("canvas-".length) : "");
            return [{
                id,
                name: attachment.name,
                type: attachment.type,
                size: attachment.size,
                width: attachment.width,
                height: attachment.height,
                ...(canvasNodeId ? { canvasNodeId } : {}),
            }];
        });
    }

    /** 清理指定网页或全部 turn 附件。 */
    clearTurnAttachments(clientId?: string) {
        this.turnAttachments.forEach((item, id) => {
            if (!clientId || item.clientId === clientId) this.turnAttachments.delete(id);
        });
    }

    /** 获取属于指定网页 turn 的图片附件。 */
    getTurnAttachment(clientId: string, attachmentId: string) {
        const attachment = this.turnAttachments.get(attachmentId);
        if (!attachment) throw new Error(`找不到本轮图片附件：${attachmentId}`);
        if (attachment.clientId !== clientId) throw new Error("图片附件不属于当前 turn 的发起标签页");
        return attachment;
    }

    /** 接收网页返回的工具调用结果。 */
    resolveResult(clientId: string, body: { requestId?: string; error?: string; result?: unknown }) {
        const item = body.requestId ? this.pending.get(body.requestId) : null;
        if (!item || !body.requestId || item.clientId !== clientId) return false;
        this.pending.delete(body.requestId);
        logger.debug("Canvas tool result received", { clientId, requestId: body.requestId, error: body.error, result: body.result });
        body.error ? item.reject(new Error(body.error)) : item.resolve(body.result);
        return true;
    }

    /** 向全部已连接网页广播事件。 */
    emitAll(type: string, payload: unknown) {
        this.clients.forEach((client) => sendEvent(client, type, payload));
    }

    /** 向线程所属浏览器广播带线程归属的事件。 */
    emitThread(type: string, threadId: string, payload: Record<string, unknown> = {}) {
        const data: Record<string, unknown> = { ...payload, threadId };
        const replayKey = codexReplayKey(type, data);
        const eventTurnId = String(data.turnId || data.turn_id || "");
        const running = this.runningTurns.get(threadId) || (eventTurnId ? [...this.runningTurns.entries()].find(([, item]) => item.turnId === eventTurnId)?.[1] : undefined);
        const currentScope = Boolean(running) && (!running!.turnId || !eventTurnId || eventTurnId === running!.turnId);
        if (currentScope && replayKey) {
            const item = recordValue(data.item);
            const eventType = String(data.type || "");
            if (type === "agent_event" && item.id && (eventType === "item.started" || eventType === "item.updated")) this.codexReplayActiveItems.add(replayKey);
            if (type === "agent_event" && item.id && eventType === "item.completed") this.codexReplayActiveItems.delete(replayKey);
            if (type === "agent_event" && (eventType === "turn.completed" || eventType === "error")) this.clearReplayActiveTurn(threadId, eventTurnId);
            const replayData = this.replaySnapshot(replayKey, data);
            this.codexReplayEvents.set(replayKey, { type, payload: { ...replayData, replayed: true } });
            while (this.codexReplayEvents.size > 240) {
                const evictable = [...this.codexReplayEvents.keys()].find((key) => !this.codexReplayActiveItems.has(key));
                if (!evictable) break;
                this.codexReplayEvents.delete(evictable);
            }
        }
        // 优先用运行中 turn 的 owner，避免 threadOwners 被错误覆盖后把回复推丢
        const ownerId = running?.ownerId || this.threadOwner(threadId);
        const sent = this.emitOwner(ownerId, type, data);
        if (!sent && ownerId !== HOST_OWNER_ID) logger.warn("Thread event dropped: no SSE client for owner", { type, threadId, ownerId, eventType: data.type });
    }

    /** 向指定所有者（浏览器）的全部页面广播事件；返回送达的连接数。 */
    emitOwner(ownerId: string, type: string, payload: unknown) {
        let sent = 0;
        this.clients.forEach((client, clientId) => {
            if (this.clientOwners.get(clientId) !== ownerId) return;
            sendEvent(client, type, payload);
            sent += 1;
        });
        return sent;
    }

    /** 为断线重连保存完整的最新文本快照，实时连接仍只接收增量。 */
    private replaySnapshot(replayKey: string, data: Record<string, unknown>) {
        if (data.type !== "item.updated" && data.type !== "item.completed") return data;
        const item = recordValue(data.item);
        if (!item.id) return data;
        const previous = recordValue(recordValue(this.codexReplayEvents.get(replayKey)?.payload).item);
        const delta = String(item.delta || "");
        if (!delta) return data;
        const previousText = String(previous.text || "");
        const { delta: _delta, ...snapshotItem } = item;
        return { ...data, item: { ...previous, ...snapshotItem, text: `${previousText}${delta}` } };
    }

    private clearReplayActiveTurn(threadId: string, turnId: string) {
        const prefix = `item:${turnId}:`;
        this.codexReplayActiveItems.forEach((key) => {
            if (key.startsWith(prefix)) this.codexReplayActiveItems.delete(key);
        });
        if (!turnId) return;
        this.codexReplayActiveItems.forEach((key) => {
            const event = this.codexReplayEvents.get(key);
            const eventThreadId = String(event?.payload.threadId || event?.payload.thread_id || "");
            const eventTurnId = String(event?.payload.turnId || event?.payload.turn_id || "");
            if (eventThreadId === threadId && eventTurnId === turnId) this.codexReplayActiveItems.delete(key);
        });
    }

    /** 校验工具参数并将调用分派到当前目标网页。 */
    async callTool(name: unknown, rawInput: unknown, preferredThreadId = "", ownerId = "") {
        if (!isToolName(name)) throw new Error(`未知工具：${String(name)}`);
        const clientId = this.resolveToolClientId(preferredThreadId, ownerId);
        if (!clientId) throw new Error("无法确定工具目标网页，请指定已绑定的会话");
        logger.info("MCP tool called", { name, input: rawInput, targetClientId: clientId, preferredThreadId: preferredThreadId || undefined });
        const input = parseToolInput(name, rawInput) as Record<string, unknown>;
        if (SITE_TOOLS.has(name)) {
            if (!this.clients.size) throw new Error("当前没有已连接网页");
            return await this.requestCanvasTool(name, input, clientId);
        }
        const readTool = ["canvas_get_state", "canvas_get_selection", "canvas_export_snapshot"].includes(name);
        const canvasState = this.clients.has(clientId) ? this.canvasStates.get(clientId) || null : null;
        if (readTool && (!this.clients.size || !canvasState)) throw new Error("当前没有已连接画布");
        if (name === "canvas_get_state" || name === "canvas_export_snapshot") return compactCanvasState(canvasState);
        if (name === "canvas_get_selection") {
            const ids = expandSelectionNodeIds(canvasState);
            const idList = [...ids];
            const mindMaps = mindMapsForSelection(canvasState?.mindMaps, idList);
            const nodes = (canvasState?.nodes || []).filter((node) => ids.has(node.id)).map(compactNode);
            const connections = (canvasState?.connections || [])
                .filter((conn) => ids.has(conn.fromNodeId) && ids.has(conn.toNodeId))
                .map(compactConnection);
            return {
                nodes,
                ...(connections.length ? { connections } : {}),
                ...(mindMaps.length ? { mindMaps } : {}),
            };
        }
        if (name === "canvas_create_attachment_nodes") return await this.createAttachmentNodes(input as { attachmentIds: string[]; x?: number; y?: number; gap?: number; direction?: "row" | "column" }, clientId);
        if (!this.clients.size) throw new Error("当前没有已连接画布");
        const request = buildCanvasToolRequest(name, input, canvasState);
        return await this.requestCanvasTool(request.name, request.input, clientId);
    }

    /** 将当前 turn 的附件转换为画布图片节点。 */
    private async createAttachmentNodes(input: { attachmentIds: string[]; x?: number; y?: number; gap?: number; direction?: "row" | "column" }, preferredClientId = "") {
        const clientId = preferredClientId || this.targetClientId;
        if (!this.clients.has(clientId)) throw new Error("当前没有已连接画布");
        const attachments = input.attachmentIds.map((id) => this.getTurnAttachment(clientId, id));
        const canvasState = this.canvasStates.get(clientId) || null;
        // 有正在跑的 Codex 节点时，附件贴在其左侧，避免丢到画布最右侧导致后续生成占位也看不见
        const runningCodex = (canvasState?.nodes || []).find((node) => node.metadata?.codexPhase === "running");
        const hasExplicit = input.x !== undefined || input.y !== undefined;
        const useCodexAnchor = Boolean(runningCodex);
        const x = useCodexAnchor || hasExplicit ? Number(input.x ?? (runningCodex ? runningCodex.position.x - 360 : 0)) : undefined;
        const y = useCodexAnchor || hasExplicit ? Number(input.y ?? (runningCodex ? runningCodex.position.y : 0)) : undefined;
        const gap = Number(input.gap ?? 40);
        const direction = input.direction || "row";
        let offset = 0;
        const nodes = attachments.map((attachment) => {
            const size = fitAttachmentNodeSize(attachment.width, attachment.height);
            const node = {
                id: `image-${crypto.randomUUID()}`,
                attachmentId: attachment.id,
                title: attachment.name,
                ...(x !== undefined && y !== undefined
                    ? { position: { x: direction === "row" ? x + offset : x, y: direction === "column" ? y + offset : y } }
                    : {}),
                width: size.width,
                height: size.height,
            };
            offset += (direction === "row" ? size.width : size.height) + gap;
            return node;
        });
        await this.requestCanvasTool("canvas_create_attachment_nodes", { nodes }, clientId);
        return { nodes: nodes.map(({ id, attachmentId, title }) => ({ id, attachmentId, title })) };
    }

    /** 向目标网页发送工具请求并等待调用结果。 */
    private async requestCanvasTool(name: ToolName, input: Record<string, unknown>, preferredClientId = "") {
        const requestId = crypto.randomUUID();
        const clientId = preferredClientId || this.targetClientId;
        const client = this.clients.get(clientId);
        if (!client) throw new Error("当前没有已连接画布");
        sendEvent(client, "tool_call", { requestId, name, input });
        logger.debug("Canvas tool request sent", { requestId, name, input, clientId });
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                logger.warn("Canvas tool request timed out", { requestId, name, clientId });
                reject(new Error("画布操作超时"));
            }, 30000);
            this.pending.set(requestId, { clientId, resolve: (value) => (clearTimeout(timer), resolve(value)), reject: (error) => (clearTimeout(timer), reject(error)) });
        });
    }
}

/** 为运行中 turn 的可重放事件生成稳定键。 */
function codexReplayKey(type: string, payload: Record<string, unknown>) {
    const turnId = String(payload.turnId || payload.turn_id || "");
    if (type === "chat_message") {
        const message = recordValue(payload.message);
        const clientMessageId = String(message.clientMessageId || "");
        if (clientMessageId) return `chat:${clientMessageId}`;
        const messageId = String(message.itemId || message.id || "");
        return messageId ? `chat:${turnId}:${messageId}` : "";
    }
    if (type === "agent_error") return `error:${turnId}`;
    if (type !== "agent_event") return "";
    const item = recordValue(payload.item);
    if (item.id) return `item:${turnId}:${String(item.id)}`;
    const eventType = String(payload.type || "");
    if (eventType === "plan.updated") return `plan:${turnId}`;
    if (eventType === "usage.updated") return `usage:${turnId}`;
    if (eventType === "turn.completed" || eventType === "error") return `${eventType}:${turnId}`;
    return "";
}

function recordValue(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** 向 SSE 连接写入一个事件。 */
function sendEvent(res: ServerResponse, type: string, payload: unknown) {
    res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}
/** 将未知数值转换为正数，否则使用默认值。 */
function positiveNumber(value: unknown, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}
