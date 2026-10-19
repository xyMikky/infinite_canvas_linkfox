import { Copy, FolderPlus, Trash2 } from "lucide-react";
import { Button, Modal, Popconfirm, Space, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { PromptCoverThumb } from "@/components/prompts/prompt-cover-thumb";
import { formatPromptDate, type Prompt } from "@/services/api/prompts";

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset, onDelete }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void; onDelete?: () => void }) {
    const { i18n, t } = useTranslation();

    return (
        <Modal title={prompt?.title} open={Boolean(prompt)} onCancel={onClose} footer={null} width={720} centered styles={{ body: { height: "calc(85vh - 55px)", overflow: "hidden" } }}>
            {prompt ? (
                <div className="flex h-full min-h-0 flex-col">
                    <div className="shrink-0 space-y-3 pb-4">
                        <PromptCoverThumb
                            url={prompt.coverUrl}
                            alt={prompt.title}
                            className="h-48 w-full rounded-lg object-cover sm:h-56"
                            fallbackClassName="grid h-48 w-full place-items-center rounded-lg bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-600 sm:h-56"
                            iconClassName="size-9"
                        />
                        {prompt.referenceImageUrls.length > 1 ? (
                            <div className="grid grid-cols-6 gap-2">
                                {prompt.referenceImageUrls
                                    .filter((url) => url !== prompt.coverUrl)
                                    .slice(0, 6)
                                    .map((url) => (
                                        <PromptCoverThumb key={url} url={url} className="aspect-square w-full rounded-md object-cover" fallbackClassName="aspect-square w-full rounded-md bg-stone-100 dark:bg-stone-800" iconClassName="size-4 opacity-40" />
                                    ))}
                            </div>
                        ) : null}
                    </div>
                    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-y border-stone-200 py-4 pr-2 dark:border-stone-800">
                        <div className="flex flex-wrap gap-1.5">
                            {prompt.tags.map((tag) => (
                                <Tag key={tag} className="m-0">
                                    {tag}
                                </Tag>
                            ))}
                        </div>
                        {prompt.description ? <p className="mt-4 text-sm leading-6 text-stone-500 dark:text-stone-400">{prompt.description}</p> : null}
                        {prompt.preview ? <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{prompt.preview}</pre> : null}
                        <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-800 dark:text-stone-300">{prompt.prompt}</p>
                        {prompt.createdAt || prompt.updatedAt ? <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">{prompt.createdAt ? t("common.created", { date: formatPromptDate(prompt.createdAt, i18n.resolvedLanguage) }) : null}{prompt.createdAt && prompt.updatedAt ? " · " : null}{prompt.updatedAt ? t("common.updated", { date: formatPromptDate(prompt.updatedAt, i18n.resolvedLanguage) }) : null}</div> : null}
                    </div>
                    <div className="shrink-0 pt-4">
                        <Space wrap>
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(prompt.prompt)}>
                                {t("common.copyPrompt")}
                            </Button>
                            {onSaveAsset ? (
                                <Button icon={<FolderPlus className="size-4" />} onClick={() => onSaveAsset(prompt)}>
                                    {t("common.addToAssets")}
                                </Button>
                            ) : null}
                            {onDelete ? (
                                <Popconfirm title={t("prompts.editor.deleteTitle", { name: prompt.title })} description={t("prompts.editor.deleteDescription")} okText={t("common.delete")} cancelText={t("common.cancel")} okButtonProps={{ danger: true }} onConfirm={onDelete}>
                                    <Button danger icon={<Trash2 className="size-4" />}>
                                        {t("common.delete")}
                                    </Button>
                                </Popconfirm>
                            ) : null}
                        </Space>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}

