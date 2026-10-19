import { buildAddSmartPreviewNodeOp } from "@/components/canvas/nodes/smart-preview-node";
import { planDocumentPreviewSource, type AgentPlanDocument } from "@/lib/agent/agent-plan-document";
import { useAgentStore } from "@/stores/use-agent-store";

export function importPlanDocumentToCanvas(doc: AgentPlanDocument) {
    const source = planDocumentPreviewSource(doc);
    if (!source.trim()) return "empty" as const;
    const canvasContext = useAgentStore.getState().canvasContext;
    if (!canvasContext) return "no-canvas" as const;
    const viewport = canvasContext.snapshot.viewport;
    const k = Math.max(viewport.k || 1, 0.05);
    const title = (doc.title || "规划书").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 48) || "规划书";
    canvasContext.applyOps([
        buildAddSmartPreviewNodeOp({
            title,
            width: 560,
            height: 780,
            position: {
                x: -viewport.x / k + 80 + Math.random() * 48,
                y: -viewport.y / k + 80 + Math.random() * 48,
            },
            metadata: {
                status: "success",
                planPreview: true,
                smartPreviewPath: `${title}.md`,
                smartPreviewKind: "markdown",
                content: source,
            },
        }),
    ]);
    return "ok" as const;
}
