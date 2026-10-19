import type { CSSProperties } from "react";

import { useHostTheme } from "./theme";
import { toneColor } from "./tokens";
import { HoverTip, useHoverTip } from "./tooltip";
import { mergeStyle } from "./ui";
import type { ChartTone } from "./charts";

export type FlowShape = "process" | "decision" | "terminal";
export type FlowDiagramNode = { id: string; label: string; note?: string; shape?: FlowShape; tone?: ChartTone };
export type FlowDiagramEdge = { from: string; to: string; label?: string };

/** 估算 SVG 文本宽度：中日韩按一个字宽算，ASCII 按 0.56 字宽算。 */
function textWidth(text: string, fontSize: number) {
    return [...text].reduce((sum, char) => sum + (/[\x00-\xff]/.test(char) ? 0.56 : 1) * fontSize, 0);
}

function wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number) {
    const lines: string[] = [];
    let current = "";
    for (const char of [...text]) {
        if (textWidth(current + char, fontSize) > maxWidth && current) {
            lines.push(current);
            current = char;
            if (lines.length === maxLines) break;
        } else {
            current += char;
        }
    }
    if (lines.length < maxLines && current) lines.push(current);
    if (lines.length && lines.join("") !== text) {
        const last = lines[lines.length - 1];
        const chars = [...last];
        lines[lines.length - 1] = chars.length > 1 ? `${chars.slice(0, -1).join("")}…` : "…";
    }
    return lines;
}

function flowNodeCopy(node: FlowDiagramNode, nodeWidth: number, shape: FlowShape) {
    const inner = nodeWidth - (shape === "decision" ? 44 : 24);
    const labelLines = wrapText(node.label, inner, 12, node.note ? 3 : 8);
    const noteLines = node.note ? wrapText(node.note, inner, 11, 6) : [];
    const height = Math.max(54, 22 + labelLines.length * 16 + (noteLines.length ? 6 + noteLines.length * 15 : 0));
    return { labelLines, noteLines, height };
}

/** DFS 找出会构成环的回边，分层时必须排除，否则层级会被无限推高。 */
function findBackEdges(nodes: FlowDiagramNode[], edges: FlowDiagramEdge[]) {
    const outgoing = new Map<string, FlowDiagramEdge[]>();
    for (const edge of edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) || []), edge]);
    const state = new Map<string, "visiting" | "done">();
    const back = new Set<FlowDiagramEdge>();
    const visit = (id: string) => {
        state.set(id, "visiting");
        for (const edge of outgoing.get(id) || []) {
            const next = state.get(edge.to);
            if (next === "visiting") back.add(edge);
            else if (!next) visit(edge.to);
        }
        state.set(id, "done");
    };
    for (const node of nodes) if (!state.get(node.id)) visit(node.id);
    return back;
}

/** 按最长路径给节点分层（忽略回边）。 */
function layerNodes(nodes: FlowDiagramNode[], edges: FlowDiagramEdge[], backEdges: Set<FlowDiagramEdge>) {
    const layer = new Map<string, number>(nodes.map((node) => [node.id, 0]));
    for (let round = 0; round < nodes.length; round++) {
        let changed = false;
        for (const edge of edges) {
            if (backEdges.has(edge) || !layer.has(edge.from) || !layer.has(edge.to)) continue;
            const next = (layer.get(edge.from) || 0) + 1;
            if (next > (layer.get(edge.to) || 0)) {
                layer.set(edge.to, next);
                changed = true;
            }
        }
        if (!changed) break;
    }
    return layer;
}

/**
 * 数据驱动的流程图：只给 nodes / edges，自动分层排布并连线。
 * direction="row" 从左到右，"column" 从上到下。
 */
export function FlowDiagram({
    nodes,
    edges,
    direction = "row",
    nodeWidth = 136,
    nodeHeight = 54,
    gapMain = 56,
    gapCross = 20,
    style,
}: {
    nodes: FlowDiagramNode[];
    edges: FlowDiagramEdge[];
    direction?: "row" | "column";
    nodeWidth?: number;
    nodeHeight?: number;
    gapMain?: number;
    gapCross?: number;
    style?: CSSProperties;
}) {
    const theme = useHostTheme();
    const { ref, tip, show, hide } = useHoverTip();
    const copies = new Map(nodes.map((node) => [node.id, flowNodeCopy(node, nodeWidth, node.shape || "process")]));
    const boxHeight = nodes.length
        ? Math.max(nodeHeight, ...nodes.map((node) => copies.get(node.id)?.height ?? nodeHeight))
        : nodeHeight;
    const backEdges = findBackEdges(nodes, edges);
    const layer = layerNodes(nodes, edges, backEdges);
    const groups = new Map<number, FlowDiagramNode[]>();
    for (const node of nodes) {
        const index = layer.get(node.id) || 0;
        groups.set(index, [...(groups.get(index) || []), node]);
    }
    const layerCount = Math.max(...[...groups.keys()]) + 1;
    const crossCount = Math.max(...[...groups.values()].map((group) => group.length));
    const stepMain = (direction === "row" ? nodeWidth : boxHeight) + gapMain;
    const stepCross = (direction === "row" ? boxHeight : nodeWidth) + gapCross;
    const crossSpan = crossCount * stepCross - gapCross;

    const box = new Map<string, { x: number; y: number }>();
    for (const [index, group] of groups) {
        const offset = (crossSpan - (group.length * stepCross - gapCross)) / 2;
        group.forEach((node, order) => {
            const main = index * stepMain;
            const cross = offset + order * stepCross;
            box.set(node.id, direction === "row" ? { x: main, y: cross } : { x: cross, y: main });
        });
    }

    const width = direction === "row" ? layerCount * stepMain - gapMain : crossSpan;
    const height = direction === "row" ? crossSpan : layerCount * stepMain - gapMain;
    const markerId = `flow-arrow-${nodes.map((node) => node.id).join("-").replace(/[^\w-]/g, "")}`;
    const nodeColor = (node: FlowDiagramNode) => (node.tone ? toneColor[node.tone] : theme.stroke.primary);

    return (
        <div ref={ref} style={{ position: "relative" }}>
        <svg
            width="100%"
            viewBox={`0 0 ${width + 2} ${height + 2}`}
            style={mergeStyle({ display: "block", maxWidth: width + 2 }, style)}
        >
            <defs>
                <marker id={markerId} markerWidth="7" markerHeight="7" refX="6.5" refY="3.5" orient="auto">
                    <path d="M0,0 L7,3.5 L0,7 Z" fill={theme.text.quaternary} />
                </marker>
            </defs>

            {edges.map((edge) => {
                const from = box.get(edge.from);
                const to = box.get(edge.to);
                if (!from || !to) return null;
                const forward = (layer.get(edge.to) || 0) > (layer.get(edge.from) || 0);
                const start = direction === "row"
                    ? { x: from.x + (forward ? nodeWidth : nodeWidth / 2), y: from.y + boxHeight / 2 }
                    : { x: from.x + nodeWidth / 2, y: from.y + (forward ? boxHeight : boxHeight / 2) };
                const end = direction === "row"
                    ? { x: to.x + (forward ? 0 : nodeWidth / 2), y: to.y + boxHeight / 2 }
                    : { x: to.x + nodeWidth / 2, y: to.y + (forward ? 0 : boxHeight) };
                const detour = direction === "row" ? Math.max(28, Math.abs(end.x - start.x) / 2) : Math.max(24, Math.abs(end.y - start.y) / 2);
                const path = forward
                    ? direction === "row"
                        ? `M ${start.x} ${start.y} C ${start.x + detour} ${start.y}, ${end.x - detour} ${end.y}, ${end.x} ${end.y}`
                        : `M ${start.x} ${start.y} C ${start.x} ${start.y + detour}, ${end.x} ${end.y - detour}, ${end.x} ${end.y}`
                    : direction === "row"
                      ? `M ${start.x} ${from.y} C ${start.x} ${from.y - 34}, ${end.x} ${to.y - 34}, ${end.x} ${to.y}`
                      : `M ${from.x} ${start.y} C ${from.x - 34} ${start.y}, ${to.x - 34} ${end.y}, ${to.x} ${end.y}`;
                const midX = (start.x + end.x) / 2;
                const midY = (start.y + end.y) / 2;
                return (
                    <g key={`${edge.from}-${edge.to}`}>
                        <path d={path} fill="none" stroke={theme.stroke.primary} strokeWidth={1.2} markerEnd={`url(#${markerId})`} />
                        {edge.label ? (
                            <text x={midX} y={forward ? midY - 6 : midY - 30} textAnchor="middle" fontSize={10} fill={theme.text.tertiary}>
                                {edge.label}
                            </text>
                        ) : null}
                    </g>
                );
            })}

            {nodes.map((node) => {
                const point = box.get(node.id);
                if (!point) return null;
                const shape = node.shape || "process";
                const color = nodeColor(node);
                const copy = copies.get(node.id) || flowNodeCopy(node, nodeWidth, shape);
                const { labelLines, noteLines } = copy;
                const centerX = point.x + nodeWidth / 2;
                const centerY = point.y + boxHeight / 2;
                const lineBlock = labelLines.length * 16 + (noteLines.length ? 6 + noteLines.length * 15 : 0);
                const firstY = point.y + (boxHeight - lineBlock) / 2 + 8;
                return (
                    <g
                        key={node.id}
                        onMouseMove={(event) =>
                            show(
                                event,
                                <div>
                                    <div style={{ fontWeight: 590 }}>{node.label}</div>
                                    {node.note ? <div style={{ color: theme.text.secondary }}>{node.note}</div> : null}
                                </div>,
                            )
                        }
                        onMouseLeave={hide}
                    >
                        {shape === "decision" ? (
                            <polygon
                                points={`${centerX},${point.y} ${point.x + nodeWidth},${centerY} ${centerX},${point.y + boxHeight} ${point.x},${centerY}`}
                                fill={theme.fill.quaternary}
                                stroke={color}
                            />
                        ) : (
                            <rect
                                x={point.x}
                                y={point.y}
                                width={nodeWidth}
                                height={boxHeight}
                                rx={shape === "terminal" ? Math.min(18, boxHeight / 2) : 8}
                                fill={theme.fill.quaternary}
                                stroke={color}
                            />
                        )}
                        {labelLines.map((line, index) => (
                            <text key={index} x={centerX} y={firstY + index * 16} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill={theme.text.primary}>
                                {line}
                            </text>
                        ))}
                        {noteLines.map((line, index) => (
                            <text
                                key={`note-${index}`}
                                x={centerX}
                                y={firstY + labelLines.length * 16 + 6 + index * 15}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fontSize={11}
                                fill={theme.text.tertiary}
                            >
                                {line}
                            </text>
                        ))}
                    </g>
                );
            })}
        </svg>
            <HoverTip tip={tip} />
        </div>
    );
}
