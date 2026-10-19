import { create } from "zustand";

import type { RoomDocument } from "@/lib/canvas/room/room-types";

type CanvasRoomStore = {
    active: boolean;
    role: "host" | "guest" | null;
    roomId: string;
    token: string;
    projectId: string;
    rev: number;
    connected: boolean;
    onlineCount: number;
    shareUrls: string[];
    sharePath: string;
    readOnly: boolean;
    setRoomState: (patch: Partial<CanvasRoomStore>) => void;
    resetRoom: () => void;
};

const initial: Omit<CanvasRoomStore, "setRoomState" | "resetRoom"> = {
    active: false,
    role: null,
    roomId: "",
    token: "",
    projectId: "",
    rev: 0,
    connected: false,
    onlineCount: 0,
    shareUrls: [],
    sharePath: "",
    readOnly: false,
};

export const useCanvasRoomStore = create<CanvasRoomStore>((set) => ({
    ...initial,
    setRoomState: (patch) => set((state) => ({ ...state, ...patch })),
    resetRoom: () => set(initial),
}));

export function getRoomViewportKey(roomId: string) {
    return `room-viewport:${roomId}`;
}

export function loadRoomViewport(roomId: string) {
    try {
        const raw = sessionStorage.getItem(getRoomViewportKey(roomId));
        if (!raw) return null;
        return JSON.parse(raw) as { x: number; y: number; k: number };
    } catch {
        return null;
    }
}

export function saveRoomViewport(roomId: string, viewport: { x: number; y: number; k: number }) {
    try {
        sessionStorage.setItem(getRoomViewportKey(roomId), JSON.stringify(viewport));
    } catch {
        // ignore
    }
}

export type { RoomDocument };
