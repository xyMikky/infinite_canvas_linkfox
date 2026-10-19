import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useHostTheme } from "./theme";

export type HoverTipState = { x: number; y: number; flip: boolean; content: ReactNode } | null;

/**
 * 悬停提示：`ref` 挂到 position:relative 的容器上，目标元素挂 `onMouseMove={(e) => show(e, 内容)}`
 * 与 `onMouseLeave={hide}`，容器内渲染 `<HoverTip tip={tip} />`。
 */
export function useHoverTip() {
    const ref = useRef<HTMLDivElement | null>(null);
    const [tip, setTip] = useState<HoverTipState>(null);
    // SDK 组件自身不经过源码 JSX 转译，也需要标记纯 HTML 的交互容器。
    useLayoutEffect(() => {
        ref.current?.setAttribute("data-canvas-live", "true");
    });
    const visible = Boolean(tip);
    useEffect(() => {
        if (!visible) return;
        const hide = () => setTip(null);
        window.addEventListener("scroll", hide, true);
        window.addEventListener("wheel", hide, { passive: true });
        window.addEventListener("resize", hide);
        window.addEventListener("blur", hide);
        return () => {
            window.removeEventListener("scroll", hide, true);
            window.removeEventListener("wheel", hide);
            window.removeEventListener("resize", hide);
            window.removeEventListener("blur", hide);
        };
    }, [visible]);
    const show = (event: { clientX: number; clientY: number }, content: ReactNode) => {
        if (!ref.current) return;
        setTip({ x: event.clientX, y: event.clientY, flip: event.clientX > window.innerWidth * 0.62, content });
    };
    const hide = () => setTip(null);
    return { ref, tip, show, hide };
}

export function HoverTip({ tip }: { tip: HoverTipState }) {
    const theme = useHostTheme();
    const tipRef = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        const el = tipRef.current;
        if (!el || !tip) return;
        const { width, height } = el.getBoundingClientRect();
        const x = tip.flip ? tip.x - width - 12 : tip.x + 12;
        const y = tip.y + height + 22 > window.innerHeight ? tip.y - height - 14 : tip.y + 14;
        el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
        el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
    }, [tip]);
    if (!tip) return null;
    return createPortal(
        <div
            ref={tipRef}
            role="tooltip"
            style={{
                position: "fixed",
                left: tip.x + 12,
                top: tip.y + 14,
                width: "max-content",
                maxWidth: "min(300px, calc(100vw - 16px))",
                maxHeight: "calc(100vh - 16px)",
                overflow: "hidden",
                overflowWrap: "anywhere",
                background: theme.bg.chrome,
                border: `1px solid ${theme.stroke.primary}`,
                borderRadius: 6,
                padding: "5px 9px",
                fontSize: 12,
                lineHeight: "17px",
                color: theme.text.primary,
                pointerEvents: "none",
                zIndex: 2100,
            }}
        >
            {tip.content}
        </div>,
        document.body,
    );
}
