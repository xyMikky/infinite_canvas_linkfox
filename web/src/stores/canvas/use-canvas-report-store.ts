import { create } from "zustand";
import type { CanvasNodeData } from "@/types/canvas";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasReport } from "@/lib/canvas/report/document";

export type CanvasReportSession = { nodeId: string; folderId: string; fromExploded: boolean; report: CanvasReport };
export const useCanvasReportStore = create<{
    session: CanvasReportSession | null;
    open: (node: CanvasNodeData) => void;
    close: () => void;
}>((set) => ({
    session: null,
    close: () => set({ session: null }),
    open: (node) => {
        const meta = node.metadata || {};
        const fromExploded = Boolean(meta.canvasExplodedSource);
        const path = String((fromExploded ? meta.canvasExplodedPath : meta.smartPreviewPath) || "report.canvas.tsx");
        const source = String((fromExploded ? meta.canvasExplodedSource : meta.content) || "");
        // 点击时冻结发起文档，异步加载、阅读状态和导出都不写回任何画布项目。
        set({ session: {
            nodeId: node.id, folderId: String(meta.proxyFolderNodeId || ""), fromExploded,
            report: {
                title: node.title || "Canvas 报告", path, source, theme: useThemeStore.getState().theme,
                state: structuredClone(meta.canvasTsxState?.[path] || {}), assets: {},
            },
        } });
    },
}));
