import { type CSSProperties, type ReactNode } from "react";
import { Button, Modal, Switch, Tooltip, theme as antdTheme } from "antd";
import { Check, Ellipsis, Image as ImageIcon, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_OVERLAY_MODAL_Z_INDEX } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { defaultImageQuickToolIds, type ImageQuickToolId } from "./canvas-image-toolbar-tools";

export type ImageToolbarSettingsTool = {
    id: ImageQuickToolId;
    title: string;
    label: string;
    icon: ReactNode;
    active?: boolean;
    danger?: boolean;
};

type PreviewTool = ImageToolbarSettingsTool | {
    id: "more";
    title: string;
    label: string;
    icon: ReactNode;
    active?: boolean;
    danger?: boolean;
};

const toolGroupNames = ["manage", "edit", "generate", "prompt"] as const;
const toolGroups: Record<ImageQuickToolId, typeof toolGroupNames[number]> = {
    info: "manage", delete: "manage", saveAsset: "manage", download: "manage", replace: "manage", view: "manage",
    resize: "edit", maskEdit: "edit", paint: "edit", crop: "edit", blur: "edit", photopea: "edit", split: "edit",
    cutout: "generate", upscale: "generate", outpaint: "generate", angle: "generate",
    copyPrompt: "prompt", reversePrompt: "prompt", pinSearch: "prompt",
};

export function ImageToolSettingsModal({
    open,
    tools,
    selectedIds,
    showLabels,
    onToggle,
    onShowLabelsChange,
    onCancel,
    onSave,
}: {
    open: boolean;
    tools: ImageToolbarSettingsTool[];
    selectedIds: ImageQuickToolId[];
    showLabels: boolean;
    onToggle: (id: ImageQuickToolId, visible: boolean) => void;
    onShowLabelsChange: (value: boolean) => void;
    onCancel: () => void;
    onSave: () => void;
}) {
    const { t } = useTranslation();
    const { token } = antdTheme.useToken();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const selected = new Set(selectedIds);
    const selectedTools = tools.filter((tool) => selected.has(tool.id));
    const previewTools: PreviewTool[] = [
        ...selectedTools,
        { id: "more", title: t("canvas.imageTools.configure"), label: t("canvas.imageTools.more"), icon: <Ellipsis className="size-4" />, active: true },
    ];

    const restoreDefaults = () => {
        const defaults = new Set(defaultImageQuickToolIds);
        tools.forEach((tool) => {
            const visible = defaults.has(tool.id);
            if (selected.has(tool.id) !== visible) onToggle(tool.id, visible);
        });
        onShowLabelsChange(true);
    };

    return (
        <Modal
            title={
                <div className="space-y-1.5 pr-8">
                    <h2 className="m-0 text-base font-semibold">{t("canvas.imageTools.customize")}</h2>
                    <p className="m-0 text-xs font-normal leading-relaxed" style={{ color: theme.node.placeholder }}>{t("canvas.imageTools.description")}</p>
                </div>
            }
            open={open}
            centered
            width="min(940px, 96vw)"
            onCancel={onCancel}
            destroyOnHidden
            zIndex={CANVAS_OVERLAY_MODAL_Z_INDEX}
            getContainer={() => document.body}
            styles={{
                container: { display: "flex", flexDirection: "column", maxHeight: "calc(100dvh - 40px)", padding: 0, overflow: "hidden", background: theme.node.panel, color: theme.node.text },
                header: { flexShrink: 0, margin: 0, padding: "18px 24px", background: theme.node.panel, borderBottom: "1px solid " + theme.toolbar.border },
                body: { minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", scrollbarWidth: "thin", scrollbarColor: theme.toolbar.border + " transparent" },
                footer: { flexShrink: 0, margin: 0, padding: "12px 20px", borderTop: "1px solid " + theme.toolbar.border },
            }}
            modalRender={(node) => (
                <div
                    data-canvas-shortcuts-ignore
                    data-canvas-no-zoom
                    style={{ "--tool-hover": theme.toolbar.itemHover, "--tool-border": theme.toolbar.border, "--tool-focus": theme.node.activeStroke } as CSSProperties}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                >{node}</div>
            )}
            footer={
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Button type="text" icon={<RotateCcw className="size-3.5" />} onClick={restoreDefaults}>
                        {t("canvas.imageToolbarSettings.restoreDefaults")}
                    </Button>
                    <div className="flex items-center gap-2">
                        <Button type="text" onClick={onCancel}>{t("common.cancel")}</Button>
                        <Button type="primary" onClick={onSave}>{t("common.save")}</Button>
                    </div>
                </div>
            }
        >
            <div className="space-y-6 p-4 sm:p-6">
                <section className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="m-0 text-xs font-semibold">{t("canvas.imageToolbarSettings.livePreview")}</h3>
                        <label className="flex cursor-pointer items-center gap-2 text-xs" style={{ color: theme.node.placeholder }}>
                            {t("canvas.imageTools.showLabels")}
                            <Switch size="small" aria-label={t("canvas.imageTools.showLabels")} checked={showLabels} onChange={onShowLabelsChange} />
                        </label>
                    </div>
                    <div className="space-y-3 overflow-hidden rounded-xl p-3" style={{ background: theme.canvas.background }}>
                        <div
                            tabIndex={0}
                            role="region"
                            aria-label={t("canvas.imageToolbarSettings.livePreview")}
                            className="overflow-x-auto overscroll-x-contain rounded-xl border border-[var(--tool-border)] focus-visible:outline-2 focus-visible:outline-[var(--tool-focus)]"
                            style={{ background: theme.toolbar.panel, scrollbarWidth: "thin", scrollbarColor: theme.toolbar.border + " transparent" }}
                        >
                            <div className="flex w-max min-w-full items-center justify-center gap-0.5 p-1">
                                {previewTools.map((tool) => (
                                    <Tooltip key={tool.id} title={tool.title}>
                                        <span className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg text-xs ${showLabels ? "px-2.5" : "w-9"}`}
                                            style={{ color: tool.danger ? token.colorError : theme.toolbar.item, background: tool.active ? theme.toolbar.activeBg : undefined }}>
                                            {tool.icon}
                                            {showLabels ? <span className="whitespace-nowrap">{tool.label}</span> : null}
                                        </span>
                                    </Tooltip>
                                ))}
                            </div>
                        </div>
                        <div className="mx-auto flex h-16 w-44 items-center justify-center gap-2 rounded-lg border border-[var(--tool-border)] text-[11px]" style={{ color: theme.node.placeholder }}>
                            <ImageIcon className="size-5" />{t("canvas.imageTools.imageNode")}
                        </div>
                    </div>
                    <p className="m-0 text-[11px]" style={{ color: theme.node.placeholder }}>{t("canvas.imageToolbarSettings.previewHint")}</p>
                </section>

                <section className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                        <h3 className="m-0 text-xs font-semibold">{t("canvas.imageTools.quickTools")}</h3>
                        <span className="text-[11px] tabular-nums" style={{ color: theme.node.placeholder }} aria-live="polite">
                            {t("canvas.imageToolbarSettings.selectedCount", { count: selectedTools.length, total: tools.length })}
                        </span>
                    </div>
                    <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                        {toolGroupNames.map((group) => {
                            const groupTools = tools.filter((tool) => (toolGroups[tool.id] || "manage") === group);
                            if (!groupTools.length) return null;
                            return <fieldset key={group} className="m-0 min-w-0 border-0 p-0">
                                <legend className="mb-2 w-full border-b border-[var(--tool-border)] pb-2 text-[11px] font-medium" style={{ color: theme.node.placeholder }}>
                                    {t(`canvas.imageToolbarSettings.groups.${group}`)}
                                </legend>
                                <div className="grid grid-cols-2 gap-1">
                                    {groupTools.map((tool) => (
                                        <label key={tool.id} title={tool.title} className="min-w-0 cursor-pointer">
                                            <input type="checkbox" checked={selected.has(tool.id)} onChange={(event) => onToggle(tool.id, event.target.checked)} className="peer sr-only" />
                                            <span className="flex min-h-10 items-center gap-2 rounded-lg px-2.5 py-2 text-xs hover:bg-[var(--tool-hover)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-[var(--tool-focus)]"
                                                style={{ color: selected.has(tool.id) ? theme.node.text : theme.toolbar.item }}>
                                                <span className="shrink-0" aria-hidden>{tool.icon}</span>
                                                <span className="min-w-0 flex-1 leading-snug">{tool.label}</span>
                                                <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border"
                                                    style={{ borderColor: selected.has(tool.id) ? theme.node.activeStroke : theme.toolbar.border, background: selected.has(tool.id) ? theme.node.activeStroke : "transparent", color: theme.node.panel }}>
                                                    {selected.has(tool.id) ? <Check className="size-2.5" strokeWidth={3} /> : null}
                                                </span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </fieldset>;
                        })}
                    </div>
                </section>
            </div>
        </Modal>
    );
}
