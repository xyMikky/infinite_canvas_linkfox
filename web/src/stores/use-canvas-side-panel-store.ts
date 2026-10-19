import { create } from "zustand";

export const CANVAS_SIDE_PANEL_MOTION_MS = 500;
export const CANVAS_SIDE_PANEL_MIN_WIDTH = 220;
export const CANVAS_SIDE_PANEL_MAX_WIDTH = 480;
export const CANVAS_SIDE_PANEL_DEFAULT_WIDTH = 280;
export const CANVAS_SIDE_PANEL_Z_INDEX = 1100;
export const CANVAS_OVERLAY_MODAL_Z_INDEX = 1300;
export const CANVAS_SIDE_PANEL_OVER_MODAL_Z_INDEX = CANVAS_OVERLAY_MODAL_Z_INDEX + 10;
/** 顶栏与侧栏是兄弟层；须高于侧栏，也须高于收起后仍可能溢出的 Agent 外壳（1250） */
export const CANVAS_TOP_BAR_Z_INDEX = 1260;
export const CANVAS_TOP_BAR_MENU_Z_INDEX = CANVAS_SIDE_PANEL_OVER_MODAL_Z_INDEX + 20;

const WIDTH_KEY = "canvas-side-panel-width";
const OPEN_KEY = "canvas-side-panel-open";

function initialWidth() {
    if (typeof window === "undefined") return CANVAS_SIDE_PANEL_DEFAULT_WIDTH;
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    if (!stored) return CANVAS_SIDE_PANEL_DEFAULT_WIDTH;
    return Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, stored));
}

function initialOpen() {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(OPEN_KEY) !== "0";
}

type CanvasSidePanelStore = {
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    /** 导出模型角度弹窗打开时，侧栏需叠在弹窗之上供点选参考图 */
    modelAngleOverlayOpen: boolean;
    setWidth: (width: number) => void;
    setModelAngleOverlayOpen: (open: boolean) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
};

export const useCanvasSidePanelStore = create<CanvasSidePanelStore>((set, get) => ({
    width: initialWidth(),
    panelOpen: initialOpen(),
    panelMounted: initialOpen(),
    panelClosing: false,
    modelAngleOverlayOpen: false,
    setWidth: (width) => set({ width }),
    setModelAngleOverlayOpen: (open) => set({ modelAngleOverlayOpen: open }),
    openPanel: () => {
        if (typeof window !== "undefined") localStorage.setItem(OPEN_KEY, "1");
        set({ panelOpen: true, panelMounted: true, panelClosing: false });
    },
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        if (typeof window !== "undefined") localStorage.setItem(OPEN_KEY, "0");
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelMounted: false, panelClosing: false });
        }, CANVAS_SIDE_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
}));
