import { create } from "zustand";
import i18n from "@/i18n";

import type { AgentPlanDocument } from "@/lib/agent/agent-plan-document";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";

export type AgentChatRole = "user" | "assistant" | "system" | "tool" | "error";
export type AgentAttachment = {
    id: string;
    name: string;
    type: string;
    size: number;
    width: number;
    height: number;
    url: string;
    dataUrl: string;
    /** 已在画布上的图片节点 ID；有则生图应直接引用，禁止再复制一份 */
    canvasNodeId?: string;
    /** 默认 image；file/folder 在输入区显示为小节点，发送时展开为路径上下文 */
    kind?: "image" | "file" | "folder" | "text";
    localPath?: string;
    /** 发给模型的短上下文（优先本地路径）；不写入用户可见输入正文 */
    promptText?: string;
    /** 由画布选区自动附加；轻量模式切换时移除，手动附件保留。 */
    autoCanvasContext?: boolean;
};
export type AgentChatItem = { id: string; itemId?: string; clientMessageId?: string; threadId?: string; turnId?: string; role: AgentChatRole; title?: string; text: string; historyText?: string; meta?: string; detail?: unknown; attachments?: AgentAttachment[]; streamId?: string; activityItems?: Record<string, string> };
export type AgentEventLog = { id: string; time: string; title: string; text: string; raw?: unknown };
export type AgentPendingToolCall = { requestId: string; name: string; input?: { ops?: CanvasAgentOp[]; path?: string } & Record<string, unknown> };
export type AgentPermissionMode = "request" | "automatic" | "full";
export type AgentCollaborationMode = "chat" | "default" | "plan";
export type AgentReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type AgentModel = {
    id: string;
    model: string;
    displayName: string;
    defaultReasoningEffort: AgentReasoningEffort;
    supportedReasoningEfforts: Array<{ reasoningEffort: AgentReasoningEffort; description?: string }>;
    isDefault?: boolean;
};
export type AgentApprovalDecision = "accept" | "acceptForSession" | "decline";
export type AgentUserInputOption = { label: string; description?: string; value?: string };
export type AgentUserInputQuestion = { id: string; header?: string; question: string; isOther?: boolean; isSecret?: boolean; options?: AgentUserInputOption[] };
export type AgentPendingApproval = { requestId: string; method: string; threadId?: string; turnId?: string; itemId?: string; anchorAfterId?: string; reason?: string; command?: unknown; cwd?: string; grantRoot?: string; networkApprovalContext?: unknown; permissions?: unknown; questions?: AgentUserInputQuestion[]; deciding?: AgentApprovalDecision };
export type AgentCanvasContext = { snapshot: CanvasAgentSnapshot; applyOps: (ops?: CanvasAgentOp[]) => CanvasAgentSnapshot; undoOps: () => CanvasAgentSnapshot | null; canUndo: boolean };
export type AgentThreadSummary = { id: string; preview: string; name?: string | null; cwd?: string; status?: string; source?: unknown; createdAt?: number; updatedAt?: number };
export type AgentTokenUsage = { input: number; cached: number; output: number };
export type AgentBootstrapStatus = { key: string; text: string; detail: string; status: "running" | "ready" | "error" };
export type AgentConversationState = {
    revision: number;
    conversationId: string;
    threadId: string;
    status: "idle" | "preparing" | "ready" | "warning" | "running" | "failed";
    mcpStatuses: Record<string, { status: "starting" | "ready" | "failed" | "cancelled"; error?: string | null; failureReason?: string | null }>;
    sourceClientId?: string;
    error?: string;
};
export type AgentPanelTab = "chat" | "setup" | "history" | "skills" | "log";
export type AgentProvider = "codex" | "cursor";

const CONNECT_TIMEOUT_MS = 6000;
let agentSource: EventSource | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;

type AgentStore = {
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    /** 状态已是打开但外壳宽度仍为 0 时，递增以重挂动画 */
    panelEpoch: number;
    /** 画布正在拖连线（用于高亮 Codex 面板落点） */
    canvasWireActive: boolean;
    /** 悬停在底部对话框拖入区 */
    codexPanelDropHover: boolean;
    canvasContext: AgentCanvasContext | null;
    /** Agent 面板引擎：对话走 Codex 或 Cursor CLI；星小驰始终 Codex */
    agentProvider: AgentProvider;
    /** Cursor Dashboard User API Key，供 CLI 无头鉴权 */
    cursorApiKey: string;
    url: string;
    token: string;
    connected: boolean;
    /** 本地通道已连通，但 Codex 登录状态已失效，需要重新登录。 */
    codexAuthExpired: boolean;
    enabled: boolean;
    silentConnect: boolean;
    prompt: string;
    attachments: AgentAttachment[];
    sending: boolean;
    waiting: boolean;
    messages: AgentChatItem[];
    tokenUsage: AgentTokenUsage | null;
    eventLogs: AgentEventLog[];
    threads: AgentThreadSummary[];
    activeThreadId: string;
    activeTurnId: string;
    /** 画布节点请求面板切换到它自己的 Codex 会话；面板消费后清空 */
    requestedThreadId: string;
    workspacePath: string;
    loadingThreads: boolean;
    activeTab: AgentPanelTab;
    confirmTools: boolean;
    permissionMode: AgentPermissionMode;
    collaborationMode: AgentCollaborationMode;
    models: AgentModel[];
    model: string;
    reasoningEffort: AgentReasoningEffort | "";
    activity: string;
    conversation: AgentConversationState;
    bootstrapStatus: AgentBootstrapStatus | null;
    mcpStartupStatuses: Record<string, AgentBootstrapStatus>;
    connectError: string;
    pendingTool: AgentPendingToolCall | null;
    pendingApprovals: AgentPendingApproval[];
    planDocument: AgentPlanDocument | null;
    setAgentState: (patch: Partial<Omit<AgentStore, "setAgentState" | "connectAgent" | "disconnectAgent" | "addMessage" | "addEventLog" | "clearEventLogs" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext">>) => void;
    openPanel: (options?: { tab?: AgentPanelTab }) => void;
    closePanel: () => void;
    togglePanel: () => void;
    setCanvasContext: (context: AgentCanvasContext | null) => void;
    connectAgent: (options?: { silent?: boolean }) => void;
    disconnectAgent: (patch?: Partial<Omit<AgentStore, "setAgentState" | "connectAgent" | "disconnectAgent" | "addMessage" | "addEventLog" | "clearEventLogs" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext">>) => void;
    addMessage: (item: AgentChatItem) => void;
    addEventLog: (item: AgentEventLog) => void;
    clearEventLogs: () => void;
};

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;

export const useAgentStore = create<AgentStore>((set, get) => ({
    width: typeof window === "undefined"
        ? 440
        : Math.min(760, Math.max(360, Number(localStorage.getItem("canvas-agent-panel-width")) || 440)),
    panelOpen: false,
    panelMounted: true,
    panelClosing: false,
    panelEpoch: 0,
    canvasWireActive: false,
    codexPanelDropHover: false,
    canvasContext: null,
    agentProvider: typeof window === "undefined"
        ? "codex"
        : ((localStorage.getItem("canvas-agent-provider") === "cursor" ? "cursor" : "codex") as AgentProvider),
    cursorApiKey: typeof window === "undefined" ? "" : localStorage.getItem("canvas-cursor-api-key") || "",
    url: typeof window === "undefined" ? "http://127.0.0.1:17371" : localStorage.getItem("canvas-agent-url") || "http://127.0.0.1:17371",
    token: typeof window === "undefined" ? "" : localStorage.getItem("canvas-agent-token") || "",
    connected: false,
    codexAuthExpired: false,
    enabled: false,
    silentConnect: false,
    prompt: "",
    attachments: [],
    sending: false,
    waiting: false,
    messages: [],
    tokenUsage: null,
    eventLogs: [],
    threads: [],
    activeThreadId: "",
    activeTurnId: "",
    requestedThreadId: "",
    workspacePath: "",
    loadingThreads: false,
    activeTab: "setup",
    confirmTools: false,
    permissionMode: typeof window === "undefined" ? "request" : (localStorage.getItem("canvas-agent-permission-mode") as AgentPermissionMode) || "request",
    collaborationMode: typeof window === "undefined" ? "chat" : (() => {
        const mode = localStorage.getItem("canvas-agent-chat-mode");
        return mode === "default" || mode === "plan" ? mode : "chat";
    })(),
    models: [],
    model: typeof window === "undefined" ? "" : localStorage.getItem("canvas-agent-model") || "",
    reasoningEffort: typeof window === "undefined" ? "" : (localStorage.getItem("canvas-agent-reasoning-effort") as AgentReasoningEffort) || "",
    activity: i18n.t("agent.state.ready"),
    conversation: { revision: 0, conversationId: "", threadId: "", status: "idle", mcpStatuses: {} },
    bootstrapStatus: null,
    mcpStartupStatuses: {},
    connectError: "",
    pendingTool: null,
    pendingApprovals: [],
    planDocument: null,
    setAgentState: (patch) => set(patch),
    openPanel: (options) => set({
        panelOpen: true,
        panelMounted: true,
        panelClosing: false,
        ...(options?.tab ? { activeTab: options.tab } : {}),
    }),
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        set({ panelOpen: false, panelClosing: true, codexPanelDropHover: false });
        setTimeout(() => {
            if (get().panelClosing) set({ panelClosing: false });
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    },
    togglePanel: () => {
        const { panelOpen, panelClosing, panelEpoch } = get();
        const visualWidth = typeof document === "undefined"
            ? 0
            : document.querySelector("[data-agent-panel-shell]")?.getBoundingClientRect().width ?? 0;
        // 以实际宽度为准：状态开着但宽为 0 时再点应展开，而不是走关闭
        if (visualWidth > 32) {
            get().closePanel();
            return;
        }
        if (panelOpen && !panelClosing) {
            set({ panelEpoch: panelEpoch + 1, panelClosing: false });
            return;
        }
        get().openPanel();
    },
    setCanvasContext: (canvasContext) => set({ canvasContext }),
    connectAgent: (options) => {
        const silent = options?.silent ?? false;
        const endpoint = get().url.trim().replace(/\/$/, "");
        const token = get().token.trim();
        if (!endpoint || !token) return set({ connectError: silent ? "" : i18n.t("agent.state.connectionRequired") });
        try {
            const parsed = new URL(endpoint);
            if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
        } catch {
            return set({ connectError: silent ? "" : i18n.t("agent.state.invalidUrl") });
        }
        localStorage.setItem("canvas-agent-url", endpoint);
        localStorage.setItem("canvas-agent-token", token);
        // Only set enabled here; LocalAgentPanel's effect owns SSE initialization.
        set({ url: endpoint, token, enabled: true, silentConnect: silent, activity: i18n.t("agent.status.connecting"), connectError: "", codexAuthExpired: false });
    },
    disconnectAgent: (patch = {}) => {
        agentSource?.close();
        agentSource = null;
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = null;
        set({ enabled: false, connected: false, silentConnect: false, activity: i18n.t("agent.state.offline"), conversation: { revision: 0, conversationId: "", threadId: "", status: "idle", mcpStatuses: {} }, bootstrapStatus: null, mcpStartupStatuses: {}, ...patch });
    },
    addMessage: (item) => set((state) => ({ messages: [...state.messages, item] })),
    addEventLog: (item) => set((state) => ({ eventLogs: [...state.eventLogs.slice(-160), item] })),
    clearEventLogs: () => set({ eventLogs: [] }),
}));
