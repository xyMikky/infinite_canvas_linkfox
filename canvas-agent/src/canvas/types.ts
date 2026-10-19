/** 画布坐标。 */
export type Position = { x: number; y: number };
export type Viewport = { x: number; y: number; k: number };
export type ViewportSize = { width: number; height: number };
export type CanvasNodeType = string;
export type CanvasNode = { id: string; type: CanvasNodeType; title?: string; position: Position; width: number; height: number; metadata?: Record<string, unknown> };
export type CanvasConnection = { id: string; fromNodeId: string; toNodeId: string; kind?: string; label?: string };
export type MindMapAgentContext = {
    rootId: string;
    rootLabel: string;
    nodeCount: number;
    nodeIds: string[];
    selectedInMap: string[];
    outline: string;
};
export type CanvasSnapshot = {
    projectId?: string;
    title?: string;
    nodes?: CanvasNode[];
    connections?: CanvasConnection[];
    selectedNodeIds?: string[];
    viewport?: Viewport;
    viewportSize?: ViewportSize;
    clientId?: string;
    mindMaps?: MindMapAgentContext[];
};
