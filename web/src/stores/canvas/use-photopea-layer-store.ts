import { create } from "zustand";

export type PhotopeaLayerImage = { url: string; storageKey?: string; title?: string };
type ImportHandler = (image: PhotopeaLayerImage) => void;

export const usePhotopeaLayerStore = create<{
    handler: ImportHandler | null;
    register: (handler: ImportHandler) => () => void;
    tryImport: (image: PhotopeaLayerImage) => boolean;
}>((set, get) => ({
    handler: null,
    register: (handler) => {
        set({ handler });
        return () => { if (get().handler === handler) set({ handler: null }); };
    },
    tryImport: (image) => {
        const handler = get().handler;
        if (!handler) return false;
        handler(image);
        return true;
    },
}));
