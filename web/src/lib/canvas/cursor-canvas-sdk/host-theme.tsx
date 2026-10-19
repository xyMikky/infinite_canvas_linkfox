import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { CanvasRuntimeProvider } from "./theme";

const EMPTY_STATE: Record<string, unknown> = {};

export function CursorCanvasThemeProvider({ children, ctx }: { children: ReactNode; ctx?: CanvasNodeContext }) {
    const kind = useThemeStore((state) => state.theme);
    const ctxRef = useRef(ctx);
    ctxRef.current = ctx;
    const documentKey = ctx?.node.metadata?.smartPreviewPath || "canvas.tsx";
    const values = ctx?.node.metadata?.canvasTsxState?.[documentKey] || EMPTY_STATE;
    const update = useCallback((key: string, action: (previous: unknown) => unknown) => {
        const host = ctxRef.current;
        if (!host) return;
        const path = host.node.metadata?.smartPreviewPath || "canvas.tsx";
        host.updateMetadata((metadata) => {
            const state = metadata.canvasTsxState || {};
            const previous = state[path] || EMPTY_STATE;
            const next = action(Object.hasOwn(previous, key) ? previous[key] : undefined);
            // 与画布项目一起落盘；拒绝循环对象、函数等无法恢复的状态。
            const json = JSON.stringify(next);
            if (json === undefined) throw new Error("useCanvasState 仅支持可 JSON 序列化的数据");
            return {
                canvasTsxState: { ...state, [path]: { ...previous, [key]: JSON.parse(json) } },
                // 快照是派生数据，随实际状态变更一起失效；重绘不能额外制造保存/撤销记录。
                ...(metadata.canvasFragmentLive ? { canvasFragmentPreview: undefined } : {}),
            };
        });
    }, []);
    const state = useMemo(() => ctx ? { values, update } : null, [Boolean(ctx), values, update]);
    const actions = useMemo(() => ({
        type: ctx ? "canvas" as const : "none" as const,
        focusNode: (id: string) => { if (ctxRef.current?.getNode(id)) ctxRef.current.emit("node:focus", id); },
        previewNode: (id: string) => { if (ctxRef.current?.getNode(id)) ctxRef.current.emit("node:preview", id); },
        selectNodes: (ids: string[]) => {
            const host = ctxRef.current;
            if (host) host.applyOps([{ type: "select_nodes", ids: ids.filter((id) => Boolean(host.getNode(id))) }]);
        },
    }), [Boolean(ctx)]);
    return <CanvasRuntimeProvider kind={kind} state={state} actions={actions}>{children}</CanvasRuntimeProvider>;
}
