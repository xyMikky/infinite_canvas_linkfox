import { useEffect, useState } from "react";
import { BookOpen, Check, FileText, Image as ImageIcon, Music2, SlidersHorizontal, Type, X } from "lucide-react";
import { Button, Form, Input, Modal } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { imageSettingsTriggerLabel } from "@/components/image-settings-panel";
import type { PromptAssetDraft } from "@/lib/canvas/prompt-asset";
import type { PromptAssetGeneration, PromptAssetMedia } from "@/services/api/prompt-source-runtime";
import { resolveModelDisplayName, useEffectiveConfig } from "@/stores/use-config-store";
import { CANVAS_OVERLAY_MODAL_Z_INDEX } from "@/stores/use-canvas-side-panel-store";
import { LibraryGroupSelect } from "@/components/library-groups";
import { ALL_LIBRARY_GROUPS, promptGroupKey } from "@/lib/library-groups";
import { LOCAL_PROMPT_SOURCE_ID } from "@/services/api/local-prompts";
import { useLibraryGroupStore } from "@/stores/use-library-group-store";
import { useThemeStore } from "@/stores/use-theme-store";

type FormValues = { title: string; prompt: string; groupId?: string };

function mediaKey(item: PromptAssetMedia) {
    return item.storageKey || item.url || item.text || `${item.role}-${item.kind}`;
}

function defaultCoverKey(items: PromptAssetMedia[]) {
    const outputs = items.filter((item) => item.role === "output");
    const marked = outputs.find((item) => item.cover);
    const first = outputs.find((item) => item.kind === "image" || item.kind === "video") || outputs[0];
    return mediaKey(marked || first || { role: "output", kind: "image" });
}

export function PromptAssetSaveDialog({
    draft,
    saving,
    onCancel,
    onSubmit,
}: {
    draft: (PromptAssetDraft & { title: string; id?: string }) | null;
    saving: boolean;
    onCancel: () => void;
    onSubmit: (values: PromptAssetDraft & { title: string }) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [form] = Form.useForm<FormValues>();
    const [media, setMedia] = useState<PromptAssetMedia[]>([]);
    const [coverKey, setCoverKey] = useState("");
    const open = Boolean(draft);
    const groupsHydrated = useLibraryGroupStore((state) => state.hydrated);

    useEffect(() => {
        if (!draft || !groupsHydrated) return;
        const store = useLibraryGroupStore.getState();
        const groupId = draft.id ? store.data.prompts.members[promptGroupKey({ sourceId: LOCAL_PROMPT_SOURCE_ID, id: draft.id })] || "" : store.selected.prompts;
        form.setFieldValue("groupId", groupId === ALL_LIBRARY_GROUPS ? "" : groupId);
    }, [draft, groupsHydrated, form]);

    useEffect(() => {
        if (!draft) return;
        form.setFieldsValue({ title: draft.title, prompt: draft.prompt });
        setMedia(draft.media);
        setCoverKey(defaultCoverKey(draft.media));
    }, [draft, form]);

    const inputs = media.filter((item) => item.role !== "output");
    const outputs = media.filter((item) => item.role === "output");
    const removeAt = (target: PromptAssetMedia) => {
        setMedia((prev) => {
            const next = prev.filter((item) => item !== target);
            if (mediaKey(target) === coverKey) setCoverKey(defaultCoverKey(next));
            return next;
        });
    };

    return (
        <Modal
            title={
                <div className="pr-6">
                    <div className="flex items-center gap-2 text-base font-semibold">
                        <BookOpen className="size-4" />
                        {draft?.id ? t("canvas.sidePanel.promptAssetEditTitle") : t("canvas.sidePanel.promptAssetConfirm")}
                    </div>
                    <div className="mt-1 text-xs font-normal" style={{ color: theme.node.muted }}>{t("canvas.sidePanel.promptAssetReviewHint")}</div>
                </div>
            }
            open={open}
            centered
            width="min(1040px, 96vw)"
            zIndex={CANVAS_OVERLAY_MODAL_Z_INDEX}
            styles={{
                container: { display: "flex", flexDirection: "column", height: "min(740px, calc(100dvh - 32px))", padding: 0, overflow: "hidden", background: theme.node.panel, color: theme.node.text },
                header: { flexShrink: 0, margin: 0, padding: "18px 24px", background: theme.node.panel, borderBottom: `1px solid ${theme.toolbar.border}` },
                body: { flex: 1, minHeight: 0, overflow: "hidden" },
                footer: { flexShrink: 0, margin: 0, padding: "14px 20px", borderTop: `1px solid ${theme.toolbar.border}` },
            }}
            modalRender={(content) => (
                <div data-canvas-shortcuts-ignore data-canvas-no-zoom
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                >{content}</div>
            )}
            maskClosable={!saving}
            keyboard={!saving}
            closable={!saving}
            onCancel={onCancel}
            footer={
                <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-3">
                    <span className="mr-auto hidden text-xs sm:block" style={{ color: theme.node.muted }}>{t("canvas.sidePanel.promptAssetSaveHint")}</span>
                    <div className="flex items-center gap-2">
                        <Button type="text" disabled={saving} onClick={onCancel}>{t("common.cancel")}</Button>
                        <Button type="primary" loading={saving} icon={<Check className="size-4" />} onClick={() => form.submit()}>
                            {draft?.id ? t("common.save") : t("canvas.sidePanel.promptAssetConfirm")}
                        </Button>
                    </div>
                </div>
            }
            destroyOnHidden
        >
            <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain md:grid md:grid-cols-[minmax(0,1fr)_320px] md:overflow-hidden">
                <Form
                    form={form}
                    layout="vertical"
                    requiredMark={false}
                    disabled={saving}
                    className="flex min-h-[420px] min-w-0 flex-col p-5 md:min-h-0 md:overflow-y-auto md:p-6"
                    onFinish={(values) => {
                        if (saving) return;
                        const title = values.title.trim();
                        const prompt = values.prompt.trim();
                        if (!prompt && !media.length) {
                            form.setFields([{ name: "prompt", errors: [t("prompts.editor.promptRequired")] }]);
                            return;
                        }
                        if (!title) return;
                        onSubmit({
                            title,
                            prompt,
                            groupId: values.groupId,
                            media: media.map((item) => ({ ...item, cover: item.role === "output" && mediaKey(item) === coverKey ? true : undefined })),
                            generation: draft?.generation,
                        });
                    }}
                >
                    <div className="grid shrink-0 gap-x-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                        <Form.Item className="!mb-5" name="title" label={t("prompts.editor.title")} rules={[{ required: true, whitespace: true, message: t("prompts.editor.titleRequired") }]}>
                            <Input maxLength={100} size="large" placeholder={t("prompts.editor.titlePlaceholder")} />
                        </Form.Item>
                        <Form.Item className="!mb-5" name="groupId" label={t("libraryGroups.title")}><LibraryGroupSelect scope="prompts" disabled={saving} /></Form.Item>
                    </div>
                    <Form.Item
                        className="!mb-0 flex min-h-[220px] flex-1 flex-col [&_.ant-form-item-row]:flex-1 [&_.ant-form-item-control]:flex-1 [&_.ant-form-item-control-input]:flex-1 [&_.ant-form-item-control-input-content]:h-full"
                        name="prompt"
                        label={<span className="flex items-center gap-2 font-medium"><FileText className="size-4" />{t("prompts.editor.prompt")}</span>}
                    >
                        <Input.TextArea placeholder={t("prompts.editor.promptPlaceholder")} style={{ height: "100%", minHeight: 160, resize: "none", padding: "12px 14px", lineHeight: 1.8 }} />
                    </Form.Item>
                    <GenerationSummary generation={draft?.generation} />
                </Form>
                <aside className="flex shrink-0 flex-col gap-6 border-t p-5 md:min-h-0 md:overflow-y-auto md:overscroll-contain md:border-t-0 md:border-l" style={{ borderColor: theme.toolbar.border }}>
                    <MediaSection role="input" items={inputs} saving={saving} onRemove={removeAt} />
                    <div className="border-t" style={{ borderColor: theme.toolbar.border }} />
                    <MediaSection role="output" items={outputs} saving={saving} onRemove={removeAt} coverKey={coverKey} onSelectCover={setCoverKey} />
                </aside>
            </div>
        </Modal>
    );
}

function GenerationSummary({ generation }: { generation?: PromptAssetGeneration }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useEffectiveConfig();
    if (!generation?.model) return null;
    const chips = [
        generation.generationMode === "image" ? imageSettingsTriggerLabel({ ...config, model: generation.model, size: generation.size || config.size, quality: generation.quality || config.quality, modelParams: generation.modelParams || config.modelParams }) : "",
        generation.generationMode === "image" && generation.count ? t("canvas.sidePanel.promptAssetCount", { count: generation.count }) : "",
        generation.generationMode === "video" ? [generation.vquality, generation.size, generation.seconds].filter(Boolean).join(" · ") : "",
        generation.generationMode === "audio" ? [generation.audioVoice, generation.audioFormat].filter(Boolean).join(" · ") : "",
    ].filter(Boolean);
    return (
        <div className="mt-5 shrink-0 border-t pt-4" style={{ borderColor: theme.toolbar.border }}>
            <div className="mb-2 flex items-center gap-2 text-xs" style={{ color: theme.node.muted }}><SlidersHorizontal className="size-3.5" />{t("canvas.sidePanel.promptAssetGeneration")}</div>
            <div className="break-words text-sm">{resolveModelDisplayName(config, generation.model) || generation.model}</div>
            {chips.length > 0 && <div className="mt-1 break-words text-xs leading-relaxed" style={{ color: theme.node.muted }}>{chips.join(" · ")}</div>}
        </div>
    );
}

function MediaSection({
    role,
    items,
    saving,
    onRemove,
    coverKey,
    onSelectCover,
}: {
    role: "input" | "output";
    items: PromptAssetMedia[];
    saving: boolean;
    onRemove: (item: PromptAssetMedia) => void;
    coverKey?: string;
    onSelectCover?: (key: string) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const output = role === "output";
    return (
        <section className="shrink-0">
            <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="!m-0 text-sm font-medium">{t(`canvas.sidePanel.${output ? "promptAssetOutputs" : "promptAssetInputs"}`)}</h3>
                <span className="text-xs tabular-nums" style={{ color: theme.node.muted }}>{items.length}</span>
            </div>
            <p className="mb-3 text-xs leading-relaxed" style={{ color: theme.node.muted }}>{t(`canvas.sidePanel.${output ? "promptAssetOutputsHint" : "promptAssetInputsHint"}`)}</p>
            {items.length ? (
                <div className="grid grid-cols-2 gap-2">
                    {items.map((item, index) => (
                        <MediaTile
                            key={`${item.role}-${item.kind}-${index}`}
                            item={item}
                            onRemove={() => onRemove(item)}
                            index={index}
                            saving={saving}
                            cover={Boolean(coverKey && mediaKey(item) === coverKey)}
                            onSelectCover={onSelectCover ? () => onSelectCover(mediaKey(item)) : undefined}
                        />
                    ))}
                </div>
            ) : (
                <div className="flex min-h-20 items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-4 text-xs" style={{ color: theme.node.muted, borderColor: theme.toolbar.border }}>
                    <ImageIcon className="size-4 shrink-0" />
                    {t(`canvas.sidePanel.${output ? "promptAssetOutputsEmpty" : "promptAssetInputsEmpty"}`)}
                </div>
            )}
        </section>
    );
}

function MediaTile({
    item,
    onRemove,
    index,
    saving,
    cover,
    onSelectCover,
}: {
    item: PromptAssetMedia;
    onRemove: () => void;
    index: number;
    saving: boolean;
    cover?: boolean;
    onSelectCover?: () => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const kindLabel = `${t(`canvas.sidePanel.filter.${item.kind}`)} ${index + 1}`;
    const selectLabel = t(cover ? "canvas.sidePanel.promptAssetCoverBadge" : "canvas.sidePanel.promptAssetSetCover");
    const removeLabel = `${t("canvas.sidePanel.promptAssetRemoveItem")} ${kindLabel}`;
    const preview =
        item.kind === "image" && item.url ? (
            <img src={item.url} alt={kindLabel} loading="lazy" className="aspect-[4/3] w-full object-contain" />
        ) : item.kind === "video" && item.url ? (
            <video src={item.url} controls playsInline preload="metadata" aria-label={kindLabel} className="aspect-[4/3] w-full object-contain" />
        ) : item.kind === "audio" && item.url ? (
            <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 px-2">
                <Music2 className="size-6 opacity-60" />
                <audio src={item.url} controls preload="metadata" aria-label={kindLabel} className="w-full" />
            </div>
        ) : (
            <div className="flex aspect-[4/3] flex-col gap-1.5 p-2.5">
                <Type className="size-4 opacity-50" />
                <div className="min-h-0 flex-1 overflow-hidden whitespace-pre-wrap break-words text-xs leading-snug opacity-80">{item.text}</div>
            </div>
        );
    return (
        <div className="min-w-0 overflow-hidden rounded-lg border" style={{ borderColor: cover ? theme.node.activeStroke : theme.toolbar.border }}>
            <div style={{ background: theme.canvas.background }}>
                {onSelectCover && item.kind === "image" ? (
                    <button type="button" className="block w-full cursor-pointer focus-visible:outline focus-visible:-outline-offset-2 disabled:cursor-default" disabled={saving} aria-label={`${selectLabel} · ${kindLabel}`} aria-pressed={cover} onClick={onSelectCover}>{preview}</button>
                ) : preview}
            </div>
            <div className="flex min-h-9 items-center justify-between gap-1 px-1.5" style={{ color: theme.node.muted }}>
                {onSelectCover ? (
                    <Button type="text" size="small" className="!min-w-0 !px-1 !text-xs" disabled={saving} aria-pressed={cover} title={`${selectLabel} · ${kindLabel}`} icon={cover ? <Check className="size-3" /> : undefined} onClick={onSelectCover}>{selectLabel}</Button>
                ) : <span className="px-1 text-xs">{kindLabel}</span>}
                <Button
                    type="text"
                    size="small"
                    className="!h-7 !w-7 !min-w-7 shrink-0 !p-0"
                    disabled={saving}
                    icon={<X className="size-3.5" />}
                    aria-label={removeLabel}
                    title={removeLabel}
                    onClick={onRemove}
                />
            </div>
        </div>
    );
}
