import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { LocalAgentPanel } from "./local-agent-panel";
import { AgentPlanDocumentPanel } from "./agent-plan-document-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { AGENT_PLAN_COLLAPSED_WIDTH } from "@/lib/agent/agent-plan-document";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;
const PANEL_WIDTH_MIN = 360;
const PANEL_WIDTH_MAX = 760;

function clampPanelWidth(value: number) {
    return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, value));
}

export function AgentPanel() {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const width = clampPanelWidth(useAgentStore((state) => state.width) || 440);
    const planDocument = useAgentStore((state) => state.planDocument);
    const [resizing, setResizing] = useState(false);
    const panelMounted = useAgentStore((state) => state.panelMounted);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const panelClosing = useAgentStore((state) => state.panelClosing);
    const panelEpoch = useAgentStore((state) => state.panelEpoch);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const planWidth = planDocument ? (planDocument.collapsed ? AGENT_PLAN_COLLAPSED_WIDTH : planDocument.width) : 0;
    const interactive = panelOpen && !panelClosing;
    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = clampPanelWidth(startWidth + startX - moveEvent.clientX);
            setAgentState({ width: nextWidth });
        };
        const onUp = () => {
            localStorage.setItem("canvas-agent-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    if (!panelMounted) return null;

    const openWidth = width + planWidth + 1;

    return (
        <motion.div
            key={panelEpoch}
            data-agent-panel-shell
            className="relative flex h-full shrink-0 justify-end"
            initial={false}
            animate={{ width: panelOpen ? openWidth : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            inert={!interactive}
            style={{ overflow: "clip", pointerEvents: interactive ? "auto" : "none", zIndex: 0 }}
        >
            <AgentPlanDocumentPanel />
            <motion.aside
                className="relative flex h-full shrink-0 flex-col border-l"
                data-canvas-shortcuts-ignore
                initial={false}
                animate={{ x: panelClosing ? 28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
                style={{ width, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text, overflow: "hidden" }}
            >
                <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label={t("agent.panel.resize")} />
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <LocalAgentPanel embedded />
                </div>
            </motion.aside>
        </motion.div>
    );
}
