import { useEffect, useState } from "react";
import { App, Button, Input, Tooltip } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { CheckCircle2, Copy, KeyRound, Link2, LoaderCircle, Play, PlugZap, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { fetchCodexInstallStatus, fetchCursorInstallStatus } from "@/services/api/canvas-agent";
import { useAgentStore, type AgentProvider } from "@/stores/use-agent-store";

const DIRECT_AGENT_COMMAND = "npx -y @basketikun/canvas-agent";

export function AgentConnectView({
    theme,
    provider = "codex",
    url,
    token,
    enabled,
    connected,
    activity,
    connectError,
    onUrlChange,
    onTokenChange,
    onToggleEnabled,
    onStartDirect,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    provider?: AgentProvider;
    url: string;
    token: string;
    enabled: boolean;
    connected: boolean;
    activity: string;
    connectError: string;
    onUrlChange: (value: string) => void;
    onTokenChange: (value: string) => void;
    onToggleEnabled: () => void;
    onStartDirect: () => Promise<void>;
}) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const cursorApiKey = useAgentStore((state) => state.cursorApiKey);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const bootstrapStatus = useAgentStore((state) => state.bootstrapStatus);
    const mcpStartupStatuses = useAgentStore((state) => state.mcpStartupStatuses);
    const mcpEntries = Object.entries(mcpStartupStatuses);
    const [starting, setStarting] = useState(false);
    const [cliInstalled, setCliInstalled] = useState<boolean | null>(null);
    const [cliCheckAvailable, setCliCheckAvailable] = useState(true);
    const statusText = connectError ? t("agent.status.failed") : connected ? activity : enabled ? t("agent.status.connecting") : t("agent.status.disconnected");
    const statusColor = connectError ? "#dc2626" : connected ? "#16a34a" : enabled ? "#d97706" : theme.node.muted;
    const isCursor = provider === "cursor";
    const startDisabled = starting || connected;

    useEffect(() => {
        let cancelled = false;
        const check = isCursor ? fetchCursorInstallStatus() : fetchCodexInstallStatus();
        void check.then((status) => {
            if (cancelled) return;
            setCliCheckAvailable(status.available);
            setCliInstalled(status.available ? status.installed : null);
        });
        return () => {
            cancelled = true;
        };
    }, [isCursor]);

    const copyCommand = (command: string) => {
        copyToClipboard(command);
        message.success(t("agent.connect.commandCopied"));
    };
    const handleStartDirect = async () => {
        if (starting || startDisabled) return;
        setStarting(true);
        try {
            await onStartDirect();
            const status = isCursor ? await fetchCursorInstallStatus() : await fetchCodexInstallStatus();
            setCliCheckAvailable(status.available);
            setCliInstalled(status.available ? status.installed : null);
        } finally {
            setStarting(false);
        }
    };

    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div className="flex flex-col gap-2">
                    <Button
                        type="primary"
                        size="large"
                        block
                        className="!inline-flex !h-12 !shrink-0 !items-center !justify-center !overflow-hidden !text-base"
                        icon={<Play className="size-5" />}
                        loading={starting}
                        disabled={startDisabled}
                        onClick={() => void handleStartDirect()}
                    >
                        {t(starting ? "agent.connect.starting" : "agent.connect.startDirect")}
                    </Button>
                    {cliCheckAvailable ? (
                        <div className="text-[11px] leading-5" style={{ color: cliInstalled ? "#16a34a" : "#dc2626" }}>
                            {cliInstalled
                                ? t(isCursor ? "agent.connect.cursorInstalled" : "agent.connect.codexInstalled")
                                : t(isCursor ? "agent.connect.cursorNotInstalled" : "agent.connect.codexNotInstalled")}
                        </div>
                    ) : (
                        <div className="text-[11px] leading-5" style={{ color: theme.node.muted }}>
                            {t(isCursor ? "agent.connect.cursorCheckUnavailable" : "agent.connect.codexCheckUnavailable")}
                        </div>
                    )}
                </div>

                <div>
                    <div className="text-base font-semibold leading-6">{t("agent.connect.title")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("agent.connect.description")}
                    </div>
                </div>

                <div className="rounded-lg px-3 py-2.5">
                    <div className="text-sm font-medium leading-5">{t("agent.connect.directTitle")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t(isCursor ? "agent.connect.cursorDirectText" : "agent.connect.directText")}
                    </div>
                    {isCursor ? (
                        <label className="mt-3 grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <KeyRound className="size-3.5" />
                                {t("agent.connect.cursorApiKey")}
                            </span>
                            <Input.Password
                                size="large"
                                prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />}
                                value={cursorApiKey}
                                onChange={(event) => {
                                    const value = event.target.value;
                                    localStorage.setItem("canvas-cursor-api-key", value);
                                    setAgentState({ cursorApiKey: value });
                                }}
                                placeholder={t("agent.connect.cursorApiKeyPlaceholder")}
                            />
                            <span className="text-[11px] leading-5" style={{ color: theme.node.muted }}>{t("agent.connect.cursorApiKeyHint")}</span>
                        </label>
                    ) : null}
                    <div className="mt-2 flex min-w-0 items-center gap-2 rounded-md border bg-transparent px-2 py-1.5" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] leading-5">{DIRECT_AGENT_COMMAND}</code>
                        <Tooltip title={t("agent.connect.copyCommand")}>
                            <Button size="small" type="text" className="!h-6 !w-6 !min-w-6" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(DIRECT_AGENT_COMMAND)} />
                        </Tooltip>
                    </div>
                </div>

                {connected && (bootstrapStatus || mcpEntries.length) ? (
                    <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: theme.node.stroke }}>
                        <div className="text-sm font-medium leading-5">{t("agent.connect.mcpStatus")}</div>
                        {bootstrapStatus ? (
                            <div className="mt-2 flex min-w-0 items-start gap-2 text-xs leading-5" style={{ color: theme.node.muted }}>
                                <BootstrapIcon status={bootstrapStatus.status} />
                                <div className="min-w-0">
                                    <div className="font-medium" style={{ color: theme.node.text }}>{bootstrapStatus.text}</div>
                                    {bootstrapStatus.detail ? <div className="opacity-65">{bootstrapStatus.detail}</div> : null}
                                </div>
                            </div>
                        ) : null}
                        {mcpEntries.length ? (
                            <div className="mt-3 space-y-2">
                                {mcpEntries.map(([name, item]) => (
                                    <div key={name} className="flex min-w-0 items-start gap-2 text-xs leading-5" style={{ color: theme.node.muted }}>
                                        <BootstrapIcon status={item.status} />
                                        <div className="min-w-0">
                                            <div className="font-medium" style={{ color: theme.node.text }}>{name}</div>
                                            <div className="opacity-65">{item.detail}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {isCursor ? null : (
                <div className="rounded-lg border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    <div className="font-medium" style={{ color: theme.node.text }}>
                        {t("agent.connect.codexUsageTitle")}
                    </div>
                    <div className="mt-1">{t("agent.connect.codexUsageText")}</div>
                </div>
                )}

                <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 text-sm font-medium leading-5">{t("agent.connect.webConnection")}</span>
                                <span
                                    className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4"
                                    style={{ borderColor: connected || enabled || connectError ? statusColor : theme.node.stroke, color: statusColor }}
                                >
                                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
                                    <span className="truncate">{statusText}</span>
                                </span>
                            </div>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                {t("agent.connect.autoDiscover")}
                            </div>
                        </div>
                        <Button className="!h-8 !px-3" type={enabled ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={onToggleEnabled}>
                            {t(enabled ? "agent.connect.disconnect" : "agent.connect.connect")}
                        </Button>
                    </div>
                    <div className="mt-3 grid gap-2.5">
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <Link2 className="size-3.5" />
                                {t("agent.connect.localAddress")}
                                <span className="font-normal opacity-70">Local URL</span>
                            </span>
                            <Input size="large" prefix={<Link2 className="mr-1 size-4" style={{ color: theme.node.faint }} />} value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder={t("agent.connect.urlPlaceholder")} />
                        </label>
                        <label className="grid gap-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: theme.node.muted }}>
                                <KeyRound className="size-3.5" />
                                {t("agent.connect.token")}
                                <span className="font-normal opacity-70">Connect token</span>
                            </span>
                            <Input.Password
                                size="large"
                                prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />}
                                value={token}
                                onChange={(event) => onTokenChange(event.target.value)}
                                placeholder={t("agent.connect.tokenPlaceholder")}
                            />
                        </label>
                        {connectError ? (
                            <div className="rounded-md border px-2.5 py-2 text-xs leading-5" style={{ borderColor: "rgba(220,38,38,.35)", color: "#dc2626" }}>
                                {connectError}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

function BootstrapIcon({ status }: { status: "running" | "ready" | "error" }) {
    if (status === "running") return <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin" />;
    if (status === "ready") return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />;
    return <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-600" />;
}
