import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";

export type RoomDocument = {
    title: string;
    backgroundMode: CanvasBackgroundMode;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

export type RoomOp =
    | { type: "upsert_nodes"; nodes: CanvasNodeData[]; opId?: string; clientId?: string; rev?: number }
    | { type: "remove_nodes"; nodeIds: string[]; opId?: string; clientId?: string; rev?: number }
    | { type: "upsert_connections"; connections: CanvasConnection[]; opId?: string; clientId?: string; rev?: number }
    | { type: "remove_connections"; connectionIds: string[]; opId?: string; clientId?: string; rev?: number }
    | { type: "set_title"; title: string; opId?: string; clientId?: string; rev?: number }
    | { type: "set_background_mode"; backgroundMode: string; opId?: string; clientId?: string; rev?: number };

export type RoomWsMessage =
    | { type: "snapshot"; rev: number; document: RoomDocument; online?: number }
    | { type: "ops"; rev: number; ops: RoomOp[]; clientId?: string; online?: number }
    | { type: "presence"; online?: number; clientId?: string; payload?: unknown }
    | { type: "media_request"; storageKey: string }
    | { type: "room_closed" }
    | { type: "pong" };

export type CreateRoomResponse = {
    ok: boolean;
    roomId?: string;
    token?: string;
    projectId?: string;
    sharePath?: string;
    shareUrls?: string[];
    error?: string;
};

export type RoomInfoResponse = {
    ok: boolean;
    rev?: number;
    online?: number;
    document?: RoomDocument;
    projectId?: string;
    error?: string;
};
