import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Tooltip } from "antd";
import dayjs from "dayjs";
import { Bot, History, MessageSquare, PanelRightClose, Play, PlugZap, Plus, Settings, Sparkles, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { persistAgentIoDirs } from "@/lib/canvas/agent-io-paths";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { readImageMeta } from "@/lib/image-utils";
import { randomId } from "@/lib/utils";
import { uploadImage } from "@/services/image-storage";
import { bindPendingAgentUserMessage, deleteAgentThreadMessages, deleteAgentTurnMessages, deletePendingAgentUserMessage, moveAgentUserMessage, readAgentLocalMessages, readAgentUserMessages, saveAgentLocalMessage, savePendingAgentUserMessage } from "@/services/agent-chat-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useCanvasInteractionStore } from "@/stores/canvas/use-canvas-interaction-store";
import { useShallow } from "zustand/react/shallow";
import { useAgentStore, type AgentAttachment, type AgentBootstrapStatus, type AgentCanvasContext, type AgentChatItem, type AgentCollaborationMode, type AgentConversationState, type AgentModel, type AgentPendingApproval, type AgentPendingToolCall, type AgentPermissionMode, type AgentProvider, type AgentReasoningEffort, type AgentThreadSummary } from "@/stores/use-agent-store";
import { applyCodexGeneratedImagesAsResultNodes, createCodexLoadingPlaceholders, settleCodexPlaceholders } from "@/components/canvas/nodes/codex-image-node";
import { codexImageJob, codexImageJobByThread, liveCodexImageJobs, parseCodexDeclaredCount, useCodexImageJobStore, type CodexImageJobRequest } from "@/stores/use-codex-image-job-store";
import { buildCodexTextSystemPrompt, codexTextJob, codexTextJobByThread, liveCodexTextJobs, useCodexTextJobStore } from "@/stores/use-codex-text-job-store";
import { collectCodexTextResult, runQueuedCodexTextJob } from "@/components/agent/codex-text-job-runner";
import { type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { acquireAgentClientId } from "@/lib/agent/agent-client-id";
import { agentOwnerId } from "@/lib/agent/agent-owner-id";
import { buildAgentPlanDocument, planWasExecuted } from "@/lib/agent/agent-plan-document";
import { registerPlanHandoff, registerPlanPreview } from "@/lib/agent/plan-handoff";
import { applyCanvasNodesToComposer, expandComposerContext, isImageAgentAttachment, syncCanvasSelectionToComposer, withCanvasNodeId } from "@/lib/agent/canvas-selection-to-composer";
import { formatDroppedLocalPaths, formatDroppedTextFiles, isComposerImageFile, isComposerTextFile } from "@/lib/agent/composer-drop-files";
import { appendComposerFile, orderedAttachmentsFromPrompt, pruneAttachmentsToPrompt, removeComposerFileToken, stripComposerFileTokens } from "@/lib/agent/composer-inline";
import { isSiteTool, runSiteTool } from "@/lib/agent/agent-site-tools";
import { acknowledgeCodexHistory, activateAgentClient, AgentApiError, agentEnginePath, deleteCodexTurn, discoverAgentConfig, fetchAgentJson, fetchLocalAgentConnectInfo, forkCodexThread, interruptAgentTurn, postAgentApproval, postAgentUserInput, postState, postToolResult, resolveAgentEndpointForPage, startLocalAgent, updateAgentFilePaths } from "@/services/api/canvas-agent";
import { useConfigStore } from "@/stores/use-config-store";
import { AgentChatTimeline, AgentUsageBar } from "./agent-chat";
import { AgentChatComposer } from "./agent-chat-composer";
import { isPlanSwitchAsk, isUserInputRequest, type AgentUserInputArchive } from "./agent-chat-message";
import { AgentConnectView } from "./agent-connect-view";
import {
    activityDeltaFallback,
    activityDetail,
    activityKind,
    activityPlaceholder,
    agentAttachmentToChatAttachment,
    agentErrorView,
    appendPendingUserMessage,
    upsertUserChatMessage,
    attachmentPayloadBytes,
    compactText,
    eventUsage,
    formatAgentActivity,
    composeReasoningText,
    formatAgentEvent,
    formatAgentEventLog,
    formatAgentPlan,
    formatBytes,
    bindPendingTurnMessages,
    insertAgentMessage,
    isCanvasWriteTool,
    isConnectionErrorMessage,
    isTrackedThreadEvent,
    isReasoningSummary,
    isUserInputMessage,
    lastMessageAnchorInTurn,
    mergeAgentMessages,
    mergeHistoryAttachments,
    mergeStreamText,
    normalizeHistoryMessages,
    normalizeText,
    objectField,
    parseEventData,
    promptWithAttachments,
    registerLiveAgentTurn,
    scopeChatItem,
    stringText,
    toolName,
    turnPlanStatus,
    upsertAgentMessage,
    type AgentEventItem,
    type AgentEventPayload,
} from "./agent-event-formatters";
import { AgentHistoryView } from "./agent-history-view";
import { AgentLogView } from "./agent-log-view";
import { AgentPanelTabs } from "./agent-panel-tabs";
import { AgentSkillsView } from "./agent-skills-view";

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_PAYLOAD_BYTES = 28 * 1024 * 1024;
const DEFAULT_AGENT_URL = "http://127.0.0.1:17371";
const AGENT_PROTOCOL_VERSION = 9;
const HISTORY_RETRY_DELAYS_MS = [0, 150, 350, 700, 1200];
const AGENT_REASONING_EFFORTS = new Set<AgentReasoningEffort>(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const rt = (key: string, options?: Record<string, unknown>) => i18n.t(`agent.runtime.${key}`, options);
const isStaleCodexThreadError = (error: unknown) => /thread not loaded|no rollout found/i.test(error instanceof Error ? error.message : String(error));

type AgentWorkspace = { workspacePath: string; activeThreadId?: string };
type AgentThreadsResponse = { ok?: boolean; workspace?: AgentWorkspace; conversation?: AgentConversationState; data?: AgentThreadSummary[] };
type AgentThreadResponse = { ok?: boolean; contextMode?: "chat" | "default"; workspace?: AgentWorkspace; conversation?: AgentConversationState; thread?: AgentThreadSummary; messages?: AgentChatItem[]; settledTurnIds?: string[]; historyReady?: boolean; stale?: boolean };
type AgentWorkspaceResponse = { ok?: boolean; workspace?: AgentWorkspace; conversation?: AgentConversationState };
type AgentTurnResponse = { ok?: boolean; threadId?: string };
type AgentModelsResponse = { ok?: boolean; data?: AgentModel[] };
type AgentCodexState = { busy?: boolean; threadId?: string; turnId?: string };
type AgentHelloEvent = { ok?: boolean; protocolVersion?: number; clientId?: string; workspace?: { activeThreadId?: string }; conversation?: AgentConversationState; codex?: AgentCodexState; pendingApprovals?: AgentPendingApproval[] };
type AgentWorkspaceEvent = { activeThreadId?: string; threadId?: string; sourceClientId?: string; emptyThread?: boolean; draftThread?: boolean; conversation?: AgentConversationState };
type AgentChatEvent = { threadId?: string; turnId?: string; sourceClientId?: string; replayed?: boolean; message?: AgentChatItem };
type AgentBootstrapEvent = { type?: "codex.preparing" | "codex.prepare_failed" | "mcp.startup" | "mcp.complete"; phase?: "preheat" | "runtime"; threadId?: string; name?: string; status?: "starting" | "ready" | "failed" | "cancelled"; error?: string | null; failureReason?: string | null };

function authoritativeHistoryTurnKeys(threadId: string, settledTurnIds: string[]) {
    return new Set(settledTurnIds.map((turnId) => `${threadId}\0${turnId}`));
}

function agentErrorState(error: unknown) {
    return error instanceof AgentApiError ? (error.response as { state?: AgentConversationState }).state : undefined;
}

function currentProvider(): AgentProvider {
    return useAgentStore.getState().agentProvider;
}

function engineApi(suffix: string) {
    return agentEnginePath(currentProvider(), suffix);
}

function isCursorThreadId(threadId?: string) {
    return Boolean(threadId && threadId.startsWith("cursor:"));
}

function shouldApplyEngineEvent(threadId?: string) {
    return currentProvider() === "cursor" ? isCursorThreadId(threadId) : !isCursorThreadId(threadId);
}

function cursorInitFailedConversation(error: unknown): AgentConversationState {
    return {
        revision: Date.now(),
        conversationId: "",
        threadId: "",
        status: "failed",
        mcpStatuses: {},
        error: error instanceof Error && error.name === "TimeoutError" ? rt("cursorCreateTimeout") : error instanceof Error ? error.message : String(error),
    };
}

function conversationBootstrapView(conversation: AgentConversationState) {
    if (currentProvider() === "cursor") {
        const bootstrapStatus: AgentBootstrapStatus | null = conversation.status === "idle" || conversation.status === "preparing"
            ? { key: "cursor:preparing", text: rt("cursorInitializing"), detail: rt("cursorCreating"), status: "running" }
            : conversation.status === "failed"
                ? { key: "cursor:prepare_failed", text: rt("cursorInitFailed"), detail: conversation.error || rt("cursorCreateFailed"), status: "error" }
                : conversation.status === "ready" || conversation.status === "running"
                    ? { key: "cursor:ready", text: rt("cursorReady"), detail: rt("cursorReadyDetail"), status: "ready" }
                    : null;
        return { bootstrapStatus, mcpStartupStatuses: {} };
    }
    const mcpStartupStatuses: Record<string, AgentBootstrapStatus> = Object.fromEntries(Object.entries(conversation.mcpStatuses).map(([name, item]) => {
        const view: AgentBootstrapStatus = item.status === "starting"
            ? { key: `mcp:${name}:starting`, text: rt("mcpStarting", { name }), detail: rt("mcpConnecting"), status: "running" }
            : item.status === "ready"
                ? { key: `mcp:${name}:ready`, text: rt("mcpReadyNamed", { name }), detail: rt("toolsReady"), status: "ready" }
                : { key: `mcp:${name}:${item.status}`, text: rt(item.status === "failed" ? "mcpFailedNamed" : "mcpCanceledNamed", { name }), detail: item.error || rt("toolInitFailed"), status: "error" };
        return [name, view];
    }));
    const services = Object.values(mcpStartupStatuses);
    const pending = services.filter((item) => item.status === "running").length;
    const bootstrapStatus: AgentBootstrapStatus | null = conversation.status === "idle" || conversation.status === "preparing"
        ? services.length
            ? { key: "mcp:starting", text: rt("mcpServicesStarting"), detail: pending ? rt("toolServicesPending", { count: pending }) : rt("checkingToolServices"), status: "running" }
            : { key: "codex:preparing", text: rt("conversationInitializing"), detail: rt("conversationCreating"), status: "running" }
        : conversation.status === "warning"
            ? { key: "mcp:warning", text: rt("someMcpFailed"), detail: rt("remainingToolsReady"), status: "error" }
            : conversation.status === "failed"
                ? { key: "codex:prepare_failed", text: rt("conversationInitFailed"), detail: conversation.error || rt("conversationCreateFailed"), status: "error" }
                : conversation.status === "ready"
                    ? { key: "mcp:ready", text: rt("mcpServicesReady", { count: services.length }), detail: rt("toolsReady"), status: "ready" }
                    : null;
    return { bootstrapStatus, mcpStartupStatuses };
}

export function LocalAgentPanel({ embedded, headless, autoConnect }: { embedded?: boolean; headless?: boolean; autoConnect?: boolean }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { message, modal } = App.useApp();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    // Field-level selectors with useShallow rerender only when these fields change.
    // canvasContext is intentionally excluded because project updates it every frame during dragging and resizing.
    // The panel uses it only for ref synchronization and debounced postState calls, never during rendering.
    // Subscribing here would rerender the panel every frame and amplify the #185 crash, so it is observed imperatively below.
    const { width, url, token, connected, enabled, prompt, attachments, sending, waiting, tokenUsage, eventLogs, threads, activeThreadId, workspacePath, loadingThreads, activeTab, confirmTools, permissionMode, collaborationMode, models, model, reasoningEffort, activity, conversation, connectError, pendingTool, pendingApprovals, agentProvider } = useAgentStore(
        useShallow((state) => ({
            width: state.width,
            url: state.url,
            agentProvider: state.agentProvider,
            token: state.token,
            connected: state.connected,
            enabled: state.enabled,
            prompt: state.prompt,
            attachments: state.attachments,
            sending: state.sending,
            waiting: state.waiting,
            tokenUsage: state.tokenUsage,
            eventLogs: state.eventLogs,
            threads: state.threads,
            activeThreadId: state.activeThreadId,
            workspacePath: state.workspacePath,
            loadingThreads: state.loadingThreads,
            activeTab: state.activeTab,
            confirmTools: state.confirmTools,
            permissionMode: state.permissionMode,
            collaborationMode: state.collaborationMode,
            models: state.models,
            model: state.model,
            reasoningEffort: state.reasoningEffort,
            activity: state.activity,
            conversation: state.conversation,
            connectError: state.connectError,
            pendingTool: state.pendingTool,
            pendingApprovals: state.pendingApprovals,
        })),
    );
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const requestedThreadId = useAgentStore((state) => state.requestedThreadId);
    const hasAnsweredUserInput = useAgentStore((state) => state.messages.some((item) => item.detail && typeof item.detail === "object" && (item.detail as { kind?: unknown }).kind === "userInput"));
    const planDocument = useAgentStore((state) => state.planDocument);
    // running 但已不在等待时，视为可发送（避免历史刷新作废后 status 卡住导致发送永久灰）
    const conversationReady = conversation.status === "ready" || conversation.status === "warning"
        || (conversation.status === "running" && !sending && !waiting);
    const conversationBusy = conversation.status === "preparing" || (conversation.status === "running" && (sending || waiting));
    const composerAttachments = useMemo(() => attachments.map(agentAttachmentToChatAttachment), [attachments]);
    const closePanel = useAgentStore((state) => state.closePanel);
    const pushMessage = useAgentStore((state) => state.addMessage);
    const pushEventLog = useAgentStore((state) => state.addEventLog);
    const clearEventLogs = useAgentStore((state) => state.clearEventLogs);
    const loadSkills = useAgentSkillStore((state) => state.loadSkills);
    const clearSkillSelection = useAgentSkillStore((state) => state.clearSelection);
    const skillCount = useAgentSkillStore((state) => state.skills.length);
    const messageCount = useAgentStore((state) => state.messages.length);
    const canvasContextRef = useRef<AgentCanvasContext | null>(useAgentStore.getState().canvasContext);
    const selectionKeyRef = useRef("");
    const selectionSyncSeqRef = useRef(0);
    const confirmToolsRef = useRef(confirmTools);
    const pendingToolRef = useRef<AgentPendingToolCall | null>(null);
    const autoConnectRef = useRef(false);
    const desktopBootRef = useRef(false);
    const connectedRef = useRef(false);
    const errorLoggedRef = useRef(false);
    const attachmentUrlsRef = useRef(new Set<string>());
    const clientIdRef = useRef("");
    const [clientReady, setClientReady] = useState(false);
    const [connectionAttempt, setConnectionAttempt] = useState(0);
    const loadThreadsSequenceRef = useRef(0);
    const loadThreadsInFlightRef = useRef(0);
    const threadMessagesRef = useRef(new Map<string, AgentChatItem[]>());
    const authoritativeHistoryTurnsRef = useRef(new Set<string>());
    const liveTurnKeysRef = useRef(new Set<string>());
    const planHandoffDoneRef = useRef("");
    const maybePlanHandoffRef = useRef<(turnId: string) => void>(() => undefined);
    const publishPlanDocumentRef = useRef<(markdown?: string, threadId?: string, turnId?: string) => void>(() => undefined);
    const threadOperationRef = useRef(0);
    const threadOperationSequenceRef = useRef(0);
    const [editingTurn, setEditingTurn] = useState<AgentChatItem | null>(null);
    const editingTurnRef = useRef<AgentChatItem | null>(null);
    const endpoint = useMemo(() => url.trim().replace(/\/$/, ""), [url]);
    const urlAgentAutoConnect = searchParams.has("agentUrl") && searchParams.has("agentToken");
    useEffect(() => {
        let disposed = false;
        void acquireAgentClientId().then((clientId) => {
            if (!disposed) {
                clientIdRef.current = clientId;
                setClientReady(true);
            }
        });
        return () => { disposed = true; };
    }, []);
    const loadThreadSnapshot = useCallback(async (threadId: string, sequence: number, response?: AgentThreadResponse, expectedTurnId = "") => {
        const storedMessagesPromise = readAgentUserMessages(threadId).catch(() => []);
        const localMessagesPromise = readAgentLocalMessages(threadId).catch(() => []);
        let thread = response;
        let lastError: unknown;
        for (const delayMs of HISTORY_RETRY_DELAYS_MS) {
            if (delayMs) await delay(delayMs);
            if (sequence !== loadThreadsSequenceRef.current || useAgentStore.getState().activeThreadId !== threadId) return false;
            try {
                thread ||= await fetchAgentJson<AgentThreadResponse>(endpoint, token, engineApi(`/threads/${encodeURIComponent(threadId)}`));
                lastError = undefined;
            } catch (error) {
                lastError = error;
                thread = undefined;
                continue;
            }
            if (thread.stale) return "stale";
            const history = normalizeHistoryMessages(thread.messages || []);
            const storedMessages = await storedMessagesPromise;
            const localMessages = await localMessagesPromise;
            const latest = useAgentStore.getState();
            if (sequence !== loadThreadsSequenceRef.current || latest.activeThreadId !== threadId) return false;
            const historyTurns = authoritativeHistoryTurnKeys(threadId, thread.settledTurnIds || []);
            const expectedTurnKey = expectedTurnId ? `${threadId}\0${expectedTurnId}` : "";
            const hasExpectedTurn = !expectedTurnId || historyTurns.has(expectedTurnKey);
            historyTurns.forEach((key) => {
                if (key === expectedTurnKey) return;
                liveTurnKeysRef.current.delete(key);
            });
            if (latest.activeTurnId) liveTurnKeysRef.current.add(`${threadId}\0${latest.activeTurnId}`);
            if (expectedTurnKey) liveTurnKeysRef.current.add(expectedTurnKey);
            authoritativeHistoryTurnsRef.current = historyTurns;
            const attachmentSources = [...latest.messages, ...storedMessages.map((item) => ({ ...item, threadId }))];
            const snapshot = mergeHistoryAttachments(history, attachmentSources);
            const restoredLocal = localMessages.map((item) => scopeChatItem({
                id: item.id,
                itemId: item.itemId || item.id,
                clientMessageId: item.clientMessageId,
                role: item.role,
                title: item.title,
                text: item.text,
                detail: item.detail,
            } as AgentChatItem, item.threadId || threadId, item.turnId || ""));
            const messages = mergeAgentMessages(snapshot, [...latest.messages, ...restoredLocal], threadId, liveTurnKeysRef.current);
            // 历史尚未带上助手回复时，不要用更空的快照盖住 SSE 已写入的内容
            const localAssistantCount = latest.messages.filter((item) => item.threadId === threadId && (item.role === "assistant" || item.role === "tool")).length;
            const mergedAssistantCount = messages.filter((item) => item.role === "assistant" || item.role === "tool").length;
            const keepRicherLocal = (thread.historyReady === false || isCursorThreadId(threadId)) && localAssistantCount > mergedAssistantCount;
            const nextMessages = keepRicherLocal ? latest.messages : messages;
            persistLocalUserInputMessages(threadId, nextMessages);
            if (isCursorThreadId(threadId)) persistCursorThreadMessages(threadId, nextMessages);
            threadMessagesRef.current.set(threadId, nextMessages);
            const currentDoc = latest.planDocument;
            const restored = currentDoc?.threadId === threadId
                ? currentDoc
                : buildAgentPlanDocument({ threadId, turnId: "", messages: nextMessages, collapsed: true, width: currentDoc?.width });
            setAgentState({
                messages: nextMessages,
                connectError: "",
                ...(restored && !currentDoc ? { planDocument: restored, panelOpen: true, panelMounted: true, panelClosing: false } : {}),
            });
            const coveredTurnIds = [...historyTurns].map((key) => key.slice(threadId.length + 1));
            if (coveredTurnIds.length && !keepRicherLocal && !isCursorThreadId(threadId)) void acknowledgeCodexHistory(endpoint, token, threadId, coveredTurnIds).catch(() => undefined);
            if (hasExpectedTurn && thread.historyReady !== false) return true;
            thread = undefined;
        }
        if (lastError) throw lastError;
        return false;
    }, [endpoint, setAgentState, token]);
    const applyWorkspaceChange = useCallback((data: AgentWorkspaceEvent) => {
        const nextThreadId = data.activeThreadId ?? data.threadId ?? "";
        const current = useAgentStore.getState();
        const threadChanged = current.activeThreadId !== nextThreadId;
        const emptyThread = Boolean(data.emptyThread || data.draftThread);
        const activeTurn = current.sending || current.waiting;
        const rescopeDuringTurn = emptyThread && activeTurn && Boolean(nextThreadId);
        const pendingMessage = [...current.messages].reverse().find((item) => item.role === "user" && !item.turnId);
        const keepPendingMessage = Boolean(
            data.emptyThread
            && pendingMessage
            && activeTurn
            && (!data.sourceClientId || data.sourceClientId === clientIdRef.current),
        );
        if (threadChanged && current.activeThreadId) {
            const messages = keepPendingMessage ? current.messages.filter((item) => item.id !== pendingMessage!.id) : current.messages;
            persistLocalUserInputMessages(current.activeThreadId, messages);
            if (isCursorThreadId(current.activeThreadId)) persistCursorThreadMessages(current.activeThreadId, messages);
            threadMessagesRef.current.set(current.activeThreadId, messages);
        }
        const cachedNext = nextThreadId ? threadMessagesRef.current.get(nextThreadId) : undefined;
        if (emptyThread && nextThreadId && !activeTurn && !cachedNext?.length) threadMessagesRef.current.delete(nextThreadId);
        if (threadChanged || (emptyThread && !activeTurn)) {
            loadThreadsSequenceRef.current += 1;
            authoritativeHistoryTurnsRef.current.clear();
            liveTurnKeysRef.current.clear();
        } else if (threadChanged && activeTurn && current.activeThreadId && nextThreadId) {
            loadThreadsSequenceRef.current += 1;
            authoritativeHistoryTurnsRef.current.clear();
            const remapped = [...liveTurnKeysRef.current].map((key) => (
                key.startsWith(`${current.activeThreadId}\0`) ? `${nextThreadId}\0${key.slice(current.activeThreadId.length + 1)}` : key
            ));
            liveTurnKeysRef.current.clear();
            remapped.forEach((key) => liveTurnKeysRef.current.add(key));
        }
        const rescopedMessages = rescopeDuringTurn
            ? current.messages.map((item) => {
                const onCurrent = !item.threadId || item.threadId === current.activeThreadId || item.threadId === "local";
                return onCurrent ? scopeChatItem(item, nextThreadId, item.turnId || "") : item;
            })
            : current.messages;
        const messages = keepPendingMessage
            ? [scopeChatItem(pendingMessage!, nextThreadId, "")]
            : rescopeDuringTurn
                ? rescopedMessages
                : emptyThread && !(threadChanged && cachedNext?.length) ? []
                    : threadChanged ? cachedNext || []
                        : current.messages;
        pendingToolRef.current = null;
        const restoredPlan = emptyThread && !activeTurn
            ? null
            : threadChanged || rescopeDuringTurn
                ? buildAgentPlanDocument({ threadId: nextThreadId, turnId: "", messages, collapsed: true, width: current.planDocument?.width })
                : current.planDocument;
        setAgentState({
            activeThreadId: nextThreadId,
            activeTurnId: (threadChanged || emptyThread) && !activeTurn ? "" : current.activeTurnId,
            messages,
            tokenUsage: (threadChanged || emptyThread) && !activeTurn ? null : current.tokenUsage,
            pendingTool: null,
            pendingApprovals: (threadChanged || emptyThread) && !activeTurn ? [] : current.pendingApprovals,
            planDocument: restoredPlan,
            ...(restoredPlan && threadChanged ? { panelOpen: true, panelMounted: true, panelClosing: false } : {}),
        });
        return loadThreadsSequenceRef.current;
    }, [setAgentState]);
    const applyConversationState = useCallback((next: AgentConversationState, force = false) => {
        const current = useAgentStore.getState();
        if (!next?.revision || !force && next.revision <= current.conversation.revision) return false;
        const conversationChanged = next.conversationId !== current.conversation.conversationId;
        if (conversationChanged || next.threadId !== current.activeThreadId) {
            applyWorkspaceChange({
                activeThreadId: next.threadId,
                emptyThread: conversationChanged || !current.activeThreadId,
                draftThread: next.status === "preparing",
                sourceClientId: next.sourceClientId,
            });
        }
        const runStatePatch: { waiting?: boolean; sending?: boolean } = {};
        if (current.conversation.status === "running" && next.status !== "running" && next.status !== "preparing") {
            runStatePatch.waiting = false;
            runStatePatch.sending = false;
        } else if (next.status === "running" && next.threadId === (current.activeThreadId || next.threadId) && (current.sending || current.waiting)) {
            runStatePatch.waiting = true;
            runStatePatch.sending = false;
        }
        setAgentState({ conversation: next, ...conversationBootstrapView(next), ...runStatePatch });
        return true;
    }, [applyWorkspaceChange, setAgentState]);
    const loadThreads = useCallback(async (skipHistory = false, expectedTurnId = "") => {
        if (!connectedRef.current && !useAgentStore.getState().connected) return;
        let sequence = ++loadThreadsSequenceRef.current;
        loadThreadsInFlightRef.current += 1;
        setAgentState({ loadingThreads: true });
        try {
            const data = await fetchAgentJson<AgentThreadsResponse>(endpoint, token, engineApi("/threads"));
            if (sequence !== loadThreadsSequenceRef.current) return;
            if (data.conversation) {
                applyConversationState(data.conversation);
                sequence = loadThreadsSequenceRef.current;
            }
            const current = useAgentStore.getState();
            const currentThreadId = current.activeThreadId || (!data.conversation ? data.workspace?.activeThreadId : "") || "";
            if (!data.conversation && currentThreadId !== current.activeThreadId) sequence = applyWorkspaceChange({ activeThreadId: currentThreadId });
            if (sequence !== loadThreadsSequenceRef.current || useAgentStore.getState().activeThreadId !== currentThreadId) return;
            setAgentState({
                threads: (data.data || []).filter((item) => item.id === currentThreadId || Boolean(item.preview || item.name)),
                workspacePath: data.workspace?.workspacePath || "",
            });
            if (currentThreadId && !skipHistory) {
                const snapshot = await loadThreadSnapshot(currentThreadId, sequence, undefined, expectedTurnId);
                if (snapshot === "stale" && currentProvider() !== "cursor") {
                    await fetchAgentJson<AgentWorkspaceResponse>(endpoint, token, "/agent/codex/threads/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: clientIdRef.current, permissionMode, collaborationMode: useAgentStore.getState().collaborationMode }) })
                        .then((result) => result.conversation && applyConversationState(result.conversation))
                        .catch((error) => addEventLog(rt("conversationInitFailed"), error));
                }
            } else {
                authoritativeHistoryTurnsRef.current.clear();
                liveTurnKeysRef.current.clear();
            }
        } catch (error) {
            if (isStaleCodexThreadError(error) && currentProvider() !== "cursor") {
                await fetchAgentJson<AgentWorkspaceResponse>(endpoint, token, "/agent/codex/threads/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: clientIdRef.current, permissionMode, collaborationMode: useAgentStore.getState().collaborationMode }) })
                    .then((result) => result.conversation && applyConversationState(result.conversation))
                    .catch((resetError) => addEventLog(rt("conversationInitFailed"), resetError));
            } else {
                addEventLog(rt("historyReadFailed"), error);
            }
        } finally {
            // 用 in-flight 计数，避免中途 sequence 被 workspace 切换抬高后 loadingThreads 永远不落
            loadThreadsInFlightRef.current = Math.max(0, loadThreadsInFlightRef.current - 1);
            if (!loadThreadsInFlightRef.current && !threadOperationRef.current) setAgentState({ loadingThreads: false });
        }
    }, [applyConversationState, applyWorkspaceChange, endpoint, loadThreadSnapshot, setAgentState, token]);
    // Imperatively subscribe to canvasContext to keep the ref current and debounce snapshot reports without rerendering the panel.
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const syncSelectionChips = (snapshot: AgentCanvasContext["snapshot"] | null | undefined) => {
            const agent = useAgentStore.getState();
            if (agent.collaborationMode === "chat") return;
            if (agent.sending || agent.waiting) return;
            const syncToComposer = useCanvasInteractionStore.getState().selectionToComposer;
            const selected = syncToComposer ? snapshot?.selectedNodeIds || [] : [];
            const key = selected.join("|");
            if (key === selectionKeyRef.current) return;
            selectionKeyRef.current = key;
            const seq = ++selectionSyncSeqRef.current;
            void syncCanvasSelectionToComposer(syncToComposer || !snapshot ? snapshot : { ...snapshot, selectedNodeIds: [] }, {
                isStale: () => seq !== selectionSyncSeqRef.current || syncToComposer !== useCanvasInteractionStore.getState().selectionToComposer,
            });
        };
        syncSelectionChips(canvasContextRef.current?.snapshot);
        const unsubscribe = useAgentStore.subscribe((state) => {
            if (state.canvasContext !== canvasContextRef.current) {
                canvasContextRef.current = state.canvasContext;
                if (useAgentStore.getState().connected) {
                    if (timer) clearTimeout(timer);
                    timer = setTimeout(() => void postState(endpoint, token, clientIdRef.current, canvasContextRef.current?.snapshot || null), 300);
                }
            }
            syncSelectionChips(state.canvasContext?.snapshot);
        });
        return () => {
            unsubscribe();
            if (timer) clearTimeout(timer);
        };
    }, [endpoint, token]);
    useEffect(() => {
        confirmToolsRef.current = confirmTools;
    }, [confirmTools]);
    useEffect(() => {
        pendingToolRef.current = pendingTool;
    }, [pendingTool]);
    const revokeOwnedAttachmentUrl = (url?: string) => {
        if (!url || !attachmentUrlsRef.current.has(url)) return;
        URL.revokeObjectURL(url);
        attachmentUrlsRef.current.delete(url);
    };
    useEffect(() => () => attachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

    useEffect(() => {
        if (!clientReady || !enabled || !token.trim()) return;
        localStorage.setItem("canvas-agent-url", endpoint);
        localStorage.setItem("canvas-agent-token", token);
        const clientId = clientIdRef.current;
        const provider = agentProvider;
        let disposed = false;
        let protocolRejected = false;
        let eventQueue = Promise.resolve();
        const isCurrentConnection = () => !disposed && clientIdRef.current === clientId && currentProvider() === provider;
        const enqueueEvent = (task: () => void | Promise<void>) => {
            eventQueue = eventQueue.then(async () => {
                if (isCurrentConnection()) await task();
            }).catch((error) => {
                if (!isCurrentConnection()) return;
                if (!connectedRef.current) failConnection(error?.name === "TimeoutError" ? rt("connectionTimeout") : error instanceof Error ? error.message : rt("connectionFailedDescription"));
                else addEventLog(rt("conversationSyncFailed"), error);
            });
        };
        const source = new EventSource(`${endpoint}/events?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}&ownerId=${encodeURIComponent(agentOwnerId())}`);
        const connectionTimer = window.setTimeout(() => failConnection(rt("connectionTimeout")), 15000);
        const failConnection = (text: string) => {
            if (!isCurrentConnection()) return;
            disposed = true;
            window.clearTimeout(connectionTimer);
            source.close();
            connectedRef.current = false;
            setAgentState({ enabled: false, connected: false, sending: false, waiting: false, silentConnect: false, connectError: text, activity: rt("connectionFailed"), bootstrapStatus: null, mcpStartupStatuses: {}, pendingTool: null, pendingApprovals: [] });
            addEventLog(rt("connectionFailed"), text);
            useAgentSkillStore.getState().reset();
        };
        connectedRef.current = false;
        setAgentState({ connected: false, bootstrapStatus: null, mcpStartupStatuses: {} });
        source.addEventListener("hello", (event) => enqueueEvent(async () => {
            if (!isCurrentConnection()) return;
            let hello = parseEventData<AgentHelloEvent>(event);
            if (hello?.protocolVersion !== AGENT_PROTOCOL_VERSION) {
                const text = rt("agentOutdated");
                protocolRejected = true;
                window.clearTimeout(connectionTimer);
                source.close();
                connectedRef.current = false;
                setAgentState({ enabled: false, connected: false, waiting: false, sending: false, activity: rt("restartRequired"), connectError: text, silentConnect: false, pendingTool: null, pendingApprovals: [] });
                useAgentSkillStore.getState().reset();
                addEventLog(rt("versionMismatch"), text, hello);
                if (!headless) message.error(text);
                return;
            }
            // SSE hello 是共享的 Codex 状态；Cursor 必须读取自己的会话，不能据此跳过建会话。
            if (provider === "cursor") {
                const result = await fetchAgentJson<AgentWorkspaceResponse>(endpoint, token, agentEnginePath(provider, "/workspace"), { signal: AbortSignal.timeout(10000) });
                if (!isCurrentConnection()) return;
                if (!result.conversation) throw new Error(rt("cursorCreateFailed"));
                const next = result.conversation;
                hello = { ...hello, conversation: next, workspace: { activeThreadId: next.threadId }, codex: hello.codex?.threadId === next.threadId ? hello.codex : { busy: next.status === "running", threadId: next.threadId } };
            }
            if (!hello.codex?.busy) {
                window.clearTimeout(connectionTimer);
                const result = await fetchAgentJson<AgentWorkspaceResponse>(endpoint, token, agentEnginePath(provider, "/context"), {
                    method: "POST", headers: { "content-type": "application/json" },
                    body: JSON.stringify({ clientId, permissionMode, collaborationMode: useAgentStore.getState().collaborationMode }),
                    signal: AbortSignal.timeout(60000),
                });
                if (!isCurrentConnection()) return;
                hello = { ...hello, workspace: result.workspace, conversation: result.conversation, codex: { busy: false, threadId: result.conversation?.threadId } };
            }
            const codex = hello?.codex;
            const busy = Boolean(codex?.busy);
            const nextThreadId = hello?.conversation?.threadId ?? hello?.workspace?.activeThreadId ?? useAgentStore.getState().activeThreadId;
            if (hello?.conversation && shouldApplyEngineEvent(hello.conversation.threadId)) applyConversationState(hello.conversation, true);
            else if (currentProvider() !== "cursor") applyWorkspaceChange({ activeThreadId: nextThreadId });
            const current = useAgentStore.getState();
            const nextTurnId = codex?.threadId === nextThreadId ? codex.turnId ?? "" : "";
            if (nextTurnId) liveTurnKeysRef.current.add(`${nextThreadId}\0${nextTurnId}`);
            const activeTurnId = busy ? nextTurnId : "";
            const pendingApprovals = busy ? (hello?.pendingApprovals || []).filter((item) => !item.threadId || item.threadId === nextThreadId) : [];
            const messages = activeTurnId
                ? bindPendingTurnMessages(current.messages.filter((item) => !isConnectionErrorMessage(item)), nextThreadId, activeTurnId)
                : current.messages.filter((item) => !isConnectionErrorMessage(item));
            errorLoggedRef.current = false;
            connectedRef.current = true;
            window.clearTimeout(connectionTimer);
            setAgentState({
                connected: true,
                activity: pendingApprovals.some((item) => isUserInputRequest(item)) ? rt("awaitingUserInput") : pendingApprovals.length ? rt("awaitingApproval") : busy ? rt("codexRunning") : rt("connected"),
                waiting: busy,
                sending: false,
                connectError: "",
                silentConnect: false,
                activeThreadId: nextThreadId,
                activeTurnId,
                messages,
                pendingApprovals,
            });
            if (!headless) message.success(rt("localAgentConnected"));
            const { canvasDataDir } = useConfigStore.getState().config;
            void persistAgentIoDirs(canvasDataDir).then((dirs) => {
                if (dirs.input || dirs.output) void updateAgentFilePaths(endpoint, token, dirs.input, dirs.output).catch(() => {});
            });
            void postState(endpoint, token, clientId, canvasContextRef.current?.snapshot || null);
            if (document.visibilityState === "visible" && document.hasFocus()) void activateAgentClient(endpoint, token, clientId);
            // Cursor 已有可用线程时不要 reset：SSE 重连每次 hello 都会再造一条空历史
            if (!busy && currentProvider() === "cursor" && (!nextThreadId || !hello?.conversation || hello.conversation.status === "idle")) {
                void fetchAgentJson<AgentWorkspaceResponse>(endpoint, token, agentEnginePath("cursor", "/threads/reset"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, permissionMode, collaborationMode: useAgentStore.getState().collaborationMode }), signal: AbortSignal.timeout(15000) })
                    .then((result) => isCurrentConnection() && result.conversation && applyConversationState(result.conversation, true))
                    .catch((error) => {
                        if (!isCurrentConnection()) return;
                        applyConversationState(cursorInitFailedConversation(error), true);
                        addEventLog(rt("cursorInitFailed"), error);
                        if (!headless) message.error(error instanceof Error ? error.message : rt("cursorInitFailed"));
                    });
            } else if (!busy && currentProvider() !== "cursor" && !nextThreadId && (!hello?.conversation || hello.conversation.status === "idle")) {
                void fetchAgentJson<AgentWorkspaceResponse>(endpoint, token, "/agent/codex/threads/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, permissionMode, collaborationMode: useAgentStore.getState().collaborationMode }) })
                    .then((result) => isCurrentConnection() && result.conversation && applyConversationState(result.conversation))
                    .catch((error) => {
                        if (!isCurrentConnection()) return;
                        const state = agentErrorState(error);
                        if (state) applyConversationState(state);
                        addEventLog(rt("conversationInitFailed"), error);
                    });
            }
        }));
        source.addEventListener("codex_state", (event) => {
            const data = parseEventData<AgentCodexState>(event);
            if (!data) return;
            enqueueEvent(async () => {
                const busy = Boolean(data.busy);
                const current = useAgentStore.getState();
                const eventThreadId = data.threadId || "";
                const appliesToCurrentThread = !eventThreadId || eventThreadId === current.activeThreadId;
                if (busy && eventThreadId) liveTurnKeysRef.current.add(`${eventThreadId}\0`);
                if (busy && !appliesToCurrentThread) {
                    // turn 换线程后 activeThreadId 可能尚未更新：先登记，勿丢后续事件
                    if (!current.sending && !current.waiting) return;
                }
                if (!busy && !appliesToCurrentThread) {
                    const tracked = eventThreadId && [...liveTurnKeysRef.current].some((key) => key === `${eventThreadId}\0` || key.startsWith(`${eventThreadId}\0`));
                    if (!tracked && !current.sending && !current.waiting) return;
                }
                const threadIdForState = eventThreadId || current.activeThreadId;
                const turnId = data.turnId || current.activeTurnId;
                if (turnId && threadIdForState) liveTurnKeysRef.current.add(`${threadIdForState}\0${turnId}`);
                const activeTurnId = busy ? turnId : "";
                const messages = activeTurnId && threadIdForState ? bindPendingTurnMessages(current.messages, threadIdForState, activeTurnId) : current.messages.map((message) => {
                    if (busy || !turnId || message.threadId !== threadIdForState || message.turnId !== turnId) return message;
                    return {
                        ...message,
                        streamId: undefined,
                        ...(objectField(message.detail, "kind") === "reasoning" ? { detail: activityDetail(message.detail, "reasoning", "completed") } : {}),
                    };
                });
                setAgentState({
                    activity: busy ? rt("codexRunning") : current.activity === rt("processingFailed") ? rt("processingFailed") : rt("completed"),
                    waiting: busy,
                    sending: false,
                    activeTurnId,
                    ...(busy && threadIdForState && threadIdForState !== current.activeThreadId ? { activeThreadId: threadIdForState } : {}),
                    messages,
                    ...(busy || current.conversation.status !== "running" ? {} : {
                        conversation: {
                            ...current.conversation,
                            status: Object.values(current.conversation.mcpStatuses || {}).some((item) => item.status === "failed" || item.status === "cancelled") ? "warning" : "ready",
                        },
                    }),
                });
                if (!busy && current.waiting) {
                    // 必须 await：并行 loadThreads 会冲掉仍在入队的 SSE 回复
                    await loadThreads(false, turnId);
                    maybePlanHandoffRef.current(turnId);
                }
            });
        });
        source.addEventListener("tool_call", (event) => {
            if (!isCurrentConnection()) return;
            const data = parseEventData<AgentPendingToolCall>(event);
            if (data) void handleToolCall(endpoint, token, data);
        });
        source.addEventListener("codex_approval", (event) => {
            if (!isCurrentConnection()) return;
            const data = parseEventData<AgentPendingApproval>(event);
            if (!data || !isTrackedThreadEvent(data, useAgentStore.getState().activeThreadId, liveTurnKeysRef.current)) return;
            const current = useAgentStore.getState();
            const turnId = data.turnId || current.activeTurnId;
            const next = isUserInputRequest(data) ? {
                ...data,
                anchorAfterId: data.itemId || lastMessageAnchorInTurn(current.messages, current.activeThreadId, turnId),
            } : data;
            setAgentState({ pendingApprovals: [...current.pendingApprovals.filter((item) => item.requestId !== data.requestId), next], activity: isUserInputRequest(data) ? rt("awaitingUserInput") : rt("awaitingApproval") });
            addEventLog(isUserInputRequest(data) ? rt("awaitingUserInput") : rt("awaitingApproval"), data.reason || data.method, data);
        });
        source.addEventListener("codex_approval_resolved", (event) => {
            if (!isCurrentConnection()) return;
            const data = parseEventData<{ requestId?: string; decision?: "accept" | "acceptForSession" | "decline" | "cancel" }>(event);
            const requestId = data?.requestId === undefined || data.requestId === null || data.requestId === "" ? "" : String(data.requestId);
            if (!requestId) return;
            const current = useAgentStore.getState();
            const approval = current.pendingApprovals.find((item) => String(item.requestId) === requestId);
            const pendingApprovals = current.pendingApprovals.filter((item) => String(item.requestId) !== requestId);
            setAgentState({ pendingApprovals, activity: approvalActivity(pendingApprovals, current.waiting, current.activity) });
            const decision = data.decision || approval?.deciding;
            if (approval && decision) addEventLog(rt(decision === "accept" || decision === "acceptForSession" ? "approvalGranted" : "approvalCanceled"), approval.reason || approval.method, approval);
        });
        source.addEventListener("agent_event", (event) => {
            const data = parseEventData<AgentEventPayload>(event);
            if (data) enqueueEvent(() => {
                if (!isTrackedThreadEvent(data, useAgentStore.getState().activeThreadId, liveTurnKeysRef.current)) return;
                const shouldProcess = registerLiveAgentTurn(data, authoritativeHistoryTurnsRef.current, liveTurnKeysRef.current);
                if (data.type !== "usage.updated" && !shouldProcess) return;
                return handleAgentEvent(data);
            });
        });
        source.addEventListener("agent_bootstrap", (event) => {
            const data = parseEventData<AgentBootstrapEvent>(event);
            if (!data?.type) return;
            if (data.type === "codex.preparing") {
                addEventLog(rt("conversationInitializing"), rt("conversationCreating"), data);
                return;
            }
            if (data.type === "codex.prepare_failed") {
                addEventLog(rt("conversationInitFailed"), data.error, data);
                return;
            }
            if (data.type === "mcp.complete") {
                addEventLog(rt("mcpStatusComplete"), rt("mcpListRead"), data);
                return;
            }
            if (!data.name || !data.status) return;
            const label = data.name;
            const status = data.status === "starting"
                ? { text: rt("mcpStarting", { name: label }), detail: rt("mcpConnecting"), status: "running" as const }
                : data.status === "ready"
                    ? { text: rt("mcpReadyNamed", { name: label }), detail: rt("toolsReady"), status: "ready" as const }
                    : data.status === "failed"
                        ? { text: rt("mcpFailedNamed", { name: label }), detail: data.error || rt("toolInitFailed"), status: "error" as const }
                        : { text: rt("mcpCanceledNamed", { name: label }), detail: rt("toolInitCanceled"), status: "error" as const };
            addEventLog(status.text, status.detail, data);
        });
        source.addEventListener("conversation_changed", (event) => {
            const data = parseEventData<AgentConversationState>(event);
            if (data && shouldApplyEngineEvent(data.threadId)) enqueueEvent(() => { applyConversationState(data); });
        });
        source.addEventListener("workspace_changed", (event) => {
            const data = parseEventData<AgentWorkspaceEvent>(event);
            if (!data) return;
            enqueueEvent(async () => {
                const nextThreadId = data.activeThreadId ?? data.threadId ?? "";
                if (!shouldApplyEngineEvent(nextThreadId || data.conversation?.threadId)) return;
                const current = useAgentStore.getState();
                const pendingMessage = [...current.messages].reverse().find((item) => item.role === "user" && !item.turnId);
                const keepPendingMessage = Boolean(data.emptyThread && pendingMessage && (current.sending || current.waiting) && (!data.sourceClientId || data.sourceClientId === clientIdRef.current));
                const pendingThreadId = pendingMessage?.threadId || current.activeThreadId;
                if (keepPendingMessage && nextThreadId) {
                    await moveAgentUserMessage(pendingThreadId, nextThreadId, pendingMessage!.clientMessageId || pendingMessage!.itemId || pendingMessage!.id).catch(() => undefined);
                }
                if (data.conversation) applyConversationState(data.conversation);
                else applyWorkspaceChange(data);
                if (!data.draftThread) void loadThreads(Boolean(data.emptyThread));
            });
        });
        source.addEventListener("chat_message", (event) => {
            const data = parseEventData<AgentChatEvent>(event);
            if (!data?.message) return;
            enqueueEvent(() => {
                if (!isTrackedThreadEvent(data, useAgentStore.getState().activeThreadId, liveTurnKeysRef.current)) return;
                if (!registerLiveAgentTurn(data, authoritativeHistoryTurnsRef.current, liveTurnKeysRef.current)) return;
                const current = useAgentStore.getState();
                const threadId = data.threadId || data.message!.threadId || current.activeThreadId;
                const turnId = data.turnId ?? data.message!.turnId ?? "";
                const clientMessageId = data.message!.clientMessageId || "";
                if (current.activeThreadId !== threadId) {
                    if (!(current.sending || current.waiting) && !liveTurnKeysRef.current.has(`${threadId}\0`) && ![...liveTurnKeysRef.current].some((key) => key.startsWith(`${threadId}\0`))) return;
                    setAgentState({ activeThreadId: threadId });
                }
                if (data.message!.role === "user") {
                    // 必须按 clientMessageId 合并：换线程时 threadId 不同，旧逻辑会留下本地一条 + SSE 一条
                    setAgentState({
                        messages: upsertUserChatMessage(current.messages, {
                            ...data.message!,
                            clientMessageId: clientMessageId || data.message!.id,
                            threadId,
                            turnId,
                        }),
                    });
                    if (clientMessageId) void bindPendingAgentUserMessage(threadId, clientMessageId, turnId).catch(() => undefined);
                    if (clientMessageId && !data.message!.attachments?.length) {
                        void readAgentUserMessages(threadId).then((storedMessages) => {
                            const stored = storedMessages.find((item) => item.id === clientMessageId || Boolean(turnId && item.turnId === turnId));
                            const latest = useAgentStore.getState();
                            if (!stored || latest.activeThreadId !== threadId) return;
                            if (!latest.messages.some((item) => item.clientMessageId === clientMessageId)) return;
                            setAgentState({
                                messages: upsertUserChatMessage(latest.messages, {
                                    ...data.message!,
                                    clientMessageId,
                                    threadId,
                                    turnId,
                                    text: stored.text,
                                    historyText: stored.historyText,
                                    attachments: stored.attachments,
                                }),
                            });
                        }).catch(() => undefined);
                    }
                    return;
                }
                const next = scopeChatItem(data.message!, threadId, turnId);
                setAgentState({ messages: upsertAgentMessage(current.messages, next) });
            });
        });
        source.addEventListener("agent_log", (event) => {
            if (!isCurrentConnection()) return;
            const text = parseEventData<{ text?: unknown }>(event)?.text;
            addEventLog(rt("log"), text, text);
        });
        source.addEventListener("codex_auth_expired", (event) => {
            if (!isCurrentConnection()) return;
            const text = String(parseEventData<{ message?: unknown }>(event)?.message || rt("codexAuthExpired"));
            setAgentState({ codexAuthExpired: true });
            addEventLog(rt("codexAuthExpired"), text, text);
            if (!headless) message.error(text);
        });
        source.addEventListener("skills_changed", (event) => {
            if (!isCurrentConnection()) return;
            if (useAgentStore.getState().collaborationMode === "chat" && !useAgentSkillStore.getState().loaded) return;
            const data = parseEventData<{ forceReload?: boolean }>(event);
            void loadSkills(endpoint, token, Boolean(data?.forceReload));
        });
        source.addEventListener("agent_error", (event) => {
            const data = parseEventData<AgentEventPayload>(event);
            if (!data) return;
            enqueueEvent(() => {
                if (!isTrackedThreadEvent(data, useAgentStore.getState().activeThreadId, liveTurnKeysRef.current)) return;
                if (!registerLiveAgentTurn(data, authoritativeHistoryTurnsRef.current, liveTurnKeysRef.current)) return;
                showAgentError(data.message, data, !data.replayed);
            });
        });
        source.onerror = () => {
            if (disposed || protocolRejected) return;
            window.clearTimeout(connectionTimer);
            const wasConnected = connectedRef.current;
            const silent = useAgentStore.getState().silentConnect && !wasConnected;
            const text = rt(wasConnected ? "connectionLostDescription" : "connectionFailedDescription");
            if (!errorLoggedRef.current || wasConnected) {
                addEventLog(rt(wasConnected ? "connectionLost" : "connectionFailed"), text);
                if (!headless && !silent) message.error(text);
            }
            errorLoggedRef.current = true;
            connectedRef.current = false;
            pendingToolRef.current = null;
            setAgentState({
                activity: rt(wasConnected ? "connectionLost" : "connectionFailed"),
                connected: false,
                waiting: false,
                sending: false,
                connectError: silent ? "" : text,
                silentConnect: false,
                pendingTool: null,
                pendingApprovals: [],
            });
            useAgentSkillStore.getState().reset();
            if (!wasConnected) {
                disposed = true;
                source.close();
                setAgentState({ enabled: false });
            }
        };
        return () => {
            disposed = true;
            window.clearTimeout(connectionTimer);
            source.close();
            connectedRef.current = false;
            loadThreadsSequenceRef.current += 1;
            useAgentSkillStore.getState().reset();
        };
    }, [agentProvider, applyConversationState, applyWorkspaceChange, clientReady, connectionAttempt, enabled, endpoint, loadSkills, loadThreads, message, setAgentState, token]);

    useEffect(() => {
        if (connected) void loadThreads();
    }, [connected, loadThreads]);

    useEffect(() => {
        if (connected && (collaborationMode !== "chat" || activeTab === "skills")) void loadSkills(endpoint, token);
    }, [connected, endpoint, loadSkills, token, agentProvider, collaborationMode, activeTab]);

    useEffect(() => {
        if (!connected || currentProvider() === "cursor") return;
        void fetchAgentJson<AgentModelsResponse>(endpoint, token, "/agent/codex/models").then(({ data = [] }) => {
            const names = new Set<string>();
            const models = data.flatMap((item) => {
                const name = item.displayName || item.model;
                const efforts = item.supportedReasoningEfforts.filter(({ reasoningEffort }) => AGENT_REASONING_EFFORTS.has(reasoningEffort));
                if (item.model === "codex-auto-review" || names.has(name) || !efforts.length) return [];
                names.add(name);
                const defaultReasoningEffort: AgentReasoningEffort = efforts.some((effort) => effort.reasoningEffort === item.defaultReasoningEffort)
                    ? item.defaultReasoningEffort
                    : efforts[0].reasoningEffort;
                return [{ ...item, supportedReasoningEfforts: efforts, defaultReasoningEffort }];
            });
            if (!models.length) return;
            const savedModel = useAgentStore.getState().model;
            const current = models.find((item) => item.model === savedModel) || models.find((item) => item.isDefault) || models[0];
            const savedEffort = useAgentStore.getState().reasoningEffort;
            const efforts = current.supportedReasoningEfforts.map((item) => item.reasoningEffort);
            const nextEffort = efforts.includes(savedEffort as AgentReasoningEffort)
                ? savedEffort as AgentReasoningEffort
                : (current.defaultReasoningEffort || efforts[0]);
            localStorage.setItem("canvas-agent-model", current.model);
            localStorage.setItem("canvas-agent-reasoning-effort", nextEffort);
            setAgentState({ models, model: current.model, reasoningEffort: nextEffort });
        }).catch((error) => addEventLog(rt("modelListFailed"), error));
    }, [connected, endpoint, setAgentState, token]);

    useEffect(() => {
        if (!connected) return;
        const activate = () => void activateAgentClient(endpoint, token, clientIdRef.current);
        const activateVisible = () => {
            if (document.visibilityState === "visible") activate();
        };
        window.addEventListener("focus", activate);
        document.addEventListener("visibilitychange", activateVisible);
        return () => {
            window.removeEventListener("focus", activate);
            document.removeEventListener("visibilitychange", activateVisible);
        };
    }, [connected, endpoint, token]);

    // Codex 生图节点排队任务：每条任务独占一条 Codex 线程，可与其它节点并发
    useEffect(() => {
        const failOfflineJobs = () => {
            liveCodexImageJobs().forEach((job) => useCodexImageJobStore.getState().fail(i18n.t("canvas.codexImage.agentRequired"), job.id));
        };

        // 未连接时：立刻失败掉排队/运行中的任务，避免节点一直假转圈
        if (!connected || !clientReady) {
            failOfflineJobs();
            return useCodexImageJobStore.subscribe((state) => {
                if (state.jobs.some((job) => job.status === "queued")) failOfflineJobs();
            });
        }

        const launch = () => {
            const params = { endpoint, token, clientId: clientIdRef.current, permissionMode, model, reasoningEffort };
            liveCodexImageJobs().filter((job) => job.status === "queued").forEach((job) => void runQueuedCodexImageJob(job.id, params));
        };
        const unsub = useCodexImageJobStore.subscribe((state, prev) => {
            if (state.jobs.some((job) => job.status === "queued" && !prev.jobs.some((item) => item.id === job.id))) launch();
        });
        launch();
        return unsub;
    }, [clientReady, connected, endpoint, model, permissionMode, reasoningEffort, token]);

    // Codex 文本/智能体节点排队任务：同样独占线程并发执行
    useEffect(() => {
        const failOfflineJobs = () => {
            liveCodexTextJobs().forEach((job) => useCodexTextJobStore.getState().fail(i18n.t("canvas.codexText.agentRequired"), job.id));
        };
        if (!connected || !clientReady) {
            failOfflineJobs();
            return useCodexTextJobStore.subscribe((state) => {
                if (state.jobs.some((job) => job.status === "queued")) failOfflineJobs();
            });
        }
        const launch = () => {
            const params = { endpoint, token, clientId: clientIdRef.current, permissionMode, model, reasoningEffort };
            liveCodexTextJobs().filter((job) => job.status === "queued").forEach((job) => void runQueuedCodexTextJob(job.id, params));
        };
        const unsub = useCodexTextJobStore.subscribe((state, prev) => {
            if (state.jobs.some((job) => job.status === "queued" && !prev.jobs.some((item) => item.id === job.id))) launch();
        });
        launch();
        return unsub;
    }, [clientReady, connected, endpoint, model, permissionMode, reasoningEffort, token]);

    const rewindFromTurn = async (target: AgentChatItem, options?: { silent?: boolean }) => {
        const current = useAgentStore.getState();
        if (!current.connected || target.role !== "user") return false;
        if ((current.sending || current.waiting) && target.turnId && target.turnId === current.activeTurnId) return false;
        const start = current.messages.findIndex((item) => item.id === target.id);
        if (start < 0) return false;
        const threadId = target.threadId || current.activeThreadId;
        const removed = current.messages.slice(start);
        const nextMessages = current.messages.slice(0, start);
        const removedUserIds = removed.filter((item) => item.role === "user").map((item) => item.id);
        const turnIds = uniqueTurnIds(removed);
        const removedTurnIds = new Set(turnIds);
        if (threadId) threadMessagesRef.current.set(threadId, nextMessages);
        setAgentState({
            messages: nextMessages,
            pendingApprovals: current.pendingApprovals.filter((item) => !item.turnId || !removedTurnIds.has(item.turnId)),
            pendingTool: current.activeTurnId && removedTurnIds.has(current.activeTurnId) ? null : current.pendingTool,
        });
        try {
            for (const turnId of turnIds) {
                if (threadId) await deleteCodexTurn(endpoint, token, threadId, turnId);
            }
            if (threadId) await deleteAgentTurnMessages(threadId, { messageIds: removed.map((item) => item.id) }).catch(() => undefined);
            await Promise.all(removedUserIds.map((id) => deletePendingAgentUserMessage(id).catch(() => undefined)));
            if (!options?.silent) message.success(rt("turnDeleted"));
            return true;
        } catch (error) {
            addEventLog(rt("deleteTurnFailed"), error);
            message.error(error instanceof Error ? error.message : rt("deleteTurnFailed"));
            await loadThreads();
            return false;
        }
    };

    /** Cursor 不能 fork：开一条新空会话，只保留被编辑提问之前的界面消息。 */
    const branchCursorBeforeTurn = async (target: AgentChatItem) => {
        const current = useAgentStore.getState();
        const start = current.messages.findIndex((item) => item.id === target.id);
        if (start < 0) return false;
        const kept = current.messages.slice(0, start);
        try {
            const result = await fetchAgentJson<AgentWorkspaceResponse & { thread?: { id?: string } }>(endpoint, token, engineApi("/threads/reset"), {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ clientId: clientIdRef.current, permissionMode, collaborationMode: useAgentStore.getState().collaborationMode }),
            });
            if (result.conversation) applyConversationState(result.conversation, true);
            const nextThreadId = result.thread?.id || result.workspace?.activeThreadId || result.conversation?.threadId || "";
            if (!nextThreadId) throw new Error(rt("editTurnResendFailed"));
            applyWorkspaceChange({
                ...(result.workspace || {}),
                activeThreadId: nextThreadId,
                emptyThread: true,
                sourceClientId: clientIdRef.current,
            });
            const scoped = kept.map((item) => scopeChatItem({ ...item } as AgentChatItem, nextThreadId, item.turnId || ""));
            threadMessagesRef.current.set(nextThreadId, scoped);
            setAgentState({
                messages: scoped,
                activeThreadId: nextThreadId,
                activeTurnId: "",
                pendingApprovals: [],
                pendingTool: null,
                tokenUsage: null,
            });
            return true;
        } catch (error) {
            addEventLog(rt("editTurnResendFailed"), error);
            message.error(error instanceof Error ? error.message : rt("editTurnResendFailed"));
            await loadThreads();
            return false;
        }
    };

    /** 编辑重发：fork 截断模型上下文；仅 hide 回合无法让模型忘记已答内容。 */
    const branchBeforeTurn = async (target: AgentChatItem) => {
        const current = useAgentStore.getState();
        if (!current.connected || target.role !== "user") return false;
        if (current.agentProvider === "cursor") return branchCursorBeforeTurn(target);
        const start = current.messages.findIndex((item) => item.id === target.id);
        if (start < 0) return false;
        const sourceThreadId = target.threadId || current.activeThreadId;
        if (!sourceThreadId) return false;
        const kept = current.messages.slice(0, start);
        const lastKeepTurnId = lastSettledTurnId(kept);
        try {
            if (!lastKeepTurnId) {
                const result = await fetchAgentJson<{
                    workspace?: { activeThreadId?: string };
                    conversation?: AgentConversationState;
                    thread?: { id?: string };
                }>(endpoint, token, "/agent/codex/threads/new", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ clientId: clientIdRef.current, permissionMode, collaborationMode: useAgentStore.getState().collaborationMode }),
                });
                if (result.conversation) applyConversationState(result.conversation);
                const nextThreadId = result.thread?.id || result.workspace?.activeThreadId || result.conversation?.threadId || "";
                if (result.workspace || nextThreadId) {
                    applyWorkspaceChange({
                        ...(result.workspace || {}),
                        activeThreadId: nextThreadId,
                        emptyThread: true,
                        sourceClientId: clientIdRef.current,
                    });
                }
                threadMessagesRef.current.set(nextThreadId || sourceThreadId, []);
                setAgentState({
                    messages: [],
                    activeThreadId: nextThreadId || useAgentStore.getState().activeThreadId,
                    activeTurnId: "",
                    pendingApprovals: [],
                    pendingTool: null,
                    tokenUsage: null,
                });
                return true;
            }
            const result = await forkCodexThread(endpoint, token, sourceThreadId, {
                lastTurnId: lastKeepTurnId,
                clientId: clientIdRef.current,
                permissionMode,
            });
            if (result.conversation) applyConversationState(result.conversation as AgentConversationState);
            const nextThreadId = result.thread?.id || result.workspace?.activeThreadId || result.conversation?.threadId || "";
            if (!nextThreadId) throw new Error(rt("editTurnResendFailed"));
            if (result.workspace || nextThreadId) {
                applyWorkspaceChange({
                    ...(result.workspace || {}),
                    activeThreadId: nextThreadId,
                    sourceClientId: clientIdRef.current,
                });
            }
            const snapshotMessages = Array.isArray(result.messages)
                ? (result.messages as AgentChatItem[]).map((item) => scopeChatItem(item, nextThreadId, item.turnId || ""))
                // fallback 也必须经 scopeChatItem 重标 id，否则旧 threadId:turnId:itemId 挂到新线程，快照合并对不齐会重复/丢失
                : kept.map((item) => scopeChatItem({ ...item } as AgentChatItem, nextThreadId, item.turnId || ""));
            threadMessagesRef.current.set(nextThreadId, snapshotMessages);
            setAgentState({
                messages: snapshotMessages,
                activeThreadId: nextThreadId,
                activeTurnId: "",
                pendingApprovals: [],
                pendingTool: null,
                tokenUsage: null,
            });
            return true;
        } catch (error) {
            addEventLog(rt("editTurnResendFailed"), error);
            message.error(error instanceof Error ? error.message : rt("editTurnResendFailed"));
            await loadThreads();
            return false;
        }
    };

    const cancelEditTurn = () => {
        editingTurnRef.current = null;
        setEditingTurn(null);
    };

    const beginEditTurn = (item: AgentChatItem) => {
        const current = useAgentStore.getState();
        if (!current.connected || item.role !== "user") return;
        if ((current.sending || current.waiting) && item.turnId && item.turnId === current.activeTurnId) return;
        editingTurnRef.current = item;
        setEditingTurn(item);
        setAgentState({ activeTab: "chat" });
    };

    const submitEditedTurn = async (item: AgentChatItem, text: string, attachmentIds: string[] = []) => {
        const current = useAgentStore.getState();
        if (!current.connected || item.role !== "user") return;
        if ((current.sending || current.waiting) && item.turnId && item.turnId === current.activeTurnId) return;
        const kept = new Set(attachmentIds);
        const files = composerAttachmentsFromHistory(item).filter((file) => kept.has(file.id));
        editingTurnRef.current = item;
        setEditingTurn(item);
        await sendPrompt({ text: text.trim(), attachments: files });
    };

    useEffect(() => {
        editingTurnRef.current = null;
        setEditingTurn(null);
    }, [activeThreadId]);

    const sendPrompt = async (override?: { text: string; attachments?: AgentAttachment[]; collaborationMode?: AgentCollaborationMode }) => {
        const composerPrompt = prompt;
        const composerAttachments = attachments;
        const draftPrompt = override?.text ?? composerPrompt;
        const draftAttachments = override
            ? (override.attachments || [])
            : composerAttachments;
        const skillState = useAgentSkillStore.getState();
        const selectedSkill = skillState.selectedSkill;
        const selectedSkillRevision = skillState.selectionRevision;
        const filesFromPrompt = orderedAttachmentsFromPrompt(draftPrompt, draftAttachments).map(withCanvasNodeId);
        const files = override && "attachments" in override && !filesFromPrompt.length
            ? (override.attachments || []).map(withCanvasNodeId)
            : filesFromPrompt;
        const imageFiles = files.filter(isImageAgentAttachment);
        const contextText = expandComposerContext(files);
        const typedText = stripComposerFileTokens(draftPrompt);
        // 对话气泡只显示用户输入；路径/源码上下文只进入发给模型的 requestPrompt
        const userText = typedText || (imageFiles.length ? rt("imagesSent", { count: imageFiles.length }) : files.length ? rt("contextSent", { count: files.length }) : "");
        const requestPrompt = [typedText, contextText].filter(Boolean).join("\n\n") || promptWithAttachments("", imageFiles);
        const currentState = useAgentStore.getState();
        const mode = override?.collaborationMode ?? currentState.collaborationMode;
        const editingDraft = editingTurnRef.current;
        if (!currentState.connected || !requestPrompt || currentState.sending || currentState.waiting || currentState.loadingThreads) return false;
        if (!editingDraft && !(["ready", "warning", "running"].includes(currentState.conversation.status))) return false;
        if (attachmentPayloadBytes(imageFiles) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
            addMessage({ role: "error", title: rt("imageTooLarge"), text: rt("imagePayloadTooLarge") });
            return false;
        }
        const editing = editingDraft;
        if (editing && !override?.collaborationMode) {
            // fork 期间必须置 sending 锁：否则等待返回时再点发送会并行两次 fork，线程与消息错乱
            setAgentState({ sending: true, activity: rt("sending") });
            const branched = await branchBeforeTurn(editing);
            if (!branched) {
                setAgentState({ sending: false, activity: rt("editTurnResendFailed") });
                return false;
            }
            editingTurnRef.current = null;
            setEditingTurn(null);
            // fork 后会话常仍在 preparing；持锁等到 ready 再发 turn，避免 409
            const forkReady = await (async () => {
                const started = Date.now();
                while (Date.now() - started < 20000) {
                    const state = useAgentStore.getState();
                    if (!state.connected) return false;
                    if (!state.waiting && !state.loadingThreads && ["ready", "warning"].includes(state.conversation.status)) return true;
                    await new Promise((resolve) => window.setTimeout(resolve, 150));
                }
                return false;
            })();
            if (!forkReady) {
                setAgentState({ sending: false, activity: rt("editTurnResendFailed") });
                message.error(rt("editTurnResendFailed"));
                return false;
            }
        }
        const messageId = createId();
        loadThreadsSequenceRef.current += 1;
        const currentBeforeSend = useAgentStore.getState();
        const requestThreadId = currentBeforeSend.activeThreadId;
        setAgentState({
            prompt: "",
            attachments: [],
            activity: rt("sending"),
            sending: true,
            loadingThreads: false,
            activeTurnId: "",
            messages: currentBeforeSend.messages,
        });
        addMessage({ id: messageId, itemId: "synthetic:user", clientMessageId: messageId, threadId: requestThreadId, turnId: "", role: "user", text: userText, historyText: requestPrompt, attachments: files });
        let threadId = requestThreadId;
        try {
            if (files.length) await savePendingAgentUserMessage({ id: messageId, role: "user", text: userText, historyText: requestPrompt, attachments: files });
            const selectedModel = models.find((item) => item.model === model);
            const supportedEfforts = selectedModel?.supportedReasoningEfforts.map((item) => item.reasoningEffort) ?? [];
            const requestEffort = supportedEfforts.includes(reasoningEffort as AgentReasoningEffort)
                ? reasoningEffort
                : (selectedModel?.defaultReasoningEffort && supportedEfforts.includes(selectedModel.defaultReasoningEffort)
                    ? selectedModel.defaultReasoningEffort
                    : supportedEfforts[0] || (reasoningEffort === "none" ? "" : reasoningEffort));
            const modelName = selectedModel?.displayName || model || rt("defaultModel");
            const effortName = requestEffort ? i18n.t(`agent.composer.effort.${requestEffort}`) : rt("defaultEffort");
            addEventLog(rt("sendTask"), `${modelName} · ${effortName}${selectedSkill ? ` · Skill ${selectedSkill.name}` : ""}${files.length ? ` · ${rt("attachmentCount", { count: files.length })}` : ""} · ${compactText(typedText) || rt("attachmentsOnly")}`);
            // fork 后 revision/conversationId 可能已变，必须以最新会话状态提交
            const latestConversation = useAgentStore.getState().conversation;
            const accepted = await fetchAgentJson<AgentTurnResponse>(endpoint, token, engineApi("/turn"), {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    prompt: requestPrompt,
                    messageText: userText,
                    messageId,
                    clientId: clientIdRef.current,
                    threadId: useAgentStore.getState().activeThreadId || threadId,
                    conversationId: latestConversation.conversationId,
                    expectedRevision: latestConversation.revision,
                    permissionMode,
                    collaborationMode: mode,
                    model,
                    effort: requestEffort,
                    skill: !selectedSkill ? undefined : { name: selectedSkill.name, path: selectedSkill.path },
                    ...(currentProvider() === "cursor" ? { apiKey: useAgentStore.getState().cursorApiKey.trim() } : {}),
                    attachments: imageFiles.map(({ id, name, type, size, width, height, dataUrl, canvasNodeId }) => ({ id, name, type, size, width, height, dataUrl, ...(canvasNodeId ? { canvasNodeId } : {}) })),
                }),
            });
            threadId = accepted.threadId || threadId;
            if (!threadId) throw new Error(rt("startConversationFailed"));
            if (threadId !== useAgentStore.getState().activeThreadId) setAgentState({ activeThreadId: threadId });
            if (selectedSkill) clearSkillSelection(selectedSkillRevision);
            if (files.length) {
                const latestMessage = useAgentStore.getState().messages.find((item) => item.clientMessageId === messageId);
                const acceptedThreadId = latestMessage?.threadId || threadId;
                await bindPendingAgentUserMessage(acceptedThreadId, messageId, latestMessage?.turnId || "").catch((error) => addEventLog(rt("attachmentHistoryFailed"), error));
            }
            files.forEach((item) => revokeOwnedAttachmentUrl(item.url));
            return true;
        } catch (error) {
            if (files.length) await deletePendingAgentUserMessage(messageId).catch(() => undefined);
            const text = error instanceof Error ? error.message : rt("sendFailed");
            const response = error instanceof AgentApiError ? error.response as { code?: string; state?: AgentConversationState } : undefined;
            if (response?.state) applyConversationState(response.state);
            const stale = response?.code === "CONVERSATION_STALE";
            const busy = response?.code === "CONVERSATION_BUSY" || text.includes("Codex 正在运行");
            const state = useAgentStore.getState();
            const removeFailedPending = (messages: AgentChatItem[]) => messages.filter((item) => item.clientMessageId !== messageId || Boolean(item.turnId));
            threadMessagesRef.current.forEach((messages, cachedThreadId) => {
                const next = removeFailedPending(messages);
                if (next.length !== messages.length) threadMessagesRef.current.set(cachedThreadId, next);
            });
            const ownsCurrentThread = state.activeThreadId === (threadId || requestThreadId);
            const restoreDraft = state.prompt || state.attachments.length ? {} : { prompt: composerPrompt, attachments: composerAttachments };
            if (ownsCurrentThread) {
                setAgentState({
                    activity: rt(stale ? "conversationSynced" : busy ? "codexRunning" : "sendFailed"),
                    sending: false,
                    messages: removeFailedPending(state.messages),
                    ...restoreDraft,
                });
                addMessage({ threadId: state.activeThreadId, turnId: "", role: "error", title: rt(stale ? "conversationSynced" : busy ? "taskStillRunning" : "sendFailed"), text });
            } else {
                setAgentState({ sending: false, messages: removeFailedPending(state.messages), ...restoreDraft });
            }
            addEventLog(rt("sendFailed"), error);
            return false;
        }
    };

    const stopTurn = async () => {
        const current = useAgentStore.getState();
        if (!current.connected || (!current.sending && !current.waiting)) return;
        setAgentState({ activity: rt("stopping") });
        let timedOut = false;
        try {
            await Promise.race([
                interruptAgentTurn(endpoint, token, current.activeThreadId || undefined, current.agentProvider),
                new Promise<never>((_, reject) => window.setTimeout(() => {
                    timedOut = true;
                    reject(new Error("interrupt-timeout"));
                }, 4000)),
            ]);
            addEventLog(rt("stopTask"), rt("taskStopped"));
        } catch (error) {
            if (timedOut) {
                addEventLog(rt("stopTask"), "interrupt timeout");
                return;
            }
            setAgentState({ activity: rt("stopFailed") });
            addEventLog(rt("stopFailed"), error);
        }
    };

    const addAttachments = async (files: FileList | File[] | null) => {
        if (!files) return;
        const list = Array.from(files);
        const images = list.filter(isComposerImageFile);
        const texts = list.filter((file) => !isComposerImageFile(file) && isComposerTextFile(file));
        const others = list.filter((file) => !isComposerImageFile(file) && !isComposerTextFile(file));
        const prev = useAgentStore.getState().attachments;
        try {
            const next = await Promise.all(
                images.slice(0, Math.max(0, MAX_ATTACHMENTS - prev.length)).map(async (file) => {
                    const dataUrl = await readDataUrl(file);
                    const meta = await readImageMeta(dataUrl);
                    const url = URL.createObjectURL(file);
                    attachmentUrlsRef.current.add(url);
                    const type = file.type || `image/${(file.name.split(".").pop() || "png").toLowerCase()}`;
                    return { id: createId(), name: file.name, type, size: file.size, width: meta.width, height: meta.height, url, dataUrl };
                }),
            );
            const merged = [...prev, ...next];
            if (attachmentPayloadBytes(merged) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
                next.forEach((item) => revokeOwnedAttachmentUrl(item.url));
                addMessage({ role: "error", title: rt("imageTooLarge"), text: rt("imageLimit") });
                return;
            }
            let nextPrompt = useAgentStore.getState().prompt;
            if (next.length) {
                for (const item of next) nextPrompt = appendComposerFile(nextPrompt, item.id);
            }
            if (texts.length) {
                const chunk = await formatDroppedTextFiles(texts);
                nextPrompt = nextPrompt ? `${nextPrompt}\n\n${chunk}` : chunk;
            }
            if (others.length) {
                const chunk = formatDroppedLocalPaths(others);
                nextPrompt = nextPrompt ? `${nextPrompt}\n\n${chunk}` : chunk;
            }
            if (next.length || texts.length || others.length) {
                setAgentState({ attachments: merged, prompt: nextPrompt });
            }
            if (texts.length) message.success(t("agent.composer.dropTextAdded", { count: texts.length }));
            if (others.length && !next.length && !texts.length) message.info(t("agent.composer.dropPathAdded", { count: others.length }));
            if (!next.length && !texts.length && !others.length) message.warning(t("agent.composer.dropUnsupported"));
        } catch (error) {
            addMessage({ role: "error", title: rt("imageReadFailed"), text: error instanceof Error ? error.message : rt("imageReadFailed") });
        }
    };

    const removeAttachment = (id: string) => {
        const removed = attachments.find((item) => item.id === id);
        if (removed) revokeOwnedAttachmentUrl(removed.url);
        const state = useAgentStore.getState();
        setAgentState({
            attachments: state.attachments.filter((item) => item.id !== id),
            prompt: removeComposerFileToken(state.prompt, id),
        });
    };

    const addFromCanvas = async () => {
        const snapshot = canvasContextRef.current?.snapshot;
        if (!snapshot) {
            message.warning(t("agent.composer.noCanvas"));
            return;
        }
        if (!snapshot.selectedNodeIds.length) {
            message.warning(t("agent.composer.noCanvasSelection"));
            return;
        }
        const result = await applyCanvasNodesToComposer(snapshot.selectedNodeIds, { nodes: snapshot.nodes });
        if (result.ok) {
            message.success(t("agent.composer.canvasSelectionAdded", { count: result.count }));
            return;
        }
        if (result.reason === "empty") message.warning(t("agent.composer.canvasSelectionEmpty"));
        else if (result.reason === "too-large") message.warning(t("agent.composer.imageLimit"));
        else if (result.reason === "error") message.error(t("agent.composer.canvasSelectionFailed"));
        else message.warning(t("agent.composer.noCanvas"));
    };

    const handleToolCall = async (endpoint: string, token: string, payload: AgentPendingToolCall) => {
        if (confirmToolsRef.current && isCanvasWriteTool(payload.name)) {
            if (pendingToolRef.current) {
                await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, error: rt("pendingCanvasTool") });
                return;
            }
            pendingToolRef.current = payload;
            setAgentState({ pendingTool: payload });
            addEventLog(rt("awaitingConfirmation"), payload, payload);
            return;
        }
        await runToolCall(endpoint, token, payload);
    };

    const runToolCall = async (endpoint: string, token: string, payload: AgentPendingToolCall) => {
        if (isSiteTool(payload.name)) {
            try {
                addEventLog(toolName(payload.name), payload, payload);
                const result = await runSiteTool(payload.name, payload.input || {}, navigate, { canvasSnapshot: canvasContextRef.current?.snapshot || null });
                await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, result });
                addEventLog(rt("toolCompleted", { tool: toolName(payload.name) }), result, result);
            } catch (error) {
                const message = error instanceof Error ? error.message : rt("toolExecutionFailed");
                await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, error: message });
            }
            return;
        }
        try {
            const input: { ops?: CanvasAgentOp[]; path?: string } = payload.input || {};
            addEventLog(toolName(payload.name), payload, payload);
            let result: unknown;
            let appliedOps = input.ops || [];
            if (payload.name === "site_navigate") {
                const path = input.path || "/";
                navigate(path);
                result = { ok: true, path };
            } else if (payload.name === "canvas_apply_ops") {
                const context = canvasContextRef.current;
                if (!context) throw new Error(rt("openCanvasFirst"));
                result = context.applyOps(appliedOps);
                void postState(endpoint, token, clientIdRef.current, result as CanvasAgentSnapshot);
            } else if (payload.name === "canvas_create_attachment_nodes") {
                const context = canvasContextRef.current;
                if (!context) throw new Error(rt("openCanvasFirst"));
                appliedOps = await attachmentNodeOps(endpoint, token, clientIdRef.current, payload.input?.nodes);
                result = context.applyOps(appliedOps);
                await postState(endpoint, token, clientIdRef.current, result as CanvasAgentSnapshot);
            } else {
                const snapshot = canvasContextRef.current?.snapshot;
                if (!snapshot) throw new Error(rt("openCanvasFirst"));
                result = snapshot;
            }
            await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, result });
            addEventLog(rt("toolCompleted", { tool: toolName(payload.name) }), result, result);
        } catch (error) {
            const message = error instanceof Error ? error.message : rt("canvasOperationFailed");
            await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, error: message });
        }
    };

    const rejectPendingTool = async () => {
        if (!pendingTool) return;
        await postToolResult(endpoint, token, clientIdRef.current, { requestId: pendingTool.requestId, error: rt("canvasToolCanceled") });
        pendingToolRef.current = null;
        setAgentState({ pendingTool: null });
    };

    const approvePendingTool = async () => {
        if (!pendingTool) return;
        const tool = pendingTool;
        pendingToolRef.current = null;
        setAgentState({ pendingTool: null });
        await runToolCall(endpoint, token, tool);
    };

    const decideApproval = async (approval: AgentPendingApproval, decision: "accept" | "acceptForSession" | "decline") => {
        const current = useAgentStore.getState();
        const pending = current.pendingApprovals.find((item) => item.requestId === approval.requestId);
        if (!pending || pending.deciding) return;
        setAgentState({ pendingApprovals: current.pendingApprovals.map((item) => item.requestId === approval.requestId ? { ...item, deciding: decision } : item), activity: rt("submittingApproval") });
        try {
            await postAgentApproval(endpoint, token, approval.requestId, decision, currentProvider());
            const latest = useAgentStore.getState();
            if (latest.pendingApprovals.some((item) => item.requestId === approval.requestId)) setAgentState({ activity: rt("waitingCodexApproval") });
        } catch (error) {
            const latest = useAgentStore.getState();
            const expired = error instanceof Error && error.message.includes("审批请求已失效");
            const resolved = expired || !latest.pendingApprovals.some((item) => item.requestId === approval.requestId);
            const pendingApprovals = resolved
                ? latest.pendingApprovals.filter((item) => item.requestId !== approval.requestId)
                : latest.pendingApprovals.map((item) => item.requestId === approval.requestId ? { ...item, deciding: undefined } : item);
            setAgentState({ pendingApprovals, activity: approvalActivity(pendingApprovals, latest.waiting, latest.activity) });
            if (resolved) return;
            addEventLog(rt("approvalFailed"), error);
            message.error(error instanceof Error ? error.message : rt("approvalFailed"));
        }
    };

    const decideUserInput = async (approval: AgentPendingApproval, answers: Record<string, string[]>) => {
        const current = useAgentStore.getState();
        const pending = current.pendingApprovals.find((item) => item.requestId === approval.requestId);
        if (!pending || pending.deciding) return;
        setAgentState({ pendingApprovals: current.pendingApprovals.map((item) => item.requestId === approval.requestId ? { ...item, deciding: "accept" } : item), activity: rt("submittingUserInput") });
        try {
            await postAgentUserInput(endpoint, token, approval.requestId, answers, currentProvider());
            const latest = useAgentStore.getState();
            if (latest.pendingApprovals.some((item) => item.requestId === approval.requestId)) setAgentState({ activity: rt("waitingCodexUserInput") });
        } catch (error) {
            const latest = useAgentStore.getState();
            const expired = error instanceof Error && (error.message.includes("问答请求已失效") || error.message.includes("审批请求已失效"));
            const resolved = expired || !latest.pendingApprovals.some((item) => item.requestId === approval.requestId);
            const pendingApprovals = resolved
                ? latest.pendingApprovals.filter((item) => item.requestId !== approval.requestId)
                : latest.pendingApprovals.map((item) => item.requestId === approval.requestId ? { ...item, deciding: undefined } : item);
            setAgentState({ pendingApprovals, activity: approvalActivity(pendingApprovals, latest.waiting, latest.activity) });
            if (resolved) return;
            addEventLog(rt("userInputFailed"), error);
            message.error(error instanceof Error ? error.message : rt("userInputFailed"));
        }
    };

    const answersWantPlan = (answers: Record<string, string[]>) =>
        Object.values(answers).flat().some((value) => /^(是|yes)$/i.test(String(value).trim()) || /切换到规划|用规划/.test(String(value)));

    const turnIsBusy = () => {
        const current = useAgentStore.getState();
        return current.sending || current.waiting || current.conversation.status === "running" || current.conversation.status === "preparing";
    };

    const waitUntilTurnIdle = async (timeoutMs = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs && turnIsBusy()) {
            await new Promise((resolve) => window.setTimeout(resolve, 100));
        }
        return !turnIsBusy();
    };

    const waitUntilCanSendPrompt = async (timeoutMs = 20000) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const current = useAgentStore.getState();
            if (
                current.connected
                && !current.sending
                && !current.waiting
                && !current.loadingThreads
                && ["ready", "warning"].includes(current.conversation.status)
            ) return true;
            await new Promise((resolve) => window.setTimeout(resolve, 150));
        }
        return false;
    };

    const switchToPlanAndContinue = async (approval: AgentPendingApproval, answers: Record<string, string[]>) => {
        changeCollaborationMode("plan");
        if (!headless) message.success(t("agent.panel.planSwitchedToPlan"));
        // 先提交「是」，再中断。问答未答完时 interrupt 会一直挂起，按钮转圈停住。
        await decideUserInput(approval, answers);
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        for (let attempt = 0; attempt < 3; attempt += 1) {
            await stopTurn();
            if (await waitUntilTurnIdle(10000)) break;
        }
        // interrupt 超时或事件滞后时，先清本地忙态，再等会话真正可发
        if (turnIsBusy()) {
            const current = useAgentStore.getState();
            setAgentState({
                sending: false,
                waiting: false,
                conversation: current.conversation.status === "running"
                    ? { ...current.conversation, status: "ready" }
                    : current.conversation,
            });
        }
        const ready = await waitUntilCanSendPrompt(20000);
        if (!ready) {
            addEventLog(rt("planContinueFailed"), rt("taskStillRunning"));
            if (!headless) message.error(rt("planContinueFailed"));
            return;
        }
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const sent = await sendPrompt({ text: t("agent.panel.planContinueTaskPrompt"), collaborationMode: "plan" });
            if (sent) return;
            await new Promise((resolve) => window.setTimeout(resolve, 800));
            if (await waitUntilCanSendPrompt(8000)) continue;
            break;
        }
        addEventLog(rt("planContinueFailed"), rt("sendFailed"));
        if (!headless) message.error(rt("planContinueFailed"));
    };

    const submitUserInput = async (approval: AgentPendingApproval, answers: Record<string, string[]>) => {
        if (useAgentStore.getState().collaborationMode !== "plan" && isPlanSwitchAsk(approval) && answersWantPlan(answers)) {
            await switchToPlanAndContinue(approval, answers);
            return;
        }
        await decideUserInput(approval, answers);
    };

    const archiveUserInput = (record: AgentUserInputArchive) => {
        const current = useAgentStore.getState();
        const answers = record.entries.map((item) => item.answer).filter(Boolean);
        const seq = current.messages.filter((item) => {
            const kind = item.detail && typeof item.detail === "object" ? (item.detail as { kind?: unknown }).kind : undefined;
            return kind === "userInput" && item.turnId === current.activeTurnId;
        }).length + 1;
        const next = scopeChatItem({
            id: `synthetic:userInput:${current.activeThreadId || "local"}:${current.activeTurnId || "turn"}:${seq}:${Date.now()}`,
            itemId: `synthetic:userInput:${seq}`,
            role: "tool",
            title: t("agent.message.userInputAnswered"),
            text: answers.join("；") || t("agent.message.userInputAnswered"),
            detail: { kind: "userInput", status: "completed", entries: record.entries, anchorAfterId: record.anchorAfterId },
        } as AgentChatItem, current.activeThreadId, current.activeTurnId);
        setAgentState({ messages: insertAgentMessage(current.messages, next) });
        persistLocalUserInputMessages(current.activeThreadId, [next]);
    };

    const syncPermissionModeToAgent = async (nextMode: AgentPermissionMode) => {
        const current = useAgentStore.getState();
        if (current.agentProvider === "cursor") return;
        if (!current.connected || current.sending || current.waiting || ["preparing", "running"].includes(current.conversation.status)) return;
        if (!current.activeThreadId || current.conversation.status === "idle") {
            const result = await fetchAgentJson<AgentWorkspaceResponse>(endpoint, token, engineApi("/threads/reset"), {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ clientId: clientIdRef.current, permissionMode: nextMode, collaborationMode: useAgentStore.getState().collaborationMode }),
            });
            if (result.conversation) applyConversationState(result.conversation);
            return;
        }
        if (current.conversation.status === "ready") {
            const result = await fetchAgentJson<AgentThreadResponse>(endpoint, token, engineApi(`/threads/${encodeURIComponent(current.activeThreadId)}/resume`), {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ permissionMode: nextMode, clientId: clientIdRef.current }),
            });
            if (result.conversation) applyConversationState(result.conversation);
        }
    };

    const changePermissionMode = (nextMode: AgentPermissionMode) => {
        const apply = () => {
            localStorage.setItem("canvas-agent-permission-mode", nextMode);
            setAgentState({ permissionMode: nextMode });
            void syncPermissionModeToAgent(nextMode).catch(() => undefined);
        };
        if (nextMode !== "full") return apply();
        modal.confirm({
            title: rt("enableFullAccess"),
            content: rt("fullAccessDescription"),
            okText: rt("enableFullAccessAction"),
            okType: "danger",
            cancelText: t("common.cancel"),
            onOk: apply,
        });
    };

    const changeCollaborationMode = async (nextMode: AgentCollaborationMode) => {
        const current = useAgentStore.getState();
        if (nextMode === current.collaborationMode) return;
        const crossesContext = (nextMode === "chat") !== (current.collaborationMode === "chat");
        if (crossesContext && (current.sending || current.waiting || current.loadingThreads || ["preparing", "running"].includes(current.conversation.status))) return;
        try {
            if (crossesContext && current.connected) {
                setAgentState({ loadingThreads: true });
                const result = await fetchAgentJson<AgentWorkspaceResponse>(endpoint, token, engineApi("/context"), {
                    method: "POST", headers: { "content-type": "application/json" },
                    body: JSON.stringify({ clientId: clientIdRef.current, permissionMode: current.permissionMode, collaborationMode: nextMode }),
                    signal: AbortSignal.timeout(60000),
                });
                if (result.conversation) applyConversationState(result.conversation, true);
            }
            localStorage.setItem("canvas-agent-chat-mode", nextMode);
            setAgentState({ collaborationMode: nextMode });
            if (crossesContext) {
                selectionKeyRef.current = "";
                selectionSyncSeqRef.current += 1;
                if (nextMode === "chat") {
                    const draft = useAgentStore.getState();
                    const prompt = draft.attachments.filter((item) => item.autoCanvasContext).reduce((text, item) => removeComposerFileToken(text, item.id), draft.prompt);
                    setAgentState({ prompt, attachments: draft.attachments.filter((item) => !item.autoCanvasContext) });
                }
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : rt("newConversationFailed"));
        } finally {
            if (crossesContext) setAgentState({ loadingThreads: false });
        }
    };

    const publishPlanDocument = (markdown?: string, threadId?: string, turnId?: string, collapsed = true) => {
        const current = useAgentStore.getState();
        const doc = buildAgentPlanDocument({
            threadId: threadId || current.activeThreadId,
            turnId: turnId || current.activeTurnId,
            markdown,
            messages: current.messages,
            collapsed,
            width: current.planDocument?.width,
            executed: current.planDocument?.executed,
        });
        if (!doc) return;
        setAgentState({
            planDocument: doc,
            panelOpen: true,
            panelMounted: true,
            panelClosing: false,
        });
    };
    publishPlanDocumentRef.current = publishPlanDocument;

    const beginPlanHandoff = async () => {
        const current = useAgentStore.getState();
        if (!current.connected || current.sending || current.waiting) return;
        if (current.planDocument?.executed || planWasExecuted(current.messages)) return;
        publishPlanDocument();
        const latest = useAgentStore.getState();
        if (latest.planDocument) setAgentState({ planDocument: { ...latest.planDocument, executed: true } });
        changeCollaborationMode("default");
        if (!headless) message.success(t("agent.panel.planSwitchedToAgent"));
        await sendPrompt({ text: t("agent.panel.planExecutePrompt"), collaborationMode: "default" });
    };

    registerPlanHandoff(() => void beginPlanHandoff());
    registerPlanPreview((markdown, threadId, turnId) => {
        publishPlanDocument(markdown, threadId, turnId, false);
    });

    maybePlanHandoffRef.current = (turnId: string) => {
        const current = useAgentStore.getState();
        const key = `${current.activeThreadId}:${turnId}`;
        if (!turnId || planHandoffDoneRef.current === key) return;
        if (!canStartPlanHandoff(current)) return;
        publishPlanDocument(undefined, current.activeThreadId, turnId);
        if (current.prompt.trim()) {
            planHandoffDoneRef.current = key;
            const latest = useAgentStore.getState();
            if (latest.planDocument) setAgentState({ planDocument: { ...latest.planDocument, executed: true } });
            changeCollaborationMode("default");
            if (!headless) message.success(t("agent.panel.planSwitchedToAgent"));
            return;
        }
        planHandoffDoneRef.current = key;
        window.setTimeout(() => {
            if (!canStartPlanHandoff(useAgentStore.getState())) return;
            void beginPlanHandoff();
        }, 400);
    };

    const toggleAgentConnection = async ({ silent = false, forceUrl, forceToken }: { silent?: boolean; forceUrl?: string; forceToken?: string } = {}) => {
        if (enabled && !forceToken) {
            clearAgentSession({ enabled: false, connected: false, activity: rt("offline"), connectError: "" });
            return;
        }
        const urlToken = searchParams.get("agentToken") || "";
        const urlEndpoint = searchParams.get("agentUrl") || "";
        const discovered = urlToken || forceToken ? null : await discoverAgentConfig(resolveAgentEndpointForPage(forceUrl || endpoint || DEFAULT_AGENT_URL));
        const nextEndpoint = resolveAgentEndpointForPage((urlEndpoint || forceUrl || discovered?.url || endpoint || DEFAULT_AGENT_URL).trim().replace(/\/$/, ""));
        const nextToken = (urlToken || forceToken || token.trim() || discovered?.token || "").trim();
        if (!nextEndpoint) {
            const text = rt("addressRequired");
            if (!silent) {
                setAgentState({ connectError: text });
                if (!headless) message.warning(text);
            }
            return;
        }
        if (!nextToken) {
            const text = rt("agentNotFound");
            if (!silent) {
                setAgentState({ connectError: text });
                if (!headless) message.warning(text);
            }
            return;
        }
        try {
            const parsed = new URL(nextEndpoint);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("invalid protocol");
        } catch {
            const text = rt("invalidAddress");
            if (!silent) {
                setAgentState({ connectError: text });
                if (!headless) message.warning(text);
            }
            return;
        }
        errorLoggedRef.current = false;
        // 地址和 token 相同也必须重建 SSE，否则不会再收到 hello 来恢复 connected。
        setConnectionAttempt((attempt) => attempt + 1);
        // 静默重连时不要把用户从「对话」踢回「连接设置」；手动连接才进 setup
        setAgentState({
            url: nextEndpoint,
            token: nextToken,
            enabled: true,
            connected: false,
            silentConnect: silent,
            activity: rt("connecting"),
            connectError: "",
            ...(silent ? {} : { activeTab: "setup" as const }),
        });
    };

    const startDirectAgent = async () => {
        const result = await startLocalAgent();
        if (!result.ok) {
            if ("unavailable" in result && result.unavailable) {
                message.warning(t("agent.connect.startUnavailable"));
                return;
            }
            if ("codexMissing" in result && result.codexMissing) {
                message.warning(t("agent.connect.codexMissing"));
                return;
            }
            message.error("error" in result ? result.error : t("agent.connect.startFailed"));
            return;
        }
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
            const info = await fetchLocalAgentConnectInfo();
            if (info && "unavailable" in info) {
                message.warning(t("agent.connect.startUnavailable"));
                return;
            }
            if (info?.token) {
                message.success(t(result.alreadyRunning ? "agent.connect.alreadyRunning" : "agent.connect.startSuccess"));
                if (useAgentStore.getState().connected) {
                    setAgentState({ url: info.url, token: info.token, connectError: "", activeTab: "chat" });
                    return;
                }
                // 静默连接，避免先跳回「连接设置」；一键启动成功后直接进对话
                await toggleAgentConnection({ forceUrl: info.url, forceToken: info.token, silent: true });
                setAgentState({ activeTab: "chat" });
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        message.warning(t("agent.connect.startTimeout"));
    };

    useEffect(() => {
        if (urlAgentAutoConnect && confirmTools) setAgentState({ confirmTools: false });
    }, [confirmTools, setAgentState, urlAgentAutoConnect]);

    useEffect(() => {
        if ((!autoConnect && !urlAgentAutoConnect) || autoConnectRef.current || enabled || connected) return;
        autoConnectRef.current = true;
        void toggleAgentConnection({ silent: true });
    }, [autoConnect, connected, enabled, urlAgentAutoConnect]);

    useEffect(() => {
        if (typeof window === "undefined" || !window.desktopAPI?.isDesktop || desktopBootRef.current || enabled || connected || headless) return;
        desktopBootRef.current = true;
        void (async () => {
            const info = await fetchLocalAgentConnectInfo();
            if (info && "unavailable" in info) return;
            if (info?.token) {
                await toggleAgentConnection({ forceUrl: info.url, forceToken: info.token, silent: true });
                setAgentState({ activeTab: "chat" });
                return;
            }
            const result = await startLocalAgent();
            if (!result.ok) return;
            const deadline = Date.now() + 30_000;
            while (Date.now() < deadline) {
                const next = await fetchLocalAgentConnectInfo();
                if (next && !("unavailable" in next) && next.token) {
                    await toggleAgentConnection({ forceUrl: next.url, forceToken: next.token, silent: true });
                    setAgentState({ activeTab: "chat" });
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
        })();
    }, [connected, enabled, headless, setAgentState]);

    function clearAgentSession(patch: Parameters<typeof setAgentState>[0] = {}) {
        loadThreadsSequenceRef.current += 1;
        threadMessagesRef.current.clear();
        authoritativeHistoryTurnsRef.current.clear();
        liveTurnKeysRef.current.clear();
        threadOperationRef.current = 0;
        setAgentState({
            messages: [],
            tokenUsage: null,
            threads: [],
            activeThreadId: "",
            activeTurnId: "",
            workspacePath: "",
            loadingThreads: false,
            waiting: false,
            sending: false,
            pendingTool: null,
            pendingApprovals: [],
            planDocument: null,
            conversation: { revision: 0, conversationId: "", threadId: "", status: "idle", mcpStatuses: {} },
            bootstrapStatus: null,
            mcpStartupStatuses: {},
            ...patch,
        });
        useAgentSkillStore.getState().reset();
        pendingToolRef.current = null;
    }

    const beginThreadOperation = () => {
        const operation = ++threadOperationSequenceRef.current;
        threadOperationRef.current = operation;
        setAgentState({ loadingThreads: true });
        return operation;
    };

    const finishThreadOperation = (operation: number) => {
        if (threadOperationRef.current !== operation) return;
        threadOperationRef.current = 0;
        setAgentState({ loadingThreads: false });
    };

    const resetDraftConversation = async (operation: number) => {
        clearSkillSelection();
        setAgentState({ activeTab: "chat", activity: rt("creatingConversation") });
        const result = await fetchAgentJson<AgentWorkspaceResponse>(endpoint, token, engineApi("/threads/reset"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: clientIdRef.current, permissionMode, collaborationMode: useAgentStore.getState().collaborationMode }) });
        if (threadOperationRef.current !== operation) return;
        if (result.conversation) applyConversationState(result.conversation, currentProvider() === "cursor");
        setAgentState({ activeTab: "chat", activity: rt("newConversation") });
    };

    const conversationNeedsDraft = (state = useAgentStore.getState()) =>
        state.connected && (!state.activeThreadId || state.conversation.status === "idle");

    const startNewThread = async () => {
        const current = useAgentStore.getState();
        if (!current.connected || current.sending || current.waiting || current.loadingThreads || ["preparing", "running"].includes(current.conversation.status)) return;
        if (currentProvider() === "cursor" && current.activeThreadId && current.conversation.status === "ready" && !current.messages.length) {
            setAgentState({ activeTab: "chat", activity: rt("newConversation") });
            return;
        }
        const operation = beginThreadOperation();
        try {
            await resetDraftConversation(operation);
        } catch (error) {
            const state = agentErrorState(error);
            if (state) applyConversationState(state);
            else if (currentProvider() === "cursor") applyConversationState(cursorInitFailedConversation(error), true);
            addEventLog(rt("newConversationFailed"), error);
            message.error(error instanceof Error ? error.message : rt("newConversationFailed"));
            await loadThreads();
        } finally {
            finishThreadOperation(operation);
        }
    };

    /** 删光回合后强制开新对话：绕过 loadingThreads 等静默 guard，短暂等待忙态结束后再 reset */
    const forceFreshEmptyThread = async () => {
        if (!useAgentStore.getState().connected) return;
        const operation = beginThreadOperation();
        try {
            for (let i = 0; i < 40; i += 1) {
                const state = useAgentStore.getState();
                if (!state.sending && !state.waiting && !["preparing", "running"].includes(state.conversation.status)) break;
                await new Promise((resolve) => window.setTimeout(resolve, 200));
            }
            await resetDraftConversation(operation);
        } catch (error) {
            const state = agentErrorState(error);
            if (state) applyConversationState(state);
            else if (currentProvider() === "cursor") applyConversationState(cursorInitFailedConversation(error), true);
            addEventLog(rt("newConversationFailed"), error);
            message.error(error instanceof Error ? error.message : rt("newConversationFailed"));
            await loadThreads();
        } finally {
            finishThreadOperation(operation);
        }
    };

    useEffect(() => {
        // hello 里已对 idle 发起 reset；这里只做兜底，稍后再查，避免与 hello 并发
        if (!connected || conversation.status !== "idle" || loadingThreads || sending || waiting) return;
        const timer = window.setTimeout(() => {
            const latest = useAgentStore.getState();
            if (!latest.connected || latest.conversation.status !== "idle" || latest.loadingThreads || latest.sending || latest.waiting) return;
            if (["preparing", "running"].includes(latest.conversation.status)) return;
            void startNewThread();
        }, 2500);
        return () => window.clearTimeout(timer);
    }, [connected, conversation.status, loadingThreads, sending, waiting]);

    const resumeThread = async (threadId: string) => {
        const current = useAgentStore.getState();
        if (!current.connected || !threadId) return;
        if (threadId === current.activeThreadId) {
            setAgentState({ activeTab: "chat" });
            return;
        }
        // 主对话忙碌时仍允许切到节点会话；仅跳过发送中的互斥写操作
        if (current.sending || current.loadingThreads) return;
        const operation = beginThreadOperation();
        try {
            const result = await fetchAgentJson<AgentThreadResponse>(endpoint, token, engineApi(`/threads/${encodeURIComponent(threadId)}/resume`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ permissionMode, clientId: clientIdRef.current }) });
            if (result.contextMode) {
                localStorage.setItem("canvas-agent-chat-mode", result.contextMode);
                setAgentState({ collaborationMode: result.contextMode });
            }
            if (result.conversation) applyConversationState(result.conversation);
            await loadThreads();
            if (useAgentStore.getState().activeThreadId === threadId) setAgentState({ activeTab: "chat", activity: rt("conversationResumed") });
        } catch (error) {
            const state = agentErrorState(error);
            if (state) applyConversationState(state);
            addEventLog(rt("resumeConversationFailed"), error);
            message.error(error instanceof Error ? error.message : rt("resumeConversationFailed"));
            await loadThreads();
        } finally {
            finishThreadOperation(operation);
        }
    };

    // 画布节点任务请求切到自己的 Codex 会话，便于在面板里看该节点的完整过程
    useEffect(() => {
        if (!requestedThreadId) return;
        const threadId = requestedThreadId;
        setAgentState({ requestedThreadId: "", activeTab: "chat", panelOpen: true, panelMounted: true, panelClosing: false });
        if (currentProvider() === "cursor") {
            localStorage.setItem("canvas-agent-provider", "codex");
            clearAgentSession({ agentProvider: "codex", activeTab: "chat" });
        }
        if (threadId !== useAgentStore.getState().activeThreadId) void resumeThread(threadId);
    }, [requestedThreadId]);

    const switchAgentProvider = () => {
        if (sending || waiting || loadingThreads) return;
        const next: AgentProvider = agentProvider === "cursor" ? "codex" : "cursor";
        localStorage.setItem("canvas-agent-provider", next);
        clearAgentSession({ agentProvider: next, activeTab: "chat" });
        if (useAgentStore.getState().connected) void startNewThread();
    };

    const deleteThreads = async (threadIds: string[]) => {
        if (!connected || !threadIds.length || sending || waiting || loadingThreads) return;
        const operation = beginThreadOperation();
        const deletedThreadIds: string[] = [];
        try {
            for (const threadId of new Set(threadIds)) {
                await fetchAgentJson(endpoint, token, engineApi(`/threads/${encodeURIComponent(threadId)}/delete`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: clientIdRef.current }) });
                threadMessagesRef.current.delete(threadId);
                deletedThreadIds.push(threadId);
            }
            void deleteAgentThreadMessages(deletedThreadIds).catch(() => undefined);
            await loadThreads();
            if (threadOperationRef.current === operation && conversationNeedsDraft()) {
                await resetDraftConversation(operation);
                await loadThreads();
            }
            message.success(rt("recordsDeleted", { count: deletedThreadIds.length }));
        } catch (error) {
            if (deletedThreadIds.length) {
                void deleteAgentThreadMessages(deletedThreadIds).catch(() => undefined);
            }
            await loadThreads();
            if (threadOperationRef.current === operation && conversationNeedsDraft()) {
                try {
                    await resetDraftConversation(operation);
                    await loadThreads();
                } catch (resetError) {
                    addEventLog(rt("newConversationFailed"), resetError);
                }
            }
            addEventLog(rt("deleteConversationFailed"), error);
            message.error(error instanceof Error ? error.message : rt("deleteConversationFailed"));
        } finally {
            finishThreadOperation(operation);
        }
    };

    const confirmDeleteThreads = (threadIds: string[]) => {
        modal.confirm({
            title: rt("deleteConversations", { count: threadIds.length }),
            content: rt("deleteConversationsDescription"),
            okText: t("common.delete"),
            okType: "danger",
            cancelText: t("common.cancel"),
            onOk: () => deleteThreads(threadIds),
        });
    };

    const deleteTurn = async (target: AgentChatItem) => {
        const current = useAgentStore.getState();
        if (!current.connected || target.role !== "user") return;
        if ((current.sending || current.waiting) && target.turnId && target.turnId === current.activeTurnId) return;
        const threadId = target.threadId || current.activeThreadId;
        const turnId = (target.turnId || "").trim();
        const nextMessages = removeTurnMessages(current.messages, target);
        const removedUserIds = current.messages
            .filter((item) => !nextMessages.includes(item) && item.role === "user")
            .map((item) => item.id);
        if (threadId) threadMessagesRef.current.set(threadId, nextMessages);
        setAgentState({
            messages: nextMessages,
            pendingApprovals: turnId
                ? current.pendingApprovals.filter((item) => item.turnId !== turnId)
                : current.pendingApprovals,
            pendingTool: turnId && turnId === current.activeTurnId ? null : current.pendingTool,
        });
        try {
            if (threadId && turnId) await deleteCodexTurn(endpoint, token, threadId, turnId);
            if (threadId) void deleteAgentTurnMessages(threadId, { turnId, messageIds: removedUserIds }).catch(() => undefined);
            await Promise.all(removedUserIds.map((id) => deletePendingAgentUserMessage(id).catch(() => undefined)));
            message.success(rt("turnDeleted"));
            // 界面已无回合但仍停在旧线程上时，模型上下文还在；自动开新对话避免「空聊天却记得上次」
            const remainingUsers = nextMessages.filter((item) => item.role === "user" && item.turnId);
            if (!remainingUsers.length) void forceFreshEmptyThread();
        } catch (error) {
            addEventLog(rt("deleteTurnFailed"), error);
            message.error(error instanceof Error ? error.message : rt("deleteTurnFailed"));
            await loadThreads();
        }
    };

    const confirmDeleteTurn = (item: AgentChatItem) => {
        modal.confirm({
            title: t("agent.chat.deleteTurn"),
            content: t("agent.chat.deleteTurnDescription"),
            okText: t("common.delete"),
            okType: "danger",
            cancelText: t("common.cancel"),
            onOk: () => deleteTurn(item),
        });
    };

    const addMessage = (item: Omit<AgentChatItem, "id"> & { id?: string }) => {
        const text = normalizeText(item.text);
        if (!text && !item.attachments?.length) return;
        const current = useAgentStore.getState();
        const itemId = item.itemId || item.id || createId();
        const next = scopeChatItem({ ...item, id: item.id || itemId, itemId, text } as AgentChatItem, item.threadId ?? current.activeThreadId, item.turnId ?? current.activeTurnId);
        if (next.role === "user") {
            const messages = upsertUserChatMessage(current.messages, next);
            setAgentState({ messages });
            if (isCursorThreadId(next.threadId)) persistCursorThreadMessages(next.threadId, messages);
            return;
        }
        const messages = upsertAgentMessage(current.messages, next);
        setAgentState({ messages });
        if (isCursorThreadId(next.threadId)) persistCursorThreadMessages(next.threadId, messages);
    };

    const addEventLog = (title: string, text: unknown, raw?: unknown) => {
        const value = normalizeText(text) || title;
        const last = useAgentStore.getState().eventLogs.at(-1);
        if (last?.title === title && last.text === value) return;
        pushEventLog({ id: `${Date.now()}-${Math.random()}`, time: dayjs().format("YYYY-MM-DD HH:mm:ss"), title, text: value, raw });
    };

    const upsertActivityMessage = (item: AgentChatItem) => {
        setAgentState({ messages: upsertAgentMessage(useAgentStore.getState().messages, item) });
    };

    const appendActivityDelta = (event: AgentEventPayload) => {
        const item = event.item;
        if (!item?.id) return;
        // Codex reasoning：summary=可读摘要，content=原始思考（若开启 show_raw），delta=流式增量
        const summaryText = flattenCodexText(item.summary);
        const contentText = flattenCodexText(item.content);
        const combined = [summaryText, contentText].filter(Boolean).filter((part, index, all) => all.indexOf(part) === index).join("\n\n");
        const text = stringText(item.text) || stringText(item.delta) || combined;
        const isDelta = Boolean(stringText(item.delta)) && !combined;
        if (!text) return;
        if (item.type === "reasoning") {
            // 每条 reasoning 单独占位，插在当前时间线末尾；勿合并进 synthetic:reasoning，否则会永远堆在回合顶部
            const scoped = scopeEventChatItem(event, activityDeltaFallback(item, text), item.id);
            const current = useAgentStore.getState().messages.find((message) => message.id === scoped.id);
            const previous = current?.text || "";
            const nextText = isDelta
                ? `${previous === activityPlaceholder("reasoning") ? "" : previous}${text}`
                : (combined || text);
            upsertActivityMessage({
                ...scoped,
                title: i18n.t("agent.events.reasoning"),
                text: nextText,
                detail: activityDetail(current?.detail || scoped.detail, "reasoning", "inProgress"),
                streamId: scoped.id,
            });
            return;
        }
        const scoped = scopeEventChatItem(event, activityDeltaFallback(item, text), item.id);
        const currentMessages = useAgentStore.getState().messages;
        const index = currentMessages.findIndex((message) => message.id === scoped.id);
        if (index < 0) {
            if (!text.trim()) return;
            upsertActivityMessage(scoped);
            return;
        }
        const current = currentMessages[index];
        if (item.type === "command_execution") {
            const detail = activityDetail(current.detail, "command", "inProgress");
            detail.output = isDelta ? `${stringText(detail.output)}${text}` : text;
            setAgentState({ messages: currentMessages.map((message, itemIndex) => itemIndex === index ? { ...message, detail } : message) });
            return;
        }
        const placeholder = activityPlaceholder(item.type);
        if (!text.trim() && current.text === placeholder) return;
        const nextText = isDelta ? `${current.text === placeholder ? "" : current.text}${text}` : mergeStreamText(current.text, text);
        setAgentState({ messages: currentMessages.map((message, itemIndex) => itemIndex === index ? { ...message, text: nextText, detail: { ...activityDetail(message.detail, activityKind(item.type), "inProgress") } } : message) });
    };

    const upsertEventActivity = (event: AgentEventPayload, item: Omit<AgentChatItem, "id">) => {
        const itemId = event.item?.id;
        if (!itemId) return;
        if (event.item?.type === "reasoning") {
            const scoped = scopeEventChatItem(event, { ...item, id: itemId }, itemId);
            const current = useAgentStore.getState().messages.find((message) => message.id === scoped.id);
            const previous = current?.text || "";
            const incoming = normalizeText(item.text);
            const nextText = incoming === "已完成分析" && previous && previous !== activityPlaceholder("reasoning")
                ? previous
                : (incoming || previous || activityPlaceholder("reasoning"));
            const status = String(objectField(item.detail, "status") || (event.type === "item.completed" ? "completed" : "inProgress"));
            const running = ["inProgress", "in_progress", "running", "pending", "started"].includes(status);
            upsertActivityMessage({
                ...scoped,
                title: i18n.t("agent.events.reasoning"),
                text: nextText,
                detail: activityDetail(item.detail || current?.detail || scoped.detail, "reasoning", status),
                streamId: running ? scoped.id : undefined,
            });
            return;
        }
        upsertActivityMessage(scopeEventChatItem(event, { ...item, id: itemId }, itemId));
    };

    const finishEmptyReasoningActivity = (event: AgentEventPayload) => {
        const itemId = event.item?.id;
        if (!itemId) return;
        const scopedId = scopeEventChatItem(event, { id: itemId, role: "tool", text: "" }, itemId).id;
        const currentMessages = useAgentStore.getState().messages;
        const index = currentMessages.findIndex((message) => message.id === scopedId);
        if (index < 0) return;
        const current = currentMessages[index];
        if (isReasoningSummary(current.text)) {
            setAgentState({
                messages: currentMessages.map((message, itemIndex) => itemIndex === index
                    ? { ...message, detail: activityDetail(message.detail, "reasoning", "completed"), streamId: undefined }
                    : message),
            });
            return;
        }
        setAgentState({ messages: currentMessages.filter((_, itemIndex) => itemIndex !== index) });
    };

    const finishPlanActivity = (event: AgentEventPayload) => {
        const id = scopeEventChatItem(event, { id: "synthetic:plan", role: "tool", text: "" }, "synthetic:plan").id;
        const currentMessages = useAgentStore.getState().messages;
        const index = currentMessages.findIndex((message) => message.id === id);
        if (index < 0) return;
        const current = currentMessages[index];
        const detail = activityDetail(current.detail, "todo", turnPlanStatus(current.detail, event.status));
        setAgentState({ messages: currentMessages.map((message, itemIndex) => itemIndex === index ? { ...message, detail } : message) });
    };

    const showAgentError = (value: unknown, event?: AgentEventPayload, log = true) => {
        const error = agentErrorView(value);
        const item = event
            ? scopeEventChatItem(event, { id: "synthetic:error", role: "error", title: error.title, text: error.text }, "synthetic:error")
            : scopeChatItem({ id: createId(), role: "error", title: error.title, text: error.text }, useAgentStore.getState().activeThreadId, useAgentStore.getState().activeTurnId);
        const state = useAgentStore.getState();
        const current = state.messages.find((message) => message.id === item.id);
        if (current && !normalizeText(value)) return;
        upsertActivityMessage(item);
        setAgentState({ activity: rt("processingFailed"), pendingApprovals: [], waiting: false, sending: false });
        if (log) addEventLog(rt("processingFailed"), error.text, value);
    };

    const applyCodexGeneratedToNode = (generated: Awaited<ReturnType<typeof importImageSources>>, codexJob: CodexImageJobRequest, options?: { finalize?: boolean }) => {
        const context = canvasContextRef.current;
        if (!context || !generated.length) return false;
        const source = context.snapshot.nodes.find((node) => node.id === codexJob.nodeId);
        if (!source) return false;
        // 按路径 / 上传指纹去重，避免同一张图 path+base64 或并发事件写两次
        const fresh = generated.filter((image) => {
            const key = image.sourceKey || `${image.upload.width}x${image.upload.height}:${image.upload.bytes}:${image.upload.storageKey}`;
            return useCodexImageJobStore.getState().markImported(codexJob.id, [key]) > 0;
        });
        if (!fresh.length) return false;
        let latest = codexImageJob(codexJob.id) || codexJob;
        // auto 未声明 COUNT 时，按已到图数兜底铺占位，避免结果无处可填
        if (!latest.placeholderNodeIds.length) {
            const fromCli = parseCodexDeclaredCount(latest.cliLog);
            ensureCodexPlaceholders(latest.id, fromCli || Math.max(latest.expectedCount, latest.importedCount + fresh.length, 1));
            latest = codexImageJob(codexJob.id) || latest;
        }
        const startIndex = Math.max(0, latest.importedCount - fresh.length);
        const thinking = compactCodexThinkingDisplay(latest.statusLog, latest.cliLog, latest.importedCount);
        // 对比只用本任务实际送出的参考图（上传 / 附件），按 image1、image2 顺序
        // 优先 dataUrl / storageKey：blob: 会在发送后 revoke，不能写进结果节点
        const taskReferences = [
            ...(source.metadata?.references || []),
            ...(latest.attachments || []).map((item) => item.dataUrl || item.url),
        ].filter((url, index, list) => Boolean(url) && list.indexOf(url) === index).slice(0, 2);
        const snapshot = applyCodexGeneratedImagesAsResultNodes(
            context.applyOps,
            {
                id: source.id,
                position: source.position,
                width: source.width,
                height: source.height,
                references: taskReferences,
            },
            fresh.map((image, index) => ({ upload: image.upload, name: image.name || `Codex ${startIndex + index + 1}` })),
            thinking,
            { startIndex, placeholderNodeIds: latest.placeholderNodeIds },
        ) as CanvasAgentSnapshot;
        void postState(endpoint, token, clientIdRef.current, snapshot);
        useCodexImageJobStore.getState().setStatusLog(codexJob.id, i18n.t("canvas.codexImage.resultLinked", { count: codexImageJob(codexJob.id)?.importedCount || fresh.length }));
        const done = codexImageJob(codexJob.id) || latest;
        const reachedTarget = done.expectedCount > 0 && done.importedCount >= done.expectedCount;
        if (options?.finalize || reachedTarget) {
            if (done.placeholderNodeIds?.length) {
                settleCodexPlaceholders(context.applyOps, done.placeholderNodeIds, done.importedCount, "remove");
            }
            const idleSnapshot = markCodexSourceNodeIdle(context, done.nodeId, {
                thinkingLog: compactCodexThinkingDisplay(done.statusLog, done.cliLog, done.importedCount),
            });
            void postState(endpoint, token, clientIdRef.current, idleSnapshot);
            useCodexImageJobStore.getState().succeed(codexJob.id);
        }
        return true;
    };

    const settleCodexJobPlaceholders = (job: CodexImageJobRequest, mode: "error" | "remove", errorMessage?: string) => {
        const context = canvasContextRef.current;
        if (!context || !job.placeholderNodeIds?.length) return;
        const snapshot = settleCodexPlaceholders(context.applyOps, job.placeholderNodeIds, job.importedCount, mode, errorMessage) as CanvasAgentSnapshot;
        void postState(endpoint, token, clientIdRef.current, snapshot);
    };

    /** 生图任务失败：占位标红、节点复位、任务置错。 */
    const failCodexImageJob = (job: CodexImageJobRequest, errorMessage: string) => {
        settleCodexJobPlaceholders(job, "error", errorMessage);
        const context = canvasContextRef.current;
        if (context) void postState(endpoint, token, clientIdRef.current, markCodexSourceNodeIdle(context, job.nodeId, { errorDetails: errorMessage }));
        useCodexImageJobStore.getState().fail(errorMessage, job.id);
    };

    /** turn 结束：已有导入则收尾；否则从 SAVED 路径兜底（避免与事件导入叠成双份）。 */
    const finishCodexJobFallback = async (jobId: string) => {
        const latest = codexImageJob(jobId);
        if (!latest || latest.status !== "running") return;
        if (latest.importedCount > 0) {
            useCodexImageJobStore.getState().setStatusLog(jobId, i18n.t("canvas.codexImage.resultLinked", { count: latest.importedCount }));
            settleCodexJobPlaceholders(latest, "remove");
            const context = canvasContextRef.current;
            if (context) {
                const idleSnapshot = markCodexSourceNodeIdle(context, latest.nodeId, {
                    thinkingLog: compactCodexThinkingDisplay(latest.statusLog, latest.cliLog, latest.importedCount),
                });
                void postState(endpoint, token, clientIdRef.current, idleSnapshot);
            }
            useCodexImageJobStore.getState().succeed(jobId);
            return;
        }
        // 节点任务在独立线程，助手回复不一定进当前会话消息，SAVED 路径优先从任务自身日志取
        const paths = parseSavedImagePaths(latest.cliLog);
        if (paths.length) {
            try {
                const generated = await importImageSources(endpoint, token, paths);
                if (applyCodexGeneratedToNode(generated, latest, { finalize: true })) {
                    addEventLog(rt("importGeneratedImages"), i18n.t("canvas.codexImage.appliedToNode"));
                    return;
                }
            } catch (error) {
                addEventLog(rt("importGeneratedImages"), error);
            }
        }
        const current = codexImageJob(jobId);
        if (current?.status === "running") failCodexImageJob(current, i18n.t("canvas.codexImage.noImageReturned"));
    };

    /** 把生图结果导入发起该任务的节点。 */
    const importCodexJobImages = async (jobId: string, item: AgentEventItem) => {
        await enqueueCodexImageImport(async () => {
            try {
                const generated = await importGeneratedImages(endpoint, token, item);
                if (!generated.length) {
                    addEventLog(rt("importGeneratedImages"), i18n.t("canvas.codexImage.importEmpty", { keys: Object.keys(item).join(",") || "none" }));
                    return;
                }
                const job = codexImageJob(jobId);
                if (job && (job.status === "running" || job.status === "queued") && applyCodexGeneratedToNode(generated, job)) {
                    addEventLog(rt("importGeneratedImages"), i18n.t("canvas.codexImage.appliedToNode"));
                }
            } catch (error) {
                addEventLog(rt("importGeneratedImages"), error);
            }
        });
    };

    /** 画布节点任务按线程归属消费事件：思考、结果文本、生图落盘都只写进对应任务，不进当前会话消息。 */
    const applyCodexJobEvent = async (event: AgentEventPayload, scope: { threadId: string; turnId: string }) => {
        const imageJob = codexImageJobByThread(scope.threadId);
        const textJob = codexTextJobByThread(scope.threadId);
        if (!imageJob && !textJob) return;
        const imageStore = useCodexImageJobStore.getState();
        const textStore = useCodexTextJobStore.getState();
        if (event.type === "turn.started" && scope.turnId) {
            if (imageJob) imageStore.setScope(imageJob.id, { turnId: scope.turnId });
            if (textJob) textStore.setScope(textJob.id, { turnId: scope.turnId });
            return;
        }
        if (event.type === "error" || (event.type === "item.completed" && event.item?.type === "error")) {
            const text = agentErrorView(event.message || event.item?.message).text;
            if (imageJob) failCodexImageJob(imageJob, text || i18n.t("canvas.codexImage.failed"));
            if (textJob) textStore.fail(text || i18n.t("canvas.codexText.failed"), textJob.id);
            return;
        }
        if (event.type === "turn.completed") {
            if (event.status === "failed") {
                const text = event.error?.message ? agentErrorView(event.error.message).text : "";
                if (imageJob) failCodexImageJob(imageJob, text || i18n.t("canvas.codexImage.failed"));
                if (textJob) textStore.fail(text || i18n.t("canvas.codexText.failed"), textJob.id);
                return;
            }
            if (imageJob) {
                // turn 已结束后稍等 image_generation 事件，避免时序竞态误判失败；已凑齐张数则立刻收尾
                const reached = imageJob.expectedCount > 0 && imageJob.importedCount >= imageJob.expectedCount;
                const delay = reached ? 0 : imageJob.importedCount > 0 ? 800 : 6000;
                window.setTimeout(() => void enqueueCodexImageImport(() => finishCodexJobFallback(imageJob.id)), delay);
            }
            if (textJob) {
                const text = collectCodexTextResult(scope.threadId, scope.turnId) || codexTextJob(textJob.id)?.resultText || "";
                if (text.trim()) textStore.succeed(textJob.id, text.trim());
                else textStore.fail(i18n.t("canvas.codexText.empty"), textJob.id);
            }
            return;
        }
        const item = event.item;
        if (item?.type === "image_generation") {
            if (!imageJob) return;
            // 「正在生成/已完成」是本地状态文案，不是 CLI 思考；revisedPrompt 才是模型侧内容
            imageStore.setStatusLog(imageJob.id, i18n.t(event.type === "item.completed" ? "agent.events.imageCompleted" : "agent.events.generatingImage"));
            const revised = stringText(item.revisedPrompt);
            if (revised) pushCodexImageLog(imageJob.id, `revisedPrompt:\n${revised}`);
            if (event.type === "item.completed" && item.id && !event.replayed) await importCodexJobImages(imageJob.id, item);
            return;
        }
        if (event.type !== "item.updated" && event.type !== "item.completed") return;
        if (item?.type !== "reasoning" && item?.type !== "agent_message" && item?.type !== "plan") return;
        const text = stringText(item.text) || stringText(item.delta) || composeReasoningText(item.summary, item.content, "");
        if (!text.trim()) return;
        const isDelta = Boolean(stringText(item.delta)) && !stringText(item.text);
        if (imageJob) pushCodexImageLog(imageJob.id, text);
        if (textJob) {
            textStore.appendStatusLog(textJob.id, text);
            if (item.type === "agent_message") {
                if (isDelta) textStore.appendResultText(textJob.id, text);
                else textStore.setResultText(textJob.id, text);
            }
        }
    };

    const handleAgentEvent = async (event: AgentEventPayload) => {
        const jobScope = eventScope(event);
        await applyCodexJobEvent(event, jobScope);
        // 画布节点任务与其它标签页的会话都在自己的线程上，不能混进当前会话消息
        if (jobScope.threadId && !isTrackedThreadEvent(event, useAgentStore.getState().activeThreadId, liveTurnKeysRef.current)) return;
        if (jobScope.threadId && jobScope.threadId !== useAgentStore.getState().activeThreadId && (useAgentStore.getState().sending || useAgentStore.getState().waiting)) {
            setAgentState({ activeThreadId: jobScope.threadId });
        }
        if (event.type === "usage.updated") setAgentState({ tokenUsage: eventUsage(event) });
        const log = event.replayed ? null : formatAgentEventLog(event);
        const activity = formatAgentActivity(event);
        if (log) addEventLog(log.title, log.text);
        if (event.type === "turn.started" && (event.turnId || event.turn_id)) {
            const scope = eventScope(event);
            const current = useAgentStore.getState();
            if (!scope.threadId || !scope.turnId) return;
            liveTurnKeysRef.current.add(`${scope.threadId}\0${scope.turnId}`);
            setAgentState({ activeTurnId: scope.turnId, waiting: true, sending: false, bootstrapStatus: null, mcpStartupStatuses: {}, codexAuthExpired: false, messages: bindPendingTurnMessages(current.messages, scope.threadId, scope.turnId) });
        }
        if (event.type === "item.updated" && event.item?.type === "agent_message" && event.item.id) {
            const delta = stringText(event.item.delta);
            appendStreamText(event, delta || stringText(event.item.text));
            return;
        }
        if (event.type === "item.updated" && event.item) {
            appendActivityDelta(event);
            return;
        }
        if (event.type === "plan.updated" && event.turn_id) {
            const plan = formatAgentPlan(event);
            if (plan) upsertActivityMessage(scopeEventChatItem(event, { ...plan, id: "synthetic:plan" }, "synthetic:plan"));
            const explanation = stringText(event.explanation).trim();
            const currentDoc = useAgentStore.getState().planDocument;
            if (explanation && (!currentDoc || !currentDoc.markdown.trim())) {
                publishPlanDocumentRef.current(explanation, eventScope(event).threadId, eventScope(event).turnId);
            }
            return;
        }
        if (event.type === "item.completed" && event.item?.type === "error") {
            showAgentError(event.item.message, event, !event.replayed);
            return;
        }
        if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.id) {
            const text = stringText(event.item.text);
            const scoped = scopeEventChatItem(event, { id: event.item.id, role: "assistant", title: "Codex", text }, event.item.id);
            const currentMessages = useAgentStore.getState().messages;
            const index = currentMessages.findIndex((message) => message.id === scoped.id);
            if (index >= 0) {
                setAgentState({ messages: currentMessages.map((message, itemIndex) => itemIndex === index ? { ...message, text: text || message.text, streamId: undefined } : message) });
            } else {
                addMessage(scoped);
            }
            const currentDoc = useAgentStore.getState().planDocument;
            if (currentDoc && !currentDoc.markdown.trim() && text.trim()) {
                publishPlanDocumentRef.current(text, eventScope(event).threadId, eventScope(event).turnId);
            }
            return;
        }
        if (event.type === "item.completed" && event.item?.type === "reasoning" && !activity) {
            const recovered = composeReasoningText(event.item.summary, event.item.content, event.item.text);
            if (recovered) {
                upsertEventActivity(event, { role: "tool", title: i18n.t("agent.events.reasoning"), text: recovered, detail: { kind: "reasoning", status: "completed" } });
                return;
            }
            finishEmptyReasoningActivity(event);
            return;
        }
        if (event.type === "item.completed" && event.item?.type === "plan") {
            const text = stringText(event.item.text) || stringText(event.item.explanation);
            if (text.trim()) publishPlanDocumentRef.current(text, eventScope(event).threadId, eventScope(event).turnId);
            if (event.item.id) {
                const scope = eventScope(event);
                const id = scopeEventChatItem(event, { id: event.item.id, role: "tool", text: "" }, event.item.id).id;
                setAgentState({
                    messages: useAgentStore.getState().messages.filter((item) => {
                        if (item.id === id) return false;
                        const kind = item.detail && typeof item.detail === "object" ? (item.detail as { kind?: unknown }).kind : undefined;
                        return !(kind === "plan" && (!scope.turnId || item.turnId === scope.turnId));
                    }),
                });
            }
            return;
        }
        // 主对话自己触发的生图（非画布节点任务）：直接落到画布右侧
        if (!event.replayed && event.type === "item.completed" && event.item?.type === "image_generation" && event.item.id && !codexImageJobByThread(jobScope.threadId)) {
            if (!event.sourceClientId || event.sourceClientId === clientIdRef.current) {
                // 串行导入，避免多张 image_generation 并发把同一批图写两遍
                await enqueueCodexImageImport(async () => {
                    try {
                        const generated = await importGeneratedImages(endpoint, token, event.item!);
                        if (!generated.length) {
                            const keys = event.item && typeof event.item === "object" ? Object.keys(event.item as object).join(",") : "";
                            addEventLog(rt("importGeneratedImages"), i18n.t("canvas.codexImage.importEmpty", { keys: keys || "none" }));
                            return;
                        }
                        const context = canvasContextRef.current;
                        if (context) {
                            const right = Math.max(0, ...context.snapshot.nodes.map((node) => node.position.x + node.width)) + 80;
                            const ops = generated.flatMap<CanvasAgentOp>((image, index) => {
                                const size = fitNodeSize(image.upload.width, image.upload.height);
                                const id = `image-${createId()}`;
                                return [{
                                    type: "add_node" as const,
                                    id,
                                    nodeType: "image" as const,
                                    title: image.name,
                                    position: { x: right, y: index * ((size.height || 280) + 40) },
                                    ...size,
                                    metadata: imageMetadata(image.upload),
                                }];
                            });
                            const result = context.applyOps(ops);
                            void postState(endpoint, token, clientIdRef.current, result);
                            addEventLog(rt("importGeneratedImages"), rt("addedToSourceCanvas"));
                        } else {
                            addEventLog(rt("importGeneratedImages"), rt("imageGenerated"));
                        }
                    } catch (error) {
                        addEventLog(rt("importGeneratedImages"), error);
                    }
                });
            }
        }
        if (activity && event.item?.id) {
            upsertEventActivity(event, activity);
            return;
        }
        if (event.type === "turn.completed") {
            const scope = eventScope(event);
            if (scope.turnId) {
                finishPlanActivity(event);
                liveTurnKeysRef.current.add(`${scope.threadId}\0${scope.turnId}`);
            }
            const current = useAgentStore.getState();
            setAgentState({
                waiting: false,
                sending: false,
                activeTurnId: current.activeTurnId === scope.turnId ? "" : current.activeTurnId,
                messages: current.messages.map((message) => {
                    if (!scope.turnId || message.threadId !== scope.threadId || message.turnId !== scope.turnId) return message;
                    if (objectField(message.detail, "kind") === "reasoning") {
                        return { ...message, streamId: undefined, detail: activityDetail(message.detail, "reasoning", "completed") };
                    }
                    return message.streamId ? { ...message, streamId: undefined } : message;
                }),
            });
            if (event.status === "failed") showAgentError(event.error?.message, event, !event.replayed);
        }
        const item = formatAgentEvent(event);
        if (item) addMessage(scopeEventChatItem(event, { ...item, id: event.item?.id || createId() }, event.item?.id || createId()));
    };

    const appendStreamText = (event: AgentEventPayload, text: string) => {
        if (!text) return;
        const itemId = event.item?.id;
        if (!itemId) return;
        const scoped = scopeEventChatItem(event, { id: itemId, role: "assistant", title: "Codex", text, streamId: itemId }, itemId);
        const currentMessages = useAgentStore.getState().messages;
        const index = currentMessages.findIndex((message) => message.id === scoped.id);
        if (index < 0) {
            pushMessage(scoped);
            return;
        }
        const nextText = typeof event.item?.delta === "string" ? currentMessages[index].text + text : text;
        setAgentState({ messages: currentMessages.map((message, itemIndex) => itemIndex === index ? { ...message, text: nextText } : message) });
    };

    const connectionStatus = t(connectError ? "agent.status.failed" : connected ? "agent.status.connected" : enabled ? "agent.status.connecting" : "agent.status.disconnected");
    const connectionStatusColor = connectError ? "#dc2626" : connected ? "#16a34a" : enabled ? "#d97706" : theme.node.muted;
    const content = (
        <div className="flex min-h-0 flex-1 flex-col">
            <AgentPanelTabs
                value={activeTab}
                theme={theme}
                leading={
                    <div className="flex items-center gap-1">
                        <span className="grid size-8 place-items-center">
                            <Bot className="size-4" />
                        </span>
                        <div className="hidden text-base font-semibold leading-5 @min-[560px]:block">Agent</div>
                        <Tooltip title={t("agent.panel.switchEngine", { engine: t(agentProvider === "cursor" ? "agent.panel.engineCursor" : "agent.panel.engineCodex"), status: connectionStatus })} placement="bottomLeft" getPopupContainer={() => document.body}>
                            <Button size="small" type="text" className="!h-8 !w-8 !min-w-8 !px-0 @min-[560px]:!w-auto @min-[560px]:!min-w-0 @min-[560px]:!px-[7px]" aria-label={t("agent.panel.switchEngineLabel", { engine: t(agentProvider === "cursor" ? "agent.panel.engineCursor" : "agent.panel.engineCodex") })} icon={<PlugZap className="size-3.5" style={{ color: connectionStatusColor }} />} onClick={switchAgentProvider} disabled={sending || waiting || loadingThreads}>
                                <span className="hidden @min-[560px]:inline">{t(agentProvider === "cursor" ? "agent.panel.engineCursor" : "agent.panel.engineCodex")}</span>
                            </Button>
                        </Tooltip>
                        <Tooltip title={t("agent.panel.connectionSettings", { status: connectionStatus })} placement="bottomLeft" getPopupContainer={() => document.body}>
                            <Button size="small" type="text" className="!h-8 !w-8 !min-w-8 !px-0" aria-label={t("agent.panel.connectionSettingsLabel", { status: connectionStatus })} icon={<Settings className="size-3.5" />} onClick={() => setAgentState({ activeTab: "setup" })} />
                        </Tooltip>
                    </div>
                }
                items={[
                    { value: "chat", label: t("agent.panel.chat"), icon: <MessageSquare className="size-3.5" /> },
                    { value: "history", label: t("agent.panel.history"), icon: <History className="size-3.5" />, count: threads.length },
                    { value: "skills", label: t("agent.panel.skills"), icon: <Sparkles className="size-3.5" />, count: skillCount },
                    { value: "log", label: t("agent.panel.logs"), icon: <Terminal className="size-3.5" />, count: eventLogs.length },
                ]}
                onChange={(activeTab) => {
                    setAgentState({ activeTab });
                    if (activeTab === "history") {
                        const latest = useAgentStore.getState();
                        if (isCursorThreadId(latest.activeThreadId)) persistCursorThreadMessages(latest.activeThreadId, latest.messages);
                        void loadThreads();
                    }
                }}
                right={
                    <>
                        <Tooltip title={t("agent.history.newThread")} placement="bottom" getPopupContainer={() => document.body}>
                            <Button size="small" type="text" className="!h-8 !w-8 !min-w-8 !px-0 @min-[560px]:!w-auto @min-[560px]:!min-w-0 @min-[560px]:!px-[7px]" aria-label={t("agent.history.newThread")} disabled={!connected || loadingThreads || sending || waiting || conversationBusy} icon={<Plus className="size-3.5" />} onClick={startNewThread}>
                                <span className="hidden @min-[560px]:inline">{t("agent.history.newThread")}</span>
                            </Button>
                        </Tooltip>
                        <Tooltip title={t("agent.panel.collapse")} getPopupContainer={() => document.body}>
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" aria-label={t("agent.panel.collapseLabel")} style={{ color: theme.node.muted }} icon={<PanelRightClose className="size-4" />} onClick={closePanel} />
                        </Tooltip>
                    </>
                }
            />

            {activeTab === "setup" ? (
                <AgentConnectView
                    theme={theme}
                    provider={agentProvider}
                    url={url}
                    token={token}
                    enabled={enabled}
                    connected={connected}
                    activity={activity}
                    connectError={connectError}
                    onUrlChange={(url) => setAgentState({ url, connectError: "" })}
                    onTokenChange={(token) => setAgentState({ token, connectError: "" })}
                    onToggleEnabled={() => void toggleAgentConnection()}
                    onStartDirect={startDirectAgent}
                />
            ) : activeTab === "skills" ? (
                <AgentSkillsView clientId={clientIdRef.current} />
            ) : activeTab === "history" ? (
                <AgentHistoryView
                    theme={theme}
                    threads={threads}
                    activeThreadId={activeThreadId}
                    workspacePath={workspacePath}
                    loading={loadingThreads}
                    busy={sending || waiting || conversationBusy}
                    connected={connected}
                    onRefresh={() => void loadThreads()}
                    onNewThread={() => void startNewThread()}
                    onResumeThread={(threadId) => void resumeThread(threadId)}
                    onDeleteThreads={confirmDeleteThreads}
                />
            ) : activeTab === "log" ? (
                <AgentLogView
                    logs={eventLogs}
                    theme={theme}
                    context={{ endpoint, connected, enabled, activity, waiting, sending, messages: messageCount, pendingTool: pendingTool?.name }}
                    onClear={clearEventLogs}
                    onCopied={(text) => message.success(text)}
                    onCopyBlocked={(text) => message.warning(text)}
                />
            ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                    <AgentChatTimeline theme={theme} pendingTool={pendingTool} pendingApprovals={pendingApprovals} sending={sending} waiting={waiting} onRejectTool={rejectPendingTool} onApproveTool={approvePendingTool} onApprovalDecision={decideApproval} onUserInputSubmit={submitUserInput} onUserInputArchive={archiveUserInput} onDeleteTurn={confirmDeleteTurn} onEditTurn={beginEditTurn} onCancelEditTurn={cancelEditTurn} onResendTurn={(item, text, attachmentIds) => void submitEditedTurn(item, text, attachmentIds)} editingTurnId={editingTurn?.id} />
                    {tokenUsage ? <AgentUsageBar usage={tokenUsage} theme={theme} /> : null}
                    {collaborationMode === "plan" && !planDocument && hasAnsweredUserInput && !waiting && !sending && conversationReady && !pendingApprovals.some((item) => isUserInputRequest(item) && !item.deciding) ? (
                        <div className="flex shrink-0 items-center gap-3 border-t px-4 py-2.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium">{t("agent.panel.planHandoffTitle")}</div>
                                <div className="text-[11px] leading-4" style={{ color: theme.node.muted }}>{t("agent.panel.planHandoffHint")}</div>
                            </div>
                            <button
                                type="button"
                                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium"
                                style={{ background: theme.node.fill, color: theme.node.text, border: `1px solid ${theme.node.stroke}` }}
                                onClick={() => void beginPlanHandoff()}
                            >
                                <Play className="size-3.5" />
                                {t("agent.panel.planHandoffAction")}
                            </button>
                        </div>
                    ) : null}
                    <AgentChatComposer
                        prompt={prompt}
                        attachments={composerAttachments}
                        disabled={!connected || !conversationReady || loadingThreads || Boolean(editingTurn)}
                        sending={sending || waiting}
                        placeholder={conversation.status === "idle" || conversation.status === "preparing"
                            ? t(agentProvider === "cursor" ? "agent.panel.cursorInitializing" : "agent.panel.mcpInitializing")
                            : conversation.status === "failed"
                                ? t(agentProvider === "cursor" ? "agent.panel.cursorInitFailed" : "agent.panel.initFailed")
                                : collaborationMode === "plan"
                                    ? hasAnsweredUserInput && !waiting && !sending && !pendingApprovals.some(isUserInputRequest)
                                        ? t("agent.panel.planContinuePlaceholder")
                                        : t("agent.panel.planPlaceholder")
                                    : collaborationMode === "chat"
                                        ? t("agent.composer.collaboration.chatPlaceholder")
                                        : t(agentProvider === "cursor" ? "agent.panel.cursorPlaceholder" : "agent.panel.placeholder")}
                        theme={theme}
                        onPromptChange={(nextPrompt) => {
                            const prev = useAgentStore.getState().attachments;
                            const nextAttachments = pruneAttachmentsToPrompt(nextPrompt, prev);
                            for (const item of prev) {
                                if (nextAttachments.some((keep) => keep.id === item.id)) continue;
                                revokeOwnedAttachmentUrl(item.url);
                            }
                            setAgentState({ prompt: nextPrompt, attachments: nextAttachments });
                        }}
                        onSubmit={sendPrompt}
                        onStop={stopTurn}
                        onAddFiles={addAttachments}
                        onAddFromCanvas={addFromCanvas}
                        onRemoveAttachment={removeAttachment}
                        confirmTools={confirmTools}
                        onConfirmToolsChange={(confirmTools) => setAgentState({ confirmTools })}
                        permissionMode={agentProvider === "cursor" ? undefined : permissionMode}
                        onPermissionModeChange={agentProvider === "cursor" ? undefined : changePermissionMode}
                        collaborationMode={collaborationMode}
                        onCollaborationModeChange={changeCollaborationMode}
                        models={agentProvider === "cursor" ? undefined : models}
                        model={model}
                        reasoningEffort={reasoningEffort}
                        onModelChange={(model) => {
                            const selected = models.find((item) => item.model === model);
                            if (!selected) return;
                            const supported = selected.supportedReasoningEfforts.map((item) => item.reasoningEffort);
                            const currentEffort = useAgentStore.getState().reasoningEffort;
                            const effort = (supported.includes(currentEffort as AgentReasoningEffort) ? currentEffort : undefined)
                                || selected.defaultReasoningEffort
                                || supported[0];
                            localStorage.setItem("canvas-agent-model", model);
                            if (effort) localStorage.setItem("canvas-agent-reasoning-effort", effort);
                            setAgentState({ model, ...(effort ? { reasoningEffort: effort as AgentReasoningEffort } : {}) });
                        }}
                        onReasoningEffortChange={(reasoningEffort) => {
                            localStorage.setItem("canvas-agent-reasoning-effort", reasoningEffort);
                            setAgentState({ reasoningEffort });
                        }}
                        left={
                            attachments.length ? (
                                <span className="hidden text-[11px] @min-[660px]:inline" style={{ color: theme.node.muted }}>
                                    {formatBytes(attachmentPayloadBytes(attachments))} / 30MB
                                </span>
                            ) : null
                        }
                    />
                </div>
            )}
        </div>
    );

    if (headless) return null;
    return embedded ? content : null;
}

function eventScope(event: AgentEventPayload) {
    return {
        threadId: event.threadId || event.thread_id || "",
        turnId: event.turnId || event.turn_id || "",
    };
}

function scopeEventChatItem(event: AgentEventPayload, item: AgentChatItem, itemId: string) {
    const scope = eventScope(event);
    return scopeChatItem({ ...item, itemId }, scope.threadId, scope.turnId);
}

function approvalActivity(pendingApprovals: AgentPendingApproval[], waiting: boolean, fallback: string) {
    if (pendingApprovals.some((item) => isUserInputRequest(item))) return rt("awaitingUserInput");
    if (pendingApprovals.length) return rt("awaitingApproval");
    return waiting ? rt("codexRunning") : fallback;
}

function canStartPlanHandoff(state: ReturnType<typeof useAgentStore.getState>) {
    if (state.collaborationMode !== "plan") return false;
    if (!state.connected || state.sending || state.waiting || state.loadingThreads) return false;
    if (!["ready", "warning"].includes(state.conversation.status)) return false;
    if (state.pendingApprovals.some((item) => isUserInputRequest(item) && !item.deciding)) return false;
    if (liveCodexImageJobs().length || liveCodexTextJobs().length) return false;
    return state.messages.some((item) => {
        const kind = item.detail && typeof item.detail === "object" ? (item.detail as { kind?: unknown }).kind : undefined;
        return kind === "userInput" || kind === "plan";
    });
}

function composerAttachmentsFromHistory(item: AgentChatItem) {
    return (item.attachments || [])
        .filter((file) => file.dataUrl?.startsWith("data:image") || file.kind === "file" || file.kind === "folder" || file.kind === "text" || file.localPath || file.promptText)
        .map((file) => withCanvasNodeId({ ...file, url: file.dataUrl || file.url || "" }));
}

function uniqueTurnIds(items: AgentChatItem[]) {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const turnId = (items[index].turnId || "").trim();
        if (!turnId || seen.has(turnId)) continue;
        seen.add(turnId);
        ids.push(turnId);
    }
    return ids;
}

/** 时间线上最后一个已落盘 turnId（从后往前找）。 */
function lastSettledTurnId(items: AgentChatItem[]) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const turnId = (items[index].turnId || "").trim();
        if (turnId) return turnId;
    }
    return "";
}

/** 删除一轮用户提问及其后续回答/工具消息（按 turnId；无 turnId 时删到下一条用户消息前）。 */
function removeTurnMessages(messages: AgentChatItem[], target: AgentChatItem) {
    const turnId = (target.turnId || "").trim();
    if (turnId) return messages.filter((item) => item.turnId !== turnId);
    const start = messages.findIndex((item) => item.id === target.id);
    if (start < 0) return messages;
    let end = start + 1;
    while (end < messages.length && messages[end].role !== "user") end += 1;
    return [...messages.slice(0, start), ...messages.slice(end)];
}

async function attachmentNodeOps(endpoint: string, token: string, clientId: string, value: unknown): Promise<CanvasAgentOp[]> {
    const nodes = Array.isArray(value) ? value : [];
    if (!nodes.length) throw new Error(rt("noImageAttachments"));
    return await Promise.all(
        nodes.map(async (value) => {
            const item = value as { id?: unknown; attachmentId?: unknown; title?: unknown; position?: unknown };
            const id = String(item.id || "");
            const attachmentId = String(item.attachmentId || "");
            if (!id || !attachmentId) throw new Error(rt("invalidAttachmentNode"));
            const res = await fetch(`${endpoint}/agent/attachments/${encodeURIComponent(attachmentId)}?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`);
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: string } | null;
                throw new Error(body?.error || rt("attachmentReadFailed"));
            }
            const image = await uploadImage(await res.blob());
            const size = fitNodeSize(image.width, image.height);
            const position = item.position && typeof item.position === "object" ? (item.position as { x?: unknown; y?: unknown }) : null;
            const posX = Number(position?.x);
            const posY = Number(position?.y);
            return {
                type: "add_node" as const,
                id,
                nodeType: "image" as const,
                title: String(item.title || rt("referenceImage")),
                ...(Number.isFinite(posX) && Number.isFinite(posY) ? { position: { x: posX, y: posY } } : {}),
                width: size.width,
                height: size.height,
                metadata: imageMetadata(image),
            };
        }),
    );
}

function persistLocalUserInputMessages(threadId: string, messages: AgentChatItem[]) {
    if (!threadId) return;
    for (const item of messages) {
        if (!isUserInputMessage(item)) continue;
        void saveAgentLocalMessage(threadId, {
            id: item.id,
            itemId: item.itemId,
            clientMessageId: item.clientMessageId,
            role: item.role,
            title: item.title,
            text: item.text,
            detail: item.detail,
            threadId: item.threadId || threadId,
            turnId: item.turnId,
        }).catch(() => undefined);
    }
}

function persistCursorThreadMessages(threadId: string, messages: AgentChatItem[]) {
    if (!threadId) return;
    const seen = new Set<string>();
    for (const item of messages) {
        if ((item.role !== "user" && item.role !== "assistant") || !item.text?.trim()) continue;
        const key = item.role === "user" ? `user:${item.clientMessageId || item.turnId || item.text}` : item.id;
        if (seen.has(key)) continue;
        seen.add(key);
        void saveAgentLocalMessage(threadId, {
            id: item.id,
            itemId: item.itemId || item.id,
            clientMessageId: item.clientMessageId,
            role: item.role,
            title: item.title,
            text: item.text,
            detail: item.detail,
            threadId: item.threadId || threadId,
            turnId: item.turnId,
        }).catch(() => undefined);
    }
}

function createId() {
    return randomId();
}

/** 压缩思考区展示：去掉 SAVED 路径噪音，保留简短状态 + 关键回复 */
function compactCodexThinkingDisplay(statusLog: string, cliLog: string, imageCount: number) {
    const status = (statusLog || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("[本地] 仍在等待"))
        .slice(-4)
        .join("\n");
    const cli = (cliLog || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !/^SAVED\s*[:：]/i.test(line) && line.toUpperCase() !== "NONE")
        .join("\n")
        .trim()
        .slice(-1200);
    const done = i18n.t("canvas.codexImage.resultLinked", { count: imageCount });
    if (status && cli) return `${status}\n\n── Codex ──\n${cli}\n\n${done}`;
    if (cli) return `── Codex ──\n${cli}\n\n${done}`;
    return status ? `${status}\n\n${done}` : done;
}

function flattenCodexText(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return value.map(flattenCodexText).filter(Boolean).join("\n");
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    return flattenCodexText(record.text ?? record.summary ?? record.content ?? "");
}

function markCodexSourceNodeIdle(
    context: AgentCanvasContext,
    nodeId: string,
    patch?: { thinkingLog?: string; errorDetails?: string },
) {
    const snapshot = context.applyOps([{
        type: "update_node",
        id: nodeId,
        metadata: {
            codexPhase: "idle",
            errorDetails: patch?.errorDetails || "",
            ...(patch?.thinkingLog != null ? { thinkingLog: patch.thinkingLog } : {}),
        },
    }]) as CanvasAgentSnapshot;
    return snapshot;
}

/** 按 Codex 判定张数创建「生成中」占位（仅创建一次） */
function ensureCodexPlaceholders(jobId: string, count: number) {
    const job = codexImageJob(jobId);
    if (!job || (job.status !== "running" && job.status !== "queued")) return;
    const n = Math.min(4, Math.max(1, count));
    if (job.placeholderNodeIds.length) {
        useCodexImageJobStore.getState().setPlaceholders(jobId, job.placeholderNodeIds, n);
        return;
    }
    const context = useAgentStore.getState().canvasContext;
    if (!context) return;
    const source = context.snapshot.nodes.find((node) => node.id === job.nodeId);
    if (!source) return;
    const userPrompt = job.prompt.split("用户提示词：").pop()?.trim() || "Codex";
    const ids = createCodexLoadingPlaceholders(
        context.applyOps,
        {
            id: source.id,
            position: source.position,
            width: source.width,
            height: source.height,
            references: (source.metadata?.references || []).filter(Boolean),
        },
        n,
        userPrompt,
    );
    useCodexImageJobStore.getState().setPlaceholders(jobId, ids, n);
    useCodexImageJobStore.getState().setStatusLog(jobId, i18n.t("canvas.codexImage.placeholdersReady", { count: n }));
}

/** 仅写入 Codex 真实输出（reasoning / 回复），不写本地进度文案 */
function pushCodexImageLog(jobId: string, text: string) {
    const body = text.trim();
    if (!body) return;
    // 过滤占位/状态类文案，避免冒充 CLI 思考
    if (["正在分析", "已完成分析", "Thinking...", "正在思考...", "正在生成图片", "图片生成完成", "图片生成失败"].includes(body)) return;
    if (body === i18n.t("agent.events.generatingImage") || body === i18n.t("agent.events.imageCompleted")) return;
    useCodexImageJobStore.getState().appendCliLog(jobId, text);
    const latest = codexImageJob(jobId);
    // Codex 声明 COUNT: N 后立刻铺「生成中」占位
    if (latest && !latest.placeholderNodeIds.length && latest.cliLog) {
        const count = parseCodexDeclaredCount(latest.cliLog);
        if (count) ensureCodexPlaceholders(jobId, count);
    }
}

/** 发送单个画布生图任务；每条任务独占一条 Codex 线程，可与其它任务并发。 */
async function runQueuedCodexImageJob(jobId: string, params: {
    endpoint: string;
    token: string;
    clientId: string;
    permissionMode: AgentPermissionMode;
    model: string;
    reasoningEffort: AgentReasoningEffort | "";
}) {
    const job = codexImageJob(jobId);
    if (!job || job.status !== "queued") return;
    const store = useCodexImageJobStore.getState();
    // 先占坑再 await，避免重复 launch 导致同一任务发两遍
    const messageId = createId();
    if (!store.markRunning(jobId, messageId)) return;
    if (!useAgentStore.getState().connected) {
        store.fail(i18n.t("canvas.codexImage.agentRequired"), jobId);
        return;
    }
    if (attachmentPayloadBytes(job.attachments) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
        store.fail(i18n.t("agent.runtime.imagePayloadTooLarge"), jobId);
        return;
    }
    const userText = i18n.t("canvas.codexImage.taskLabel");
    store.setStatusLog(jobId, i18n.t("canvas.codexImage.thinkingSent"));
    useAgentStore.getState().addEventLog({
        id: `${Date.now()}-${Math.random()}`,
        time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        title: i18n.t("agent.runtime.sendTask"),
        text: `Codex Image · gpt-image-2${job.skill ? ` · Skill ${job.skill.name}` : ""} · ${compactText(job.prompt)}`,
    });
    try {
        const accepted = await fetchAgentJson<{ ok?: boolean; threadId?: string }>(params.endpoint, params.token, "/agent/codex/node-turn", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                prompt: job.prompt,
                messageText: userText,
                messageId,
                clientId: params.clientId,
                permissionMode: params.permissionMode,
                model: params.model,
                effort: params.reasoningEffort,
                ...(job.skill ? { skill: job.skill } : {}),
                attachments: job.attachments.map(({ id, name, type, size, width, height, dataUrl }) => ({ id, name, type, size, width, height, dataUrl })),
            }),
        });
        if (!accepted.threadId) throw new Error(i18n.t("agent.runtime.startConversationFailed"));
        useCodexImageJobStore.getState().setScope(jobId, { threadId: accepted.threadId });
    } catch (error) {
        const text = error instanceof Error ? error.message : i18n.t("agent.runtime.sendFailed");
        useCodexImageJobStore.getState().fail(text, jobId);
        useAgentStore.getState().addEventLog({
            id: `${Date.now()}-${Math.random()}`,
            time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
            title: i18n.t("agent.runtime.sendFailed"),
            text,
            raw: error,
        });
    }
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

let codexImageImportChain: Promise<void> = Promise.resolve();

function enqueueCodexImageImport(task: () => Promise<void>) {
    const run = codexImageImportChain.then(task, task);
    codexImageImportChain = run.catch(() => undefined);
    return run;
}

async function importGeneratedImages(endpoint: string, token: string, item: AgentEventItem) {
    // 有落盘路径时只用路径，避免同一张图再解一份 base64 → 双节点
    return importImageSources(endpoint, token, collectImageGenerationSources(item));
}

async function importImageSources(endpoint: string, token: string, sources: string[]) {
    const imported: Array<{
        upload: Awaited<ReturnType<typeof uploadImage>>;
        name: string;
        sourceKey: string;
        attachment: { id: string; name: string; type: string; size: number; width: number; height: number; url: string; dataUrl: string };
    }> = [];
    for (const [index, source] of sources.entries()) {
        try {
            const blob = await readGeneratedImageBlob(endpoint, token, source);
            if (!blob || blob.size < 32) continue;
            const upload = await uploadImage(blob);
            const dataUrl = await readDataUrl(blob);
            const name = guessGeneratedImageName(source, index);
            const sourceKey = isLikelyImagePath(source)
                ? source.trim().toLowerCase()
                : `${upload.width}x${upload.height}:${upload.bytes}:${blob.size}`;
            imported.push({
                upload,
                name,
                sourceKey,
                attachment: { id: createId(), name, type: blob.type || upload.mimeType, size: blob.size, width: upload.width, height: upload.height, url: upload.url, dataUrl },
            });
        } catch (error) {
            console.warn("[codex-image] failed to import source", source.slice(0, 80), error);
        }
    }
    return imported;
}

/** 优先 savedPath；仅当没有路径时才用 base64 result */
function collectImageGenerationSources(item: AgentEventItem) {
    const record = item as Record<string, unknown>;
    const pathKeys = ["savedPath", "saved_path", "path", "filePath", "file_path"];
    const paths: string[] = [];
    for (const key of pathKeys) {
        const value = record[key];
        if (typeof value === "string" && isLikelyImagePath(value.trim())) paths.push(value.trim());
    }
    if (paths.length) return Array.from(new Set(paths));
    return Array.from(collectGeneratedImageSources(item));
}

async function readGeneratedImageBlob(endpoint: string, token: string, source: string) {
    if (source.startsWith("data:image/")) {
        const response = await fetch(source);
        if (!response.ok) throw new Error(rt("generatedImageReadFailed"));
        return response.blob();
    }
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(source) && source.replace(/\s/g, "").length > 256) {
        const raw = source.replace(/\s/g, "");
        const mime = guessBase64Mime(raw);
        const dataUrl = `data:${mime};base64,${raw}`;
        const response = await fetch(dataUrl);
        if (!response.ok) throw new Error(rt("generatedImageReadFailed"));
        return response.blob();
    }
    const response = await fetch(`${endpoint}/agent/local-image?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: source }),
    });
    if (!response.ok) throw new Error(rt("generatedImageReadFailed"));
    return response.blob();
}

function collectGeneratedImageSources(value: unknown, result = new Set<string>(), depth = 0) {
    if (depth > 8 || value == null) return result;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return result;
        if (trimmed.startsWith("data:image/")) {
            result.add(trimmed);
            return result;
        }
        if (isLikelyImagePath(trimmed)) {
            result.add(trimmed);
            return result;
        }
        // Codex 常见：result 为裸 base64 PNG/JPEG，没有 data: 前缀
        const compact = trimmed.replace(/\s/g, "");
        if (compact.length > 256 && /^[A-Za-z0-9+/=]+$/.test(compact) && looksLikeImageBase64(compact)) {
            result.add(compact);
        }
        return result;
    }
    if (Array.isArray(value)) {
        value.forEach((item) => collectGeneratedImageSources(item, result, depth + 1));
        return result;
    }
    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        // 优先读取明确字段，避免把无关长字符串误判成图
        for (const key of ["savedPath", "saved_path", "path", "filePath", "file_path", "result", "b64_json", "image_base64", "imageBase64", "data"]) {
            if (key in record) collectGeneratedImageSources(record[key], result, depth + 1);
        }
        Object.entries(record).forEach(([key, item]) => {
            if (["savedPath", "saved_path", "path", "filePath", "file_path", "result", "b64_json", "image_base64", "imageBase64", "data"].includes(key)) return;
            if (typeof item === "string" && item.length > 200000) return; // 跳过已处理的大字段重复遍历
            collectGeneratedImageSources(item, result, depth + 1);
        });
    }
    return result;
}

/** 从 Codex 回复文本里提取本机图片绝对路径（优先 SAVED: 行，其次任意绝对路径）。 */
function parseSavedImagePaths(text: string) {
    const found = new Set<string>();
    const add = (value: string) => {
        const cleaned = value.trim().replace(/^[`"'<(\[]+/, "").replace(/[`"'>)\].,;：]+$/, "");
        if (cleaned && cleaned.toUpperCase() !== "NONE" && isLikelyImagePath(cleaned)) found.add(cleaned);
    };
    text.split(/\r?\n/).forEach((line) => {
        const saved = /^\s*SAVED\s*[:：]\s*(.+)$/i.exec(line);
        if (saved) add(saved[1]);
    });
    if (found.size) return Array.from(found);
    const pattern = /(?:[a-zA-Z]:[\\/]|\/)[^\s"'`<>|]+\.(?:avif|gif|jpe?g|png|webp)/gi;
    (text.match(pattern) || []).forEach(add);
    return Array.from(found);
}

function isLikelyImagePath(value: string) {
    if (value.includes("\n")) return false;
    if (/^\/.+\.(?:avif|gif|jpe?g|png|webp)$/i.test(value)) return true;
    // Windows: C:\...\.png 或 C:/.../.png
    if (/^[a-zA-Z]:[\\/].+\.(?:avif|gif|jpe?g|png|webp)$/i.test(value)) return true;
    if (/^\\\\.+\.(?:avif|gif|jpe?g|png|webp)$/i.test(value)) return true;
    return false;
}

function looksLikeImageBase64(value: string) {
    return value.startsWith("iVBOR") || value.startsWith("/9j/") || value.startsWith("R0lGOD") || value.startsWith("UklGR") || value.startsWith("AAAA");
}

function guessBase64Mime(value: string) {
    if (value.startsWith("/9j/")) return "image/jpeg";
    if (value.startsWith("R0lGOD")) return "image/gif";
    if (value.startsWith("UklGR")) return "image/webp";
    return "image/png";
}

function guessGeneratedImageName(source: string, index: number) {
    if (source.startsWith("data:image/") || (!source.includes("/") && !source.includes("\\"))) return rt("generatedImageName", { index: index + 1 });
    const normalized = source.replace(/\\/g, "/");
    return normalized.split("/").at(-1) || rt("generatedImageName", { index: index + 1 });
}

function readDataUrl(file: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error(rt("imageReadFailed")));
        reader.readAsDataURL(file);
    });
}

function delay(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
