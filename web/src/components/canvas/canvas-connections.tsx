import type { MouseEvent as ReactMouseEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";

export function ConnectionPath({
    connection,
    from,
    to,
    active,
    simple = false,
    onSelect,
    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    simple?: boolean;
    onSelect: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    /** 传递连线用 Codex 品牌橙，深浅主题都足够醒目 */
    const carryColor = colorTheme === "dark" ? "#fb923c" : "#ea580c";
    const startX = from.position.x + from.width;
    const startY = from.position.y + from.height / 2;
    const endX = to.position.x;
    const endY = to.position.y + to.height / 2;
    const dx = Math.abs(endX - startX);
    const curvature = Math.max(dx * 0.5, 50);
    const pathD = `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
    const stroke = connection.carry ? carryColor : active ? theme.node.activeStroke : theme.node.muted;

    return (
        <g>
            <path
                data-connection-id={connection.id}
                d={pathD}
                stroke="transparent"
                strokeWidth="16"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu?.(event);
                }}
            />
            {simple ? (
                <path d={pathD} stroke={stroke} strokeWidth={connection.carry ? 3 : active ? 3 : 2} strokeOpacity={connection.carry ? 0.85 : active ? 1 : 0.82} strokeLinecap="round" fill="none" style={{ pointerEvents: "none" }} />
            ) : connection.carry ? (
                <>
                    <path d={pathD} stroke={carryColor} strokeOpacity={active ? 0.4 : 0.26} strokeWidth={active ? 10 : 8} strokeLinecap="round" fill="none" style={{ pointerEvents: "none" }} />
                    <path d={pathD} stroke={carryColor} strokeWidth={active ? 3.5 : 3} strokeLinecap="round" fill="none" style={{ pointerEvents: "none" }} />
                    <circle r={active ? 4.5 : 4} fill={carryColor} style={{ pointerEvents: "none" }}>
                        <animateMotion dur="2.6s" repeatCount="indefinite" path={pathD} />
                    </circle>
                </>
            ) : (
                <path
                    d={pathD}
                    stroke={active ? theme.node.activeStroke : theme.node.muted}
                    strokeWidth={active ? 3 : 2}
                    strokeOpacity={active ? 1 : 0.82}
                    fill="none"
                    style={{ filter: active ? `drop-shadow(0 0 8px ${theme.node.activeStroke}66)` : undefined, pointerEvents: "none" }}
                />
            )}
        </g>
    );
}

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node) return null;

    const startX = handle.handleType === "source" ? node.position.x + node.width : mouseWorld.x;
    const startY = handle.handleType === "source" ? node.position.y + node.height / 2 : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : node.position.y + node.height / 2;
    const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;
    const snappedStartY = handle.handleType === "target" && target ? target.position.y + target.height / 2 : startY;
    const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;
    const snappedEndY = handle.handleType === "source" && target ? target.position.y + target.height / 2 : endY;
    const distance = Math.abs(snappedEndX - snappedStartX);
    const pathD = `M ${snappedStartX} ${snappedStartY} C ${snappedStartX + distance * 0.5} ${snappedStartY}, ${snappedEndX - distance * 0.5} ${snappedEndY}, ${snappedEndX} ${snappedEndY}`;

    return <path d={pathD} stroke={theme.node.activeStroke} strokeWidth="2" fill="none" strokeDasharray="5,5" />;
}
