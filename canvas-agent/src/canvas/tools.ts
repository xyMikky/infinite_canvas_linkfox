import { toolInputSchemas, toolNames, type ToolName } from "./schemas.js";
import type { CanvasNode, CanvasSnapshot, MindMapAgentContext, Position } from "./types.js";

/** 判断传入名称是否为已注册的画布工具。 */
export function isToolName(name: unknown): name is ToolName {
    return typeof name === "string" && toolNames.includes(name as ToolName);
}

/** 按工具名称校验并解析调用参数。 */
export function parseToolInput(name: ToolName, input: unknown) {
    return toolInputSchemas[name].parse(input ?? {});
}

export function mindMapsForSelection(mindMaps: MindMapAgentContext[] | undefined, selectedNodeIds: string[] | undefined) {
    if (!mindMaps?.length) return [];
    if (!selectedNodeIds?.length) return mindMaps;
    const selected = new Set(selectedNodeIds);
    return mindMaps.filter((item) => item.nodeIds.some((id) => selected.has(id)) || selected.has(item.rootId));
}

/** 选中 group 时展开组内成员（含嵌套组）。 */
export function expandSelectionNodeIds(state: CanvasSnapshot | null): Set<string> {
    const nodes = state?.nodes || [];
    const selected = state?.selectedNodeIds || [];
    const expanded = new Set(selected);
    const queue = [...selected];
    while (queue.length) {
        const id = queue.pop()!;
        const group = nodes.find((node) => node.id === id);
        if (!group || group.type !== "group") continue;
        for (const child of nodes) {
            const groupId = child.metadata?.groupId;
            if (typeof groupId !== "string" || groupId !== id || expanded.has(child.id)) continue;
            expanded.add(child.id);
            if (child.type === "group") queue.push(child.id);
        }
    }
    return expanded;
}

/** 压缩画布快照，避免向 Agent 返回过长的节点内容。 */
export function compactCanvasState(state: CanvasSnapshot | null) {
    if (!state) throw new Error("当前没有已连接画布");
    const mindMaps = state.mindMaps?.length ? state.mindMaps : undefined;
    return {
        projectId: state.projectId,
        title: state.title,
        selectedNodeIds: state.selectedNodeIds,
        viewport: state.viewport,
        ...(state.viewportSize ? { viewportSize: state.viewportSize } : {}),
        clientId: state.clientId,
        nodes: (state.nodes || []).map(compactNode),
        connections: (state.connections || []).map(compactConnection),
        ...(mindMaps ? { mindMaps } : {}),
        mindMapGuide:
            "空选区≠无图（先 get_state 防重复套图）。上→下主链对边直连；旁侧少打组且只连整框；细则进 smart-preview；坐标仅初值。完成前自检：无重复前缀/无堆叠/无蛛网/组框不空壳/主链可读；禁止只点中心就宣称完成。",
        mindMapSelfCheck: mindMapSelfCheck(state.nodes || []),
    };
}

function boxesOverlap(a: CanvasNode, b: CanvasNode) {
    const ax = a.position.x;
    const ay = a.position.y;
    const bx = b.position.x;
    const by = b.position.y;
    return ax < bx + b.width - 8 && ax + a.width > bx + 8 && ay < by + b.height - 8 && ay + a.height > by + 8;
}

/** 给 Agent 看的轻量自检，不改布局，只报告重叠与规模。 */
function mindMapSelfCheck(nodes: CanvasNode[]) {
    const minds = nodes.filter((node) => node.type === "mind-node");
    const groups = nodes.filter((node) => node.type === "group");
    let overlapPairs = 0;
    for (let i = 0; i < minds.length; i += 1) {
        for (let j = i + 1; j < minds.length; j += 1) {
            if (boxesOverlap(minds[i], minds[j])) overlapPairs += 1;
        }
    }
    for (let i = 0; i < groups.length; i += 1) {
        for (let j = i + 1; j < groups.length; j += 1) {
            if (boxesOverlap(groups[i], groups[j])) overlapPairs += 1;
        }
    }
    return {
        mindNodeCount: nodes.filter((node) => node.type === "mind-node").length,
        groupCount: nodes.filter((node) => node.type === "group").length,
        overlapPairs,
        ok: overlapPairs === 0,
    };
}

/** 压缩连线，保留导图/标注语义。 */
export function compactConnection(connection: { id: string; fromNodeId: string; toNodeId: string; kind?: string; label?: string; fromSide?: string; toSide?: string }) {
    const next: Record<string, unknown> = {
        id: connection.id,
        fromNodeId: connection.fromNodeId,
        toNodeId: connection.toNodeId,
    };
    if (connection.kind) next.kind = connection.kind;
    const label = String(connection.label || "").trim();
    if (label) next.label = label.length > 80 ? `${label.slice(0, 80)}…` : label;
    if (connection.fromSide) next.fromSide = connection.fromSide;
    if (connection.toSide) next.toSide = connection.toSide;
    return next;
}

/** 压缩单个画布节点的元数据内容。 */
export function compactNode(node: CanvasNode) {
    if (node.type === "mind-node") {
        const metadata = node.metadata || {};
        const label = String(metadata.content || node.title || "").trim() || "（空）";
        const role =
            metadata.mindRole === "root"
                ? "center"
                : metadata.mindKind === "decision"
                  ? "decision"
                  : metadata.mindKind === "annotation"
                    ? "annotation"
                    : "topic";
        const compact: Record<string, unknown> = {
            id: node.id,
            type: node.type,
            role,
            label,
            title: node.title,
            position: node.position,
            width: node.width,
            height: node.height,
        };
        if (metadata.mindKind && metadata.mindKind !== "topic") compact.mindKind = metadata.mindKind;
        if (metadata.mindShape) compact.mindShape = metadata.mindShape;
        if (metadata.mindColor) compact.mindColor = metadata.mindColor;
        if (typeof metadata.fontSize === "number") compact.fontSize = metadata.fontSize;
        return compact;
    }
    const metadata = { ...(node.metadata || {}) };
    if (typeof metadata.content === "string" && metadata.content.length > 240) metadata.content = `${metadata.content.slice(0, 120)}...`;
    return { id: node.id, type: node.type, title: node.title, position: node.position, width: node.width, height: node.height, metadata };
}

/** 计算新节点在当前画布右侧的默认横坐标（无视口信息时的回退）。 */
export function nextCanvasX(state: CanvasSnapshot | null) {
    const nodes = state?.nodes || [];
    return nodes.length ? Math.max(...nodes.map((node) => node.position.x + node.width)) + 80 : 0;
}

/** 当前视口中心的世界坐标；无视口尺寸时回退到 nextCanvasX/0。 */
export function viewportWorldCenter(state: CanvasSnapshot | null): Position {
    const viewport = state?.viewport;
    const size = state?.viewportSize;
    if (viewport && size?.width && size?.height) {
        return {
            x: (size.width / 2 - viewport.x) / viewport.k,
            y: (size.height / 2 - viewport.y) / viewport.k,
        };
    }
    return { x: nextCanvasX(state), y: 0 };
}

/** 未指定坐标时，让节点中心落在当前视口中心。 */
export function defaultNodePosition(state: CanvasSnapshot | null, width = 320, height = 240): Position {
    const center = viewportWorldCenter(state);
    return { x: center.x - width / 2, y: center.y - height / 2 };
}
