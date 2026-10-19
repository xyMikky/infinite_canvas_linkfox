import { nanoid } from "nanoid";

import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";

import type { CreateRoomResponse, RoomDocument, RoomInfoResponse, RoomOp, RoomWsMessage } from "./room-types";

export type RoomClientOptions = {
    roomId: string;
    token: string;
    role: "host" | "guest";
    lastRev?: number;
    onMessage: (msg: RoomWsMessage) => void;
    onClose?: () => void;
    onOpen?: () => void;
};

export class RoomClient {
    private ws: WebSocket | null = null;
    private readonly clientId = `client-${nanoid(8)}`;
    private pingTimer: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly options: RoomClientOptions) {}

    connect() {
        const { roomId, token, role, lastRev = 0 } = this.options;
        const proto = window.location.protocol === "https:" ? "wss" : "ws";
        const url = `${proto}://${window.location.host}/api/rooms/${encodeURIComponent(roomId)}/ws?token=${encodeURIComponent(token)}&role=${role}&clientId=${encodeURIComponent(this.clientId)}&lastRev=${lastRev}`;
        this.ws = new WebSocket(url);
        this.ws.onopen = () => {
            this.options.onOpen?.();
            this.pingTimer = setInterval(() => this.send({ type: "ping" }), 15000);
        };
        this.ws.onmessage = (event) => {
            try {
                this.options.onMessage(JSON.parse(String(event.data)) as RoomWsMessage);
            } catch {
                // ignore
            }
        };
        this.ws.onclose = () => {
            if (this.pingTimer) clearInterval(this.pingTimer);
            this.options.onClose?.();
        };
    }

    disconnect() {
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.ws?.close();
        this.ws = null;
    }

    sendOps(ops: RoomOp[]) {
        if (!ops.length) return;
        this.send({ type: "ops", ops });
    }

    sendPresence(payload: unknown) {
        this.send({ type: "presence", payload });
    }

    private send(data: unknown) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data));
    }

    getClientId() {
        return this.clientId;
    }
}

export async function createRoom(projectId: string, document: RoomDocument): Promise<CreateRoomResponse> {
    const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, document }),
    });
    return (await res.json()) as CreateRoomResponse;
}

export async function fetchRoomInfo(roomId: string, token: string): Promise<RoomInfoResponse> {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token)}`);
    return (await res.json()) as RoomInfoResponse;
}

export async function deleteRoom(roomId: string, token: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token)}`, { method: "DELETE" });
    return (await res.json()) as { ok: boolean };
}

export function roomMediaUrl(roomId: string, storageKey: string, token: string) {
    return `/api/rooms/${encodeURIComponent(roomId)}/media/${encodeURIComponent(storageKey)}?token=${encodeURIComponent(token)}`;
}

export function roomFolderFileUrl(roomId: string, folderNodeId: string, relativePath: string, token: string) {
    const encoded = relativePath.split("/").map(encodeURIComponent).join("/");
    return `/api/rooms/${encodeURIComponent(roomId)}/files/${encodeURIComponent(folderNodeId)}/${encoded}?token=${encodeURIComponent(token)}`;
}

export async function uploadRoomMedia(roomId: string, storageKey: string, token: string, blob: Blob) {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/media/${encodeURIComponent(storageKey)}?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": blob.type || "application/octet-stream" },
        body: blob,
    });
    return res.ok;
}

export async function relayRoomMediaToServer(roomId: string, storageKey: string, token: string, client: RoomClient) {
    const blob =
        (storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey)) || null;
    if (!blob?.size) return false;
    return uploadRoomMedia(roomId, storageKey, token, blob);
}

export async function handleHostMediaRequest(roomId: string, token: string, storageKey: string, client: RoomClient) {
    const blob =
        (storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey)) || null;
    if (!blob?.size) return;
    await uploadRoomMedia(roomId, storageKey, token, blob);
}
