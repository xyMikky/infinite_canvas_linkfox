import { FolderPlus, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { type ReactNode, type UIEvent, useEffect, useState } from "react";
import { App, Button, Empty, Input, Spin, Tag } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { PromptCard } from "@/components/prompts/prompt-card";
import { LibraryGroupFilter, LibraryGroupMove } from "@/components/library-groups";
import { promptGroupKey } from "@/lib/library-groups";
import { useLibraryGroupAssignment } from "@/hooks/use-library-group-assignment";
import { usePromptList } from "@/components/prompts/use-prompt-list";
import { PromptAssetSaveDialog } from "./components/prompt-asset-save-dialog";
import { PromptDetailDialog } from "./components/prompt-detail-dialog";
import { PromptEditorDialog } from "./components/prompt-editor-dialog";
import { useCopyText } from "@/hooks/use-copy-text";
import { persistPromptAssetMedia, type PromptAssetDraft } from "@/lib/canvas/prompt-asset";
import { cn } from "@/lib/utils";
import { useAssetStore } from "@/stores/use-asset-store";
import { createLocalPrompt, deleteLocalPrompt, isLocalPromptSource, LOCAL_PROMPT_SOURCE_ID, updateLocalPrompt, type LocalPromptInput } from "@/services/api/local-prompts";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";

export default function PromptsPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const [titleKeyword, setTitleKeyword] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
    const [assetDraft, setAssetDraft] = useState<(PromptAssetDraft & { title: string; id: string }) | null>(null);
    const [saving, setSaving] = useState(false);
    const addAsset = useAssetStore((state) => state.addAsset);
    const copyText = useCopyText();
    const assignGroup = useLibraryGroupAssignment("prompts");
    const { query, items: promptItems, tags: promptTags, categories: promptCategoryOptions, total: totalPrompts } = usePromptList({ keyword: titleKeyword, tags: selectedTags, category: selectedCategory });

    const invalidatePromptViews = async () => {
        await Promise.all([query.refetch(), queryClient.invalidateQueries({ queryKey: ["side-panel-prompts", LOCAL_PROMPT_SOURCE_ID] })]);
    };

    useEffect(() => {
        if (query.isError) message.error(query.error instanceof Error ? query.error.message : t("prompts.loadFailed"));
    }, [message, query.error, query.isError, t]);

    const toggleTag = (tag: string) => {
        if (tag === ALL_PROMPTS_OPTION) return setSelectedTags([]);
        setSelectedTags((items) => (items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]));
    };

    const savePromptAsset = (item: Prompt) => {
        addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl } });
        message.success(t("common.addedToAssets"));
    };

    const openCreate = () => {
        setEditingPrompt(null);
        setEditorOpen(true);
    };

    const openEdit = (item: Prompt) => {
        if (item.bundle?.length || item.generation) {
            setAssetDraft({ id: item.id, title: item.title, prompt: item.prompt, media: item.bundle || [], generation: item.generation });
            return;
        }
        setEditingPrompt(item);
        setEditorOpen(true);
    };

    const handleSaveAsset = async (values: PromptAssetDraft & { title: string }) => {
        if (!assetDraft) return;
        setSaving(true);
        try {
            await updateLocalPrompt(assetDraft.id, {
                title: values.title,
                prompt: values.prompt,
                bundle: await persistPromptAssetMedia(values.media),
                generation: values.generation,
            });
            useAssetStore.getState().cleanupImages();
            await assignGroup([promptGroupKey({ sourceId: LOCAL_PROMPT_SOURCE_ID, id: assetDraft.id })], values.groupId);
            setAssetDraft(null);
            message.success(t("prompts.editor.updated"));
            await invalidatePromptViews();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("prompts.editor.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const handleSubmit = async (values: LocalPromptInput) => {
        setSaving(true);
        try {
            if (editingPrompt) {
                await updateLocalPrompt(editingPrompt.id, values);
                await assignGroup([promptGroupKey(editingPrompt)], values.groupId);
                message.success(t("prompts.editor.updated"));
            } else {
                const created = await createLocalPrompt(values);
                await assignGroup([promptGroupKey({ sourceId: LOCAL_PROMPT_SOURCE_ID, id: created.id })], values.groupId);
                message.success(t("prompts.editor.created"));
            }
            setEditorOpen(false);
            setEditingPrompt(null);
            await invalidatePromptViews();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("prompts.editor.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const removePrompt = async (item: Prompt) => {
        await deleteLocalPrompt(item.id);
        if (selectedPrompt?.id === item.id) setSelectedPrompt(null);
        message.success(t("prompts.editor.deleted"));
        await invalidatePromptViews();
    };

    const handleDelete = (item: Prompt) => {
        modal.confirm({
            title: t("prompts.editor.deleteTitle", { name: item.title }),
            content: t("prompts.editor.deleteDescription"),
            okText: t("common.delete"),
            okButtonProps: { danger: true },
            cancelText: t("common.cancel"),
            onOk: () => removePrompt(item),
        });
    };

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-4 py-6 [background-size:16px_16px] sm:px-6 lg:py-8 dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]" onScroll={handleListScroll}>
                <div className="mx-auto max-w-7xl">
                    <div className="text-center">
                        <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">{t("prompts.title")}</h1>
                        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{t("prompts.total", { count: totalPrompts })}</p>
                    </div>
                    <div className="mt-5 grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6">
                        <aside className="thin-scrollbar max-h-72 overflow-y-auto border-b border-stone-200 pb-5 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-6rem)] lg:border-b-0 lg:border-r lg:pb-8 lg:pr-5 dark:border-stone-800">
                            <div className="mb-5"><LibraryGroupFilter scope="prompts" /></div>
                            <PromptFilter label={t("prompts.category")} options={promptCategoryOptions} selected={selectedCategory} onChange={setSelectedCategory} />
                            <div className="mt-6">
                                <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500">{t("prompts.tags")}</div>
                                <div className="flex flex-wrap gap-1.5">
                                    {promptTags.map((tag) => {
                                        const active = tag === ALL_PROMPTS_OPTION ? selectedTags.length === 0 : selectedTags.includes(tag);
                                        return (
                                            <Tag.CheckableTag key={tag} checked={active} className={cn("prompt-filter-tag", active && "is-active")} onChange={() => toggleTag(tag)}>
                                                {tag === ALL_PROMPTS_OPTION ? t("common.all") : tag}
                                            </Tag.CheckableTag>
                                        );
                                    })}
                                </div>
                            </div>
                        </aside>
                        <section className="min-w-0">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                <Input size="large" className="min-w-0 flex-1" prefix={<Search className="size-4 text-stone-400" />} value={titleKeyword} placeholder={t("prompts.search")} onChange={(event) => setTitleKeyword(event.target.value)} />
                                <Button type="primary" size="large" className="shrink-0" icon={<Plus className="size-4" />} onClick={openCreate}>
                                    {t("prompts.create")}
                                </Button>
                            </div>
                            {query.isLoading ? (
                                <div className="flex h-60 items-center justify-center">
                                    <Spin />
                                </div>
                            ) : null}
                            {!query.isLoading ? (
                                <div className="mt-5">
                                    <PromptGrid
                                        items={promptItems}
                                        onOpen={setSelectedPrompt}
                                        renderActions={(item) => <>
                                            <LibraryGroupMove scope="prompts" itemKeys={[promptGroupKey(item)]} />
                                            {
                                            isLocalPromptSource(item.sourceId) ? (
                                                <>
                                                    <Button type="text" size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEdit(item)}>
                                                        {t("common.edit")}
                                                    </Button>
                                                    <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => handleDelete(item)}>
                                                        {t("common.delete")}
                                                    </Button>
                                                </>
                                            ) : (
                                                <Button type="text" size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(item)}>
                                                    {t("common.addToAssets")}
                                                </Button>
                                            )
                                            }</>}
                                        onCopy={(item) => copyText(item.prompt, t("common.promptCopied"))}
                                        emptyText={t("prompts.empty")}
                                        onCreate={openCreate}
                                        createLabel={t("prompts.create")}
                                    />
                                </div>
                            ) : null}
                            <div className="mt-6 text-center text-xs text-stone-500 dark:text-stone-400">{query.isFetchingNextPage ? t("prompts.loading") : query.hasNextPage ? t("prompts.loadMore") : promptItems.length > 0 ? t("prompts.end") : null}</div>
                        </section>
                    </div>
                </div>
            </main>

            <PromptDetailDialog
                prompt={selectedPrompt}
                onClose={() => setSelectedPrompt(null)}
                onCopy={(prompt) => copyText(prompt, t("common.promptCopied"))}
                onSaveAsset={savePromptAsset}
                onDelete={selectedPrompt && isLocalPromptSource(selectedPrompt.sourceId) ? () => void removePrompt(selectedPrompt) : undefined}
            />
            <PromptEditorDialog
                open={editorOpen}
                prompt={editingPrompt}
                saving={saving}
                onCancel={() => {
                    setEditorOpen(false);
                    setEditingPrompt(null);
                }}
                onSubmit={handleSubmit}
            />
            <PromptAssetSaveDialog draft={assetDraft} saving={saving} onCancel={() => !saving && setAssetDraft(null)} onSubmit={(values) => void handleSaveAsset(values)} />
        </div>
    );
}

function PromptFilter({ label, options, selected, onChange }: { label: string; options: string[]; selected: string; onChange: (value: string) => void }) {
    const { t } = useTranslation();
    return (
        <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500">{label}</div>
            <div className="flex flex-wrap gap-1.5">
                {options.map((option) => (
                    <Tag.CheckableTag key={option} checked={selected === option} className={cn("prompt-filter-tag", selected === option && "is-active")} onChange={() => onChange(option)}>
                        {option === ALL_PROMPTS_OPTION ? t("common.all") : option}
                    </Tag.CheckableTag>
                ))}
            </div>
        </div>
    );
}

function PromptGrid({
    items,
    onOpen,
    onCopy,
    renderActions,
    emptyText,
    onCreate,
    createLabel,
}: {
    items: Prompt[];
    onOpen: (item: Prompt) => void;
    onCopy: (item: Prompt) => void;
    renderActions: (item: Prompt) => ReactNode;
    emptyText: string;
    onCreate: () => void;
    createLabel: string;
}) {
    return (
        <div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {items.map((item) => (
                    <PromptCard key={`${item.sourceId}:${item.id}`} item={item} onOpen={() => onOpen(item)} onCopy={() => onCopy(item)} extraAction={renderActions(item)} />
                ))}
            </div>
            {items.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} className="py-16">
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={onCreate}>
                        {createLabel}
                    </Button>
                </Empty>
            ) : null}
        </div>
    );
}
