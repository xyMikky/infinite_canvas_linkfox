import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

const MIN_SHELL_HIT_PX = 8;

type CanvasNodeShellHitLayerProps = {
    nodes: CanvasNodeData[];
    viewport: ViewportTransform;
    onSelectCapture: (event: React.MouseEvent, nodeId: string) => void;
    onPointerDown: (event: React.MouseEvent, nodeId: string) => void;
};

/** 远景 shell 节点的屏幕坐标透明命中层，与 shell Canvas 同层绘制，避免 scale 层内命中失效。 */
export function CanvasNodeShellHitLayer({ nodes, viewport, onSelectCapture, onPointerDown }: CanvasNodeShellHitLayerProps) {
    const { k, x, y } = viewport;
    return (
        <>
            {nodes.map((node) => {
                const width = Math.max(node.width * k, MIN_SHELL_HIT_PX);
                const height = Math.max(node.height * k, MIN_SHELL_HIT_PX);
                const offsetX = (width - node.width * k) / 2;
                const offsetY = (height - node.height * k) / 2;
                return (
                    <div
                        key={`shell-hit-${node.id}`}
                        data-node-id={node.id}
                        className="absolute z-[3]"
                        style={{
                            left: node.position.x * k + x - offsetX,
                            top: node.position.y * k + y - offsetY,
                            width,
                            height,
                        }}
                        onPointerDownCapture={(event) => {
                            if (event.button !== 0) return;
                            event.stopPropagation();
                            const mouseEvent = event as unknown as React.MouseEvent;
                            onSelectCapture(mouseEvent, node.id);
                            onPointerDown(mouseEvent, node.id);
                        }}
                    />
                );
            })}
        </>
    );
}
