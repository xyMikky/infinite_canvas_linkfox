import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Diamond, GitBranch, Hexagon, StickyNote, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import {
    MIND_CREATE_ANNOTATION,
    MIND_CREATE_CHILD,
    MIND_CREATE_DECISION,
    MIND_CREATE_ROOT,
} from "@/lib/canvas/mind-map";
import { useThemeStore } from "@/stores/use-theme-store";
import { listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import type { ConnectionHandle, ConnectionHandleSide, Position } from "@/types/canvas";

export const CONNECTION_CREATE_MENU_WIDTH = 300;
/** 未测到真实高度前的估高，用于把菜单对边对齐到松手点 */
const CONNECTION_CREATE_MENU_HEIGHT_FALLBACK = 420;

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    /** 菜单左上角 */
    position: Position;
    /** 松手点：虚线落点；菜单对边对齐此处，松手后线不跳动 */
    attachPoint: Position;
};

/**
 * 按松手点放置菜单：左边拖出时菜单在左侧、右边中点贴松手点；
 * 右边拖出时菜单在右侧、左边中点贴松手点。虚线始终停在 attachPoint。
 */
export function connectionCreateMenuPositionFromAttach(
    attachPoint: Position,
    side: ConnectionHandleSide | undefined,
    menuSize: { width: number; height: number } = {
        width: CONNECTION_CREATE_MENU_WIDTH,
        height: CONNECTION_CREATE_MENU_HEIGHT_FALLBACK,
    },
): Position {
    const { width, height } = menuSize;
    if (side === "left") return { x: attachPoint.x - width, y: attachPoint.y - height / 2 };
    if (side === "right") return { x: attachPoint.x, y: attachPoint.y - height / 2 };
    if (side === "top") return { x: attachPoint.x - width / 2, y: attachPoint.y - height };
    if (side === "bottom") return { x: attachPoint.x - width / 2, y: attachPoint.y };
    return { x: attachPoint.x, y: attachPoint.y - height / 2 };
}

/** @deprecated 使用 connectionCreateMenuPositionFromAttach；保留避免外部引用报错 */
export function connectionCreateMenuAttachPoint(
    menuPosition: Position,
    side: ConnectionHandleSide | undefined,
    menuSize: { width: number; height: number } = {
        width: CONNECTION_CREATE_MENU_WIDTH,
        height: CONNECTION_CREATE_MENU_HEIGHT_FALLBACK,
    },
): Position {
    const midX = menuPosition.x + menuSize.width / 2;
    const midY = menuPosition.y + menuSize.height / 2;
    if (side === "left") return { x: menuPosition.x + menuSize.width, y: midY };
    if (side === "right") return { x: menuPosition.x, y: midY };
    if (side === "top") return { x: midX, y: menuPosition.y + menuSize.height };
    if (side === "bottom") return { x: midX, y: menuPosition.y };
    return { x: menuPosition.x, y: midY };
}

function useMindCreateOptions() {
    const { t } = useTranslation();
    return [
        { type: MIND_CREATE_ROOT, title: t("canvas.mindMap.centerTopic"), icon: <Hexagon /> },
        { type: MIND_CREATE_CHILD, title: t("canvas.mindMap.childTopic"), icon: <GitBranch /> },
        { type: MIND_CREATE_DECISION, title: t("canvas.mindMap.decisionTopic"), icon: <Diamond /> },
        { type: MIND_CREATE_ANNOTATION, title: t("canvas.mindMap.annotationTopic"), icon: <StickyNote /> },
    ] as const;
}

export function ConnectionCreateMenu({
    pending,
    onCreate,
    onClose,
    onMenuSize,
    mode = "default",
}: {
    pending: PendingConnectionCreate;
    onCreate: (type: string) => void;
    onClose: () => void;
    /** 测到真实高度后回调，用于微调菜单位置（不改虚线落点） */
    onMenuSize?: (size: { width: number; height: number }) => void;
    mode?: "mind" | "default";
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const menuRef = useRef<HTMLDivElement>(null);
    const reportedRef = useRef(false);
    const mindOptions = useMindCreateOptions();
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false);
    const mindMode = mode === "mind";

    useLayoutEffect(() => {
        reportedRef.current = false;
    }, [pending.attachPoint.x, pending.attachPoint.y, pending.connection.side, mindMode]);

    useLayoutEffect(() => {
        if (!onMenuSize || reportedRef.current) return;
        const el = menuRef.current;
        if (!el) return;
        const width = el.offsetWidth || CONNECTION_CREATE_MENU_WIDTH;
        const height = el.offsetHeight || CONNECTION_CREATE_MENU_HEIGHT_FALLBACK;
        reportedRef.current = true;
        onMenuSize({ width, height });
    }, [onMenuSize, pending.position.x, pending.position.y, mindMode]);

    return (
        <div
            ref={menuRef}
            className="absolute z-[120] max-h-[70vh] w-[300px] overflow-y-auto rounded-[18px] border p-3 shadow-2xl backdrop-blur thin-scrollbar"
            data-connection-create-menu
            data-canvas-no-zoom
            style={{ left: pending.position.x, top: pending.position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {mindMode ? t("canvas.mindMap.createFromNode") : t("canvas.createMenu.fromNode")}
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={onClose} aria-label={t("canvas.createMenu.close")}>
                    <X className="size-4" />
                </button>
            </div>
            <div className="grid gap-1">
                {mindMode
                    ? mindOptions.map((item) => (
                          <ConnectionCreateOption key={item.type} theme={theme} icon={item.icon} title={item.title} onClick={() => onCreate(item.type)} />
                      ))
                    : definitions.map((def) => (
                          <ConnectionCreateOption key={def.type} theme={theme} icon={def.icon} title={def.title} onClick={() => onCreate(def.type)} />
                      ))}
            </div>
        </div>
    );
}

export function ConnectionCreateOption({
    theme,
    icon,
    title,
    onClick,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    icon: ReactNode;
    title: string;
    onClick?: () => void;
}) {
    return (
        <button
            type="button"
            className="flex h-12 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left transition"
            style={{ color: theme.node.text }}
            onClick={onClick}
            onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
        >
            <span
                className="grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-5 [&_svg]:shrink-0"
                style={{ background: theme.node.fill, color: theme.node.muted }}
            >
                {icon}
            </span>
            <span className="min-w-0 flex-1 truncate text-base font-semibold leading-5">{title}</span>
        </button>
    );
}

export function NodeCreateMenu({
    position,
    onCreate,
    onClose,
    mode = "default",
}: {
    position: Position;
    onCreate: (type: string) => void;
    onClose: () => void;
    mode?: "mind" | "default";
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const menuRef = useRef<HTMLDivElement>(null);
    const mindOptions = useMindCreateOptions();
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false);
    const mindMode = mode === "mind";
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [onClose]);
    return (
        <div
            ref={menuRef}
            className="absolute z-[120] max-h-[70vh] w-[300px] overflow-y-auto rounded-[18px] border p-3 shadow-2xl backdrop-blur thin-scrollbar"
            data-canvas-no-zoom
            style={{ left: position.x, top: position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {mindMode ? t("canvas.mindMap.createMenu") : t("canvas.createMenu.select")}
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:opacity-100" onClick={onClose} aria-label={t("canvas.createMenu.close")}>
                    <X className="size-4" />
                </button>
            </div>
            <div className="grid gap-1">
                {mindMode
                    ? mindOptions.map((item) => (
                          <ConnectionCreateOption key={item.type} theme={theme} icon={item.icon} title={item.title} onClick={() => onCreate(item.type)} />
                      ))
                    : definitions.map((def) => (
                          <ConnectionCreateOption key={def.type} theme={theme} icon={def.icon} title={def.title} onClick={() => onCreate(def.type)} />
                      ))}
            </div>
        </div>
    );
}
