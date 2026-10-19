import { nanoid } from "nanoid";

import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

import type { RoomDocument, RoomOp } from "./room-types";

export function applyRoomOps(document: RoomDocument, ops: RoomOp[]): RoomDocument {
    let nodes = [...document.nodes];
    let connections = [...document.connections];
    let title = document.title;
    let backgroundMode = document.backgroundMode;

    for (const op of ops) {
        if (op.type === "upsert_nodes") {
            const map = new Map(nodes.map((n) => [n.id, n]));
            for (const node of op.nodes) {
                const prev = map.get(node.id);
                map.set(node.id, prev ? { ...prev, ...node, metadata: { ...prev.metadata, ...node.metadata } } : node);
            }
            nodes = [...map.values()];
        } else if (op.type === "remove_nodes") {
            const ids = new Set(op.nodeIds);
            nodes = nodes.filter((n) => !ids.has(n.id));
        } else if (op.type === "upsert_connections") {
            const map = new Map(connections.map((c) => [c.id, c]));
            for (const conn of op.connections) map.set(conn.id, { ...map.get(conn.id), ...conn });
            connections = [...map.values()];
        } else if (op.type === "remove_connections") {
            const ids = new Set(op.connectionIds);
            connections = connections.filter((c) => !ids.has(c.id));
        } else if (op.type === "set_title") {
            title = op.title;
        } else if (op.type === "set_background_mode") {
            backgroundMode = op.backgroundMode as RoomDocument["backgroundMode"];
        }
    }

    return { title, backgroundMode, nodes, connections };
}

export function diffRoomOps(before: RoomDocument, after: RoomDocument, opIdPrefix: string): RoomOp[] {
    const ops: RoomOp[] = [];
    const beforeNodes = new Map(before.nodes.map((n) => [n.id, n]));
    const afterNodes = new Map(after.nodes.map((n) => [n.id, n]));
    const upserts: CanvasNodeData[] = [];
    for (const [id, node] of afterNodes) {
        const prev = beforeNodes.get(id);
        if (!prev || JSON.stringify(prev) !== JSON.stringify(node)) upserts.push(node);
    }
    const removed = [...beforeNodes.keys()].filter((id) => !afterNodes.has(id));
    if (upserts.length) ops.push({ type: "upsert_nodes", nodes: upserts, opId: `${opIdPrefix}-n-${nanoid(6)}` });
    if (removed.length) ops.push({ type: "remove_nodes", nodeIds: removed, opId: `${opIdPrefix}-rn-${nanoid(6)}` });

    const beforeConn = new Map(before.connections.map((c) => [c.id, c]));
    const afterConn = new Map(after.connections.map((c) => [c.id, c]));
    const connUpserts: CanvasConnection[] = [];
    for (const [id, conn] of afterConn) {
        const prev = beforeConn.get(id);
        if (!prev || JSON.stringify(prev) !== JSON.stringify(conn)) connUpserts.push(conn);
    }
    const connRemoved = [...beforeConn.keys()].filter((id) => !afterConn.has(id));
    if (connUpserts.length) ops.push({ type: "upsert_connections", connections: connUpserts, opId: `${opIdPrefix}-c-${nanoid(6)}` });
    if (connRemoved.length) ops.push({ type: "remove_connections", connectionIds: connRemoved, opId: `${opIdPrefix}-rc-${nanoid(6)}` });

    if (before.title !== after.title) ops.push({ type: "set_title", title: after.title, opId: `${opIdPrefix}-t-${nanoid(6)}` });
    if (before.backgroundMode !== after.backgroundMode) {
        ops.push({ type: "set_background_mode", backgroundMode: after.backgroundMode, opId: `${opIdPrefix}-bg-${nanoid(6)}` });
    }
    return ops;
}

export function roomDocumentFromProject(project: {
    title: string;
    backgroundMode: RoomDocument["backgroundMode"];
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
}): RoomDocument {
    return {
        title: project.title,
        backgroundMode: project.backgroundMode,
        nodes: project.nodes,
        connections: project.connections,
    };
}
