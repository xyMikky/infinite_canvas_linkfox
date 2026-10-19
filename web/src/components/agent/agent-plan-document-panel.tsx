import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { App } from "antd";
import { ChevronLeft, Download, Import, Play } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Streamdown } from "streamdown";

import { AGENT_PLAN_CAPTURE_ID, clampPlanDocumentWidth, planDocumentPreviewSource, planWasExecuted } from "@/lib/agent/agent-plan-document";
import { importPlanDocumentToCanvas } from "@/lib/agent/import-plan-to-canvas";
import { requestPlanHandoff } from "@/lib/agent/plan-handoff";
import { canvasThemes } from "@/lib/canvas-theme";
import { exportElementToPng } from "@/lib/canvas/export-preview-image";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;

export function AgentPlanDocumentPanel() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const planDocument = useAgentStore((state) => state.planDocument);
    const messages = useAgentStore((state) => state.messages);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const captureRef = useRef<HTMLDivElement | null>(null);
    const [exporting, setExporting] = useState(false);
    const [planResizing, setPlanResizing] = useState(false);
    if (!planDocument) return null;

    const collapsed = planDocument.collapsed;
    const panelWidth = collapsed ? 0 : planDocument.width;

    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (collapsed) return;
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = planDocument.width;
        let nextWidth = startWidth;
        setPlanResizing(true);
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = clampPlanDocumentWidth(startWidth + startX - moveEvent.clientX);
            setAgentState({ planDocument: { ...useAgentStore.getState().planDocument!, width: nextWidth } });
        };
        const onUp = () => {
            localStorage.setItem("canvas-agent-plan-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setPlanResizing(false);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const toggleCollapsed = () => {
        setAgentState({ planDocument: { ...planDocument, collapsed: !collapsed } });
    };

    const executed = Boolean(planDocument.executed || planWasExecuted(messages));
    const importToCanvas = () => {
        const result = importPlanDocumentToCanvas(planDocument);
        if (result === "empty") message.error(t("agent.plan.importCanvasEmpty"));
        else if (result === "no-canvas") message.warning(t("agent.plan.importCanvasFailed"));
        else message.success(t("agent.plan.importCanvasDone"));
    };

    const exportImage = async () => {
        const target = captureRef.current?.querySelector("[data-smart-preview-capture]") as HTMLElement | null;
        if (!target) {
            message.error(t("agent.plan.exportFailed"));
            return;
        }
        setExporting(true);
        try {
            await exportElementToPng({
                target,
                fileName: `${planDocument.title || "plan"}-规划书.png`,
                backgroundColor: theme.node.panel,
            });
            message.success(t("agent.plan.exportDone"));
        } catch {
            message.error(t("agent.plan.exportFailed"));
        } finally {
            setExporting(false);
        }
    };

    const edgeToggle = (
        <button
            type="button"
            className="absolute top-1/2 left-0 z-50 grid h-12 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border shadow-md"
            style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={toggleCollapsed}
            aria-label={collapsed ? t("agent.plan.expand") : t("agent.plan.collapse")}
            title={collapsed ? t("agent.plan.expand") : t("agent.plan.collapse")}
        >
            <ChevronLeft className={`size-3.5 transition-transform ${collapsed ? "" : "rotate-180"}`} />
        </button>
    );

    return (
        <motion.div
            className="relative h-full shrink-0 overflow-visible"
            initial={false}
            animate={{ width: panelWidth }}
            transition={{ duration: planResizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
        >
            <div className="relative h-full overflow-hidden border-l" data-smart-preview-node={AGENT_PLAN_CAPTURE_ID} style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}>
                <div className="absolute inset-y-0 right-0 flex flex-col" style={{ width: planDocument.width }}>
                    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: theme.node.stroke }}>
                        <div className="min-w-0 flex-1 truncate text-sm font-medium">{planDocument.title}</div>
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
                            disabled={executed}
                            className="inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-semibold disabled:cursor-not-allowed"
                            style={executed
                                ? { background: theme.node.stroke, color: theme.node.muted, opacity: 0.7 }
                                : { background: "#e8c547", color: "#1a1a1a" }}
                            title={executed ? t("agent.plan.alreadyExecuted") : undefined}
                            onClick={() => { if (!executed) void requestPlanHandoff(); }}
                        >
                            <Play className="size-3 fill-current" />
                            {t("agent.plan.execute")}
                        </button>
                        <button
                            type="button"
                            className="inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs"
                            style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.text, background: "transparent" }}
                            disabled={exporting}
                            onClick={() => void exportImage()}
                        >
                            <Download className="size-3" />
                            {t("agent.plan.export")}
                        </button>
                    </div>
                    <div ref={captureRef} className="thin-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto" data-canvas-no-zoom>
                        <div data-smart-preview-capture className="p-5" style={{ background: theme.node.panel, color: theme.node.text }}>
                            <Streamdown
                                mode="static"
                                className="agent-streamdown canvas-text-md select-text"
                                controls={false}
                                linkSafety={{ enabled: false }}
                                lineNumbers={false}
                            >
                                {planDocumentPreviewSource(planDocument)}
                            </Streamdown>
                        </div>
                    </div>
                </div>
            </div>
            {collapsed ? null : <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label={t("agent.plan.resize")} />}
            {edgeToggle}
        </motion.div>
    );
}
