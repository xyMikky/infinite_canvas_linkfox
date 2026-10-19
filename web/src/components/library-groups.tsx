import { useEffect, useState, type ReactElement } from "react";
import { App, Button, Dropdown, Input, Modal, Select, Typography } from "antd";
import { ChevronLeft, Folder, FolderInput, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { purgeOwnedAssetsInGroup } from "@/lib/canvas/folder-asset";
import { ALL_LIBRARY_GROUPS, type LibraryGroup, type LibraryScope } from "@/lib/library-groups";
import { useLibraryGroupStore } from "@/stores/use-library-group-store";
import { CANVAS_OVERLAY_MODAL_Z_INDEX } from "@/stores/use-canvas-side-panel-store";

export function LibraryGroupManageMenu({
    scope,
    group,
    trigger,
    disabled,
    children,
}: {
    scope: LibraryScope;
    group: LibraryGroup;
    trigger: ("click" | "contextMenu")[];
    disabled?: boolean;
    children: ReactElement;
}) {
    const { t } = useTranslation();
    const { message, modal } = App.useApp();
    const pending = useLibraryGroupStore((state) => state.pending);
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(group.name);
    const [nameError, setNameError] = useState("");

    const save = async () => {
        try {
            await useLibraryGroupStore.getState().renameGroup(scope, group.id, name);
            setEditing(false);
        } catch (error) {
            setNameError(error instanceof Error ? error.message : t("libraryGroups.saveFailed"));
        }
    };
    const remove = () => {
        modal.confirm({
            title: t("libraryGroups.deleteTitle", { name: group.name }), content: t(scope === "assets" ? "libraryGroups.deleteHintAssets" : "libraryGroups.deleteHint"),
            zIndex: CANVAS_OVERLAY_MODAL_Z_INDEX + 20,
            okText: t("common.delete"), cancelText: t("common.cancel"), okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    if (scope === "assets") {
                        const memberIds = Object.entries(useLibraryGroupStore.getState().data.assets.members).filter(([, id]) => id === group.id).map(([key]) => key);
                        await purgeOwnedAssetsInGroup(memberIds);
                    }
                    await useLibraryGroupStore.getState().removeGroup(scope, group.id);
                }
                catch (error) { message.error(error instanceof Error ? error.message : t("libraryGroups.saveFailed")); throw error; }
            },
        });
    };

    return (
        <div className={trigger.includes("contextMenu") ? "min-w-0" : "inline-flex shrink-0"}>
            <Dropdown
                trigger={trigger}
                disabled={disabled || pending > 0}
                menu={{ items: [
                    { key: "rename", label: t("libraryGroups.rename"), icon: <Pencil className="size-3.5" />, onClick: () => { setName(group.name); setNameError(""); setEditing(true); } },
                    { key: "delete", label: t("libraryGroups.delete"), icon: <Trash2 className="size-3.5" />, danger: true, onClick: remove },
                ] }}
            >
                {children}
            </Dropdown>
            <Modal title={t("libraryGroups.rename")} open={editing} centered width={400} zIndex={CANVAS_OVERLAY_MODAL_Z_INDEX + 20}
                okText={t("common.save")} cancelText={t("common.cancel")} confirmLoading={pending > 0} onOk={() => void save()} onCancel={() => !pending && setEditing(false)} maskClosable={!pending} destroyOnHidden>
                <div data-canvas-shortcuts-ignore>
                    <Input autoFocus value={name} maxLength={80} aria-label={t("libraryGroups.name")} placeholder={t("libraryGroups.namePlaceholder")} status={nameError ? "error" : undefined} disabled={pending > 0} onChange={(event) => { setNameError(""); setName(event.target.value); }} onPressEnter={() => void save()} />
                    {nameError && <Typography.Text type="danger" className="mt-2 block text-xs" role="alert">{nameError}</Typography.Text>}
                </div>
            </Modal>
        </div>
    );
}

export function LibraryGroupFilter({ scope }: { scope: LibraryScope }) {
    const { t } = useTranslation();
    const library = useLibraryGroupStore((state) => state.data[scope]);
    const selected = useLibraryGroupStore((state) => state.selected[scope]);
    const hydrated = useLibraryGroupStore((state) => state.hydrated);
    const error = useLibraryGroupStore((state) => state.error);
    const pending = useLibraryGroupStore((state) => state.pending);
    const [creating, setCreating] = useState("");
    const [creatingOpen, setCreatingOpen] = useState(false);
    const [nameError, setNameError] = useState("");
    const current = library.groups.find((group) => group.id === selected);
    useEffect(() => { void useLibraryGroupStore.getState().hydrate(); }, []);

    const save = async () => {
        try {
            useLibraryGroupStore.getState().select(scope, await useLibraryGroupStore.getState().createGroup(scope, creating));
            setCreatingOpen(false);
        } catch (error) {
            setNameError(error instanceof Error ? error.message : t("libraryGroups.saveFailed"));
        }
    };
    const manageButton = <Button type="text" size="small" disabled={!current || pending > 0} icon={<MoreHorizontal className="size-4" />} title={t("libraryGroups.manage")} aria-label={t("libraryGroups.manage")} />;
    return (
        <div data-canvas-shortcuts-ignore>
            <div className="flex min-w-0 items-center gap-1">
                {selected !== ALL_LIBRARY_GROUPS ? (
                    <button
                        type="button"
                        onClick={() => useLibraryGroupStore.getState().select(scope, ALL_LIBRARY_GROUPS)}
                        className="grid size-7 shrink-0 place-items-center rounded-md transition hover:bg-black/5 dark:hover:bg-white/10"
                        aria-label={t("libraryGroups.backToAll")}
                        title={t("libraryGroups.backToAll")}
                    >
                        <ChevronLeft className="size-4" />
                    </button>
                ) : (
                    <Folder className="size-3.5 shrink-0 opacity-60" />
                )}
                <Select
                    aria-label={t("libraryGroups.title")} className="min-w-0 flex-1" size="small" variant="borderless"
                    value={selected} disabled={!hydrated} showSearch optionFilterProp="label"
                    options={[{ value: ALL_LIBRARY_GROUPS, label: t("libraryGroups.all") }, { value: "", label: t("libraryGroups.ungrouped") }, ...library.groups.map((group) => ({ value: group.id, label: group.name }))]}
                    onChange={(id) => useLibraryGroupStore.getState().select(scope, id)}
                />
                <Button type="text" size="small" disabled={!hydrated || pending > 0} icon={<Plus className="size-3.5" />} title={t("libraryGroups.create")} aria-label={t("libraryGroups.create")} onClick={() => { setNameError(""); setCreating(""); setCreatingOpen(true); }} />
                {current ? (
                    <LibraryGroupManageMenu scope={scope} group={current} trigger={["click"]} disabled={!hydrated || pending > 0}>
                        {manageButton}
                    </LibraryGroupManageMenu>
                ) : manageButton}
            </div>
            {error && <div className="mt-1 text-xs" role="alert">{error} <Button type="link" size="small" onClick={() => void useLibraryGroupStore.getState().hydrate()}>{t("common.retry")}</Button></div>}
            <Modal title={t("libraryGroups.create")} open={creatingOpen} centered width={400} zIndex={CANVAS_OVERLAY_MODAL_Z_INDEX + 20}
                okText={t("common.save")} cancelText={t("common.cancel")} confirmLoading={pending > 0} onOk={() => void save()} onCancel={() => !pending && setCreatingOpen(false)} maskClosable={!pending} destroyOnHidden>
                <div data-canvas-shortcuts-ignore>
                    <Input autoFocus value={creating} maxLength={80} aria-label={t("libraryGroups.name")} placeholder={t("libraryGroups.namePlaceholder")} status={nameError ? "error" : undefined} disabled={pending > 0} onChange={(event) => { setNameError(""); setCreating(event.target.value); }} onPressEnter={() => void save()} />
                    {nameError && <Typography.Text type="danger" className="mt-2 block text-xs" role="alert">{nameError}</Typography.Text>}
                </div>
            </Modal>
        </div>
    );
}

export function LibraryGroupSelect({ scope, value, onChange, disabled }: { scope: LibraryScope; value?: string; onChange?: (value: string) => void; disabled?: boolean }) {
    const { t } = useTranslation();
    const groups = useLibraryGroupStore((state) => state.data[scope].groups);
    const hydrated = useLibraryGroupStore((state) => state.hydrated);
    useEffect(() => { void useLibraryGroupStore.getState().hydrate(); }, []);
    return <Select value={value} onChange={onChange} disabled={disabled || !hydrated || undefined} aria-label={t("libraryGroups.title")} showSearch optionFilterProp="label"
        options={[{ value: "", label: t("libraryGroups.ungrouped") }, ...groups.map((group) => ({ value: group.id, label: group.name }))]} />;
}

export function LibraryGroupMove({ scope, itemKeys, compact = false, overlay = false }: { scope: LibraryScope; itemKeys: string[]; compact?: boolean; overlay?: boolean }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const library = useLibraryGroupStore((state) => state.data[scope]);
    const hydrated = useLibraryGroupStore((state) => state.hydrated);
    const pending = useLibraryGroupStore((state) => state.pending);
    const current = itemKeys.length === 1 ? library.members[itemKeys[0]] || "" : undefined;
    const name = library.groups.find((group) => group.id === current)?.name || t("libraryGroups.ungrouped");
    const disabled = !hydrated || pending > 0 || !itemKeys.length;
    const move = async (groupId: string) => {
        try {
            await useLibraryGroupStore.getState().moveItems(scope, itemKeys, groupId);
            message.success(t("libraryGroups.moved"));
        } catch (error) { message.error(error instanceof Error ? error.message : t("libraryGroups.saveFailed")); }
    };
    const trigger = overlay ? (
        <button
            type="button"
            disabled={disabled}
            className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-stone-900 disabled:opacity-50 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80"
            aria-label={t("libraryGroups.move")}
            title={`${t("libraryGroups.move")} · ${name}`}
        >
            <FolderInput className="size-4" />
        </button>
    ) : (
        <Button type="text" size="small" disabled={disabled} icon={<FolderInput className="size-3.5" />} aria-label={t("libraryGroups.move")} title={`${t("libraryGroups.move")} · ${name}`}>
            {compact ? null : t("libraryGroups.move")}
        </Button>
    );
    return (
        <span className="inline-flex" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
            <Dropdown trigger={["click"]} disabled={disabled} menu={{ selectable: true, selectedKeys: current === undefined ? [] : [current], items: [
                { key: "", label: t("libraryGroups.ungrouped") }, ...library.groups.map((group) => ({ key: group.id, label: group.name })),
            ], onClick: ({ key }) => void move(key) }}>
                {trigger}
            </Dropdown>
        </span>
    );
}
