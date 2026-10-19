import { nanoid } from "nanoid";

import { getVerticalResultPlacement, RESULT_STACK_GAP } from "@/lib/canvas/canvas-batch-layout";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

/**
 * 将旧版「多图合并进一个可展开节点」拆成独立图片节点并竖排。
 * 主图保留原节点 id；其余槽位新建节点，并从同一上游重新连线。
 */
export function flattenBatchImageNodes(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nextNodes: CanvasNodeData[] = [];
    const extraNodes: CanvasNodeData[] = [];
    const extraConnections: CanvasConnection[] = [];

    for (const node of nodes) {
        const images = node.type === CanvasNodeType.Image ? node.metadata?.images : undefined;
        if (!images || images.length <= 1) {
            nextNodes.push(node);
            continue;
        }

        const primaryId = node.metadata?.primaryImageId || images[0]?.id;
        const ordered = [images.find((item) => item.id === primaryId) || images[0], ...images.filter((item) => item.id !== primaryId)].filter(Boolean);
        const parentCenterY = node.position.y + node.height / 2;
        const parents = connections.filter((item) => item.toNodeId === node.id).map((item) => item.fromNodeId);
        const primary = ordered[0]!;

        nextNodes.push({
            ...node,
            position: getVerticalResultPlacement(0, ordered.length, node.height, parentCenterY, node.position.x, RESULT_STACK_GAP, 0),
            metadata: {
                ...node.metadata,
                content: primary.content || node.metadata?.content || "",
                storageKey: primary.storageKey || node.metadata?.storageKey,
                naturalWidth: primary.naturalWidth || node.metadata?.naturalWidth,
                naturalHeight: primary.naturalHeight || node.metadata?.naturalHeight,
                bytes: primary.bytes || node.metadata?.bytes,
                mimeType: primary.mimeType || node.metadata?.mimeType,
                status: primary.status || node.metadata?.status,
                errorDetails: primary.errorDetails || node.metadata?.errorDetails,
                images: undefined,
                primaryImageId: undefined,
                count: 1,
            },
        });

        for (let index = 1; index < ordered.length; index += 1) {
            const image = ordered[index]!;
            const id = nanoid();
            extraNodes.push({
                id,
                type: CanvasNodeType.Image,
                title: node.title ? `${node.title} ${index + 1}` : `Image ${index + 1}`,
                position: getVerticalResultPlacement(index, ordered.length, node.height, parentCenterY, node.position.x, RESULT_STACK_GAP, 0),
                width: node.width,
                height: node.height,
                metadata: {
                    ...node.metadata,
                    content: image.content || "",
                    storageKey: image.storageKey,
                    naturalWidth: image.naturalWidth,
                    naturalHeight: image.naturalHeight,
                    bytes: image.bytes,
                    mimeType: image.mimeType,
                    status: image.status || (image.content ? "success" : "idle"),
                    errorDetails: image.errorDetails,
                    prompt: node.metadata?.prompt,
                    images: undefined,
                    primaryImageId: undefined,
                    count: 1,
                },
            });
            for (const fromNodeId of parents) {
                extraConnections.push({ id: nanoid(), fromNodeId, toNodeId: id });
            }
        }
    }

    return {
        nodes: [...nextNodes, ...extraNodes],
        connections: [...connections, ...extraConnections],
    };
}
