import { App, Button, Drawer, Input, Segmented, Select, Space, Tag } from "antd";
import { ListPlus, LogIn, LogOut, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { getDreaminaAccount, getDreaminaStatus, loginDreamina, logoutDreamina, syncDreaminaModels, type DreaminaStatus } from "@/services/api/dreamina-cli";
import { getKlingAccount, getKlingStatus, loginKling, logoutKling, syncKlingModels, type KlingStatus } from "@/services/api/kling-cli";
import { defaultBaseUrlForApiFormat, defaultModelsForApiFormat, DREAMINA_CHANNEL_ID, guessCapability, KLING_CHANNEL_ID, normalizeChannelModels, type ApiCallFormat, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [klingStatus, setKlingStatus] = useState<KlingStatus>({ available: false, loggedIn: false });
    const [klingAccount, setKlingAccount] = useState<Record<string, unknown>>({});
    const [klingLoading, setKlingLoading] = useState("");
    const klingLoginRef = useRef<AbortController | null>(null);
    const [dreaminaStatus, setDreaminaStatus] = useState<DreaminaStatus>({ available: false, loggedIn: false });
    const [dreaminaAccount, setDreaminaAccount] = useState<Record<string, unknown>>({});
    const [dreaminaLoading, setDreaminaLoading] = useState("");
    const dreaminaLoginRef = useRef<AbortController | null>(null);
    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: t("config.protocols.ark"), value: "ark" },
        { label: t("config.protocols.linkfox"), value: "linkfox" },
        { label: t("config.protocols.runninghub"), value: "runninghub" },
    ];
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio", "model"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));

    useEffect(() => {
        if (open && channel) setDraft(channel);
    }, [open, channel]);
    useEffect(() => {
        if (!open || channel?.id !== KLING_CHANNEL_ID) return;
        const controller = new AbortController();
        void getKlingStatus(controller.signal).then(async (status) => {
            if (controller.signal.aborted) return;
            setKlingStatus(status);
            setKlingAccount(status.loggedIn ? await getKlingAccount(controller.signal).catch(() => ({})) : {});
        });
        return () => controller.abort();
    }, [open, channel?.id]);
    useEffect(() => {
        if (!open || channel?.id !== DREAMINA_CHANNEL_ID) return;
        const controller = new AbortController();
        void getDreaminaStatus(controller.signal).then(async (status) => {
            if (controller.signal.aborted) return;
            setDreaminaStatus(status);
            setDreaminaAccount(status.loggedIn ? await getDreaminaAccount(controller.signal).catch(() => ({})) : {});
        });
        return () => controller.abort();
    }, [open, channel?.id]);

    if (!draft) return null;

    const canUseKlingRuntime = klingStatus.available || Boolean(window.desktopAPI) || ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const canUseDreaminaRuntime = dreaminaStatus.available || Boolean(window.desktopAPI) || ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        const presetModels = defaultModelsForApiFormat(apiFormat);
        patch({
            apiFormat,
            baseUrl,
            ...(presetModels.length ? { models: presetModels } : {}),
        });
    };

    const applySelection = (names: string[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => map.get(name) || { name, capability: guessCapability(name) }));
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const save = () => {
        onSave({ ...draft, name: draft.name.trim() || t("config.channels.unnamed"), models: normalizeChannelModels(draft.models) });
        onClose();
    };

    const refreshKling = async (signal?: AbortSignal) => {
        const status = await getKlingStatus(signal);
        setKlingStatus(status);
        if (status.loggedIn) {
            setKlingAccount(await getKlingAccount(signal).catch(() => ({})));
        } else {
            setKlingAccount({});
        }
    };

    const authorizeKling = async () => {
        const controller = new AbortController();
        klingLoginRef.current = controller;
        const timer = window.setTimeout(() => controller.abort(), 5 * 60 * 1000);
        setKlingLoading("login");
        try {
            await loginKling(controller.signal);
            await refreshKling();
            message.success(t("config.kling.authorized"));
        } catch (error) {
            if (!controller.signal.aborted) message.error(error instanceof Error ? error.message : t("config.kling.failed"));
        } finally {
            window.clearTimeout(timer);
            klingLoginRef.current = null;
            setKlingLoading("");
        }
    };

    const disconnectKling = async () => {
        setKlingLoading("logout");
        try {
            await logoutKling();
            await refreshKling();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.kling.failed"));
        } finally {
            setKlingLoading("");
        }
    };

    const synchronizeKling = async () => {
        setKlingLoading("sync");
        try {
            const result = await syncKlingModels();
            const next = { ...draft, models: result.models };
            setDraft(next);
            onSave(next);
            setKlingAccount(result.identity);
            message.success(t("config.kling.synced", { count: result.models.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.kling.failed"));
        } finally {
            setKlingLoading("");
        }
    };

    const refreshDreamina = async (signal?: AbortSignal) => {
        const status = await getDreaminaStatus(signal);
        setDreaminaStatus(status);
        if (status.loggedIn) {
            setDreaminaAccount(await getDreaminaAccount(signal).catch(() => ({})));
        } else {
            setDreaminaAccount({});
        }
        return status;
    };

    const authorizeDreamina = async () => {
        dreaminaLoginRef.current?.abort();
        const controller = new AbortController();
        dreaminaLoginRef.current = controller;
        const timer = window.setTimeout(() => controller.abort(), 10 * 60 * 1000);
        setDreaminaLoading("login");
        try {
            await loginDreamina(controller.signal);
            await refreshDreamina();
            message.success(t("config.dreamina.authorized"));
        } catch (error) {
            if (!controller.signal.aborted) message.error(error instanceof Error ? error.message : t("config.dreamina.failed"));
        } finally {
            window.clearTimeout(timer);
            dreaminaLoginRef.current = null;
            setDreaminaLoading("");
        }
    };

    const disconnectDreamina = async () => {
        setDreaminaLoading("logout");
        try {
            await logoutDreamina();
            await refreshDreamina();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.dreamina.failed"));
        } finally {
            setDreaminaLoading("");
        }
    };

    const synchronizeDreamina = async () => {
        setDreaminaLoading("sync");
        try {
            const result = await syncDreaminaModels();
            const next = { ...draft, models: result.models };
            setDraft(next);
            onSave(next);
            message.success(t("config.dreamina.synced", { count: result.models.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.dreamina.failed"));
        } finally {
            setDreaminaLoading("");
        }
    };

    if (draft.id === KLING_CHANNEL_ID) {
        return (
            <Drawer
                open={open}
                width={560}
                title={t("config.kling.title")}
                onClose={onClose}
                extra={<Button onClick={onClose}>{t("common.done")}</Button>}
            >
                <div className="space-y-5">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-base font-semibold">{t("config.channels.klingName")}</span>
                            <Tag color={klingStatus.loggedIn ? "success" : canUseKlingRuntime ? "default" : "warning"}>
                                {t(klingStatus.loggedIn ? "config.kling.loggedIn" : canUseKlingRuntime ? "config.kling.loggedOut" : "config.kling.desktopOnly")}
                            </Tag>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{t("config.kling.description")}</p>
                        {klingStatus.version ? <div className="mt-1 text-xs text-stone-400">CLI v{klingStatus.version}</div> : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {!klingStatus.loggedIn ? (
                            <Button type="primary" icon={<LogIn className="size-4" />} loading={klingLoading === "login"} disabled={!canUseKlingRuntime} onClick={() => void authorizeKling()}>
                                {t("config.kling.authorize")}
                            </Button>
                        ) : (
                            <>
                                <Button icon={<RefreshCw className="size-4" />} loading={klingLoading === "sync"} onClick={() => void synchronizeKling()}>
                                    {t("config.kling.sync")}
                                </Button>
                                <Button icon={<LogOut className="size-4" />} loading={klingLoading === "logout"} onClick={() => void disconnectKling()}>
                                    {t("config.kling.logout")}
                                </Button>
                            </>
                        )}
                        {klingLoading === "login" ? <Button onClick={() => klingLoginRef.current?.abort()}>{t("common.cancel")}</Button> : null}
                    </div>

                    {klingStatus.loggedIn ? (
                        <div className="rounded-lg border border-stone-200 p-4 text-sm dark:border-stone-800">
                            <div className="font-medium">{t("config.kling.account")}</div>
                            <div className="mt-2 break-all text-xs leading-5 text-stone-500">{accountSummary(klingAccount)}</div>
                        </div>
                    ) : null}

                    <div>
                        <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                        <div className="mt-2 space-y-1">
                            {draft.models.map((model) => (
                                <div key={`${model.capability}:${model.name}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10">
                                    <Tag>{t(`config.channelEditor.capabilities.${model.capability}`)}</Tag>
                                    <span className="min-w-0 flex-1 truncate">{model.label || model.name}</span>
                                </div>
                            ))}
                            {!draft.models.length ? <div className="py-6 text-center text-sm text-stone-500">{t("config.kling.emptyModels")}</div> : null}
                        </div>
                    </div>
                </div>
            </Drawer>
        );
    }

    if (draft.id === DREAMINA_CHANNEL_ID) {
        const versionLabel = dreaminaStatus.version && typeof dreaminaStatus.version === "object" ? String((dreaminaStatus.version as Record<string, unknown>).version || "") : "";
        return (
            <Drawer open={open} width={560} title={t("config.dreamina.title")} onClose={onClose} extra={<Button onClick={onClose}>{t("common.done")}</Button>}>
                <div className="space-y-5">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-base font-semibold">{t("config.channels.dreaminaName")}</span>
                            <Tag color={dreaminaStatus.loggedIn ? "success" : canUseDreaminaRuntime ? "default" : "warning"}>
                                {t(dreaminaStatus.loggedIn ? "config.dreamina.loggedIn" : canUseDreaminaRuntime ? "config.dreamina.loggedOut" : "config.dreamina.desktopOnly")}
                            </Tag>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{t("config.dreamina.description")}</p>
                        {versionLabel ? <div className="mt-1 text-xs text-stone-400">CLI v{versionLabel}</div> : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {!dreaminaStatus.loggedIn ? (
                            <Button type="primary" icon={<LogIn className="size-4" />} loading={dreaminaLoading === "login"} disabled={!canUseDreaminaRuntime} onClick={() => void authorizeDreamina()}>
                                {t("config.dreamina.authorize")}
                            </Button>
                        ) : (
                            <>
                                <Button icon={<RefreshCw className="size-4" />} loading={dreaminaLoading === "sync"} onClick={() => void synchronizeDreamina()}>
                                    {t("config.dreamina.sync")}
                                </Button>
                                <Button icon={<LogOut className="size-4" />} loading={dreaminaLoading === "logout"} onClick={() => void disconnectDreamina()}>
                                    {t("config.dreamina.logout")}
                                </Button>
                            </>
                        )}
                        {dreaminaLoading === "login" ? <Button onClick={() => dreaminaLoginRef.current?.abort()}>{t("common.cancel")}</Button> : null}
                    </div>

                    {dreaminaStatus.loggedIn ? (
                        <div className="rounded-lg border border-stone-200 p-4 text-sm dark:border-stone-800">
                            <div className="font-medium">{t("config.dreamina.account")}</div>
                            <div className="mt-2 break-all text-xs leading-5 text-stone-500">{accountSummary(dreaminaAccount)}</div>
                        </div>
                    ) : null}

                    <div>
                        <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                        <div className="mt-2 space-y-1">
                            {draft.models.map((model) => (
                                <div key={`${model.capability}:${model.name}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10">
                                    <Tag>{t(`config.channelEditor.capabilities.${model.capability}`)}</Tag>
                                    <span className="min-w-0 flex-1 truncate">{model.label || model.name}</span>
                                </div>
                            ))}
                            {!draft.models.length ? <div className="py-6 text-center text-sm text-stone-500">{t("config.dreamina.emptyModels")}</div> : null}
                        </div>
                    </div>
                </div>
            </Drawer>
        );
    }

    return (
        <Drawer
            open={open}
            width={640}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>
                    <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">API Key</span>
                    <Input.Password
                        value={draft.apiKey}
                        onChange={(event) => patch({ apiKey: event.target.value })}
                        placeholder={draft.apiFormat === "linkfox" ? t("config.channelEditor.linkfoxKeyPlaceholder") : draft.apiFormat === "runninghub" ? t("config.channelEditor.runninghubKeyPlaceholder") : "sk-..."}
                    />
                </label>
                {draft.apiFormat === "linkfox" ? <p className="md:col-span-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{t("config.channelEditor.linkfoxHint")}</p> : null}
            </div>

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                    {t("config.channelEditor.selectModels")}
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                    {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                </Button>
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
        </Drawer>
    );
}

function accountSummary(account: Record<string, unknown>) {
    const user = account.user && typeof account.user === "object" ? (account.user as Record<string, unknown>) : account;
    return [user.name, user.nickname, user.email, account.inspiration, account.credits, account.balance].filter((value) => value != null && value !== "").map(String).join(" · ") || "—";
}
