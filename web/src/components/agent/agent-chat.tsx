import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Tooltip } from "antd";
import { Trash2 } from "lucide-react";
import { motion, useSpring, useTransform } from "motion/react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { summarizeCanvasAgentOps } from "@/lib/canvas/canvas-agent-ops";
import { useAgentStore, type AgentChatItem, type AgentPendingApproval, type AgentPendingToolCall, type AgentTokenUsage } from "@/stores/use-agent-store";
import { useCodexImageJobStore } from "@/stores/use-codex-image-job-store";
import { AgentApprovalCard, AgentChatMessage, AgentCommandGroup, AgentPendingToolCard, AgentToolCard, AgentUserInputCard, AgentWorkingMessage, isUserInputRequest, type AgentUserInputArchive } from "./agent-chat-message";
import { agentMessageToChatMessage, insertAgentMessage, isReasoningSummary, isUserInputMessage, latestLiveReasoning, latestTurnAssistantNote, latestTurnReasoning, toolCallDetail, toolName, workingActivity } from "./agent-event-formatters";
import { AgentScrollToBottom } from "./agent-scroll-to-bottom";

const SCROLL_BOTTOM_THRESHOLD = 48;
const historyMessageStyle = { contentVisibility: "auto", containIntrinsicSize: "0 80px" } as const;

export function AgentChatTimeline({
    theme,
    pendingTool,
    pendingApprovals,
    sending,
    waiting,
    onRejectTool,
    onApproveTool,
    onApprovalDecision,
    onUserInputSubmit,
    onUserInputArchive,
    onDeleteTurn,
    onEditTurn,
    onCancelEditTurn,
    onResendTurn,
    editingTurnId,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    pendingTool: AgentPendingToolCall | null;
    pendingApprovals: AgentPendingApproval[];
    sending: boolean;
    waiting: boolean;
    onRejectTool: () => void;
    onApproveTool: () => void;
    onApprovalDecision: (approval: AgentPendingApproval, decision: "accept" | "acceptForSession" | "decline") => void;
    onUserInputSubmit?: (approval: AgentPendingApproval, answers: Record<string, string[]>) => void;
    onUserInputArchive?: (record: AgentUserInputArchive) => void;
    onDeleteTurn?: (item: AgentChatItem) => void;
    onEditTurn?: (item: AgentChatItem) => void;
    onCancelEditTurn?: () => void;
    onResendTurn?: (item: AgentChatItem, text: string, attachmentIds: string[]) => void;
    editingTurnId?: string;
}) {
    const { t } = useTranslation();
    const messages = useAgentStore((state) => state.messages);
    const activeTurnId = useAgentStore((state) => state.activeTurnId);
    const turns = useMemo(() => groupTimelineTurns(messages), [messages]);
    const listRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const followMessagesRef = useRef(true);
    const prevMessageCountRef = useRef(messages.length);
    const wasSendingRef = useRef(sending);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    // 仅助手流式时隐藏底部等待条；思考摘要的 streamId 不计入，否则会只剩「正在思考」计时、正文被藏起来
    const assistantStreaming = messages.some((message) => message.streamId && message.role === "assistant");
    const liveReasoning = useMemo(() => latestLiveReasoning(messages), [messages]);
    const turnReasoning = useMemo(() => latestTurnReasoning(messages), [messages]);
    const turnAssistantNote = useMemo(() => latestTurnAssistantNote(messages), [messages]);
    const reasoningForUi = liveReasoning || turnReasoning;
    const reasoningHasBody = Boolean(reasoningForUi && isReasoningSummary(reasoningForUi.text));
    const working = workingActivity(liveReasoning || messages.at(-1));
    const reasoningEffort = useAgentStore((state) => state.reasoningEffort);
    const agentProvider = useAgentStore((state) => state.agentProvider);
    const chatThreadId = useAgentStore((state) => state.activeThreadId);
    // 只关心当前会话线程上的生图任务；其它节点的任务在自己的线程里
    const codexImageJob = useCodexImageJobStore((state) => state.jobs.find((job) => job.threadId === chatThreadId) || null);
    const codexImageBusy = Boolean(codexImageJob && (codexImageJob.status === "queued" || codexImageJob.status === "running"));
    const turnLooksLikeCodexImage = useMemo(() => {
        for (let index = messages.length - 1; index >= 0; index--) {
            const message = messages[index];
            if (message.role !== "user") continue;
            return /Codex\s*生图|gpt-image-2|image_gen/i.test(message.text || "");
        }
        return false;
    }, [messages]);
    const imageGenWait = codexImageBusy || turnLooksLikeCodexImage;
    // 生图回合：标题用进度态，不假装「正在思考」；助手说明只留在时间线，等待条不搬正文
    const workingText = imageGenWait && !reasoningHasBody
        ? t("agent.eventMore.operationRunning", { operation: t("agent.events.imageGeneration") })
        : working.text;
    const waitingWithoutReasoningHint = !imageGenWait && (sending || waiting) && !reasoningHasBody && !turnAssistantNote
        ? agentProvider === "cursor"
            ? t("agent.message.waitingCursor")
            : reasoningEffort && reasoningEffort !== "none"
                ? t("agent.message.waitingNoReasoning", { effort: t(`agent.composer.effort.${reasoningEffort}`, { defaultValue: reasoningEffort }) })
                : undefined
        : undefined;
    const workingOwnDetail = ("detail" in working && typeof working.detail === "string" && working.detail) || undefined;
    const imageStatusDetail = imageGenWait && !reasoningHasBody
        ? (codexImageJob?.statusLog || "").trim().split(/\r?\n/).filter(Boolean).at(-1)
        : undefined;
    const workingDetail = workingOwnDetail
        || (reasoningHasBody ? reasoningForUi!.text : undefined)
        || imageStatusDetail
        || waitingWithoutReasoningHint;
    const updateScrollState = useCallback(() => {
        const list = listRef.current;
        if (!list) return;
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
        followMessagesRef.current = atBottom;
        setShowScrollToBottom(!atBottom);
    }, []);
    const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
        const list = listRef.current;
        if (!list) return;
        followMessagesRef.current = true;
        list.scrollTo({ top: list.scrollHeight, behavior });
        setShowScrollToBottom(false);
    }, []);
    useEffect(() => {
        const grew = messages.length > prevMessageCountRef.current;
        const last = messages.at(-1);
        prevMessageCountRef.current = messages.length;
        // 画布点运行 / 对话发送：新用户消息出现时强制跟到底部，避免停在历史中间
        if (grew && last?.role === "user") followMessagesRef.current = true;
        const frame = requestAnimationFrame(() => (followMessagesRef.current ? scrollToBottom("auto") : updateScrollState()));
        return () => cancelAnimationFrame(frame);
    }, [messages, pendingApprovals, pendingTool, scrollToBottom, updateScrollState, waiting]);
    useEffect(() => {
        const started = sending && !wasSendingRef.current;
        wasSendingRef.current = sending;
        if (!started) return;
        followMessagesRef.current = true;
        // 面板刚展开时高度可能还在变，连滚两次确保落到最新一条
        const frame = requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom("auto")));
        return () => cancelAnimationFrame(frame);
    }, [sending, scrollToBottom]);
    useEffect(() => {
        const content = contentRef.current;
        if (!content) return;
        let frame = 0;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => (followMessagesRef.current ? scrollToBottom("auto") : updateScrollState()));
        });
        observer.observe(content);
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [scrollToBottom, updateScrollState]);
    const [editText, setEditText] = useState("");
    const [editAttachmentIds, setEditAttachmentIds] = useState<string[]>([]);
    useEffect(() => {
        if (!editingTurnId) {
            setEditText("");
            setEditAttachmentIds([]);
            return;
        }
        const item = useAgentStore.getState().messages.find((message) => message.id === editingTurnId);
        setEditText(item?.text || "");
        setEditAttachmentIds((item?.attachments || []).map((file) => file.id));
    }, [editingTurnId]);
    const editingTurnIndex = editingTurnId ? turns.findIndex((turn) => turn.user.id === editingTurnId) : -1;
    const liveUserInput = pendingApprovals.filter((approval) => isUserInputRequest(approval) && !approval.deciding);
    const liveUserInputTurnId = liveUserInput[0]?.turnId || activeTurnId;
    const liveUserInputTurn = turns.find((turn) => liveUserInputTurnId && turn.user.turnId === liveUserInputTurnId) || (liveUserInput.length ? turns.at(-1) : undefined);
    const liveUserInputCard = liveUserInput.length ? (
        <AgentUserInputCard
            approvals={liveUserInput}
            theme={theme}
            onSubmit={(approval, answers) => onUserInputSubmit?.(approval, answers)}
            onArchive={onUserInputArchive}
        />
    ) : null;
    return (
        <div className="relative min-h-0 flex-1">
            <div ref={listRef} className="thin-scrollbar h-full select-text overflow-y-auto" onScroll={updateScrollState}>
                <div ref={contentRef} className="space-y-4 px-4 pb-4 pt-4">
                    {turns.map((turn, index) => {
                        if (editingTurnIndex >= 0 && index > editingTurnIndex) return null;
                        const editingThis = editingTurnId === turn.user.id;
                        const canEdit = Boolean(onEditTurn && canMutateUserTurn(turn.user, { sending, waiting, activeTurnId }));
                        return (
                        <div
                            key={turn.id}
                            className="group/turn space-y-4 rounded-xl"
                        >
                            {(editingThis ? turn.entries.filter((entry) => entry.type === "message" && entry.item.id === turn.user.id) : turn.entries).map((entry) => entry.type === "commands"
                                ? <AgentCommandGroupRow key={entry.id} items={entry.items} theme={theme} />
                                : (
                                    <AgentChatMessageRow
                                        key={entry.item.id}
                                        item={entry.item}
                                        theme={theme}
                                        editing={editingThis && entry.item.id === turn.user.id}
                                        canEdit={canEdit && entry.item.role === "user"}
                                        editText={editingThis && entry.item.id === turn.user.id ? editText : undefined}
                                        editAttachmentIds={editingThis && entry.item.id === turn.user.id ? editAttachmentIds : undefined}
                                        onEditTextChange={setEditText}
                                        onRemoveEditAttachment={editingThis ? (id) => setEditAttachmentIds((ids) => ids.filter((item) => item !== id)) : undefined}
                                        onBeginEdit={onEditTurn ? () => onEditTurn(turn.user) : undefined}
                                        onSubmitEdit={onResendTurn ? () => onResendTurn(turn.user, editText, editAttachmentIds) : undefined}
                                        onCancelEdit={onCancelEditTurn}
                                        editSubmitting={sending || waiting}
                                    />
                                ))}
                            {liveUserInputCard && liveUserInputTurn?.id === turn.id && !editingThis ? liveUserInputCard : null}
                            {onDeleteTurn && !editingThis && canMutateUserTurn(turn.user, { sending, waiting, activeTurnId }) ? (
                                <div className="flex justify-end opacity-0 transition-opacity group-hover/turn:opacity-100 focus-within:opacity-100">
                                    <Tooltip title={t("agent.chat.deleteTurn")}>
                                        <Button
                                            danger
                                            type="text"
                                            size="small"
                                            className="!h-7 !px-2 !text-xs"
                                            aria-label={t("agent.chat.deleteTurn")}
                                            icon={<Trash2 className="size-3.5" />}
                                            onClick={() => onDeleteTurn(turn.user)}
                                        >
                                            {t("agent.chat.deleteTurn")}
                                        </Button>
                                    </Tooltip>
                                </div>
                            ) : null}
                        </div>
                    );
                    })}
                    {liveUserInputCard && !liveUserInputTurn && editingTurnIndex < 0 ? liveUserInputCard : null}
                    {editingTurnIndex >= 0 ? null : pendingTool ? (
                        <AgentPendingToolCard
                            summary={summarizeCanvasAgentOps(pendingTool.input?.ops || []) || toolName(pendingTool.name)}
                            detail={toolCallDetail(pendingTool.name, pendingTool.input, "pending")}
                            theme={theme}
                            onReject={onRejectTool}
                            onApprove={onApproveTool}
                        />
                    ) : null}
                    {editingTurnIndex >= 0 ? null : pendingApprovals.filter((approval) => !isUserInputRequest(approval)).map((approval) => (
                        <AgentApprovalCard key={approval.requestId} approval={approval} theme={theme} onDecision={(decision) => onApprovalDecision(approval, decision)} />
                    ))}
                    {(sending || waiting) && editingTurnIndex < 0 && !assistantStreaming && !pendingTool && !pendingApprovals.some((approval) => !approval.deciding) ? (
                        <AgentWorkingMessage text={workingText} detail={workingDetail} activityKey={working.key} theme={theme} />
                    ) : null}
                </div>
            </div>
            {showScrollToBottom ? (
                <AgentScrollToBottom theme={theme} title={t("agent.chat.latestMessages")} onClick={() => scrollToBottom()} />
            ) : null}
        </div>
    );
}

const AgentChatMessageRow = memo(function AgentChatMessageRow({
    item,
    theme,
    editing,
    canEdit,
    editText,
    editAttachmentIds,
    onEditTextChange,
    onRemoveEditAttachment,
    onBeginEdit,
    onSubmitEdit,
    onCancelEdit,
    editSubmitting,
}: {
    item: AgentChatItem;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    editing?: boolean;
    canEdit?: boolean;
    editText?: string;
    editAttachmentIds?: string[];
    onEditTextChange?: (value: string) => void;
    onRemoveEditAttachment?: (id: string) => void;
    onBeginEdit?: () => void;
    onSubmitEdit?: () => void;
    onCancelEdit?: () => void;
    editSubmitting?: boolean;
}) {
    return (
        <div style={item.streamId || editing ? undefined : historyMessageStyle}>
            <AgentChatMessage
                item={agentMessageToChatMessage(item)}
                theme={theme}
                editing={editing}
                canEdit={canEdit}
                editText={editText}
                editAttachmentIds={editAttachmentIds}
                onEditTextChange={onEditTextChange}
                onRemoveEditAttachment={onRemoveEditAttachment}
                onBeginEdit={onBeginEdit}
                onSubmitEdit={onSubmitEdit}
                onCancelEdit={onCancelEdit}
                editSubmitting={editSubmitting}
            />
        </div>
    );
});

function canMutateUserTurn(item: AgentChatItem, state: { sending: boolean; waiting: boolean; activeTurnId: string }) {
    if (item.role !== "user") return false;
    if ((state.sending || state.waiting) && item.turnId && item.turnId === state.activeTurnId) return false;
    return true;
}

type AgentTimelineEntry = { type: "message"; item: AgentChatItem } | { type: "commands"; id: string; items: AgentChatItem[] };
type AgentTimelineTurn = { id: string; user: AgentChatItem; entries: AgentTimelineEntry[] };

function groupTimelineTurns(messages: AgentChatItem[]): AgentTimelineTurn[] {
    const turns: AgentTimelineTurn[] = [];
    let current: AgentTimelineTurn | null = null;
    groupTimelineMessages(restackUserInputMessages(messages)).forEach((entry) => {
        if (entry.type === "message" && entry.item.role === "user") {
            current = { id: entry.item.id, user: entry.item, entries: [entry] };
            turns.push(current);
            return;
        }
        if (!current) {
            const seed = entry.type === "message" ? entry.item : entry.items[0];
            current = { id: seed.id, user: seed, entries: [entry] };
            turns.push(current);
            return;
        }
        current.entries.push(entry);
    });
    return turns;
}

const AgentCommandGroupRow = memo(function AgentCommandGroupRow({ items, theme }: { items: AgentChatItem[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <div style={items.some((item) => item.streamId) ? undefined : historyMessageStyle}>
            <AgentCommandGroup items={items} theme={theme} />
        </div>
    );
});

function restackUserInputMessages(messages: AgentChatItem[]) {
    const archives = messages.filter((item) => isUserInputMessage(item));
    if (!archives.length) return messages;
    let next = messages.filter((item) => !isUserInputMessage(item));
    for (const item of archives) next = insertAgentMessage(next, item);
    return next;
}

function groupTimelineMessages(messages: AgentChatItem[]) {
    // Cursor 每回合只有一份累计思考摘要；历史恢复或迟到事件可能将它追加在回复后。
    const ordered = [...messages];
    for (const item of messages) {
        if (!item.threadId || !item.turnId || !(item.itemId || item.id).startsWith("cursor-thought-")) continue;
        const thoughtIndex = ordered.indexOf(item);
        const answerIndex = ordered.findIndex((entry) => entry.role === "assistant" && entry.threadId === item.threadId && entry.turnId === item.turnId);
        if (answerIndex < 0 || thoughtIndex < answerIndex) continue;
        ordered.splice(thoughtIndex, 1);
        ordered.splice(answerIndex, 0, item);
    }
    const timeline: AgentTimelineEntry[] = [];
    let commands: AgentChatItem[] = [];
    let commandScope = "";
    const flushCommands = () => {
        if (!commands.length) return;
        timeline.push({ type: "commands", id: `commands:${commands[0].id}`, items: commands });
        commands = [];
        commandScope = "";
    };
    ordered.forEach((item) => {
        if (isCommandMessage(item)) {
            const scope = item.threadId && item.turnId ? `${item.threadId}\0${item.turnId}` : item.id;
            if (commands.length && scope !== commandScope) flushCommands();
            commands.push(item);
            commandScope = scope;
            return;
        }
        flushCommands();
        timeline.push({ type: "message", item });
    });
    flushCommands();
    return timeline;
}

function isCommandMessage(item: AgentChatItem) {
    return item.role === "tool" && item.detail && typeof item.detail === "object" && (item.detail as { kind?: unknown }).kind === "command";
}

export function AgentUsageBar({ usage, theme }: { usage: AgentTokenUsage; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    return (
        <div className="flex items-center justify-center gap-4 px-4 pt-1 text-[11px] tabular-nums" style={{ color: theme.node.muted }}>
            <span className="opacity-70">{t("agent.chat.latestCall")}</span>
            <UsageNumber label={t("agent.chat.input")} value={usage.input} color={theme.node.text} />
            <UsageNumber label={t("agent.chat.cached")} value={usage.cached} color={theme.node.text} />
            <UsageNumber label={t("agent.chat.output")} value={usage.output} color={theme.node.text} />
        </div>
    );
}

function UsageNumber({ label, value, color }: { label: string; value: number; color: string }) {
    const spring = useSpring(value, { stiffness: 110, damping: 24, mass: 0.7 });
    const text = useTransform(spring, (current) => Math.round(current).toLocaleString());
    useEffect(() => spring.set(value), [spring, value]);
    return (
        <span className="inline-flex items-baseline gap-1" aria-label={`${label} ${value.toLocaleString()}`}>
            <span>{label}</span>
            <motion.span aria-hidden className="font-medium" style={{ color }}>
                {text}
            </motion.span>
        </span>
    );
}
