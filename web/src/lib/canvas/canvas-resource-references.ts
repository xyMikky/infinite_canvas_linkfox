import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import i18n from "@/i18n";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { isDataGroup, resolveGroupBundleText } from "@/lib/canvas/canvas-group-bundle";
import { isFolderLikeInputNode } from "@/lib/canvas/folder-input-resolve";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    previewStorageKey?: string;
    text?: string;
    active: boolean;
};

/** 取直接上游，按连线顺序。 */
function directUpstream(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return connections
        .filter((connection) => connection.toNodeId === nodeId)
        .map((connection) => nodes.find((node) => node.id === connection.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node));
}

/** 直接上游，外加沿「传递连线」继续向上带出的节点。 */
export function expandUpstreamWithCarry(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const result: CanvasNodeData[] = [];
    const seen = new Set<string>([nodeId]);
    const queue = directUpstream(nodeId, nodes, connections);
    while (queue.length) {
        const node = queue.shift()!;
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        result.push(node);
        connections
            .filter((connection) => connection.toNodeId === node.id && connection.carry)
            .forEach((connection) => {
                const upstream = nodes.find((item) => item.id === connection.fromNodeId);
                if (upstream && !seen.has(upstream.id)) queue.push(upstream);
            });
    }
    return result;
}

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return labelResourceNodes(getMentionResourceNodes(node.id, nodes, connections), true, nodes);
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = getConnectedConfigResourceNodes(nodeId, nodes, connections);
    if (configInputs.length) return configInputs;
    const ownInputs = getContextResourceNodes(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs;
    const node = nodes.find((item) => item.id === nodeId);
    return node && isResourceNode(node, nodes) ? [node] : [];
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = getConnectedConfigResourceNodes(nodeId, nodes, connections);
    if (configInputs.length) return configInputs;
    const ownInputs = getContextResourceNodes(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs;
    return [];
}

function getContextResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return expandUpstreamWithCarry(nodeId, nodes, connections).filter((node) => isResourceNode(node, nodes));
}

function getConnectedConfigResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configConnection = connections.find((connection) => connection.fromNodeId === nodeId && nodes.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config);
    if (!configConnection) return [];
    return getContextResourceNodes(configConnection.toNodeId, nodes, connections).filter((node) => node.id !== nodeId);
}

function labelResourceNodes(nodes: CanvasNodeData[], active: boolean, allNodes: CanvasNodeData[]) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const kind = resourceKind(node, allNodes);
        if (!kind) return [];
        const index = counts[kind]++;
        const label = labelForKind(kind, index);
        return [
            {
                id: node.id,
                nodeId: node.id,
                kind,
                label,
                title: node.title || label,
                previewUrl: node.metadata?.content,
                previewStorageKey: node.metadata?.storageKey,
                text: resourceText(node, allNodes),
                active,
            },
        ];
    });
}

function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return seedanceReferenceLabel("video", index);
    if (kind === "audio") return seedanceReferenceLabel("audio", index);
    return i18n.t("canvas.composer.resources.text", { index: index + 1 });
}

function isResourceNode(node: CanvasNodeData, allNodes: CanvasNodeData[]) {
    return Boolean(resourceKind(node, allNodes));
}

function resourceText(node: CanvasNodeData, allNodes: CanvasNodeData[]): string | undefined {
    if (node.type === CanvasNodeType.Group) {
        const text = resolveGroupBundleText(node, allNodes);
        return text || undefined;
    }
    if (isFolderLikeInputNode(node)) {
        const name = String(node.metadata?.proxyFolderName || node.metadata?.folderName || node.title || "").trim();
        const count = node.metadata?.proxyFolderEntryCount ?? node.metadata?.folderEntryCount ?? node.metadata?.folderEntries?.length ?? 0;
        if (name) return `文件夹：${name}${count ? `（${count} 项）` : ""}`;
    }
    if (node.type === CanvasNodeType.Text) {
        const sheets = node.metadata?.excelSheets;
        if (node.metadata?.documentKind === "excel" && sheets?.length) {
            const fromSheets = sheets
                .map((sheet) => {
                    const body = sheet.content?.trim();
                    if (!body) return "";
                    return sheets.length > 1 ? `[${sheet.name}]\n${body}` : body;
                })
                .filter(Boolean)
                .join("\n\n");
            if (fromSheets) return fromSheets;
        }
        return node.metadata?.content || node.metadata?.prompt;
    }
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    return resource?.kind === "text" ? resource.text : undefined;
}

function resourceKind(node: CanvasNodeData, allNodes: CanvasNodeData[]): CanvasResourceKind | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return "image";
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return "video";
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return "audio";
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return "text";
    if (node.type === CanvasNodeType.Group && isDataGroup(node, allNodes)) return "text";
    if (isFolderLikeInputNode(node)) return "text";
    return getNodeDefinition(node.type)?.resource?.(node)?.kind || null;
}
