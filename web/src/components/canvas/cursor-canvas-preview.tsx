import { Component, memo, useMemo, type ErrorInfo, type ReactNode } from "react";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

import { compileCursorCanvasSource } from "@/lib/canvas/cursor-canvas-runtime";
import { useHostTheme } from "@/lib/canvas/cursor-canvas-sdk";
import { CursorCanvasThemeProvider } from "@/lib/canvas/cursor-canvas-sdk/host-theme";
import { CANVAS_SANS_FONT_STACK } from "@/lib/canvas/cursor-canvas-sdk/tokens";

class CanvasErrorBoundary extends Component<{ children: ReactNode; fallback: (error: string) => ReactNode }, { error: string }> {
    state = { error: "" };

    static getDerivedStateFromError(error: Error) {
        return { error: error.message || String(error) };
    }

    componentDidCatch(error: Error, _info: ErrorInfo) {
        void _info;
        console.warn("[cursor-canvas]", error);
    }

    render() {
        if (this.state.error) return this.props.fallback(this.state.error);
        return this.props.children;
    }
}

const PreviewBody = memo(function PreviewBody({ source, scale, contentWidth }: { source: string; scale: number; contentWidth?: number }) {
    const theme = useHostTheme();
    const result = useMemo(() => {
        const compiled = compileCursorCanvasSource(source);
        return compiled.ok ? { ...compiled, Component: memo(compiled.Component) } : compiled;
    }, [source]);
    const fallback = (error: string) => (
        <div className="flex h-full items-center justify-center px-4 text-center text-xs" style={{ color: theme.text.secondary }}>
            {error}
        </div>
    );
    if (!result.ok) return fallback(result.error);
    const { Component: CanvasComponent } = result;
    const locked = typeof contentWidth === "number" && contentWidth > 0;
    return (
        <div
            className="thin-scrollbar h-full min-h-0 overflow-auto"
            style={{
                background: "transparent",
                color: theme.text.primary,
                colorScheme: theme.kind,
                fontFamily: CANVAS_SANS_FONT_STACK,
                fontSize: scale > 1 ? 15 : 13,
                lineHeight: scale > 1 ? "22px" : "18px",
            }}
            data-canvas-no-zoom
        >
            <div
                data-smart-preview-capture
                data-canvas-preview-background={theme.bg.editor}
                style={{
                    boxSizing: "border-box",
                    width: locked ? contentWidth : "100%",
                    maxWidth: locked ? contentWidth : 920,
                    minWidth: locked ? contentWidth : 0,
                    margin: locked ? 0 : "0 auto",
                    padding: scale > 1 ? "20px 18px 32px" : "24px 32px 40px",
                    zoom: scale,
                }}
            >
                <CanvasErrorBoundary key={source} fallback={fallback}>
                    <CanvasComponent />
                </CanvasErrorBoundary>
            </div>
        </div>
    );
});

export function CursorCanvasPreview({
    source,
    scale = 1,
    /** 展开到画布等场景：锁定与原预览一致的内容宽度，避免换容器后重排 */
    contentWidth,
    ctx,
}: {
    source: string;
    scale?: number;
    contentWidth?: number;
    ctx?: CanvasNodeContext;
}) {
    return (
        <CursorCanvasThemeProvider key={`${ctx?.node.id || "preview"}:${ctx?.node.metadata?.smartPreviewPath || ""}`} ctx={ctx}>
            <PreviewBody source={source} scale={scale} contentWidth={contentWidth} />
        </CursorCanvasThemeProvider>
    );
}
