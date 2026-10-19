import type { Dispatch, SetStateAction } from "react";

import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type CanvasGenerationRequest = {
    projectId: string;
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
};

type GenerationView = {
    projectId: string;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setRunningNodeId: Dispatch<SetStateAction<string | null>>;
};

type GenerationRuntime = { activeView: GenerationView | null; requests: Map<string, CanvasGenerationRequest> };
// 热更新时旧异步任务与新模块必须共用同一份绑定，否则导入会只落盘、不更新仍打开的页面。
const runtime: GenerationRuntime = import.meta.hot?.data.canvasGenerationRuntime || { activeView: null, requests: new Map() };
if (import.meta.hot) import.meta.hot.data.canvasGenerationRuntime = runtime;
const generationRequests = runtime.requests;

function resolveUpdater<T>(updater: SetStateAction<T>, prev: T): T {
    return typeof updater === "function" ? (updater as (prev: T) => T)(prev) : updater;
}

/** 当前打开的画布页注册视图；未加载完成时不要绑定，避免写到错误本地 state。 */
export function bindCanvasGenerationView(view: GenerationView) {
    runtime.activeView = view;
    return () => {
        if (runtime.activeView === view) runtime.activeView = null;
    };
}

export function hasLiveCanvasGeneration(projectId: string) {
    for (const request of generationRequests.values()) {
        if (request.projectId === projectId) return true;
    }
    return false;
}

export function listCanvasGenerationRequests() {
    return [...generationRequests.values()];
}

export function liveRunningNodeIdForProject(projectId: string) {
    for (const request of generationRequests.values()) {
        if (request.projectId === projectId) return request.runningNodeId;
    }
    return null;
}

export function patchGenerationNodes(projectId: string, updater: SetStateAction<CanvasNodeData[]>) {
    if (runtime.activeView?.projectId === projectId) {
        runtime.activeView.setNodes(updater);
        return;
    }
    const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
    if (!project) return;
    useCanvasStore.getState().updateProject(projectId, { nodes: resolveUpdater(updater, project.nodes) });
}

export function patchGenerationConnections(projectId: string, updater: SetStateAction<CanvasConnection[]>) {
    if (runtime.activeView?.projectId === projectId) {
        runtime.activeView.setConnections(updater);
        return;
    }
    const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
    if (!project) return;
    useCanvasStore.getState().updateProject(projectId, { connections: resolveUpdater(updater, project.connections) });
}

export function patchGenerationRunningNodeId(projectId: string, updater: SetStateAction<string | null>) {
    if (runtime.activeView?.projectId !== projectId) return;
    runtime.activeView.setRunningNodeId(updater);
}

export function startCanvasGenerationRequest(
    projectId: string,
    targetNodeId: string,
    originNodeId: string,
    runningId = originNodeId,
    controller = new AbortController(),
) {
    const previous = generationRequests.get(targetNodeId);
    if (previous?.controller !== controller) previous?.controller.abort();
    generationRequests.set(targetNodeId, { projectId, targetNodeId, originNodeId, runningNodeId: runningId, controller });
    return controller;
}

export function finishCanvasGenerationRequest(targetNodeId: string, controller: AbortController) {
    const request = generationRequests.get(targetNodeId);
    if (request?.controller === controller) generationRequests.delete(targetNodeId);
}

/** 按 runningNodeId 中止，返回各 projectId 受影响的节点。 */
export function stopCanvasGenerationByRunningId(runningId: string) {
    const affectedByProject = new Map<string, Set<string>>();
    for (const [key, request] of [...generationRequests.entries()]) {
        if (request.runningNodeId !== runningId) continue;
        request.controller.abort();
        generationRequests.delete(key);
        let affected = affectedByProject.get(request.projectId);
        if (!affected) {
            affected = new Set();
            affectedByProject.set(request.projectId, affected);
        }
        affected.add(request.targetNodeId);
        affected.add(request.originNodeId);
    }
    return affectedByProject;
}

/** 单次生成闭包：读写落在发起时的 projectId，切画布后仍写回该项目。 */
export function createCanvasGenerationScope(projectId: string, seedNodes: CanvasNodeData[], seedConnections: CanvasConnection[]) {
    const onActiveView = runtime.activeView?.projectId === projectId;
    const stored = onActiveView ? null : useCanvasStore.getState().projects.find((item) => item.id === projectId);
    const nodesRef = { current: onActiveView ? seedNodes : stored?.nodes || seedNodes };
    const connectionsRef = { current: onActiveView ? seedConnections : stored?.connections || seedConnections };
    return {
        nodesRef,
        connectionsRef,
        isActive: () => runtime.activeView?.projectId === projectId,
        setNodes: (updater: SetStateAction<CanvasNodeData[]>) => {
            patchGenerationNodes(projectId, (prev) => {
                const next = resolveUpdater(updater, prev);
                nodesRef.current = next;
                return next;
            });
        },
        setConnections: (updater: SetStateAction<CanvasConnection[]>) => {
            patchGenerationConnections(projectId, (prev) => {
                const next = resolveUpdater(updater, prev);
                connectionsRef.current = next;
                return next;
            });
        },
        setRunningNodeId: (updater: SetStateAction<string | null>) => {
            patchGenerationRunningNodeId(projectId, updater);
        },
        startGenerationRequest: (targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController()) =>
            startCanvasGenerationRequest(projectId, targetNodeId, originNodeId, runningId, controller),
        finishGenerationRequest: finishCanvasGenerationRequest,
        hasRunningFor: (runningId: string) => listCanvasGenerationRequests().some((item) => item.runningNodeId === runningId),
    };
}
