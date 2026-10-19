import { nanoid } from "nanoid";

import i18n from "@/i18n";
import {
    DEFAULT_MIND_COLOR,
    MIND_SHAPES,
    computeMindNodeSize,
    type MindShape,
} from "@/components/canvas/nodes/mind-node";
import { SMART_PREVIEW_NODE_TYPE } from "@/components/canvas/nodes/smart-preview-node";
import { boundsForGroupFrame } from "@/lib/canvas/canvas-node-geometry";
import { buildGroupBundleText, suggestDataGroupTitle } from "@/lib/canvas/canvas-group-bundle";
import { pickMindConnectionSides } from "@/lib/canvas/canvas-connection-geometry";
import {
    applyMindLayoutPositions,
    compactEmptyDataGroups,
    inferMissingGroupMembership,
    layoutMindMaps,
    mindOpsNeedLayout,
    packDataGroupMembers,
    recenterVerticalMindSpines,
    refreshMindConnectionSides,
    resizeDataGroupFrames,
    separateAllMindOverlaps,
    separateGroupExternalOverlaps,
} from "@/lib/canvas/mind-map-auto-layout";
import {
    MIND_NODE_TYPE,
    ensureDecisionOutgoingLabels,
    isDecisionNode,
    mindLinkKind,
    nextDecisionBranchLabel,
    orderAnnotationConnection,
    type MindMapAgentContext,
} from "@/lib/canvas/mind-map";
import { getNodeSpec, isRegisteredNodeType } from "@/lib/canvas/node-registry";
import { resolveModelForCapability, useConfigStore, type ModelCapability } from "@/stores/use-config-store";
import {
    CanvasNodeType,
    type CanvasConnection,
    type CanvasNodeData,
    type CanvasNodeMetadata,
    type CanvasNodeTypeId,
    type ConnectionHandleSide,
    type ViewportTransform,
} from "@/types/canvas";

const SMART_PREVIEW_DEFAULT = { width: 420, height: 320 };
const SMART_PREVIEW_CANVAS_TSX = { width: 560, height: 780 };
export type CanvasAgentOp =
    | { type: "add_node"; id?: string; nodeType?: CanvasNodeTypeId; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: "update_node"; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeTypeId }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string; kind?: CanvasConnection["kind"]; fromSide?: ConnectionHandleSide; toSide?: ConnectionHandleSide; label?: string }
    | { type: "update_connection"; id?: string; fromNodeId?: string; toNodeId?: string; label?: string; kind?: CanvasConnection["kind"]; fromSide?: ConnectionHandleSide; toSide?: ConnectionHandleSide }
    | { type: "set_viewport"; viewport: ViewportTransform }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string };

export type CanvasAgentSnapshot = {
    projectId: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: ViewportTransform;
    viewportSize?: { width: number; height: number };
    mindMaps?: MindMapAgentContext[];
};

export function viewportWorldCenter(snapshot: CanvasAgentSnapshot) {
    const { viewport, viewportSize } = snapshot;
    if (viewportSize?.width && viewportSize?.height && viewport) {
        return {
            x: (viewportSize.width / 2 - viewport.x) / viewport.k,
            y: (viewportSize.height / 2 - viewport.y) / viewport.k,
        };
    }
    const nodes = snapshot.nodes;
    return {
        x: nodes.length ? Math.max(...nodes.map((node) => node.position.x + node.width)) + 80 : 0,
        y: 0,
    };
}

function resolveAgentAddNodePosition(
    snapshot: CanvasAgentSnapshot,
    width: number,
    height: number,
    index: number,
    op: Pick<Extract<CanvasAgentOp, { type: "add_node" }>, "position" | "x" | "y">,
) {
    if (op.position) return op.position;
    if (op.x !== undefined || op.y !== undefined) {
        return { x: op.x ?? 0, y: op.y ?? index * 36 };
    }
    const center = viewportWorldCenter(snapshot);
    return { x: center.x - width / 2 + index * 40, y: center.y - height / 2 + index * 40 };
}

export function summarizeCanvasAgentOps(ops?: CanvasAgentOp[]) {
    const counts = (Array.isArray(ops) ? ops : []).reduce<Record<string, number>>((acc, op) => {
        if (!op?.type) return acc;
        acc[op.type] = (acc[op.type] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(counts)
        .map(([type, count]) => `${opLabel(type)} ${count}`)
        .join("，");
}

function asMindShape(value: unknown, fallback: MindShape): MindShape {
    const shape = String(value || "");
    if (shape === "underline" || (MIND_SHAPES as readonly string[]).includes(shape)) return shape as MindShape;
    return fallback;
}

function resolveMindSize(
    content: string,
    isRoot: boolean,
    fontSize: number,
    shape: MindShape,
    explicit?: { width?: number; height?: number },
) {
    const computed = computeMindNodeSize(content, isRoot, fontSize, shape);
    // Agent 传入的宽高不得小于按正文估算的尺寸，否则中文会被裁切、胶囊描边看起来缺左右弧
    return {
        width: Math.max(explicit?.width || 0, computed.width),
        height: Math.max(explicit?.height || 0, computed.height),
    };
}

function readMemberIds(metadata?: CanvasNodeMetadata): string[] {
    const raw = (metadata as { memberIds?: unknown } | undefined)?.memberIds;
    if (!Array.isArray(raw)) return [];
    return raw.filter((id): id is string => typeof id === "string" && Boolean(id));
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops?: CanvasAgentOp[]) {
    let nodes = snapshot.nodes;
    let connections = snapshot.connections;
    let selectedNodeIds = snapshot.selectedNodeIds;
    let viewport = snapshot.viewport;
    const opList = Array.isArray(ops) ? ops : [];

    opList.forEach((op, index) => {
        if (!op?.type) return;
        if (op.type === "add_node") {
            const nodeType = op.nodeType && isRegisteredNodeType(op.nodeType) ? op.nodeType : CanvasNodeType.Text;
            const spec = getNodeSpec(nodeType);

            if (nodeType === CanvasNodeType.Group) {
                const memberIds = readMemberIds(op.metadata);
                const members = nodes.filter((node) => memberIds.includes(node.id));
                const frame = members.length >= 1 ? boundsForGroupFrame(members) : null;
                const width = op.width || frame?.width || spec.width;
                const height = op.height || frame?.height || spec.height;
                const position = frame?.position || resolveAgentAddNodePosition(snapshot, width, height, index, op);
                const groupId = op.id || `group-${Date.now()}-${index}`;
                const title =
                    String(op.title || "").trim() ||
                    (members.length ? suggestDataGroupTitle(members, nodes, i18n.t("canvas.node.dataGroup")) : spec.title);
                const bundleText = members.length ? buildGroupBundleText(members) : String(op.metadata?.content || "").trim();
                const { memberIds: _keepMemberIds, ...restMeta } = (op.metadata || {}) as CanvasNodeMetadata & { memberIds?: unknown };
                const node: CanvasNodeData = {
                    id: groupId,
                    type: CanvasNodeType.Group,
                    title,
                    position,
                    width,
                    height,
                    metadata: sanitizeAgentNodeMetadata(nodeType, {
                        ...spec.metadata,
                        ...restMeta,
                        groupKind: "data",
                        ...(memberIds.length ? { memberIds } : {}),
                        ...(bundleText ? { groupBundleText: bundleText, content: bundleText } : {}),
                    }),
                };
                nodes = [...nodes, node];
                if (memberIds.length) {
                    const idSet = new Set(memberIds);
                    nodes = nodes.map((item) =>
                        idSet.has(item.id) ? { ...item, metadata: { ...item.metadata, groupId } } : item,
                    );
                }
                selectedNodeIds = [node.id];
                snapshot = { ...snapshot, nodes, selectedNodeIds };
                return;
            }

            if (nodeType === SMART_PREVIEW_NODE_TYPE) {
                const kind = String(op.metadata?.smartPreviewKind || "").trim();
                const content = String(op.metadata?.content || "").trim();
                const path = String(op.metadata?.smartPreviewPath || op.title || "").trim() || (kind === "canvasTsx" ? "preview.canvas.tsx" : "preview");
                const size = kind === "canvasTsx" ? SMART_PREVIEW_CANVAS_TSX : SMART_PREVIEW_DEFAULT;
                const width = op.width || size.width;
                const height = op.height || size.height;
                const title = String(op.title || path).trim().slice(0, 48) || "智能预览";
                const node: CanvasNodeData = {
                    id: op.id || `smart-preview-${Date.now()}-${index}`,
                    type: SMART_PREVIEW_NODE_TYPE,
                    title,
                    position: resolveAgentAddNodePosition(snapshot, width, height, index, op),
                    width,
                    height,
                    metadata: sanitizeAgentNodeMetadata(nodeType, {
                        ...spec.metadata,
                        ...op.metadata,
                        status: content || kind ? "success" : "idle",
                        smartPreviewPath: path,
                        smartPreviewKind: kind || (content ? "text" : ""),
                        smartPreviewSheetIndex: typeof op.metadata?.smartPreviewSheetIndex === "number" ? op.metadata.smartPreviewSheetIndex : -1,
                        smartPreviewSheetName: op.metadata?.smartPreviewSheetName || "",
                        smartPreviewSheetCount: op.metadata?.smartPreviewSheetCount || 0,
                        content,
                    }),
                };
                nodes = [...nodes, node];
                selectedNodeIds = [node.id];
                snapshot = { ...snapshot, nodes, selectedNodeIds };
                return;
            }

            const isMindRoot = nodeType === MIND_NODE_TYPE && op.metadata?.mindRole === "root";
            const mindKind = nodeType === MIND_NODE_TYPE && !isMindRoot ? (op.metadata?.mindKind || "topic") : undefined;
            const defaultMindShape: MindShape = isMindRoot
                ? "capsule"
                : mindKind === "decision"
                  ? "hexagon"
                  : mindKind === "annotation"
                    ? "underline"
                    : "rounded";
            const label = String(op.title || op.metadata?.content || "").trim() || (nodeType === MIND_NODE_TYPE ? "主题" : spec.title);
            const mindMeta =
                nodeType === MIND_NODE_TYPE
                    ? {
                          ...spec.metadata,
                          ...op.metadata,
                          content: String(op.metadata?.content || label),
                          mindRole: isMindRoot ? ("root" as const) : (op.metadata?.mindRole || "topic"),
                          ...(mindKind ? { mindKind } : {}),
                          mindShape: asMindShape(op.metadata?.mindShape, defaultMindShape),
                          mindColor: op.metadata?.mindColor || DEFAULT_MIND_COLOR,
                          fontSize: Number(op.metadata?.fontSize) || (isMindRoot ? 15 : 13),
                          status: "idle",
                      }
                    : null;
            const mindSize =
                mindMeta != null
                    ? resolveMindSize(
                          String(mindMeta.content),
                          isMindRoot,
                          Number(mindMeta.fontSize) || (isMindRoot ? 15 : 13),
                          asMindShape(mindMeta.mindShape, defaultMindShape),
                          { width: op.width, height: op.height },
                      )
                    : null;
            const width = mindSize?.width || op.width || spec.width;
            const height = mindSize?.height || op.height || spec.height;
            const node: CanvasNodeData = {
                id: op.id || `${nodeType}-${Date.now()}-${index}`,
                type: nodeType,
                title: label,
                position: resolveAgentAddNodePosition(snapshot, width, height, index, op),
                width,
                height,
                metadata: sanitizeAgentNodeMetadata(nodeType, mindMeta || { ...spec.metadata, ...op.metadata }),
            };
            // 组可能先于成员创建：若已有 group.memberIds 点名本节点，立刻挂上 groupId
            if (nodeType === MIND_NODE_TYPE) {
                const owner = nodes.find(
                    (item) =>
                        item.type === CanvasNodeType.Group &&
                        readMemberIds(item.metadata).includes(node.id),
                );
                if (owner) node.metadata = { ...node.metadata, groupId: owner.id };
            }
            nodes = [...nodes, node];
            selectedNodeIds = [node.id];
            snapshot = { ...snapshot, nodes, selectedNodeIds };
        }
        if (op.type === "update_node") {
            if (!op.id) return;
            nodes = nodes.map((node) => {
                if (node.id !== op.id) return node;
                const metadata = sanitizeAgentNodeMetadata(node.type, { ...node.metadata, ...op.patch?.metadata, ...op.metadata });
                const next: CanvasNodeData = { ...node, ...op.patch, metadata };
                if (node.type === MIND_NODE_TYPE && typeof metadata?.content === "string" && metadata.content.trim()) {
                    next.title = metadata.content.trim();
                }
                if (node.type === MIND_NODE_TYPE) {
                    const contentChanged =
                        typeof metadata?.content === "string" &&
                        metadata.content !== node.metadata?.content;
                    const styleChanged =
                        metadata?.mindShape !== node.metadata?.mindShape ||
                        metadata?.fontSize !== node.metadata?.fontSize ||
                        metadata?.mindKind !== node.metadata?.mindKind;
                    const sizeExplicit = op.patch?.width != null || op.patch?.height != null;
                    if ((contentChanged || styleChanged) && !sizeExplicit) {
                        const isRoot = metadata?.mindRole === "root";
                        const kind = metadata?.mindKind || "topic";
                        const fallbackShape: MindShape =
                            isRoot ? "capsule" : kind === "decision" ? "hexagon" : kind === "annotation" ? "underline" : "rounded";
                        const size = resolveMindSize(
                            String(metadata?.content || next.title || "主题"),
                            Boolean(isRoot),
                            Number(metadata?.fontSize) || (isRoot ? 15 : 13),
                            asMindShape(metadata?.mindShape, fallbackShape),
                        );
                        next.width = size.width;
                        next.height = size.height;
                    }
                }
                return next;
            });
            const memberIds = readMemberIds(op.metadata || op.patch?.metadata);
            if (memberIds.length && nodes.some((node) => node.id === op.id && node.type === CanvasNodeType.Group)) {
                const idSet = new Set(memberIds);
                nodes = nodes.map((item) => {
                    if (item.id === op.id) {
                        return { ...item, metadata: { ...item.metadata, memberIds } };
                    }
                    return idSet.has(item.id) ? { ...item, metadata: { ...item.metadata, groupId: op.id } } : item;
                });
            }
        }
        if (op.type === "delete_node") {
            const ids = new Set(op.ids || (op.id ? [op.id] : op.nodeType ? nodes.filter((node) => node.type === op.nodeType).map((node) => node.id) : []));
            nodes = nodes.filter((node) => !ids.has(node.id));
            connections = connections.filter((conn) => !ids.has(conn.fromNodeId) && !ids.has(conn.toNodeId));
            selectedNodeIds = selectedNodeIds.filter((id) => !ids.has(id));
        }
        if (op.type === "delete_connections") {
            const ids = new Set(op.ids || (op.id ? [op.id] : []));
            connections = op.all ? [] : connections.filter((conn) => !ids.has(conn.id));
        }
        if (op.type === "connect_nodes") {
            if (!op.fromNodeId || !op.toNodeId) return;
            const fromNode = nodes.find((node) => node.id === op.fromNodeId);
            const toNode = nodes.find((node) => node.id === op.toNodeId);
            if (!fromNode || !toNode) return;
            const resolved = resolveAgentConnect(fromNode, toNode, op, connections, nodes);
            const existing = connections.find((conn) => conn.fromNodeId === resolved.fromNodeId && conn.toNodeId === resolved.toNodeId);
            if (existing) {
                connections = connections.map((conn) => (conn.id === existing.id ? { ...conn, ...resolved.patch } : conn));
            } else {
                connections = [...connections, { id: op.id || nanoid(), fromNodeId: resolved.fromNodeId, toNodeId: resolved.toNodeId, ...resolved.patch }];
            }
        }
        if (op.type === "update_connection") {
            const target = findAgentConnection(connections, op);
            if (!target) return;
            connections = connections.map((conn) => {
                if (conn.id !== target.id) return conn;
                const next = { ...conn };
                if (op.label !== undefined) next.label = op.label.trim() || undefined;
                if (op.kind) next.kind = op.kind;
                if (op.fromSide) next.fromSide = op.fromSide;
                if (op.toSide) next.toSide = op.toSide;
                return next;
            });
        }
        if (op.type === "set_viewport" && op.viewport) viewport = op.viewport;
        if (op.type === "select_nodes") selectedNodeIds = (op.ids || []).filter((id) => nodes.some((node) => node.id === id));
    });

    if (mindOpsNeedLayout(opList)) {
        nodes = compactEmptyDataGroups(nodes);
        nodes = inferMissingGroupMembership(nodes);
        nodes = applyMindLayoutPositions(nodes, layoutMindMaps(nodes, connections));
        nodes = packDataGroupMembers(nodes, connections);
        nodes = resizeDataGroupFrames(nodes);
        nodes = separateGroupExternalOverlaps(nodes);
        nodes = resizeDataGroupFrames(nodes);
        nodes = separateAllMindOverlaps(nodes, connections);
        nodes = resizeDataGroupFrames(nodes);
        nodes = recenterVerticalMindSpines(nodes, connections);
        // 居中后再消一次：标注此前被排除，且居中可能把主题推回与标注重叠
        nodes = separateAllMindOverlaps(nodes, connections);
        // 末轮消重叠仍可能横向挤偏主链，最后再居中一次
        nodes = recenterVerticalMindSpines(nodes, connections);
        // 消重叠可能把成员/组框相对位移，最后必须再箍紧组框
        nodes = resizeDataGroupFrames(nodes);
        connections = refreshMindConnectionSides(nodes, connections);
    }
    connections = ensureDecisionOutgoingLabels(nodes, connections);

    return { ...snapshot, nodes, connections, selectedNodeIds, viewport };
}

function resolveAgentConnect(
    fromNode: CanvasNodeData,
    toNode: CanvasNodeData,
    op: Pick<Extract<CanvasAgentOp, { type: "connect_nodes" }>, "fromNodeId" | "toNodeId" | "kind" | "fromSide" | "toSide" | "label">,
    connections: CanvasConnection[],
    allNodes: CanvasNodeData[],
) {
    const label = String(op.label || "").trim();
    // 跨组连到组内叶子时，改挂到数据组整框，避免蛛网长线
    let fromId = op.fromNodeId;
    let toId = op.toNodeId;
    let from = fromNode;
    let to = toNode;
    const fromGid = fromNode.metadata?.groupId ? String(fromNode.metadata.groupId) : "";
    const toGid = toNode.metadata?.groupId ? String(toNode.metadata.groupId) : "";
    if (toGid && toGid !== fromGid && toGid !== fromId) {
        const group = allNodes.find((node) => node.id === toGid);
        if (group && (group.metadata?.groupKind === "data" || group.metadata?.groupBundleText || Array.isArray(group.metadata?.memberIds))) {
            toId = toGid;
            to = group;
        }
    }
    if (fromGid && fromGid !== toGid && fromGid !== toId) {
        const group = allNodes.find((node) => node.id === fromGid);
        if (group && (group.metadata?.groupKind === "data" || group.metadata?.groupBundleText || Array.isArray(group.metadata?.memberIds))) {
            fromId = fromGid;
            from = group;
        }
    }
    if (fromId === toId) {
        fromId = op.fromNodeId;
        toId = op.toNodeId;
        from = fromNode;
        to = toNode;
    }

    const linkKind = mindLinkKind(from, to) || (op.kind === "mind" || op.kind === "annotation" ? op.kind : null);
    if (linkKind === "annotation") {
        const ordered = orderAnnotationConnection(fromId, toId, allNodes);
        return {
            fromNodeId: ordered.fromNodeId,
            toNodeId: ordered.toNodeId,
            patch: {
                kind: "annotation" as const,
                ...(label ? { label } : {}),
            },
        };
    }
    if (linkKind === "mind") {
        const parent = from;
        const child = to;
        const autoSides = pickMindConnectionSides(parent, child);
        const decisionLabel =
            !label && isDecisionNode(parent) ? nextDecisionBranchLabel(parent.id, connections) : "";
        return {
            fromNodeId: fromId,
            toNodeId: toId,
            patch: {
                kind: "mind" as const,
                fromSide: op.fromSide || autoSides.startSide,
                toSide: op.toSide || autoSides.endSide,
                ...(label ? { label } : decisionLabel ? { label: decisionLabel } : {}),
            },
        };
    }
    return {
        fromNodeId: fromId,
        toNodeId: toId,
        patch: {
            ...(op.kind ? { kind: op.kind } : {}),
            ...(op.fromSide ? { fromSide: op.fromSide } : {}),
            ...(op.toSide ? { toSide: op.toSide } : {}),
            ...(label ? { label } : {}),
        },
    };
}

function findAgentConnection(connections: CanvasConnection[], op: Extract<CanvasAgentOp, { type: "update_connection" }>) {
    if (op.id) return connections.find((conn) => conn.id === op.id);
    if (op.fromNodeId && op.toNodeId) {
        return connections.find((conn) => conn.fromNodeId === op.fromNodeId && conn.toNodeId === op.toNodeId);
    }
    return undefined;
}

function sanitizeAgentNodeMetadata(nodeType: CanvasNodeTypeId, metadata?: CanvasNodeMetadata): CanvasNodeMetadata | undefined {
    if (!metadata) return metadata;
    if (nodeType !== CanvasNodeType.Config) return metadata;
    const mode = (metadata.generationMode || "image") as ModelCapability;
    const config = useConfigStore.getState().config;
    const model = resolveModelForCapability(config, metadata.model, mode);
    if (!metadata.model || metadata.model === model) return { ...metadata, model };
    return { ...metadata, model };
}

function opLabel(type: string) {
    return i18n.t(`canvas.agentOps.${type}`, { defaultValue: type });
}
