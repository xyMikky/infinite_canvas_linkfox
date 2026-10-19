import { useEffect } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button, Form, Input, Modal, Select, Upload } from "antd";
import { useTranslation } from "react-i18next";

import type { LocalPromptInput } from "@/services/api/local-prompts";
import type { Prompt } from "@/services/api/prompts";
import { LibraryGroupSelect } from "@/components/library-groups";
import { ALL_LIBRARY_GROUPS, promptGroupKey } from "@/lib/library-groups";
import { useLibraryGroupStore } from "@/stores/use-library-group-store";

export function PromptEditorDialog({
    open,
    prompt,
    saving,
    onCancel,
    onSubmit,
}: {
    open: boolean;
    prompt?: Prompt | null;
    saving: boolean;
    onCancel: () => void;
    onSubmit: (values: LocalPromptInput) => void | Promise<void>;
}) {
    const { t } = useTranslation();
    const [form] = Form.useForm<LocalPromptInput>();
    const coverUrl = Form.useWatch("coverUrl", form);
    const groupsHydrated = useLibraryGroupStore((state) => state.hydrated);

    useEffect(() => {
        if (!open || !groupsHydrated) return;
        const store = useLibraryGroupStore.getState();
        const groupId = prompt ? store.data.prompts.members[promptGroupKey(prompt)] || "" : store.selected.prompts;
        form.setFieldValue("groupId", groupId === ALL_LIBRARY_GROUPS ? "" : groupId);
    }, [form, open, prompt, groupsHydrated]);

    useEffect(() => {
        if (!open) return;
        form.setFieldsValue(
            prompt
                ? { title: prompt.title, prompt: prompt.prompt, description: prompt.description || "", tags: prompt.tags || [], coverUrl: prompt.coverUrl || "" }
                : { title: "", prompt: "", description: "", tags: [], coverUrl: "" },
        );
    }, [form, open, prompt]);

    const pickCoverFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = () => form.setFieldsValue({ coverUrl: String(reader.result || "") });
        reader.readAsDataURL(file);
        return false;
    };

    return (
        <Modal
            title={t(prompt ? "prompts.editor.editTitle" : "prompts.editor.createTitle")}
            open={open}
            centered
            width={640}
            okText={t("common.save")}
            cancelText={t("common.cancel")}
            confirmLoading={saving}
            onCancel={onCancel}
            onOk={() => form.submit()}
        >
            <Form
                form={form}
                layout="vertical"
                requiredMark="optional"
                onFinish={(values) => void onSubmit({ ...values, title: values.title.trim(), prompt: values.prompt.trim() })}
            >
                <Form.Item name="title" label={t("prompts.editor.title")} rules={[{ required: true, whitespace: true, message: t("prompts.editor.titleRequired") }]}>
                    <Input maxLength={100} placeholder={t("prompts.editor.titlePlaceholder")} />
                </Form.Item>
                <Form.Item name="prompt" label={t("prompts.editor.prompt")} rules={[{ required: true, whitespace: true, message: t("prompts.editor.promptRequired") }]}>
                    <Input.TextArea rows={6} placeholder={t("prompts.editor.promptPlaceholder")} />
                </Form.Item>
                <Form.Item name="groupId" label={t("libraryGroups.title")}><LibraryGroupSelect scope="prompts" disabled={saving} /></Form.Item>
                <Form.Item name="description" label={t("prompts.editor.description")}>
                    <Input.TextArea rows={2} placeholder={t("prompts.editor.descriptionPlaceholder")} />
                </Form.Item>
                <Form.Item name="tags" label={t("prompts.editor.tags")}>
                    <Select mode="tags" open={false} suffixIcon={null} tokenSeparators={[",", "，"]} placeholder={t("prompts.editor.tagsPlaceholder")} />
                </Form.Item>
                <Form.Item label={t("prompts.editor.cover")}>
                    <div className="space-y-2">
                        <Form.Item name="coverUrl" noStyle>
                            <Input placeholder={t("prompts.editor.coverPlaceholder")} />
                        </Form.Item>
                        <div className="flex items-center gap-2">
                            <Upload accept="image/*" showUploadList={false} beforeUpload={pickCoverFile}>
                                <Button size="small" icon={<ImagePlus className="size-3.5" />}>{t("common.upload")}</Button>
                            </Upload>
                            {coverUrl ? (
                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => form.setFieldsValue({ coverUrl: "" })}>
                                    {t("prompts.editor.removeCover")}
                                </Button>
                            ) : null}
                        </div>
                        {coverUrl ? <img src={coverUrl} alt="" className="h-32 w-full rounded-lg object-cover" /> : null}
                    </div>
                </Form.Item>
            </Form>
        </Modal>
    );
}
