import { create } from "zustand";

import type { CanvasConnection } from "@/types/canvas";

const EMPTY_SET = new Set<string>();

type RelatedHighlight = {
    relatedNodeIds: ReadonlySet<string>;
    relatedConnectionIds: ReadonlySet<string>;
};

type LiveDrag = { dx: number; dy: number; ids: ReadonlySet<string> };

type CanvasInteractionStore = RelatedHighlight & {
    selectedNodeIds: Set<string>;
    selectionToComposer: boolean;
    hoveredNodeId: string | null;
    connectionTargetNodeId: string | null;
    liveDrag: LiveDrag | null;
    _connections: CanvasConnection[];
    setConnectionsForHighlight: (connections: CanvasConnection[]) => void;
    setSelectedNodeIds: (ids: Set<string>, syncToComposer?: boolean) => void;
    setHoveredNodeId: (id: string | null | ((current: string | null) => string | null)) => void;
    setConnectionTargetNodeId: (id: string | null) => void;
    setLiveDrag: (liveDrag: LiveDrag | null) => void;
    reset: () => void;
};

function computeRelated(selectedNodeIds: Set<string>, hoveredNodeId: string | null, connections: CanvasConnection[]): RelatedHighlight {
    const relatedNodeIds = new Set<string>();
    const relatedConnectionIds = new Set<string>();
    if (selectedNodeIds.size > 1) return { relatedNodeIds, relatedConnectionIds };

    const activeNodeId = hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
    if (!activeNodeId) return { relatedNodeIds, relatedConnectionIds };

    relatedNodeIds.add(activeNodeId);
    connections.forEach((connection) => {
        if (connection.fromNodeId !== activeNodeId && connection.toNodeId !== activeNodeId) return;
        relatedConnectionIds.add(connection.id);
        relatedNodeIds.add(connection.fromNodeId);
        relatedNodeIds.add(connection.toNodeId);
    });
    return { relatedNodeIds, relatedConnectionIds };
}

function withRelated(partial: Partial<CanvasInteractionStore>, state: CanvasInteractionStore): Partial<CanvasInteractionStore> {
    const selectedNodeIds = partial.selectedNodeIds ?? state.selectedNodeIds;
    const hoveredNodeId = partial.hoveredNodeId !== undefined ? partial.hoveredNodeId : state.hoveredNodeId;
    const connections = partial._connections ?? state._connections;
    return { ...partial, ...computeRelated(selectedNodeIds, hoveredNodeId, connections) };
}

export const useCanvasInteractionStore = create<CanvasInteractionStore>((set) => ({
    selectedNodeIds: new Set<string>(),
    selectionToComposer: true,
    hoveredNodeId: null,
    connectionTargetNodeId: null,
    liveDrag: null,
    relatedNodeIds: EMPTY_SET,
    relatedConnectionIds: EMPTY_SET,
    _connections: [],
    setConnectionsForHighlight: (connections) => set((state) => withRelated({ _connections: connections }, state)),
    setSelectedNodeIds: (selectedNodeIds, selectionToComposer = true) => set((state) => withRelated({ selectedNodeIds, selectionToComposer }, state)),
    setHoveredNodeId: (next) =>
        set((state) => {
            const hoveredNodeId = typeof next === "function" ? next(state.hoveredNodeId) : next;
            return withRelated({ hoveredNodeId }, state);
        }),
    setConnectionTargetNodeId: (connectionTargetNodeId) => set({ connectionTargetNodeId }),
    setLiveDrag: (liveDrag) => set({ liveDrag }),
    reset: () =>
        set({
            selectedNodeIds: new Set(),
            selectionToComposer: true,
            hoveredNodeId: null,
            connectionTargetNodeId: null,
            liveDrag: null,
            relatedNodeIds: EMPTY_SET,
            relatedConnectionIds: EMPTY_SET,
            _connections: [],
        }),
}));
