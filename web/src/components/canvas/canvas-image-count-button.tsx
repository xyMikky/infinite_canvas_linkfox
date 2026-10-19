import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasImageCountButtonProps = {
    count: number;
    imagesPerTask?: number;
    onChange: (count: number) => void;
    maxCount?: number;
    buttonClassName?: string;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
    onOpenChange?: (open: boolean) => void;
};

export function CanvasImageCountButton({
    count,
    imagesPerTask = 1,
    onChange,
    maxCount = 15,
    buttonClassName,
    placement = "topLeft",
    onOpenChange,
}: CanvasImageCountButtonProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const safeCount = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(count)) || 1)));

    const updateOpen = (nextOpen: boolean) => {
        setOpen(nextOpen);
        onOpenChange?.(nextOpen);
    };

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => {
            const next = buttonRef.current?.getBoundingClientRect() || null;
            setButtonRect((current) => {
                if (!next && !current) return current;
                if (!next || !current) return next;
                if (current.left === next.left && current.top === next.top && current.width === next.width && current.height === next.height) return current;
                return next;
            });
        };
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
            onOpenChange?.(false);
        };
        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [onOpenChange, open]);

    return (
        <>
            <span ref={buttonRef} className="inline-flex shrink-0">
                <Button
                    size="small"
                    type="text"
                    className={buttonClassName || "!h-8 !rounded-full !border !border-solid !px-2.5"}
                    style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                    onClick={() => updateOpen(!open)}
                >
                    {imagesPerTask > 1 ? `${safeCount} 组 · ${safeCount * imagesPerTask} 张` : t("canvas.controls.images", { count: safeCount })}
                </Button>
            </span>
            {open && buttonRect
                ? createPortal(
                      <CountPortal buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme} count={safeCount} maxCount={maxCount} onChange={onChange} imagesPerTask={imagesPerTask} />,
                      document.body,
                  )
                : null}
        </>
    );
}

function CountPortal({
    imagesPerTask,
    buttonRect,
    panelRef,
    placement,
    theme,
    count,
    maxCount,
    onChange,
}: {
    imagesPerTask: number;
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: CanvasImageCountButtonProps["placement"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    count: number;
    maxCount: number;
    onChange: (count: number) => void;
}) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(String(count));
    const width = 260;
    const gap = 8;
    const margin = 12;
    const alignRight = placement?.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    const left = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;
    const topPlacement = placement?.startsWith("top");
    const style = {
        position: "fixed",
        zIndex: 1200,
        width,
        left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
        ...(topPlacement ? { bottom: window.innerHeight - buttonRect.top + gap } : { top: buttonRect.bottom + gap }),
        background: theme.toolbar.panel,
        borderRadius: 14,
        boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)",
        padding: 12,
        color: theme.node.text,
    } as const;

    useEffect(() => {
        setDraft(String(count));
    }, [count]);

    const commit = (raw: number) => {
        const next = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(raw)) || 1)));
        onChange(next);
        setDraft(String(next));
    };

    return (
        <div
            ref={panelRef}
            data-canvas-no-zoom
            style={style}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <ImageSettingsTheme theme={theme}>
                <div className="space-y-2">
                    <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
                        {imagesPerTask > 1 ? `生成组数 · 每组 ${imagesPerTask} 张` : t("settingsPanels.image.count")}
                    </div>
                    <div className="flex items-center gap-2.5">
                        <div className="min-w-0 flex-1 px-1">
                            <input
                                type="range"
                                aria-label={t("settingsPanels.image.count")}
                                min={1}
                                max={maxCount}
                                step={1}
                                value={count}
                                className="h-1.5 w-full cursor-pointer"
                                style={{ accentColor: theme.node.text }}
                                onChange={event => commit(Number(event.target.value))}
                            />
                        </div>
                        <label className="flex h-8 w-14 shrink-0 overflow-hidden rounded-md border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                            <input
                                type="number"
                                min={1}
                                max={maxCount}
                                className="min-w-0 flex-1 bg-transparent px-1.5 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                onBlur={() => commit(Number(draft))}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") event.currentTarget.blur();
                                }}
                                onMouseDown={(event) => event.stopPropagation()}
                            />
                        </label>
                    </div>
                </div>
            </ImageSettingsTheme>
        </div>
    );
}
