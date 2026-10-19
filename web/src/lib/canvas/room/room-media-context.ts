import { roomFolderFileUrl, roomMediaUrl, uploadRoomMedia } from "@/lib/canvas/room/room-client";

type RoomMediaContext = {
    roomId: string;
    token: string;
    role: "host" | "guest";
};

let roomMediaContext: RoomMediaContext | null = null;

export function setRoomMediaContext(ctx: RoomMediaContext | null) {
    roomMediaContext = ctx;
}

export function getRoomMediaContext() {
    return roomMediaContext;
}

export function clearRoomMediaContext() {
    roomMediaContext = null;
}

export function resolveRoomMediaUrl(storageKey: string) {
    if (!roomMediaContext) return null;
    return roomMediaUrl(roomMediaContext.roomId, storageKey, roomMediaContext.token);
}

export function resolveRoomFolderFileUrl(folderNodeId: string, relativePath: string) {
    if (!roomMediaContext) return null;
    return roomFolderFileUrl(roomMediaContext.roomId, folderNodeId, relativePath, roomMediaContext.token);
}

export async function syncRoomMediaIfActive(storageKey: string, blob: Blob) {
    const ctx = roomMediaContext;
    if (!ctx || !storageKey) return;
    await uploadRoomMedia(ctx.roomId, storageKey, ctx.token, blob);
}
