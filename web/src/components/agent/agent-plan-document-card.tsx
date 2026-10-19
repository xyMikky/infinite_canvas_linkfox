import { useMemo, type MouseEvent } from "react";
import { App } from "antd";
import { Import, ListChecks, LoaderCircle, PanelLeftOpen, Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import { buildAgentPlanDocument, planWasExecuted } from "@/lib/agent/agent-plan-document";
import { importPlanDocumentToCanvas } from "@/lib/agent/import-plan-to-canvas";
import { requestPlanHandoff, requestPlanPreview } from "@/lib/agent/plan-handoff";
import { canvasThemes } from "@/lib/canvas-theme";
import { useAgentStore } from "@/stores/use-agent-store";

function objectField(value: unknown, key: string) {
    if (!value || typeof value !== "object") return;
    return (value as Record<string, unknown>)[key];
}

export function AgentPlanDocumentCard({
    title,
    text,
    detail,
    theme,
}: {
    title: string;
    text: string;
    detail?: unknown;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
}) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const planDocument = useAgentStore((state) => state.planDocument);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const messages = useAgentStore((state) => state.messages);
    const activeThreadId = useAgentStore((state) => state.activeThreadId);
    const activeTurnId = useAgentStore((state) => state.activeTurnId);
    const status = String(objectField(detail, "status") || "").toLowerCase();
    const running = ["inprogress", "in_progress", "running", "started", "pending"].includes(status);
    const failed = ["failed", "error"].includes(status) && Boolean(objectField(detail, "output"));
    const doc = useMemo(() => {
        if (running) return planDocument;
        if (planDocument) return planDocument;
        return buildAgentPlanDocument({
            threadId: activeThreadId,
            turnId: activeTurnId,
            markdown: text,
            messages,
            collapsed: true,
            width: planDocument?.width,
        });
    }, [planDocument, text, messages, activeThreadId, activeTurnId, running]);
    const heading = doc?.title || title || t("agent.plan.title");
    const statusColor = failed ? "#dc2626" : running ? "#d97706" : "#16a34a";
    const statusLabel = failed ? t("agent.message.failed") : running ? t("agent.message.running") : t("agent.message.completed");
    const ready = Boolean(doc) && !running;
    const executed = Boolean(doc?.executed || planWasExecuted(messages));

    const importToCanvas = (event: MouseEvent) => {
        event.preventDefault();
        if (!doc) {
            message.error(t("agent.plan.importCanvasEmpty"));
            return;
        }
        const result = importPlanDocumentToCanvas(doc);
        if (result === "empty") message.error(t("agent.plan.importCanvasEmpty"));
        else if (result === "no-canvas") message.warning(t("agent.plan.importCanvasFailed"));
        else message.success(t("agent.plan.importCanvasDone"));
    };

    const execute = (event: MouseEvent) => {
        event.preventDefault();
        if (executed) return;
        void requestPlanHandoff();
    };

    const expandOnLeft = (event: MouseEvent) => {
        event.preventDefault();
        if (planDocument) {
            setAgentState({
                planDocument: { ...planDocument, collapsed: false },
                panelOpen: true,
                panelMounted: true,
                panelClosing: false,
            });
            return;
        }
        requestPlanPreview(doc?.markdown || text, doc?.threadId || activeThreadId, doc?.turnId || activeTurnId);
    };

    return (
        <div
            className="min-w-0 overflow-hidden rounded-xl border text-left"
            style={{ borderColor: running ? "rgba(234,88,12,.45)" : "rgba(232,197,71,.42)", background: "transparent", color: theme.node.text }}
        >
            <div className="flex items-center gap-2 px-3.5 pt-2.5">
                {running ? <LoaderCircle className="size-4 shrink-0 animate-spin" style={{ color: statusColor }} /> : <ListChecks className="size-4 shrink-0" style={{ color: statusColor }} />}
                <span className="shrink-0 text-sm font-medium">{t("agent.plan.cardLabel")}</span>
                <span className="ml-auto shrink-0 text-[11px]" style={{ color: statusColor }}>{statusLabel}</span>
            </div>
            <div className="truncate px-3.5 pb-1 pt-1.5 text-sm leading-5" style={{ color: theme.node.muted }}>
                {running ? t("agent.plan.cardRunning") : heading}
            </div>
            {ready ? (
                <div className="flex justify-end gap-2 px-3 pb-2.5 pt-2">
                    <button
                        type="button"
                        className="inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs"
                        style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.text, background: "transparent" }}
                        onClick={importToCanvas}
                    >
                        <Import className="size-3" />
                        {t("agent.plan.importCanvas")}
                    </button>
                    <button
                        type="button"
                        className="inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs"
                        style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.text, background: "transparent" }}
                        onClick={expandOnLeft}
                    >
                        <PanelLeftOpen className="size-3" />
                        {t("agent.plan.openPanel")}
                    </button>
                    <button
                        type="button"
                        disabled={executed}
                        className="inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-semibold disabled:cursor-not-allowed"
                        style={executed
                            ? { background: theme.node.stroke, color: theme.node.muted, opacity: 0.7 }
                            : { background: "#e8c547", color: "#1a1a1a" }}
                        title={executed ? t("agent.plan.alreadyExecuted") : undefined}
                        onClick={execute}
                    >
                        <Play className="size-3 fill-current" />
                        {t("agent.plan.execute")}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
