import { useCallback, useEffect, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import i18n from "@/i18n";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { createCanvasGenerationScope } from "@/lib/canvas/canvas-generation-runtime";
import { useAgentStore } from "@/stores/use-agent-store";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { buildMindMapAgentContexts } from "@/lib/canvas/mind-map";
import { expandCanvasSelectionIds } from "@/lib/canvas/expand-canvas-selection";
import { withGroupBundleContent } from "@/lib/canvas/canvas-group-bundle";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";

type GenerateNodeRef = MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>;

type AgentBridgeParams = {
    projectId: string;
    title: string | undefined;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    selectedNodeIdsRef: MutableRefObject<Set<string>>;
    viewportRef: MutableRefObject<ViewportTransform>;
    generateNodeRef: GenerateNodeRef;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

/**
 * Bridge between the canvas and local Agent: publish the current snapshot and apply/undo capabilities
 * to the Agent store for the local Codex panel. All members except applyAgentOps are internal.
 */
export function useAgentBridge(params: AgentBridgeParams) {
    const { projectId, title, nodes, connections, selectedNodeIds, viewport, viewportSize, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setViewport, setContextMenu } =
        params;
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
    const projectTitle = title || i18n.t("canvas.project.untitled");

    const agentSnapshot = useMemo<CanvasAgentSnapshot>(
        () => ({
            projectId,
            title: projectTitle,
            nodes: withGroupBundleContent(nodes),
            connections,
            selectedNodeIds: Array.from(selectedNodeIds),
            viewport,
            viewportSize,
            mindMaps: buildMindMapAgentContexts(nodes, connections, expandCanvasSelectionIds(Array.from(selectedNodeIds), nodes)),
        }),
        [connections, projectTitle, nodes, projectId, selectedNodeIds, viewport, viewportSize],
    );
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const scope = createCanvasGenerationScope(projectId, nodesRef.current, connectionsRef.current);
            if (!scope.isActive()) {
                if (safeOps.some((op) => op.type === "run_generation")) throw new Error("画布已切换，请返回原画布后再发起生成");
                const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
                if (!project) throw new Error("原画布已删除，无法写入结果");
                const next = applyCanvasAgentOps({ projectId, title: project.title, nodes: project.nodes, connections: project.connections, selectedNodeIds: [], viewport: project.viewport, viewportSize }, safeOps.filter((op) => op.type !== "run_generation"));
                useCanvasStore.getState().updateProject(projectId, { nodes: next.nodes, connections: next.connections, viewport: next.viewport });
                return { ...next, nodes: withGroupBundleContent(next.nodes) };
            }
            const before = { projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current, viewportSize };
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(
                before,
                safeOps.filter((op) => op.type !== "run_generation"),
            );
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            setAgentUndoSnapshot(before);
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length) {
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
                    }),
                );
            }
            return { ...next, projectId, title: projectTitle, nodes: withGroupBundleContent(next.nodes) };
        },
        [projectTitle, projectId, viewportSize],
    );
    const undoAgentOps = useCallback(() => {
        if (!agentUndoSnapshot || agentUndoSnapshot.projectId !== projectId || !createCanvasGenerationScope(projectId, nodesRef.current, connectionsRef.current).isActive()) return null;
        nodesRef.current = agentUndoSnapshot.nodes;
        connectionsRef.current = agentUndoSnapshot.connections;
        selectedNodeIdsRef.current = new Set(agentUndoSnapshot.selectedNodeIds);
        viewportRef.current = agentUndoSnapshot.viewport;
        setNodes(agentUndoSnapshot.nodes);
        setConnections(agentUndoSnapshot.connections);
        setSelectedNodeIds(new Set(agentUndoSnapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(agentUndoSnapshot.viewport);
        setContextMenu(null);
        setAgentUndoSnapshot(null);
        return { ...agentUndoSnapshot, projectId, title: projectTitle, nodes: withGroupBundleContent(agentUndoSnapshot.nodes) };
    }, [agentUndoSnapshot, projectTitle, projectId]);

    // 只刷新桥接内容，不要在依赖更新时先 set(null)：否则 nodes/viewport 一变就会空窗，
    // 正好撞上 canvas_generate_* 的 tool_call →「当前不在画布页」。
    useEffect(() => {
        setAgentCanvasContext({ snapshot: agentSnapshot, applyOps: applyAgentOps, undoOps: undoAgentOps, canUndo: agentUndoSnapshot?.projectId === projectId });
    }, [agentSnapshot, applyAgentOps, agentUndoSnapshot, projectId, setAgentCanvasContext, undoAgentOps]);

    // 仅在离开画布项目页（hook 真正卸载）时拆除桥接
    useEffect(() => () => setAgentCanvasContext(null), [setAgentCanvasContext]);

    return { applyAgentOps };
}
