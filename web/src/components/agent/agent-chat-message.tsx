import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { App, Button, Image, Input, Modal } from "antd";
import { Brain, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, CircleAlert, Copy, ExternalLink, FilePenLine, FileText, FolderOpen, ListChecks, LoaderCircle, Pencil, Search, ShieldAlert, TerminalSquare, Wrench, X, XCircle } from "lucide-react";
import { Streamdown, type LinkSafetyModalProps } from "streamdown";
import { useTranslation } from "react-i18next";

import { prepareAgentMarkdown, isAsciiDiagramText } from "@/lib/agent/agent-markdown-diagram";
import i18n from "@/i18n";
import { useCopyText } from "@/hooks/use-copy-text";
import { canvasThemes } from "@/lib/canvas-theme";
import { useAgentStore, type AgentPendingApproval, type AgentUserInputQuestion } from "@/stores/use-agent-store";
import { lastMessageAnchorInTurn } from "./agent-event-formatters";
import { revealAgentLocalFile } from "@/services/api/canvas-agent";
import { isPlainEnterKey } from "@/lib/keyboard-event";
import { AgentPlanDocumentCard } from "./agent-plan-document-card";

/** 把本地路径伪装成 http，绕过 rehype-harden 对 file: / Windows 盘符的 [blocked] */
const LOCAL_LINK_PREFIX = "http://127.0.0.1/__infinite_canvas_local__?path=";

const streamdownProps = () => ({
    className: "agent-streamdown",
    controls: { code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false } },
    linkSafety: { enabled: true, renderModal: (props: LinkSafetyModalProps) => <AgentLinkModal {...props} /> },
    lineNumbers: false,
    translations: {
        close: tr("close"), copied: tr("copied"), copyCode: tr("copyCode"), copyLink: tr("copyLink"), externalLinkWarning: tr("externalWarning"), openExternalLink: tr("openExternal"), openLink: tr("continueOpen"),
    },
} as const);
const streamdownAnimation = { duration: 20, stagger: 0, sep: "word" } as const;

/** Codex 常输出 `[name](C:\\...\\file)`；harden 会标 [blocked]。改写成可点的本地打开链接。 */
function rewriteAgentMarkdownLocalLinks(markdown: string) {
    return markdown.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (full, label: string, href: string) => {
        const path = localFilePath(href.trim().replace(/^<|>$/g, ""));
        if (!path) return full;
        return `[${label}](${LOCAL_LINK_PREFIX}${encodeURIComponent(path)})`;
    });
}

function AgentLinkModal({ isOpen, onClose, onConfirm, url }: LinkSafetyModalProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const copyText = useCopyText();
    const localPath = localFilePath(url);
    const [opening, setOpening] = useState(false);
    const open = async () => {
        if (!localPath) return onConfirm();
        const { url: endpoint, token } = useAgentStore.getState();
        setOpening(true);
        try {
            await revealAgentLocalFile(endpoint, token, localPath);
            message.success(t("agent.message.revealed"));
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("agent.message.openLocalFailed"));
        } finally {
            setOpening(false);
        }
    };
    return (
        <Modal open={isOpen} onCancel={onClose} footer={null} centered width={420} title={t(localPath ? "agent.message.openLocal" : "agent.message.openExternal")}>
            <div className="text-sm text-black/55 dark:text-white/55">
                {t(localPath ? "agent.message.localDescription" : "agent.message.externalDescription")}
            </div>
            <div className="mt-4 max-h-32 overflow-auto break-all rounded-lg bg-black/[.035] px-3 py-2.5 font-mono text-xs leading-5 dark:bg-white/[.06]">{localPath || url}</div>
            <div className="mt-5 flex justify-end gap-2">
                <Button type="text" icon={<Copy className="size-4" />} onClick={() => copyText(localPath || url, t(localPath ? "agent.message.pathCopied" : "agent.message.linkCopied"))}>
                    {t(localPath ? "agent.message.copyPath" : "agent.message.copyLink")}
                </Button>
                <Button type="text" loading={opening} icon={localPath ? <FolderOpen className="size-4" /> : <ExternalLink className="size-4" />} onClick={open}>
                    {t(localPath ? "agent.message.showInFolder" : "agent.message.continueOpen")}
                </Button>
            </div>
        </Modal>
    );
}

function localFilePath(value: string) {
    let decoded = value.trim();
    try {
        decoded = decodeURI(decoded);
    } catch {}
    // 经 rewriteAgentMarkdownLocalLinks 伪装的本地链接
    if (decoded.startsWith(LOCAL_LINK_PREFIX) || decoded.includes("/__infinite_canvas_local__?path=")) {
        try {
            const parsed = new URL(decoded.startsWith("http") ? decoded : `http://127.0.0.1${decoded}`);
            const path = parsed.searchParams.get("path") || "";
            return path ? decodeURIComponent(path) : "";
        } catch {
            return "";
        }
    }
    if (decoded.startsWith("file://")) {
        try {
            let pathname = decodeURIComponent(new URL(decoded).pathname);
            // Windows: file:///C:/Users/... → /C:/Users/... → C:/Users/...
            if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
            return pathname.replace(/\//g, "\\");
        } catch {
            return "";
        }
    }
    // Markdown 里常见 C:\path 或 C:/path
    if (/^[A-Za-z]:[\\/]/.test(decoded)) return decoded.replace(/\//g, "\\");
    let pathname = decoded;
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
        try {
            const parsed = new URL(decoded);
            if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) return "";
            pathname = parsed.pathname;
        } catch {
            return "";
        }
    }
    return /^\/(?:Users|home|private|tmp|Volumes|var\/folders)\//.test(pathname) ? decodeURIComponent(pathname) : "";
}

export type AgentChatAttachment = {
    id: string;
    name: string;
    url: string;
    kind?: "image" | "file" | "folder" | "text";
    localPath?: string;
};
export type AgentChatMessageItem = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    attachments?: AgentChatAttachment[];
    /** Present while the message is actively streaming; cleared on completion. */
    streamId?: string;
};

export function AgentChatMessage({
    item,
    theme,
    onRejectTool,
    onApproveTool,
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
    item: AgentChatMessageItem;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onRejectTool?: (id: string) => void;
    onApproveTool?: (id: string) => void;
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
    const { t } = useTranslation();
    const editRef = useRef<HTMLTextAreaElement>(null);
    const isUser = item.role === "user";
    const isSystem = item.role === "system";
    const color = item.role === "error" ? "#dc2626" : item.role === "tool" ? "#2563eb" : theme.node.text;
    useEffect(() => {
        if (!editing) return;
        const el = editRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
    }, [editing]);
    if (isSystem) {
        return (
            <div className="flex justify-center text-xs">
                <div className="max-w-[88%] px-3 py-1.5 text-center" style={{ color: theme.node.muted }}>
                    {item.text}
                    {item.meta ? <span className="ml-2 opacity-60">{item.meta}</span> : null}
                </div>
            </div>
        );
    }
    if (item.role === "tool") {
        if (objectField(item.detail, "kind") === "plan") return <AgentPlanDocumentCard title={item.title || i18n.t("agent.plan.title")} text={item.text} detail={item.detail} theme={theme} />;
        if (objectField(item.detail, "status") === "pending") return <AgentPendingToolCard summary={item.text} detail={item.detail} theme={theme} onReject={() => onRejectTool?.(item.id)} onApprove={() => onApproveTool?.(item.id)} />;
        return <AgentToolCard title={item.title || tr("toolCall")} text={item.text} detail={item.detail} theme={theme} />;
    }
    if (isUser) {
        const draft = editText ?? item.text;
        const editAttachments = editing ? (item.attachments || []).filter((file) => !editAttachmentIds || editAttachmentIds.includes(file.id)) : item.attachments;
        const canSend = Boolean(draft.trim() || editAttachments?.length);
        return (
            <div className="flex justify-start">
                <div
                    className={`group/user min-w-0 w-full rounded-xl border bg-black/[0.03] px-3 py-2.5 text-left text-sm leading-6 dark:bg-white/[0.05] ${canEdit && !editing ? "cursor-text" : ""}`}
                    style={{ color, borderColor: theme.node.stroke }}
                    onClick={(event) => {
                        if (!canEdit || editing) return;
                        if ((event.target as HTMLElement).closest("img,button")) return;
                        const selection = window.getSelection()?.toString();
                        if (selection) return;
                        onBeginEdit?.();
                    }}
                >
                    {editing ? (
                        <>
                            <textarea
                                ref={editRef}
                                value={draft}
                                disabled={editSubmitting}
                                rows={Math.min(12, Math.max(2, draft.split("\n").length + 1))}
                                className="w-full resize-none bg-transparent text-sm leading-6 outline-none"
                                style={{ color }}
                                onChange={(event) => onEditTextChange?.(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Escape") {
                                        event.preventDefault();
                                        onCancelEdit?.();
                                        return;
                                    }
                                    if (isPlainEnterKey(event) && canSend && !editSubmitting) {
                                        event.preventDefault();
                                        onSubmitEdit?.();
                                    }
                                }}
                            />
                            {editAttachments?.length ? <AgentMessageAttachments attachments={editAttachments} alignRight={false} onRemove={editSubmitting ? undefined : onRemoveEditAttachment} /> : null}
                            <div className="mt-2 flex justify-end gap-2">
                                <Button type="text" size="small" className="!h-7" disabled={editSubmitting} onClick={() => onCancelEdit?.()}>
                                    {t("common.cancel")}
                                </Button>
                                <Button type="primary" size="small" className="!h-7" disabled={!canSend} loading={editSubmitting} onClick={() => onSubmitEdit?.()}>
                                    {t("agent.composer.send")}
                                </Button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{item.text}</div>
                                {canEdit ? (
                                    <button
                                        type="button"
                                        className="mt-0.5 shrink-0 rounded-md p-1 opacity-0 transition-opacity group-hover/user:opacity-100 focus:opacity-100"
                                        style={{ color: theme.node.muted }}
                                        aria-label={t("agent.chat.editTurn")}
                                        title={t("agent.chat.editTurnHint")}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onBeginEdit?.();
                                        }}
                                    >
                                        <Pencil className="size-3.5" />
                                    </button>
                                ) : null}
                            </div>
                            {item.attachments?.length ? <AgentMessageAttachments attachments={item.attachments} alignRight={false} /> : null}
                            {item.meta ? <div className="mt-1 text-[11px] tabular-nums opacity-55">{item.meta}</div> : null}
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex justify-start">
            <div className="min-w-0 w-full max-w-full overflow-x-clip text-left text-sm leading-6" style={{ color }}>
                <Streamdown {...streamdownProps()} animated={streamdownAnimation} mode={item.streamId ? "streaming" : "static"}>
                    {prepareAgentMarkdown(rewriteAgentMarkdownLocalLinks(item.text))}
                </Streamdown>
                {item.attachments?.length ? <AgentMessageAttachments attachments={item.attachments} alignRight={false} /> : null}
                {item.meta ? <div className="mt-1 text-[11px] tabular-nums opacity-55">{item.meta}</div> : null}
            </div>
        </div>
    );
}

export function AgentPendingToolCard({ summary, detail, theme, onReject, onApprove }: { summary: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onReject?: () => void; onApprove?: () => void }) {
    const { t } = useTranslation();
    const view = userDetail(detail);
    return (
        <div className="min-w-0 rounded-xl border px-3 py-3" style={{ borderColor: "rgba(217,119,6,.28)", background: "rgba(217,119,6,.025)", color: theme.node.text }}>
            <details className="group">
                <summary className={`list-none ${view ? "cursor-pointer" : "cursor-default"}`} onClick={(event) => { if (!view) event.preventDefault(); }}>
                    <div className="flex min-w-0 items-center gap-2 text-sm font-medium leading-5">
                        <CircleAlert className="size-4 shrink-0 text-amber-600" />
                        <span className="min-w-0 flex-1">{t("agent.message.awaitingConfirmation")}</span>
                        {view ? <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" style={{ color: theme.node.muted }} /> : null}
                    </div>
                    <div className="mt-1 pl-6 text-sm leading-5" style={{ color: theme.node.muted }}>{summary}</div>
                </summary>
                {view ? <div className="ml-6"><AgentDetailBlock detail={view} theme={theme} /></div> : null}
            </details>
            {onReject || onApprove ? (
                <div className="mt-3 flex justify-end gap-2 border-t pt-3" style={{ borderColor: theme.node.stroke }}>
                    <Button danger type="text" className="!h-8" icon={<XCircle className="size-3.5" />} onClick={() => onReject?.()}>
                        {t("agent.message.reject")}
                    </Button>
                    <Button type="text" className="!h-8" icon={<CheckCircle2 className="size-3.5" />} style={{ color: "#16a34a" }} onClick={() => onApprove?.()}>
                        {t("agent.message.approve")}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}

export function AgentApprovalCard({ approval, theme, onDecision }: { approval: AgentPendingApproval; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onDecision: (decision: "accept" | "acceptForSession" | "decline") => void }) {
    const { t } = useTranslation();
    const isFile = approval.method === "item/fileChange/requestApproval";
    const isNetwork = Boolean(approval.networkApprovalContext);
    const title = t(isNetwork ? "agent.message.networkApproval" : isFile ? "agent.message.fileApproval" : approval.method === "item/permissions/requestApproval" ? "agent.message.permissionApproval" : "agent.message.commandApproval");
    const target = isNetwork ? approvalTarget(approval.networkApprovalContext) : isFile ? approval.grantRoot || approval.cwd : commandText(approval.command) || approval.cwd;
    return (
        <div className="min-w-0 rounded-xl border px-3 py-3" style={{ borderColor: "rgba(234,88,12,.32)", background: "rgba(234,88,12,.035)", color: theme.node.text }}>
            <div className="flex items-start gap-2.5">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-orange-600" />
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{title}</div>
                    {approval.reason ? <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>{approval.reason}</div> : null}
                    {target ? <div className="mt-1.5 break-all rounded-lg px-2.5 py-2 font-mono text-[11px] leading-4" style={{ background: theme.toolbar.panel, color: theme.node.text }}>{target}</div> : null}
                </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-1.5 border-t pt-3" style={{ borderColor: theme.node.stroke }}>
                <Button danger type="text" className="!h-8" disabled={Boolean(approval.deciding)} loading={approval.deciding === "decline"} onClick={() => onDecision("decline")}>{t("agent.message.decline")}</Button>
                <Button type="text" className="!h-8" disabled={Boolean(approval.deciding)} loading={approval.deciding === "accept"} onClick={() => onDecision("accept")}>{t("agent.message.allowOnce")}</Button>
                <Button type="text" className="!h-8" disabled={Boolean(approval.deciding)} loading={approval.deciding === "acceptForSession"} style={{ color: "#ea580c" }} onClick={() => onDecision("acceptForSession")}>{t("agent.message.allowSession")}</Button>
            </div>
        </div>
    );
}

const OTHER_OPTION = "__canvas_other__";

export function isUserInputRequest(approval: AgentPendingApproval) {
    return approval.method === "item/tool/requestUserInput" || approval.method === "tool/requestUserInput" || approval.method.endsWith("/requestUserInput");
}

export function isPlanSwitchAsk(approval: AgentPendingApproval) {
    if (!isUserInputRequest(approval)) return false;
    return (approval.questions || []).some((item) => {
        const text = `${item.header || ""} ${item.question}`;
        return /SWITCH_TO_PLAN/i.test(text) || /切换到规划|切换至规划|进入规划|switch to plan/i.test(text);
    });
}

export type AgentUserInputArchive = {
    entries: Array<{ header?: string; question: string; answer: string }>;
    anchorAfterId?: string;
};

function PlanSwitchAskCard({
    approvals,
    theme,
    submitting,
    onSubmit,
    onArchive,
}: {
    approvals: AgentPendingApproval[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    submitting: boolean;
    onSubmit: (approval: AgentPendingApproval, answers: Record<string, string[]>) => void | Promise<void>;
    onArchive?: (record: AgentUserInputArchive) => void;
}) {
    const { t } = useTranslation();
    const [picked, setPicked] = useState<"yes" | "no" | "">("");
    const busy = submitting || Boolean(picked);
    const question = approvals.flatMap((approval) => approval.questions || [])[0];
    const choose = async (yes: boolean) => {
        if (busy) return;
        setPicked(yes ? "yes" : "no");
        const label = yes ? t("agent.panel.planSwitchYes") : t("agent.panel.planSwitchNo");
        const entries = approvals.flatMap((approval) => (approval.questions || []).map((item) => ({ header: item.header, question: item.question, answer: label })));
        const state = useAgentStore.getState();
        const turnId = approvals[0]?.turnId || state.activeTurnId;
        const anchorAfterId = approvals.find((approval) => approval.anchorAfterId)?.anchorAfterId
            || approvals.find((approval) => approval.itemId)?.itemId
            || lastMessageAnchorInTurn(state.messages, state.activeThreadId, turnId);
        onArchive?.({ entries, anchorAfterId: anchorAfterId || undefined });
        try {
            for (const approval of approvals) {
                if (approval.deciding) continue;
                await onSubmit(approval, Object.fromEntries((approval.questions || []).map((item) => [item.id, [label]])));
            }
        } catch {
            setPicked("");
        }
    };
    return (
        <div className="min-w-0 overflow-hidden rounded-xl border px-3.5 py-3.5" style={{ borderColor: "#ea580c", background: "transparent", color: theme.node.text }}>
            <div className="flex items-center gap-2 text-[11px] leading-4" style={{ color: theme.node.muted }}>
                <ListChecks className="size-3.5 shrink-0" />
                <span>{t("agent.panel.planSwitchTitle")}</span>
            </div>
            <div className="mt-2 text-sm leading-6">{question?.question || t("agent.panel.planSwitchHint")}</div>
            <div className="mt-3.5 flex justify-end gap-2">
                <button
                    type="button"
                    disabled={busy}
                    className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ color: theme.node.text, border: `1px solid ${theme.node.stroke}` }}
                    onClick={() => void choose(false)}
                >
                    {picked === "no" ? <LoaderCircle className="mr-1.5 size-3.5 animate-spin" /> : null}
                    {t("agent.panel.planSwitchNo")}
                </button>
                <button
                    type="button"
                    disabled={busy}
                    className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: theme.node.fill, color: theme.node.text, border: `1px solid ${theme.node.stroke}` }}
                    onClick={() => void choose(true)}
                >
                    {picked === "yes" ? <LoaderCircle className="mr-1.5 size-3.5 animate-spin" /> : null}
                    {t("agent.panel.planSwitchYes")}
                </button>
            </div>
        </div>
    );
}

export function AgentUserInputCard({ approvals, theme, onSubmit, onArchive }: { approvals: AgentPendingApproval[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onSubmit: (approval: AgentPendingApproval, answers: Record<string, string[]>) => void | Promise<void>; onArchive?: (record: AgentUserInputArchive) => void }) {
    const { t } = useTranslation();
    const questions = approvals.flatMap((approval) => (Array.isArray(approval.questions) ? approval.questions : [])
        .filter((item) => item?.id && item.question)
        .map((item) => ({ ...item, requestId: approval.requestId, key: `${approval.requestId}:${item.id}` })));
    const [selected, setSelected] = useState<Record<string, string>>({});
    const [otherText, setOtherText] = useState<Record<string, string>>({});
    const [submitted, setSubmitted] = useState(false);
    const submittedRef = useRef(false);
    const submitting = submitted || approvals.every((approval) => Boolean(approval.deciding));
    const isComplete = (nextSelected: Record<string, string>, nextOther: Record<string, string>) => questions.length > 0 && questions.every((question) => {
        const answer = nextSelected[question.key];
        if (!answer) return false;
        if (answer === OTHER_OPTION) return Boolean(nextOther[question.key]?.trim());
        return true;
    });
    const complete = isComplete(selected, otherText);
    const hasSelection = questions.some((question) => Boolean(selected[question.key]));
    if (approvals.length && approvals.every(isPlanSwitchAsk)) {
        return <PlanSwitchAskCard approvals={approvals} theme={theme} submitting={submitting} onSubmit={onSubmit} onArchive={onArchive} />;
    }
    const submitAll = async () => {
        if (submittedRef.current) return;
        if (!isComplete(selected, otherText)) return;
        submittedRef.current = true;
        setSubmitted(true);
        const entries = questions.map((question) => ({
            header: question.header,
            question: question.question,
            answer: selected[question.key] === OTHER_OPTION ? otherText[question.key].trim() : selected[question.key],
        }));
        const state = useAgentStore.getState();
        const turnId = approvals[0]?.turnId || state.activeTurnId;
        const anchorAfterId = approvals.find((approval) => approval.anchorAfterId)?.anchorAfterId
            || approvals.find((approval) => approval.itemId)?.itemId
            || lastMessageAnchorInTurn(state.messages, state.activeThreadId, turnId);
        onArchive?.({ entries, anchorAfterId: anchorAfterId || undefined });
        for (const approval of approvals) {
            if (approval.deciding) continue;
            const answers = Object.fromEntries(questions
                .filter((question) => question.requestId === approval.requestId)
                .map((question) => {
                    const value = selected[question.key];
                    return [question.id, [value === OTHER_OPTION ? otherText[question.key].trim() : value]];
                }));
            await onSubmit(approval, answers);
        }
    };
    return (
        <div className="min-w-0 overflow-hidden rounded-xl border px-3.5 pb-3.5 pt-3.5 transition-colors" style={{ borderColor: hasSelection ? "#16a34a" : "#ea580c", background: "transparent", color: theme.node.text }}>
            <div className="flex items-center gap-2 text-[11px] leading-4" style={{ color: theme.node.muted }}>
                <ListChecks className="size-3.5 shrink-0" />
                <span>{t("agent.message.userInput")}</span>
            </div>
            <div className="mt-3 space-y-5">
                {questions.map((question) => (
                    <UserInputQuestion
                        key={question.key}
                        question={question}
                        selected={selected[question.key] || ""}
                        otherText={otherText[question.key] || ""}
                        disabled={submitting}
                        theme={theme}
                        onSelect={(value) => setSelected((current) => ({ ...current, [question.key]: value }))}
                        onOtherText={(value) => setOtherText((current) => ({ ...current, [question.key]: value }))}
                    />
                ))}
            </div>
            <div className="mt-3.5 flex justify-end">
                <button
                    type="button"
                    disabled={!complete || submitting}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
                    style={{
                        background: complete ? theme.node.fill : "transparent",
                        color: theme.node.text,
                        border: `1px solid ${theme.node.stroke}`,
                    }}
                    onClick={() => void submitAll()}
                >
                    {submitting ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                    {t("agent.message.userInputSubmit")}
                </button>
            </div>
        </div>
    );
}

function AgentUserInputRecordCard({ text, detail, theme }: { text: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const entries = userInputArchiveEntries(detail);
    const preview = entries.map((item) => item.answer).filter(Boolean).join(" · ") || text;
    return (
        <details className="group min-w-0 overflow-hidden rounded-xl border px-3.5 py-2.5 text-left" style={{ borderColor: "#16a34a", color: theme.node.text }}>
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
                <ListChecks className="size-4 shrink-0" style={{ color: "#16a34a" }} />
                <span className="min-w-0 flex-1 truncate font-medium">{t("agent.message.userInputAnswered")}</span>
                <span className="hidden min-w-0 max-w-[55%] truncate text-[11px] sm:block" style={{ color: theme.node.muted }}>{preview}</span>
                <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>{t("agent.message.userInputAnsweredCount", { count: entries.length || 1 })}</span>
                <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" style={{ color: theme.node.muted }} />
            </summary>
            <div className="mt-2.5 space-y-3 border-t pt-2.5" style={{ borderColor: theme.node.stroke }}>
                {entries.map((item, index) => (
                    <div key={`${item.question}-${index}`} className="min-w-0">
                        {item.header ? <div className="text-[11px] leading-4" style={{ color: theme.node.faint }}>{item.header}</div> : null}
                        <div className={`${item.header ? "mt-1" : ""} text-sm leading-5`} style={{ color: theme.node.muted }}>{item.question}</div>
                        <div className="mt-1.5 flex items-start gap-1.5 text-sm font-medium leading-5">
                            <Check className="mt-0.5 size-3.5 shrink-0" style={{ color: "#16a34a" }} />
                            <span>{item.answer}</span>
                        </div>
                    </div>
                ))}
            </div>
        </details>
    );
}

function userInputArchiveEntries(detail: unknown): AgentUserInputArchive["entries"] {
    const raw = detail && typeof detail === "object" && "entries" in detail ? (detail as { entries?: unknown }).entries : null;
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => {
        const entry = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return {
            header: entry.header ? String(entry.header) : undefined,
            question: String(entry.question || ""),
            answer: String(entry.answer || ""),
        };
    }).filter((item) => item.question || item.answer);
}

function UserInputQuestion({
    question,
    selected,
    otherText,
    disabled,
    theme,
    onSelect,
    onOtherText,
}: {
    question: AgentUserInputQuestion;
    selected: string;
    otherText: string;
    disabled: boolean;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onSelect: (value: string) => void;
    onOtherText: (value: string) => void;
}) {
    const { t } = useTranslation();
    const options = question.options?.filter((item) => item.label || item.value) || [];
    const allowOther = question.isOther !== false;
    const textOnly = options.length === 0;
    const rows = [
        ...options.map((option, index) => ({
            key: option.label || option.value || String(index),
            value: option.label || option.value || "",
            label: option.label || option.value || "",
            description: option.description || "",
            letter: String.fromCharCode(65 + index),
        })),
        ...(allowOther && !textOnly ? [{ key: OTHER_OPTION, value: OTHER_OPTION, label: t("agent.message.userInputOther"), description: "", letter: String.fromCharCode(65 + options.length) }] : []),
    ];
    return (
        <div className="min-w-0">
            {question.header ? <div className="text-[11px] leading-4" style={{ color: theme.node.faint }}>{question.header}</div> : null}
            <div className={`${question.header ? "mt-1" : ""} text-[15px] font-medium leading-6`}>{question.question}</div>
            {textOnly ? (
                question.isSecret ? (
                    <Input.Password
                        className="mt-2.5"
                        disabled={disabled}
                        value={otherText}
                        placeholder={t("agent.message.userInputOtherPlaceholder")}
                        onChange={(event) => {
                            onOtherText(event.target.value);
                            onSelect(OTHER_OPTION);
                        }}
                    />
                ) : (
                    <Input.TextArea
                        className="mt-2.5"
                        autoSize={{ minRows: 2, maxRows: 5 }}
                        disabled={disabled}
                        value={otherText}
                        placeholder={t("agent.message.userInputOtherPlaceholder")}
                        onChange={(event) => {
                            onOtherText(event.target.value);
                            onSelect(OTHER_OPTION);
                        }}
                    />
                )
            ) : (
                <div className="mt-2.5 overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke }}>
                    {rows.map((row, index) => {
                        const active = selected === row.value;
                        return (
                            <button
                                key={row.key}
                                type="button"
                                disabled={disabled}
                                onClick={() => onSelect(row.value)}
                                className="flex w-full min-w-0 items-start gap-2.5 px-3 py-2.5 text-left text-sm leading-5 transition hover:bg-black/[.03] disabled:cursor-not-allowed dark:hover:bg-white/[.04]"
                                style={{
                                    background: active ? theme.toolbar.activeBg : "transparent",
                                    color: theme.node.text,
                                    borderBottom: index < rows.length - 1 ? `1px solid ${theme.node.stroke}` : "none",
                                }}
                            >
                                <span className="mt-px w-4 shrink-0 text-[11px] font-medium tabular-nums" style={{ color: active ? theme.node.text : theme.node.faint }}>{row.letter}</span>
                                <span className="min-w-0 flex-1">
                                    <span className="block">{row.label}</span>
                                    {row.description ? <span className="mt-0.5 block text-xs leading-5" style={{ color: theme.node.muted }}>{row.description}</span> : null}
                                    {row.value === OTHER_OPTION && active ? (
                                        <Input
                                            className="mt-2"
                                            disabled={disabled}
                                            value={otherText}
                                            type={question.isSecret ? "password" : undefined}
                                            placeholder={t("agent.message.userInputOtherPlaceholder")}
                                            onClick={(event) => event.stopPropagation()}
                                            onChange={(event) => onOtherText(event.target.value)}
                                        />
                                    ) : null}
                                </span>
                                <Check className="mt-0.5 size-3.5 shrink-0" style={{ color: theme.node.text, opacity: active ? 1 : 0 }} />
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export function AgentToolCard({ title, text, detail, theme }: { title: string; text: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const plan = planDetail(detail);
    if (plan) return <AgentPlanCard title={title} plan={plan} theme={theme} />;
    const kind = String(objectField(detail, "kind") || "");
    if (kind === "userInput") return <AgentUserInputRecordCard text={text} detail={detail} theme={theme} />;
    if (kind === "reasoning") return <AgentReasoningSummary text={text} detail={detail} theme={theme} />;
    if (kind === "command") return <AgentCommandGroup items={[{ id: title, text, detail }]} theme={theme} />;
    const state = toolCardState(title, text, detail);
    const view = userDetail(detail);
    const showText = title !== "读取画布" || text !== "已读取当前画布内容";
    const className = "group min-w-0 rounded-xl border px-3 py-2.5 text-left";
    const style = { borderColor: theme.node.stroke, background: "transparent", color: theme.node.text };
    const content = (
        <>
            <div className="flex min-w-0 items-center gap-2 text-sm leading-5">
                <span className="shrink-0" style={{ color: state.color }}>{toolIcon(kind, state.icon)}</span>
                <span className="min-w-0 truncate font-medium">{title}</span>
                <span className="shrink-0 text-[11px]" style={{ color: state.color }}>{state.label}</span>
                {view ? <ChevronDown className="ml-auto size-3.5 shrink-0 transition-transform group-open:rotate-180" style={{ color: theme.node.muted }} /> : null}
            </div>
            {showText ? (
                isAsciiDiagramText(text) ? (
                    <pre className="thin-scrollbar mt-1 max-w-full overflow-x-auto pl-6 font-mono text-[12px] leading-5 whitespace-pre" style={{ color: state.isError ? state.color : theme.node.muted }}>
                        {text}
                    </pre>
                ) : (
                    <div className={`mt-1 whitespace-pre-wrap break-words pl-6 text-sm leading-5 ${kind === "command" ? "font-mono text-[12px]" : ""}`} style={{ color: state.isError ? state.color : theme.node.muted }}>
                        {text}
                    </div>
                )
            ) : null}
        </>
    );
    if (!view) return <div className={className} style={style}>{content}</div>;
    return (
        <details className={className} style={style}>
            <summary className="list-none cursor-pointer">{content}</summary>
            <div className="ml-6"><AgentDetailBlock detail={view} theme={theme} /></div>
        </details>
    );
}

function AgentReasoningSummary({ text, detail, theme }: { text: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const status = String(objectField(detail, "status") || "");
    const running = ["inProgress", "in_progress", "running", "started", "pending"].includes(status);
    // 思考进行中默认展开，便于看到实时 reasoning（关闭思考模式时通常无此卡片）
    const [open, setOpen] = useState(running || Boolean(text.trim()));
    useEffect(() => {
        if (running) setOpen(true);
    }, [running]);
    return (
        <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group min-w-0 text-left">
            <summary className="cursor-pointer list-none py-1 text-sm" style={{ color: theme.node.muted }}>
                <div className="flex min-w-0 items-center gap-2">
                    {running ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : <Brain className="size-4 shrink-0" />}
                    <span>{t(running ? "agent.message.thinking" : "agent.events.reasoning")}</span>
                    <ChevronRight className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
                </div>
            </summary>
            <div className="break-words pb-1 pl-6 pr-2 text-xs leading-5 [&_code]:rounded [&_code]:px-1 [&_p]:my-1 [&_pre]:my-2" style={{ color: theme.node.muted }}>
                {text.trim()
                    ? <Streamdown {...streamdownProps()} animated={streamdownAnimation} mode={running ? "streaming" : "static"}>{prepareAgentMarkdown(rewriteAgentMarkdownLocalLinks(text))}</Streamdown>
                    : <span className="opacity-60">{running ? t("agent.message.thinking") : t("agent.events.reasoning")}</span>}
            </div>
        </details>
    );
}

type AgentCommandItem = Pick<AgentChatMessageItem, "id" | "text" | "detail">;

export function AgentCommandGroup({ items, theme }: { items: AgentCommandItem[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const states = items.map((item) => commandViewState(item.detail));
    const running = states.some((state) => state.running);
    const failed = states.filter((state) => state.failed).length;
    const expandable = items.some((item) => Boolean(item.text.trim() || userDetail(item.detail)));
    const color = running ? "#d97706" : failed ? "#dc2626" : theme.node.muted;
    const label = running ? t(items.length > 1 ? "agent.message.commandsRunning" : "agent.message.commandRunning", { count: items.length }) : t("agent.message.commandsCompleted", { count: items.length, failed: failed ? t("agent.message.commandsFailed", { count: failed }) : "" });
    const header = (
        <div className="flex min-w-0 items-center gap-2 text-sm" style={{ color }}>
            {running ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : <TerminalSquare className="size-4 shrink-0" />}
            <span className="font-medium">{label}</span>
            {expandable ? <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" /> : null}
        </div>
    );
    if (!expandable) return <div className="min-w-0 py-1 text-left">{header}</div>;
    return (
        <details className="group min-w-0 text-left">
            <summary className="cursor-pointer list-none py-1">{header}</summary>
            {items.length === 1
                ? <AgentSingleCommand item={items[0]} theme={theme} />
                : <div className="ml-6 mt-1">{items.map((item, index) => <AgentCommandEntry key={item.id} item={item} index={index} theme={theme} />)}</div>
            }
        </details>
    );
}

function AgentSingleCommand({ item, theme }: { item: AgentCommandItem; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const view = userDetail(item.detail);
    return (
        <div className="ml-6 pb-1">
            {item.text ? <div className="mt-1.5 whitespace-pre-wrap break-all font-mono text-[11px] leading-5" style={{ color: theme.node.text }}>{item.text}</div> : null}
            {view ? <AgentDetailBlock detail={view} theme={theme} /> : null}
        </div>
    );
}

function AgentCommandEntry({ item, index, theme }: { item: AgentCommandItem; index: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const detailId = useId();
    const view = userDetail(item.detail);
    const state = commandViewState(item.detail);
    const status = t(state.failed ? "agent.message.failed" : state.running ? "agent.message.running" : "agent.message.completed");
    const color = state.failed ? "#dc2626" : state.running ? "#d97706" : "#16a34a";
    const content = (
        <>
            <span className="w-4 shrink-0 text-center text-[10px] tabular-nums opacity-50" style={{ color: theme.node.muted }}>{index + 1}</span>
            <code className="min-w-0 flex-1 truncate text-[11px] leading-5" style={{ color: theme.node.text }} title={item.text}>{item.text || t("agent.message.command")}</code>
            <span className="shrink-0" style={{ color }} title={status} aria-label={status}>
                {state.running ? <LoaderCircle className="size-3.5 animate-spin" /> : state.failed ? <XCircle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
            </span>
            {view ? <ChevronRight className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} style={{ color: theme.node.muted }} /> : null}
        </>
    );
    return (
        <div className={index ? "border-t" : ""} style={{ borderColor: theme.node.stroke }}>
            {view
                ? <button type="button" className="flex w-full min-w-0 items-center gap-2 py-2 text-left" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen((value) => !value)}>{content}</button>
                : <div className="flex min-w-0 items-center gap-2 py-2 text-left">{content}</div>}
            {view && open ? <div id={detailId} className="pb-2 pl-6"><AgentDetailBlock detail={view} theme={theme} /></div> : null}
        </div>
    );
}

function commandViewState(detail: unknown) {
    const status = String(objectField(detail, "status") || "").toLowerCase();
    return {
        running: ["inprogress", "in_progress", "running", "started", "pending"].includes(status),
        failed: ["failed", "error"].includes(status),
    };
}

function AgentPlanCard({ title, plan, theme }: { title: string; plan: PlanDetail; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const [open, setOpen] = useState(true);
    const completed = plan.tasks.filter((item) => item.status === "completed").length;
    const state = planCardState(plan, completed);
    return (
        <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-left" style={{ borderColor: theme.node.stroke, background: "transparent", color: theme.node.text }}>
            <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2.5">
                <ListChecks className="size-4 shrink-0" style={{ color: state.color }} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
                <span className="shrink-0 text-[11px]" style={{ color: state.color }}>{state.label}</span>
                <span aria-live="polite" className="shrink-0 text-[11px] tabular-nums" style={{ color: theme.node.muted }}>{completed}/{plan.tasks.length}</span>
                <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" style={{ color: theme.node.muted }} />
            </summary>
            {plan.explanation ? <div className="mt-1.5 text-xs leading-5" style={{ color: theme.node.muted }}>{plan.explanation}</div> : null}
            <div className="mt-2.5 space-y-2 border-t pt-2.5" style={{ borderColor: theme.node.stroke }}>
                {plan.tasks.map((item, index) => {
                    const task = planTaskState(item.status, theme.node.muted);
                    return (
                        <div key={`${index}-${item.step}`} className="flex items-start gap-2 text-sm leading-5">
                            <span className="mt-0.5 shrink-0" style={{ color: task.color }}>{task.icon}</span>
                            <span className={`min-w-0 flex-1 ${item.status === "completed" ? "opacity-55" : item.status === "inProgress" ? "font-medium" : ""}`} style={{ color: item.status === "inProgress" ? theme.node.text : theme.node.muted }}>{item.step}</span>
                            <span className="shrink-0 text-[11px]" style={{ color: task.color }}>{task.label}</span>
                        </div>
                    );
                })}
            </div>
        </details>
    );
}

export function AgentWorkingMessage({ text, detail, status = "running", activityKey, theme }: { text: string; detail?: string; status?: "running" | "ready" | "error"; activityKey: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        const startedAt = Date.now();
        setElapsed(0);
        const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
        return () => window.clearInterval(timer);
    }, [activityKey]);
    return (
        <div className="min-w-0 py-1" aria-live="polite">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" style={{ color: theme.node.muted }}>
                {status === "running" ? <LoaderCircle className="size-3.5 shrink-0 animate-spin" /> : status === "ready" ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" /> : <XCircle className="size-3.5 shrink-0 text-red-600" />}
                <span className="min-w-0">{text}</span>
                {status === "running" && elapsed >= 5 ? <span className="shrink-0 text-[11px] tabular-nums opacity-60">{waitingTime(elapsed)}</span> : null}
            </div>
            {detail ? <div className="ml-5.5 mt-1 text-xs leading-5 opacity-65" style={{ color: theme.node.muted }}>{detail}</div> : null}
            {status === "running" && elapsed >= 30 ? <div className="mt-1 text-xs leading-5 opacity-65" style={{ color: theme.node.muted }}>{t("agent.message.slowResponse")}</div> : null}
        </div>
    );
}

function waitingTime(seconds: number) {
    if (seconds < 60) return tr("waitingSeconds", { seconds });
    const minutes = Math.floor(seconds / 60);
    return tr("waitingMinutes", { minutes, seconds: seconds % 60 });
}

function commandText(value: unknown) {
    if (Array.isArray(value)) return value.map(String).join(" ");
    return typeof value === "string" ? value : "";
}

function approvalTarget(value: unknown) {
    const host = String(objectField(value, "host") || "");
    const protocol = String(objectField(value, "protocol") || "");
    const port = String(objectField(value, "port") || "");
    return host ? `${protocol ? `${protocol}://` : ""}${host}${port ? `:${port}` : ""}` : "";
}

type PlanTask = { step: string; status: string };
type PlanDetail = { status: string; tasks: PlanTask[]; explanation?: string };
type UserDetail = { kind?: string; status?: string; rows?: Array<{ label: string; value: string }>; output?: string; files?: Array<{ path: string; action?: string }> };

function AgentDetailBlock({ detail, theme }: { detail: UserDetail; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    return (
        <div className="mt-3 space-y-2.5 border-t pt-3 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
            {detail.rows?.length ? (
                <dl className="space-y-1.5">
                    {detail.rows.map((row) => (
                        <div key={`${row.label}-${row.value}`} className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
                            <dt className="opacity-60">{row.label}</dt>
                            <dd className="min-w-0 break-words" style={{ color: theme.node.text }}>{row.value}</dd>
                        </div>
                    ))}
                </dl>
            ) : null}
            {detail.files?.length ? (
                <div className="space-y-1.5">
                    <div className="opacity-60">{t("agent.message.files")}</div>
                    {detail.files.map((file) => (
                        <div key={`${file.action}-${file.path}`} className="flex items-start gap-2">
                            <FileText className="mt-0.5 size-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 break-all" style={{ color: theme.node.text }}>{file.path}</span>
                            {file.action ? <span className="shrink-0 opacity-60">{file.action}</span> : null}
                        </div>
                    ))}
                </div>
            ) : null}
            {detail.output ? (
                <div className="space-y-1.5">
                    <div className="opacity-60">{t(detail.status === "failed" || detail.status === "error" ? "agent.message.errorInfo" : "agent.message.output")}</div>
                    <pre className="thin-scrollbar max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg px-3 py-2 font-mono text-[11px] leading-4" style={{ background: theme.toolbar.panel, color: theme.node.text }}>{detail.output}</pre>
                </div>
            ) : null}
        </div>
    );
}

function AgentMessageAttachments({ attachments, alignRight, onRemove }: { attachments: AgentChatAttachment[]; alignRight?: boolean; onRemove?: (id: string) => void }) {
    const { t } = useTranslation();
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    return (
        <>
            <div className={`mt-1.5 flex flex-wrap gap-1.5 ${alignRight ? "justify-end" : "justify-start"}`}>
                {attachments.map((item) => {
                    const kind = resolveChatAttachmentKind(item);
                    if (kind === "image" && item.url) {
                        return (
                            <span key={item.id} className="relative">
                                <img
                                    src={item.url}
                                    alt={item.name}
                                    title={t("agent.message.viewLarge")}
                                    className="size-10 cursor-zoom-in rounded-lg object-cover"
                                    draggable={false}
                                    onClick={() => setPreviewUrl(item.url)}
                                />
                                {onRemove ? (
                                    <button type="button" className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-black/70 text-white" aria-label={t("agent.chat.removeAttachment")} onClick={(event) => { event.stopPropagation(); onRemove(item.id); }}>
                                        <X className="size-2.5" />
                                    </button>
                                ) : null}
                            </span>
                        );
                    }
                    const Icon = kind === "folder" ? FolderOpen : FileText;
                    return (
                        <span
                            key={item.id}
                            className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-black/10 px-2 text-[11px] leading-4 dark:border-white/15"
                            title={item.localPath || item.name}
                        >
                            <Icon className="size-3.5 shrink-0 opacity-70" />
                            <span className="min-w-0 truncate">{item.name || (kind === "folder" ? "文件夹" : "文件")}</span>
                            {onRemove ? (
                                <button type="button" className="grid size-4 shrink-0 place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/10" aria-label={t("agent.chat.removeAttachment")} onClick={(event) => { event.stopPropagation(); onRemove(item.id); }}>
                                    <X className="size-2.5" />
                                </button>
                            ) : null}
                        </span>
                    );
                })}
            </div>
            {previewUrl ? (
                <div className="hidden">
                    <Image src={previewUrl} alt={t("agent.message.attachmentPreview")} preview={{ visible: true, src: previewUrl, onVisibleChange: (visible) => !visible && setPreviewUrl(null) }} />
                </div>
            ) : null}
        </>
    );
}

function resolveChatAttachmentKind(item: AgentChatAttachment): "image" | "file" | "folder" | "text" {
    if (item.kind === "folder" || item.kind === "file" || item.kind === "text" || item.kind === "image") return item.kind;
    if (item.url?.startsWith("data:image") || item.url?.startsWith("blob:") || /^https?:/i.test(item.url || "")) return "image";
    if (item.localPath) return "file";
    return "file";
}

function toolCardState(title: string, text: string, detail?: unknown) {
    const kind = String(objectField(detail, "kind") || "");
    const raw = `${title} ${text} ${normalizeText(objectField(detail, "error"))}`;
    const lower = raw.toLowerCase();
    const status = String(objectField(detail, "status") || "").toLowerCase();
    if (kind === "plan") {
        if (["inprogress", "in_progress", "running", "started", "pending"].includes(status)) {
            return { label: tr("running"), color: "#d97706", icon: <LoaderCircle className="size-4 animate-spin" />, isError: false };
        }
        if (["failed", "error"].includes(status) && objectField(detail, "output")) {
            return { label: tr("failed"), color: "#dc2626", icon: <XCircle className="size-4" />, isError: true };
        }
        return { label: tr("completed"), color: "#16a34a", icon: <CheckCircle2 className="size-4" />, isError: false };
    }
    if (status === "noop" || /未生效|无需|没有找到|没有.*可|已存在/.test(raw)) return { label: tr("noEffect"), color: "#d97706", icon: <CircleAlert className="size-4" />, isError: false };
    if (["declined", "rejected", "cancelled", "canceled"].includes(status) || /拒绝|取消/.test(raw)) return { label: tr("canceled"), color: "#dc2626", icon: <XCircle className="size-4" />, isError: true };

    const snapshotRunning = /运行中\s*[1-9]|running\s*[1-9]/i.test(raw);
    const snapshotSucceeded = /成功\s*[1-9]|succeeded\s*[1-9]/i.test(raw);
    const hasRealFailure =
        ["failed", "error"].includes(status) ||
        /失败\s*[1-9]|错误(?!\s*0)/.test(raw) ||
        /failed\s*[1-9]|\berror\b/.test(lower);

    // 工具调用本身已结束：正文「运行中 N」只是当时快照，不能再显示转圈「进行中」
    if (["completed", "succeeded", "success"].includes(status)) {
        if (hasRealFailure && !snapshotRunning) return { label: tr("failed"), color: "#dc2626", icon: <XCircle className="size-4" />, isError: true };
        if (snapshotSucceeded) return { label: tr("completed"), color: "#16a34a", icon: <CheckCircle2 className="size-4" />, isError: false };
        if (snapshotRunning) return { label: tr("recorded"), color: "#2563eb", icon: <Wrench className="size-4" />, isError: false };
        return { label: tr("completed"), color: "#16a34a", icon: <CheckCircle2 className="size-4" />, isError: false };
    }

    if (hasRealFailure && !snapshotRunning) return { label: tr("failed"), color: "#dc2626", icon: <XCircle className="size-4" />, isError: true };
    // 仅当工具仍在执行中，才用正文推断「进行中」
    if (["inprogress", "in_progress", "running", "started", "pending"].includes(status) || (!status && snapshotRunning)) {
        return { label: tr("running"), color: "#d97706", icon: <LoaderCircle className="size-4 animate-spin" />, isError: false };
    }
    if (hasRealFailure) return { label: tr("failed"), color: "#dc2626", icon: <XCircle className="size-4" />, isError: true };
    if (/完成|成功/.test(raw) || snapshotSucceeded) return { label: tr("completed"), color: "#16a34a", icon: <CheckCircle2 className="size-4" />, isError: false };
    return { label: tr("recorded"), color: "#2563eb", icon: <Wrench className="size-4" />, isError: false };
}

function toolIcon(kind: string | undefined, fallback: ReactNode) {
    if (kind === "search") return <Search className="size-4" />;
    if (kind === "file") return <FilePenLine className="size-4" />;
    if (kind === "plan") return <ListChecks className="size-4" />;
    return fallback;
}

function planCardState(plan: PlanDetail, completed: number) {
    if (plan.status === "failed") return { label: tr("failed"), color: "#dc2626" };
    if (["interrupted", "cancelled", "canceled"].includes(plan.status)) return { label: tr("stopped"), color: "#d97706" };
    if (completed === plan.tasks.length) return { label: tr("completed"), color: "#16a34a" };
    if (plan.status === "finished") return { label: tr("finished"), color: "#2563eb" };
    return { label: tr("running"), color: "#d97706" };
}

function planTaskState(status: string, muted: string) {
    if (status === "completed") return { label: tr("completed"), color: "#16a34a", icon: <CheckCircle2 className="size-3.5" /> };
    if (status === "inProgress") return { label: tr("running"), color: "#d97706", icon: <LoaderCircle className="size-3.5 animate-spin" /> };
    return { label: tr("pending"), color: muted, icon: <Circle className="size-3.5" /> };
}

function planDetail(value: unknown): PlanDetail | null {
    if (!value || typeof value !== "object" || objectField(value, "kind") !== "todo") return null;
    const tasks = Array.isArray(objectField(value, "tasks"))
        ? (objectField(value, "tasks") as unknown[]).flatMap((item) => {
              const step = String(objectField(item, "step") || "").trim();
              return step ? [{ step, status: String(objectField(item, "status") || "pending") }] : [];
          })
        : [];
    if (!tasks.length) return null;
    const explanation = String(objectField(value, "explanation") || "").trim();
    return { status: String(objectField(value, "status") || "inProgress"), tasks, ...(explanation ? { explanation } : {}) };
}

function userDetail(value: unknown): UserDetail | null {
    if (!value || typeof value !== "object") return null;
    const detail = value as Record<string, unknown>;
    const rows = Array.isArray(detail.rows)
        ? detail.rows.flatMap((row) => {
              if (!row || typeof row !== "object") return [];
              const label = String((row as Record<string, unknown>).label || "");
              const value = String((row as Record<string, unknown>).value || "");
              return label && value ? [{ label, value }] : [];
          })
        : [];
    const files = Array.isArray(detail.files)
        ? detail.files.flatMap((file) => {
              if (!file || typeof file !== "object") return [];
              const path = String((file as Record<string, unknown>).path || "");
              return path ? [{ path, action: String((file as Record<string, unknown>).action || "") || undefined }] : [];
          })
        : [];
    const error = objectField(detail.error, "message");
    const output = typeof detail.output === "string" ? detail.output.trim() : typeof error === "string" ? error : "";
    if (!rows.length && !files.length && !output) return null;
    return { kind: typeof detail.kind === "string" ? detail.kind : undefined, status: typeof detail.status === "string" ? detail.status : undefined, rows, files, output };
}

function normalizeText(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (value instanceof Error) return value.message;
    if (value == null) return "";
    return String(objectField(value, "message") || "");
}

function objectField(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function tr(key: string, options?: Record<string, unknown>) {
    return i18n.t(`agent.message.${key}`, options);
}
