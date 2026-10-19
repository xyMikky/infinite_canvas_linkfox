import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { ArrowUp, Bot, Check, ChevronUp, ClipboardList, Cpu, Gauge, Hand, ImagePlus, Layers, LoaderCircle, MessageCircle, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { CODEX_PANEL_DROP_ZONE_ATTR } from "@/lib/agent/canvas-selection-to-composer";
import { composerFileToken, parseComposerPromptTokens, stripComposerFileTokens } from "@/lib/agent/composer-inline";
import { canvasThemes } from "@/lib/canvas-theme";
import { isPlainEnterKey } from "@/lib/keyboard-event";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useAgentStore, type AgentCollaborationMode, type AgentModel, type AgentPermissionMode, type AgentReasoningEffort } from "@/stores/use-agent-store";
import type { AgentChatAttachment } from "./agent-chat-message";
import { AgentSkillPicker } from "./agent-skill-picker";

export function AgentChatComposer({
    prompt,
    attachments = [],
    disabled,
    sending,
    placeholder,
    theme,
    onPromptChange,
    onSubmit,
    onStop,
    onAddFiles,
    onAddFromCanvas,
    onRemoveAttachment,
    confirmTools,
    onConfirmToolsChange,
    permissionMode,
    onPermissionModeChange,
    collaborationMode,
    onCollaborationModeChange,
    models,
    model,
    reasoningEffort,
    onModelChange,
    onReasoningEffortChange,
    left,
}: {
    prompt: string;
    attachments?: AgentChatAttachment[];
    disabled?: boolean;
    sending?: boolean;
    placeholder: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
    onStop?: () => void;
    onAddFiles?: (files: FileList | File[] | null) => void | Promise<void>;
    onAddFromCanvas?: () => void | Promise<void>;
    onRemoveAttachment?: (id: string) => void;
    confirmTools?: boolean;
    onConfirmToolsChange?: (confirmTools: boolean) => void;
    permissionMode?: AgentPermissionMode;
    onPermissionModeChange?: (permissionMode: AgentPermissionMode) => void;
    collaborationMode?: AgentCollaborationMode;
    onCollaborationModeChange?: (collaborationMode: AgentCollaborationMode) => void;
    models?: AgentModel[];
    model?: string;
    reasoningEffort?: AgentReasoningEffort | "";
    onModelChange?: (model: string) => void;
    onReasoningEffortChange?: (effort: AgentReasoningEffort) => void;
    left?: ReactNode;
}) {
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const editorRef = useRef<HTMLDivElement>(null);
    const syncingFromEditorRef = useRef(false);
    const composingRef = useRef(false);
    const [isComposing, setIsComposing] = useState(false);
    const selectedSkill = useAgentSkillStore((state) => state.selectedSkill);
    const clearSkillSelection = useAgentSkillStore((state) => state.clearSelection);
    const agentProvider = useAgentStore((state) => state.agentProvider);
    const codexPanelDropHover = useAgentStore((state) => state.codexPanelDropHover);
    const [fileDropHover, setFileDropHover] = useState(false);
    const attachmentById = useMemo(() => new Map(attachments.map((item) => [item.id, item])), [attachments]);
    const hasSendableContent = Boolean(stripComposerFileTokens(prompt) || attachments.length || /@\[file:/.test(prompt));
    const canSubmit = !disabled && !sending && hasSendableContent;
    const showPlaceholder = !isComposing && !stripComposerFileTokens(prompt) && !/@\[file:/.test(prompt);
    const showDropOverlay = codexPanelDropHover || fileDropHover;

    const hasExternalFiles = (transfer: DataTransfer | null) => {
        if (!transfer) return false;
        if (transfer.files?.length) return true;
        return Array.from(transfer.types || []).some((type) => type === "Files" || type === "application/x-moz-file");
    };

    const rebuildEditor = () => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.textContent = "";
        parseComposerPromptTokens(prompt).forEach((token) => {
            if (token.type === "text") {
                if (token.value) editor.append(document.createTextNode(token.value));
                return;
            }
            const file = attachmentById.get(token.id);
            if (file) editor.append(createComposerFileChip(file, theme));
            else editor.append(document.createTextNode(composerFileToken(token.id)));
        });
    };

    useEffect(() => {
        if (syncingFromEditorRef.current) {
            syncingFromEditorRef.current = false;
            return;
        }
        rebuildEditor();
    }, [prompt, attachmentById, theme]);

    const syncFromEditor = () => {
        const editor = editorRef.current;
        if (!editor) return;
        syncingFromEditorRef.current = true;
        onPromptChange(serializeComposerEditor(editor));
    };

    /** 点输入框四周留白也应进入编辑，避免只有中间一块可点 */
    const focusEditorEnd = () => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    };

    return (
        <div
            className="relative overflow-visible px-2 pb-2 pt-2"
            onWheelCapture={(event) => event.stopPropagation()}
            onDragEnter={(event) => {
                if (!onAddFiles || !hasExternalFiles(event.dataTransfer)) return;
                event.preventDefault();
                event.stopPropagation();
                setFileDropHover(true);
            }}
            onDragOverCapture={(event) => {
                if (!onAddFiles || !hasExternalFiles(event.dataTransfer)) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "copy";
                if (!fileDropHover) setFileDropHover(true);
            }}
            onDragLeave={(event) => {
                if (!fileDropHover) return;
                const next = event.relatedTarget;
                if (next instanceof Node && event.currentTarget.contains(next)) return;
                setFileDropHover(false);
            }}
            onDropCapture={(event) => {
                if (!onAddFiles) return;
                const files = Array.from(event.dataTransfer?.files || []);
                if (!files.length) return;
                event.preventDefault();
                event.stopPropagation();
                setFileDropHover(false);
                if (disabled) return;
                void onAddFiles(files);
            }}
            {...{ [CODEX_PANEL_DROP_ZONE_ATTR]: "true" }}
        >
            {showDropOverlay ? (
                <div
                    className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-[24px] border-2 border-dashed text-sm font-medium"
                    style={{ borderColor: theme.node.activeStroke, color: theme.node.text, background: `${theme.node.panel}ee` }}
                >
                    {t("agent.composer.dropToComposer")}
                </div>
            ) : null}
            <div
                className="rounded-[24px] border px-3 pb-3 pt-3 shadow-lg"
                style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}
                onMouseDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    event.preventDefault();
                    focusEditorEnd();
                }}
            >
                {selectedSkill ? (
                    <div className="mb-2 flex items-center px-1">
                        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                            <span className="truncate">{selectedSkill.interface?.displayName || selectedSkill.name}</span>
                            <button type="button" className="grid size-4 shrink-0 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" onClick={() => clearSkillSelection()} aria-label={t("agent.composer.removeSkill")}>
                                <X className="size-3" />
                            </button>
                        </span>
                    </div>
                ) : null}
                {disabled && !showPlaceholder ? (
                    <div className="mb-2 px-1 text-xs leading-5" style={{ color: theme.node.muted }} role="status">
                        {placeholder}
                    </div>
                ) : null}
                <div className="relative" onMouseDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    event.preventDefault();
                    focusEditorEnd();
                }}>
                    {showPlaceholder ? (
                        <div className="pointer-events-none absolute left-1 top-1 text-sm leading-5 opacity-45" style={{ color: theme.node.text }}>
                            {placeholder}
                        </div>
                    ) : null}
                    {/* 任务运行中也保持可编辑：可先写下一条；能否发送由 canSubmit 控制 */}
                    <div
                        ref={editorRef}
                        contentEditable
                        suppressContentEditableWarning
                        className="thin-scrollbar max-h-32 min-h-20 w-full overflow-y-auto whitespace-pre-wrap break-words px-1 py-1 text-sm leading-6 outline-none"
                        style={{ color: theme.node.text }}
                        onInput={() => {
                            if (!composingRef.current) syncFromEditor();
                        }}
                        onCompositionStart={() => {
                            composingRef.current = true;
                            setIsComposing(true);
                        }}
                        onCompositionEnd={() => {
                            composingRef.current = false;
                            setIsComposing(false);
                            syncFromEditor();
                        }}
                        onPaste={(event) => {
                            const clipboard = event.clipboardData;
                            if (!clipboard) return;
                            const text = clipboard.getData("text/plain");
                            const images = Array.from(clipboard.files).filter((file) => file.type.startsWith("image/"));
                            if (text) {
                                event.preventDefault();
                                insertComposerPlainText(text);
                                syncFromEditor();
                                return;
                            }
                            if (images.length && onAddFiles) {
                                event.preventDefault();
                                void onAddFiles(images);
                                return;
                            }
                            const html = clipboard.getData("text/html");
                            if (!html) return;
                            event.preventDefault();
                            const parsed = new DOMParser().parseFromString(html, "text/html").body.innerText;
                            if (!parsed) return;
                            insertComposerPlainText(parsed);
                            syncFromEditor();
                        }}
                        onKeyDown={(event) => {
                            if ((event.key === "Backspace" || event.key === "Delete") && deleteAdjacentComposerFile(event.key)) {
                                event.preventDefault();
                                syncFromEditor();
                                return;
                            }
                            if (!isPlainEnterKey(event)) return;
                            event.preventDefault();
                            if (!canSubmit) return;
                            void onSubmit();
                        }}
                    />
                </div>
                <div className="@container mt-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1">
                        {onAddFiles ? (
                            <>
                                <input ref={fileInputRef} hidden type="file" accept="image/*" multiple onChange={(event) => {
                                    void onAddFiles(event.target.files);
                                    event.target.value = "";
                                }} />
                                <Tooltip title={t("agent.composer.uploadImage")}>
                                    <Button type="text" shape="circle" className="!h-9 !w-9 !min-w-9" disabled={disabled || sending} style={{ color: theme.node.muted }} icon={<ImagePlus className="size-4" />} onClick={() => fileInputRef.current?.click()} aria-label={t("agent.composer.uploadImage")} />
                                </Tooltip>
                            </>
                        ) : null}
                        {onAddFromCanvas ? (
                            <Tooltip title={t("agent.composer.addFromCanvas")}>
                                <Button
                                    type="text"
                                    shape="circle"
                                    className="!h-9 !w-9 !min-w-9"
                                    disabled={disabled || sending}
                                    style={{ color: theme.node.muted }}
                                    icon={<Layers className="size-4" />}
                                    onClick={() => void onAddFromCanvas()}
                                    aria-label={t("agent.composer.addFromCanvas")}
                                />
                            </Tooltip>
                        ) : null}
                        {agentProvider === "cursor" ? null : <AgentSkillPicker />}
                        {onConfirmToolsChange ? <ToolConfirmationMenu confirmTools={Boolean(confirmTools)} theme={theme} onChange={onConfirmToolsChange} /> : null}
                        {collaborationMode && onCollaborationModeChange ? <CollaborationModeMenu collaborationMode={collaborationMode} theme={theme} onChange={onCollaborationModeChange} /> : null}
                        {permissionMode && onPermissionModeChange ? <PermissionModeMenu permissionMode={permissionMode} theme={theme} onChange={onPermissionModeChange} /> : null}
                        {models?.length && model && reasoningEffort && onModelChange && onReasoningEffortChange ? <AgentModelControls models={models} model={model} reasoningEffort={reasoningEffort} onModelChange={onModelChange} onReasoningEffortChange={onReasoningEffortChange} /> : null}
                        {left}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        {sending && onStop ? (
                            <Tooltip title={t("agent.composer.stop")} placement="top"><Button danger shape="circle" className="!h-10 !w-10 !min-w-10" icon={<Square className="size-4" />} onClick={() => void onStop()} aria-label={t("agent.composer.stop")} /></Tooltip>
                        ) : (
                            <Tooltip
                                title={disabled ? placeholder : !hasSendableContent ? t("agent.composer.sendNeedContent") : t("agent.composer.send")}
                                placement="top"
                            >
                                <Button type="primary" shape="circle" className="!h-10 !w-10 !min-w-10" disabled={!canSubmit} icon={sending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />} onClick={() => void onSubmit()} aria-label={t("agent.composer.send")} />
                            </Tooltip>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function insertComposerPlainText(text: string) {
    if (document.execCommand("insertText", false, text)) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    selection.deleteFromDocument();
    const node = document.createTextNode(text);
    const range = selection.getRangeAt(0);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}

function createComposerFileChip(file: AgentChatAttachment, theme: (typeof canvasThemes)[keyof typeof canvasThemes]) {
    const wrapper = document.createElement("span");
    wrapper.contentEditable = "false";
    wrapper.dataset.composerFileId = file.id;
    const kind = file.kind || (file.url?.startsWith("data:image") || file.url?.startsWith("blob:") || /^https?:/i.test(file.url || "") ? "image" : "file");
    if (kind === "image" && file.url) {
        wrapper.className = "mx-0.5 inline-flex size-7 items-center justify-center overflow-hidden rounded-md border align-middle";
        Object.assign(wrapper.style, { background: theme.toolbar.panel, borderColor: theme.node.stroke } satisfies CSSProperties);
        wrapper.title = file.name || "";
        const image = document.createElement("img");
        image.src = file.url;
        image.alt = file.name || "";
        image.draggable = false;
        image.className = "size-full object-cover";
        wrapper.appendChild(image);
        return wrapper;
    }
    wrapper.className = "mx-0.5 inline-flex h-7 max-w-[10rem] items-center gap-1 rounded-md border px-1.5 align-middle text-[11px]";
    Object.assign(wrapper.style, { background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text } satisfies CSSProperties);
    wrapper.title = file.localPath || file.name || "";
    const icon = document.createElement("span");
    icon.className = "inline-flex size-3.5 shrink-0 items-center justify-center opacity-70";
    icon.innerHTML = kind === "folder"
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>';
    const label = document.createElement("span");
    label.className = "min-w-0 truncate";
    label.textContent = file.name || (kind === "folder" ? "文件夹" : "文件");
    wrapper.append(icon, label);
    return wrapper;
}

function serializeComposerEditor(editor: HTMLElement) {
    return serializeComposerNodes(editor.childNodes).replace(/\uFEFF/g, "");
}

function serializeComposerNodes(nodes: NodeListOf<ChildNode> | ChildNode[]) {
    let result = "";
    Array.from(nodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) result += node.textContent || "";
        if (!(node instanceof HTMLElement)) return;
        const fileId = node.dataset.composerFileId;
        if (fileId) result += composerFileToken(fileId);
        else if (node.tagName === "BR") result += "\n";
        else result += serializeComposerNodes(node.childNodes);
    });
    return result;
}

function deleteAdjacentComposerFile(key: string) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const previous = key === "Backspace";
    const container = range.startContainer;
    const offset = range.startOffset;
    let target: HTMLElement | null = null;
    if (container.nodeType === Node.TEXT_NODE) {
        const text = container.textContent || "";
        if ((previous && offset > 0) || (!previous && offset < text.length)) return false;
        let sibling: Node | null = previous ? container.previousSibling : container.nextSibling;
        while (sibling && sibling.nodeType === Node.TEXT_NODE && !(sibling.textContent || "").trim()) {
            sibling = previous ? sibling.previousSibling : sibling.nextSibling;
        }
        if (sibling instanceof HTMLElement && sibling.dataset.composerFileId) target = sibling;
    } else if (container instanceof HTMLElement) {
        const child = container.childNodes[previous ? offset - 1 : offset];
        if (child instanceof HTMLElement && child.dataset.composerFileId) target = child;
    }
    if (!target) return false;
    const caret = document.createTextNode("");
    target.replaceWith(caret);
    range.setStart(caret, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
}

function AgentModelControls({ models, model, reasoningEffort, onModelChange, onReasoningEffortChange }: { models: AgentModel[]; model: string; reasoningEffort: AgentReasoningEffort; onModelChange: (model: string) => void; onReasoningEffortChange: (effort: AgentReasoningEffort) => void }) {
    const { t } = useTranslation();
    const current = models.find((item) => item.model === model) || models[0];
    const effortLabel = (effort: AgentReasoningEffort) => t(`agent.composer.effort.${effort}`);
    const [modelOpen, setModelOpen] = useState(false);
    const [reasoningOpen, setReasoningOpen] = useState(false);
    return (
        <div className="flex min-w-0 items-center gap-1">
            <Tooltip title={t("agent.composer.model", { model: current.displayName || current.model })} placement="top" open={modelOpen ? false : undefined}>
                <span className="inline-flex shrink-0">
                    <Select value={model} open={modelOpen} onOpenChange={setModelOpen} onValueChange={onModelChange}>
                        <SelectTrigger hideChevron className="h-9 w-9 min-w-9 justify-center gap-0 rounded-full border-0 bg-transparent px-0 text-xs font-medium shadow-none hover:bg-black/5 focus:ring-0 @min-[660px]:w-auto @min-[660px]:min-w-36 @min-[660px]:max-w-36 @min-[660px]:justify-start @min-[660px]:gap-1.5 @min-[660px]:px-2.5 dark:bg-transparent dark:hover:bg-white/10" aria-label={t("agent.composer.selectModel", { model: current.displayName || current.model })}>
                            <Cpu className="size-3.5 shrink-0 opacity-70" />
                            <span className="hidden min-w-0 flex-1 truncate text-left @min-[660px]:inline">{current.displayName || current.model}</span>
                            <ChevronUp className="hidden size-3 opacity-50 @min-[660px]:block" />
                        </SelectTrigger>
                        <SelectContent data-canvas-no-zoom position="popper" side="top" align="start" sideOffset={6} className="z-[1300] w-64 rounded-xl border border-border/70 bg-popover p-1 shadow-xl">
                            {models.map((item) => <SelectItem key={item.model} value={item.model}>{item.displayName || item.model}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </span>
            </Tooltip>
            <Tooltip title={t("agent.composer.reasoning", { effort: effortLabel(reasoningEffort) })} placement="top" open={reasoningOpen ? false : undefined}>
                <span className="inline-flex shrink-0">
                    <Select value={reasoningEffort} open={reasoningOpen} onOpenChange={setReasoningOpen} onValueChange={(value) => onReasoningEffortChange(value as AgentReasoningEffort)}>
                        <SelectTrigger hideChevron className="h-9 w-9 min-w-9 justify-center gap-0 rounded-full border-0 bg-transparent px-0 text-xs font-medium shadow-none hover:bg-black/5 focus:ring-0 @min-[660px]:w-auto @min-[660px]:min-w-[4.5rem] @min-[660px]:justify-start @min-[660px]:gap-1.5 @min-[660px]:px-2.5 dark:bg-transparent dark:hover:bg-white/10" aria-label={t("agent.composer.selectReasoning", { effort: effortLabel(reasoningEffort) })}>
                            <Gauge className="size-3.5 opacity-70" />
                            <span className="hidden @min-[660px]:inline">{effortLabel(reasoningEffort)}</span>
                            <ChevronUp className="hidden size-3 opacity-50 @min-[660px]:block" />
                        </SelectTrigger>
                        <SelectContent data-canvas-no-zoom position="popper" side="top" align="start" sideOffset={6} className="z-[1300] min-w-32 rounded-xl border border-border/70 bg-popover p-1 shadow-xl">
                            {current.supportedReasoningEfforts.map((item) => <SelectItem key={item.reasoningEffort} value={item.reasoningEffort}>{effortLabel(item.reasoningEffort)}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </span>
            </Tooltip>
        </div>
    );
}

function ComposerFlyout({
    open,
    onOpenChange,
    theme,
    tooltip,
    trigger,
    children,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    tooltip: string;
    trigger: ReactNode;
    children: ReactNode;
}) {
    const rootRef = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") onOpenChange(false);
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open, onOpenChange]);
    return (
        <Tooltip title={tooltip} placement="top" open={open ? false : undefined}>
            <span ref={rootRef} className="relative inline-flex shrink-0">
                {trigger}
                {open ? (
                    <div className="absolute bottom-full left-0 z-50 mb-2 rounded-xl border py-1 shadow-xl" data-canvas-no-zoom style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}>
                        {children}
                    </div>
                ) : null}
            </span>
        </Tooltip>
    );
}

function CollaborationModeMenu({ collaborationMode, theme, onChange }: { collaborationMode: AgentCollaborationMode; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (collaborationMode: AgentCollaborationMode) => void }) {
    const { t } = useTranslation();
    const options: Array<{ key: AgentCollaborationMode; title: string; description: string; icon: ReactNode }> = [
        { key: "chat", title: t("agent.composer.collaboration.chat"), description: t("agent.composer.collaboration.chatDescription"), icon: <MessageCircle className="size-3.5" /> },
        { key: "default", title: t("agent.composer.collaboration.agent"), description: t("agent.composer.collaboration.agentDescription"), icon: <Bot className="size-3.5" /> },
        { key: "plan", title: t("agent.composer.collaboration.plan"), description: t("agent.composer.collaboration.planDescription"), icon: <ClipboardList className="size-3.5" /> },
    ];
    const current = options.find((item) => item.key === collaborationMode) || options[0];
    const [open, setOpen] = useState(false);
    return (
        <ComposerFlyout open={open} onOpenChange={setOpen} theme={theme} tooltip={t("agent.composer.collaboration.label", { mode: current.title })} trigger={(
            <button type="button" className="flex h-9 w-9 min-w-9 shrink-0 items-center justify-center gap-0 rounded-full px-0 text-xs font-medium transition hover:bg-black/5 @min-[660px]:h-9 @min-[660px]:w-auto @min-[660px]:min-w-0 @min-[660px]:justify-start @min-[660px]:gap-1.5 @min-[660px]:px-2.5 dark:hover:bg-white/10" style={{ color: collaborationMode === "plan" ? "#2563eb" : theme.node.text }} aria-label={t("agent.composer.collaboration.select", { mode: current.title })} onClick={() => setOpen((value) => !value)}>
                {current.icon}
                <span className="hidden @min-[660px]:inline">{current.title}</span>
                <ChevronUp className="hidden size-3 opacity-50 @min-[660px]:block" />
            </button>
        )}>
            {options.map((item) => (
                <button key={item.key} type="button" className="flex w-full px-2 text-left transition hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { onChange(item.key); setOpen(false); }}>
                    <ConfirmationOption icon={item.icon} title={item.title} description={item.description} selected={collaborationMode === item.key} />
                </button>
            ))}
        </ComposerFlyout>
    );
}

function PermissionModeMenu({ permissionMode, theme, onChange }: { permissionMode: AgentPermissionMode; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (permissionMode: AgentPermissionMode) => void }) {
    const { t } = useTranslation();
    const permissionOptions: Array<{ key: AgentPermissionMode; title: string; shortTitle: string; description: string; icon: ReactNode }> = [
        { key: "request", title: t("agent.composer.permission.request"), shortTitle: t("agent.composer.permission.request"), description: t("agent.composer.permission.requestDescription"), icon: <ShieldAlert className="size-3.5" /> },
        { key: "automatic", title: t("agent.composer.permission.automatic"), shortTitle: t("agent.composer.permission.automatic"), description: t("agent.composer.permission.automaticDescription"), icon: <ShieldCheck className="size-3.5" /> },
        { key: "full", title: t("agent.composer.permission.full"), shortTitle: t("agent.composer.permission.fullShort"), description: t("agent.composer.permission.fullDescription"), icon: <ShieldOff className="size-3.5" /> },
    ];
    const current = permissionOptions.find((item) => item.key === permissionMode) || permissionOptions[0];
    const [open, setOpen] = useState(false);
    return (
        <ComposerFlyout open={open} onOpenChange={setOpen} theme={theme} tooltip={t("agent.composer.permissionLabel", { mode: current.shortTitle })} trigger={(
            <button type="button" className="flex h-9 w-9 min-w-9 shrink-0 items-center justify-center gap-0 rounded-full px-0 text-xs font-medium transition hover:bg-black/5 @min-[660px]:h-9 @min-[660px]:w-auto @min-[660px]:min-w-0 @min-[660px]:justify-start @min-[660px]:gap-1.5 @min-[660px]:px-2.5 dark:hover:bg-white/10" style={{ color: permissionMode === "full" ? "#ea580c" : theme.node.text }} aria-label={t("agent.composer.selectPermission", { mode: current.title })} onClick={() => setOpen((value) => !value)}>
                {current.icon}
                <span className="hidden @min-[660px]:inline">{current.shortTitle}</span>
                <ChevronUp className="hidden size-3 opacity-50 @min-[660px]:block" />
            </button>
        )}>
            {permissionOptions.map((item) => (
                <button key={item.key} type="button" className="flex w-full px-2 text-left transition hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { onChange(item.key); setOpen(false); }}>
                    <ConfirmationOption icon={item.icon} title={item.title} description={item.description} selected={permissionMode === item.key} />
                </button>
            ))}
        </ComposerFlyout>
    );
}

function ToolConfirmationMenu({ confirmTools, theme, onChange }: { confirmTools: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (confirmTools: boolean) => void }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const mode = t(confirmTools ? "agent.composer.tools.manual" : "agent.composer.tools.automatic");
    return (
        <ComposerFlyout open={open} onOpenChange={setOpen} theme={theme} tooltip={t("agent.composer.tools.label", { mode })} trigger={(
            <button type="button" className="flex h-9 w-9 min-w-9 shrink-0 items-center justify-center gap-0 rounded-full px-0 text-xs font-medium transition hover:bg-black/5 @min-[660px]:w-auto @min-[660px]:min-w-0 @min-[660px]:justify-start @min-[660px]:gap-1.5 @min-[660px]:px-2.5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label={t("agent.composer.tools.select", { mode })} onClick={() => setOpen((value) => !value)}>
                {confirmTools ? <Hand className="size-3.5" /> : <RefreshCw className="size-3.5" />}
                <span className="hidden @min-[660px]:inline">{mode}</span>
                <ChevronUp className="hidden size-3 opacity-50 @min-[660px]:block" />
            </button>
        )}>
            <button type="button" className="flex w-full px-2 text-left transition hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { onChange(true); setOpen(false); }}>
                <ConfirmationOption icon={<Hand className="size-4" />} title={t("agent.composer.tools.manual")} description={t("agent.composer.tools.manualDescription")} selected={confirmTools} />
            </button>
            <button type="button" className="flex w-full px-2 text-left transition hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { onChange(false); setOpen(false); }}>
                <ConfirmationOption icon={<RefreshCw className="size-4" />} title={t("agent.composer.tools.automatic")} description={t("agent.composer.tools.automaticDescription")} selected={!confirmTools} />
            </button>
        </ComposerFlyout>
    );
}

function ConfirmationOption({ icon, title, description, selected }: { icon: ReactNode; title: string; description: string; selected: boolean }) {
    return (
        <div className="flex min-w-64 items-start gap-3 py-1">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{title}</span>
                <span className="mt-0.5 block text-xs leading-5 opacity-60">{description}</span>
            </span>
            {selected ? <Check className="mt-0.5 size-4 shrink-0" /> : null}
        </div>
    );
}
