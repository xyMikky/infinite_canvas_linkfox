import { create } from "zustand";

import type { Model3dCameraPose } from "@/lib/canvas/model-3d-viewer";

export type ModelAngleExportSession = {
    nodeId: string;
    storageKey: string;
    fileName: string;
    background: string;
    showTextures: boolean;
    pose: Model3dCameraPose;
};

type ModelAngleExportStore = {
    session: ModelAngleExportSession | null;
    setSession: (next: ModelAngleExportSession | null | ((current: ModelAngleExportSession | null) => ModelAngleExportSession | null)) => void;
};

export const useModelAngleExportStore = create<ModelAngleExportStore>((set) => ({
    session: null,
    setSession: (next) => set((state) => ({ session: typeof next === "function" ? next(state.session) : next })),
}));
