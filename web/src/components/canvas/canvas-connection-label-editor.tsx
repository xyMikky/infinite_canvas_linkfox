import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { Position, ViewportTransform } from "@/types/canvas";

/** 连线中点说明编辑框（屏幕坐标定位；用 textarea 避免浏览器误判账号密码） */
export function CanvasConnectionLabelEditor({
    world,
    viewport,
    value,
    onChange,
    onCommit,
    onCancel,
}: {
    world: Position;
    viewport: ViewportTransform;
    value: string;
    onChange: (next: string) => void;
    onCommit: () => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const left = viewport.x + world.x * viewport.k;
    const top = viewport.y + world.y * viewport.k;

    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.select();
    }, []);

    return (
        <div
            className="pointer-events-auto absolute z-[75] -translate-x-1/2 -translate-y-1/2"
            style={{ left, top }}
            data-canvas-shortcuts-ignore
            data-canvas-no-zoom
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <textarea
                ref={inputRef}
                rows={1}
                name="canvas-connection-label"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
                value={value}
                maxLength={80}
                placeholder={t("canvas.connectionLabel.placeholder")}
                className="min-w-[7rem] max-w-[16rem] resize-none overflow-hidden rounded-md border px-2.5 py-1 text-center text-[12px] outline-none shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                style={{
                    background: theme.toolbar.panel,
                    borderColor: theme.toolbar.border,
                    color: theme.node.text,
                }}
                onChange={(event) => onChange(event.target.value.replace(/\n/g, ""))}
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        onCancel();
                        return;
                    }
                    if (event.key === "Enter") {
                        event.preventDefault();
                        onCommit();
                    }
                }}
                onBlur={() => onCommit()}
            />
        </div>
    );
}
