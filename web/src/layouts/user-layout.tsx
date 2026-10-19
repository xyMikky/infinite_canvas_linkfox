import type { ReactNode } from "react";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { useAgentStore } from "@/stores/use-agent-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const hideAgentPanel = pathname === "/";
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const closePanel = useAgentStore((state) => state.closePanel);

    useEffect(() => {
        if (hideAgentPanel && panelOpen) closePanel();
    }, [closePanel, hideAgentPanel, panelOpen]);

    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            {hideAgentPanel ? null : <AgentPanel />}
        </div>
    );
}
