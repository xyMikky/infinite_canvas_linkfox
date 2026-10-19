import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { GitBranch, Minus, Palette, Plus, Squircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MIND_NODE_TYPE } from "@/lib/canvas/mind-map";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";

const ROOT_SIZE = { width: 180, height: 52 };
const TOPIC_SIZE = { width: 140, height: 40 };

export const MIND_COLORS = ["#7c3aed", "#2563eb", "#059669", "#d97706", "#dc2626", "#db2777", "#0d9488", "#64748b", "#ea580c", "#0891b2"] as const;
export const DEFAULT_MIND_COLOR = MIND_COLORS[0];

export const MIND_SHAPES = ["capsule", "rounded", "rect", "circle", "diamond", "hexagon"] as const;
export type MindShape = (typeof MIND_SHAPES)[number];

const CLIP: Partial<Record<MindShape, string>> = {
    diamond: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
    hexagon: "polygon(12% 0%, 88% 0%, 100% 50%, 88% 100%, 12% 100%, 0% 50%)",
};

/** 估算导图文字宽度：中日韩等全角约 1em，拉丁约 0.55em（勿用纯拉丁系数估中文） */
function mindTextUnits(text: string) {
    let units = 0;
    for (const ch of text) {
        if (ch === "\n") continue;
        const code = ch.codePointAt(0) ?? 0;
        units += code > 0xff ? 1 : 0.55;
    }
    return units || 4;
}

export function computeMindNodeSize(text: string, isRoot: boolean, fontSize: number, shape: MindShape) {
    const base = isRoot ? ROOT_SIZE : TOPIC_SIZE;
    const raw = text || "----";
    const padX = 28;
    const maxW = 320;
    const units = mindTextUnits(raw);
    const naturalW = units * fontSize;
    const hardLines = Math.max(1, raw.split("\n").length);
    let width = Math.min(maxW, Math.max(base.width, Math.ceil(Math.min(naturalW, maxW - padX) + padX)));
    const wrapLines = Math.ceil(naturalW / Math.max(width - padX, 40));
    const lines = Math.min(6, Math.max(hardLines, wrapLines, 1));
    let height = Math.max(base.height, Math.round(lines * fontSize * 1.4 + 20));
    if (shape === "circle") {
        const side = Math.max(width, height, 64);
        width = side;
        height = side;
    }
    if (shape === "diamond") {
        width = Math.max(width, 120);
        height = Math.max(height, 72);
    }
    if (shape === "hexagon") {
        width = Math.max(width + 24, 148);
        height = Math.max(height, 48);
    }
    return { width, height };
}

function MindContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { t } = useTranslation();
    const isRoot = ctx.node.metadata?.mindRole === "root";
    const isDecision = ctx.node.metadata?.mindKind === "decision";
    const text = String(ctx.node.metadata?.content || "");
    const fontSize = Math.max(11, Math.min(28, Number(ctx.node.metadata?.fontSize) || (isRoot ? 15 : 13)));
    const shape = (ctx.node.metadata?.mindShape || (isDecision ? "hexagon" : isRoot ? "capsule" : "rounded")) as MindShape;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(text);
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const inputRef = useRef<HTMLInputElement>(null);
    const focusToken = ctx.node.metadata?.mindFocusEdit;

    const commit = useCallback((value: string) => {
        const next = value.trim() || (isRoot ? t("canvas.mindMap.centerTopic") : isDecision ? t("canvas.mindMap.decisionTopic") : t("canvas.mindMap.childTopic"));
        setEditing(false);
        ctx.updateMetadata({ content: next });
        if (ctx.node.title !== next) ctx.updateNode({ title: next });
        const size = computeMindNodeSize(next, isRoot, fontSize, shape);
        if (ctx.node.width !== size.width || ctx.node.height !== size.height) {
            ctx.updateNode({ width: size.width, height: size.height });
        }
    }, [ctx, fontSize, isDecision, isRoot, shape, t]);

    useEffect(() => {
        if (!focusToken) return;
        setDraft(String(ctx.node.metadata?.content || ""));
        setEditing(true);
        ctx.updateMetadata({ mindFocusEdit: undefined });
    }, [ctx, focusToken]);

    useEffect(() => {
        if (!editing) {
            setDraft(text);
            return;
        }
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.select();
    }, [editing, text]);

    useEffect(() => {
        if (!editing) return;
        const onPointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (inputRef.current?.contains(target)) return;
            commit(draftRef.current);
        };
        window.addEventListener("pointerdown", onPointer, true);
        return () => window.removeEventListener("pointerdown", onPointer, true);
    }, [commit, editing]);

    const accent = ctx.node.metadata?.mindColor || ctx.theme.node.activeStroke;
    const fill = `${accent}22`;
    const stroke = ctx.isSelected ? ctx.theme.node.activeStroke : accent;
    const placeholder = isRoot ? t("canvas.mindMap.centerTopic") : isDecision ? t("canvas.mindMap.decisionTopic") : t("canvas.mindMap.childTopic");
    const label = text.trim() || placeholder;
    const needed = computeMindNodeSize(label, isRoot, fontSize, shape);
    // 已落盘尺寸偏小时缩字号保可读，避免裁切；编辑时用原字号
    const fitScale = editing ? 1 : Math.min(1, ctx.node.width / needed.width, ctx.node.height / needed.height);
    const displayFontSize = Math.max(9, Math.round(fontSize * fitScale * 10) / 10);
    const textStyle = {
        color: ctx.theme.node.text,
        fontSize: `${displayFontSize}px`,
        fontWeight: isRoot || isDecision ? 600 : 500,
        lineHeight: "1.35",
    } as const;
    const clip = CLIP[shape];
    const shellStyle = shellCss(shape, ctx.node.height, isRoot, fill, stroke, Boolean(ctx.isSelected), ctx.theme.node.activeStroke);

    return (
        <div
            className="relative flex h-full w-full items-center justify-center"
            style={shellStyle}
            onDoubleClick={(event) => {
                event.stopPropagation();
                setDraft(text);
                setEditing(true);
            }}
            onPointerDown={(event) => {
                if (editing) event.stopPropagation();
            }}
        >
            {clip ? (
                <>
                    <div className="pointer-events-none absolute inset-0" style={{ clipPath: clip, background: stroke }} />
                    <div className="pointer-events-none absolute inset-[2px]" style={{ clipPath: clip, background: fill }} />
                </>
            ) : null}
            <div className={`relative z-10 flex h-full w-full items-center justify-center ${shape === "diamond" || shape === "hexagon" ? "px-6" : "px-3"}`}>
                {editing ? (
                    <input
                        ref={inputRef}
                        className="w-full border-none bg-transparent text-center outline-none"
                        style={textStyle}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") {
                                event.preventDefault();
                                setDraft(text);
                                setEditing(false);
                                return;
                            }
                            if (event.key === "Enter") {
                                event.preventDefault();
                                commit(draft);
                            }
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                    />
                ) : (
                    <div className="flex max-h-full max-w-full items-center justify-center overflow-hidden px-0.5 text-center break-words [overflow-wrap:anywhere]" style={textStyle}>
                        {label}
                    </div>
                )}
            </div>
        </div>
    );
}

function shellCss(
    shape: MindShape,
    height: number,
    isRoot: boolean,
    fill: string,
    stroke: string,
    selected: boolean,
    activeStroke: string,
): CSSProperties {
    if (shape === "diamond" || shape === "hexagon") {
        return {
            background: "transparent",
            border: "none",
            boxShadow: selected ? `0 0 0 1px ${activeStroke}55` : undefined,
        };
    }
    const radius = shape === "circle" || shape === "capsule" ? Math.max(height / 2, 999) : shape === "rect" ? 4 : isRoot ? 18 : 14;
    return {
        borderRadius: radius,
        background: fill,
        border: `1.5px solid ${stroke}`,
        boxShadow: selected ? `0 0 0 1px ${activeStroke}55` : undefined,
    };
}

/** 导图悬停工具栏：样式/颜色弹出选择，而非点击轮换 */
export function MindNodeHoverTools({
    node,
    onPatch,
    onUpdateSize,
    onKeep,
    onLeave,
    onPanelChange,
    showLabel = true,
}: {
    node: CanvasNodeData;
    onPatch: (patch: CanvasNodeMetadata) => void;
    onUpdateSize: (size: { width: number; height: number }) => void;
    onKeep: (nodeId: string) => void;
    onLeave: () => void;
    onPanelChange?: (open: boolean) => void;
    showLabel?: boolean;
}) {
    const { t } = useTranslation();
    const [panel, setPanel] = useState<"shape" | "color" | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const isRoot = node.metadata?.mindRole === "root";
    const fontSize = Math.max(11, Math.min(28, Number(node.metadata?.fontSize) || (isRoot ? 15 : 13)));
    const shape = (node.metadata?.mindShape || (isRoot ? "capsule" : "rounded")) as MindShape;
    const color = node.metadata?.mindColor || MIND_COLORS[0];

    const setPanelOpen = (next: "shape" | "color" | null) => {
        setPanel(next);
        onPanelChange?.(Boolean(next));
    };

    useEffect(() => {
        if (!panel) return;
        const onPointer = (event: PointerEvent) => {
            if (rootRef.current?.contains(event.target as Node)) return;
            setPanelOpen(null);
        };
        document.addEventListener("pointerdown", onPointer, true);
        return () => document.removeEventListener("pointerdown", onPointer, true);
    }, [panel]);

    useEffect(() => () => onPanelChange?.(false), [onPanelChange]);

    const applyShape = (next: MindShape) => {
        const content = String(node.metadata?.content || node.title || "");
        onPatch({ mindShape: next });
        onUpdateSize(computeMindNodeSize(content, isRoot, fontSize, next));
        setPanelOpen(null);
    };

    return (
        <div
            ref={rootRef}
            className="relative flex h-12 items-center"
            onMouseEnter={() => onKeep(node.id)}
            onMouseLeave={() => {
                if (!panel) onLeave();
            }}
        >
            <ToolbarChip
                title={t("canvas.mindMap.styleTitle")}
                label={t("canvas.mindMap.style")}
                showLabel={showLabel}
                active={panel === "shape"}
                icon={<Squircle className="size-4" />}
                onClick={() => setPanelOpen(panel === "shape" ? null : "shape")}
            />
            <ToolbarChip
                title={t("canvas.mindMap.colorTitle")}
                label={t("canvas.mindMap.color")}
                showLabel={showLabel}
                active={panel === "color"}
                icon={(
                    <span className="relative grid size-4 place-items-center">
                        <Palette className="size-4" />
                        <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-black/20" style={{ background: color }} />
                    </span>
                )}
                onClick={() => setPanelOpen(panel === "color" ? null : "color")}
            />
            <ToolbarChip
                title={t("canvas.nodeToolbar.decreaseFont")}
                label={t("canvas.nodeToolbar.zoomOut")}
                showLabel={showLabel}
                icon={<Minus className="size-4" />}
                onClick={() => {
                    const next = Math.max(11, fontSize - 1);
                    const content = String(node.metadata?.content || node.title || "");
                    onPatch({ fontSize: next });
                    onUpdateSize(computeMindNodeSize(content, isRoot, next, shape));
                }}
            />
            <ToolbarChip
                title={t("canvas.nodeToolbar.increaseFont")}
                label={t("canvas.nodeToolbar.zoomIn")}
                showLabel={showLabel}
                icon={<Plus className="size-4" />}
                onClick={() => {
                    const next = Math.min(28, fontSize + 1);
                    const content = String(node.metadata?.content || node.title || "");
                    onPatch({ fontSize: next });
                    onUpdateSize(computeMindNodeSize(content, isRoot, next, shape));
                }}
            />

            {panel === "shape" ? (
                <div className="absolute bottom-[calc(100%+8px)] left-0 z-[80] w-[220px] rounded-2xl border border-black/10 bg-white p-2 shadow-[0_12px_32px_rgba(15,23,42,.16)]" data-canvas-shortcuts-ignore>
                    <div className="mb-1.5 px-1 text-[11px] font-medium text-[#78716c]">{t("canvas.mindMap.pickStyle")}</div>
                    <div className="grid grid-cols-3 gap-1.5">
                        {MIND_SHAPES.map((item) => (
                            <button
                                key={item}
                                type="button"
                                className={`flex flex-col items-center gap-1 rounded-xl px-1.5 py-2 transition hover:bg-[#f0f0f1] ${shape === item ? "bg-[#eeeeef]" : ""}`}
                                onClick={() => applyShape(item)}
                            >
                                <ShapePreview shape={item} color={color} />
                                <span className="text-[10px] text-[#57534e]">{t(`canvas.mindMap.shape.${item}`)}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            {panel === "color" ? (
                <div className="absolute bottom-[calc(100%+8px)] left-10 z-[80] w-[176px] rounded-2xl border border-black/10 bg-white p-2 shadow-[0_12px_32px_rgba(15,23,42,.16)]" data-canvas-shortcuts-ignore>
                    <div className="mb-1.5 px-1 text-[11px] font-medium text-[#78716c]">{t("canvas.mindMap.pickColor")}</div>
                    <div className="grid grid-cols-5 gap-1.5">
                        {MIND_COLORS.map((item) => (
                            <button
                                key={item}
                                type="button"
                                className={`grid size-7 place-items-center rounded-full border transition ${color === item ? "border-[#242529] ring-2 ring-[#242529]/20" : "border-black/10"}`}
                                style={{ background: item }}
                                title={item}
                                onClick={() => {
                                    onPatch({ mindColor: item });
                                    setPanelOpen(null);
                                }}
                            />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function ToolbarChip({
    title,
    label,
    icon,
    onClick,
    showLabel,
    active = false,
}: {
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    showLabel: boolean;
    active?: boolean;
}) {
    const hasText = showLabel && Boolean(label);
    return (
        <button type="button" className="group relative flex h-12 items-center whitespace-nowrap px-1.5 text-[#242529]" onClick={onClick} aria-label={title} title={title}>
            <span className={`flex h-9 items-center ${hasText ? "gap-2 px-2.5" : "justify-center px-2"} rounded-lg transition group-hover:bg-[#f0f0f1] ${active ? "bg-[#eeeeef]" : ""}`}>
                {icon}
                {hasText ? <span>{label}</span> : null}
            </span>
        </button>
    );
}

function ShapePreview({ shape, color }: { shape: MindShape; color: string }) {
    const fill = `${color}33`;
    const common = "size-8 border";
    if (shape === "diamond" || shape === "hexagon") {
        return (
            <span className="relative size-8">
                <span className="absolute inset-0" style={{ clipPath: CLIP[shape], background: color }} />
                <span className="absolute inset-[2px]" style={{ clipPath: CLIP[shape], background: fill }} />
            </span>
        );
    }
    if (shape === "circle") return <span className={`${common} rounded-full`} style={{ borderColor: color, background: fill }} />;
    if (shape === "capsule") return <span className={`${common} rounded-full`} style={{ borderColor: color, background: fill, width: 28, height: 16 }} />;
    if (shape === "rect") return <span className={`${common} rounded-sm`} style={{ borderColor: color, background: fill }} />;
    return <span className={`${common} rounded-lg`} style={{ borderColor: color, background: fill }} />;
}

export function getMindNodeDefinition(): CanvasNodeDefinition {
    return {
        type: MIND_NODE_TYPE,
        title: "Mind map",
        description: "Mind map topic",
        icon: <GitBranch className="size-5" />,
        defaultSize: TOPIC_SIZE,
        defaultMetadata: {
            content: "",
            mindRole: "topic",
            mindShape: "rounded",
            fontSize: 13,
            status: "idle",
        },
        minimapColor: "#8b5cf6",
        showInCreateMenu: false,
        hidePanel: true,
        transparentBackground: true,
        resource: (node) => {
            const text = String(node.metadata?.content || node.title || "").trim();
            return text ? { kind: "text", text } : null;
        },
        Content: MindContent,
        toolbar: () => [],
        onDoubleClick: () => true,
    };
}

export function mindRootDefaultSize() {
    return ROOT_SIZE;
}

export function mindTopicDefaultSize() {
    return TOPIC_SIZE;
}
