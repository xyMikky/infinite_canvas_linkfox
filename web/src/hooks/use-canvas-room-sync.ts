import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import {
    createRoom,
    deleteRoom,
    fetchRoomInfo,
    handleHostMediaRequest,
    RoomClient,
} from "@/lib/canvas/room/room-client";
import { applyRoomOps, diffRoomOps, roomDocumentFromProject } from "@/lib/canvas/room/room-ops";
import type { RoomDocument, RoomOp, RoomWsMessage } from "@/lib/canvas/room/room-types";
import { loadRoomViewport, saveRoomViewport, useCanvasRoomStore } from "@/stores/canvas/use-canvas-room-store";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";

type UseCanvasRoomSyncOptions = {
    projectId: string;
    title: string;
    backgroundMode: CanvasBackgroundMode;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    setNodes: React.Dispatch<React.SetStateAction<CanvasNodeData[]>>;
    setConnections: React.Dispatch<React.SetStateAction<CanvasConnection[]>>;
    setTitle?: (title: string) => void;
    setBackgroundMode?: (mode: CanvasBackgroundMode) => void;
    viewport: ViewportTransform;
    setViewport: (v: ViewportTransform) => void;
    projectLoaded: boolean;
    onRoomClosed?: () => void;
};

export function useCanvasRoomSync({
    projectId,
    title,
    backgroundMode,
    nodes,
    connections,
    setNodes,
    setConnections,
    setTitle,
    setBackgroundMode,
    viewport,
    setViewport,
    projectLoaded,
    onRoomClosed,
}: UseCanvasRoomSyncOptions) {
    const [searchParams, setSearchParams] = useSearchParams();
    const roomStore = useCanvasRoomStore();
    const clientRef = useRef<RoomClient | null>(null);
    const docRef = useRef<RoomDocument | null>(null);
    const applyingRemoteRef = useRef(false);
    const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ownOpIdsRef = useRef(new Set<string>());

    const connectClient = useCallback(
        (roomId: string, token: string, role: "host" | "guest", lastRev = 0) => {
            clientRef.current?.disconnect();
            const client = new RoomClient({
                roomId,
                token,
                role,
                lastRev,
                onOpen: () => roomStore.setRoomState({ connected: true }),
                onClose: () => roomStore.setRoomState({ connected: false }),
                onMessage: (msg: RoomWsMessage) => {
                    if (msg.type === "media_request" && role === "host") {
                        void handleHostMediaRequest(roomId, token, msg.storageKey, client);
                        return;
                    }
                    if (msg.type === "room_closed") {
                        roomStore.setRoomState({ readOnly: true, connected: false });
                        onRoomClosed?.();
                        return;
                    }
                    if (msg.type === "snapshot" && msg.document) {
                        applyingRemoteRef.current = true;
                        setNodes(msg.document.nodes);
                        setConnections(msg.document.connections);
                        setTitle?.(msg.document.title);
                        setBackgroundMode?.(msg.document.backgroundMode as CanvasBackgroundMode);
                        docRef.current = msg.document;
                        roomStore.setRoomState({ rev: msg.rev, onlineCount: msg.online || 0 });
                        applyingRemoteRef.current = false;
                        return;
                    }
                    if (msg.type === "ops" && msg.ops?.length) {
                        const allOwn = msg.ops.every((op) => op.opId && ownOpIdsRef.current.has(op.opId));
                        if (allOwn) {
                            roomStore.setRoomState({ rev: msg.rev, onlineCount: msg.online || roomStore.onlineCount });
                            return;
                        }
                        applyingRemoteRef.current = true;
                        const base = docRef.current || roomDocumentFromProject({ title, backgroundMode, nodes, connections });
                        const next = applyRoomOps(base, msg.ops);
                        setNodes(next.nodes);
                        setConnections(next.connections);
                        setTitle?.(next.title);
                        setBackgroundMode?.(next.backgroundMode);
                        docRef.current = next;
                        roomStore.setRoomState({ rev: msg.rev, onlineCount: msg.online || 0 });
                        applyingRemoteRef.current = false;
                        return;
                    }
                    if (msg.type === "presence") {
                        roomStore.setRoomState({ onlineCount: msg.online || roomStore.onlineCount });
                    }
                },
            });
            client.connect();
            clientRef.current = client;
        },
        [backgroundMode, connections, nodes, onRoomClosed, roomStore, setBackgroundMode, setConnections, setNodes, setTitle, title],
    );

    useEffect(() => {
        if (!projectLoaded) return;
        const roomId = searchParams.get("room") || "";
        const token = searchParams.get("token") || "";
        if (!roomId || !token) return;

        const store = useCanvasRoomStore.getState();
        if (store.active && store.role === "host" && store.roomId === roomId && store.token === token) {
            return;
        }

        roomStore.setRoomState({ active: true, role: "guest", roomId, token, projectId });
        void fetchRoomInfo(roomId, token).then((info) => {
            if (!info.ok || !info.document) {
                roomStore.setRoomState({ readOnly: true, connected: false });
                onRoomClosed?.();
                return;
            }
            applyingRemoteRef.current = true;
            setNodes(info.document.nodes);
            setConnections(info.document.connections);
            setTitle?.(info.document.title);
            setBackgroundMode?.(info.document.backgroundMode as CanvasBackgroundMode);
            docRef.current = info.document;
            roomStore.setRoomState({ rev: info.rev || 0, onlineCount: info.online || 0 });
            applyingRemoteRef.current = false;
            const savedVp = loadRoomViewport(roomId);
            if (savedVp) setViewport(savedVp);
            connectClient(roomId, token, "guest", info.rev || 0);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectLoaded, projectId]);

    useEffect(() => {
        const roomId = roomStore.roomId;
        if (!roomStore.active || !roomId) return;
        saveRoomViewport(roomId, viewport);
    }, [roomStore.active, roomStore.roomId, viewport]);

    useEffect(() => {
        if (!roomStore.active || !clientRef.current || applyingRemoteRef.current) return;
        const nextDoc = roomDocumentFromProject({ title, backgroundMode, nodes, connections });
        const prevDoc = docRef.current;
        if (!prevDoc) {
            docRef.current = nextDoc;
            return;
        }
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        syncTimerRef.current = setTimeout(() => {
            const ops = diffRoomOps(prevDoc, nextDoc, clientRef.current!.getClientId());
            docRef.current = nextDoc;
            if (!ops.length) return;
            for (const op of ops) if (op.opId) ownOpIdsRef.current.add(op.opId);
            clientRef.current?.sendOps(ops);
        }, 80);
        return () => {
            if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        };
    }, [backgroundMode, connections, nodes, roomStore.active, title]);

    useEffect(() => () => clientRef.current?.disconnect(), []);

    const startShare = useCallback(async () => {
        const document = roomDocumentFromProject({ title, backgroundMode, nodes, connections });
        const res = await createRoom(projectId, document);
        if (!res.ok || !res.roomId || !res.token) throw new Error(res.error || "create room failed");
        docRef.current = document;
        roomStore.setRoomState({
            active: true,
            role: "host",
            roomId: res.roomId,
            token: res.token,
            projectId,
            shareUrls: res.shareUrls || [],
            sharePath: res.sharePath || "",
            connected: false,
            readOnly: false,
        });
        connectClient(res.roomId, res.token, "host");
        return res;
    }, [backgroundMode, connectClient, connections, nodes, projectId, roomStore, title]);

    const stopShare = useCallback(async () => {
        const { roomId, token } = roomStore;
        if (roomId && token) await deleteRoom(roomId, token);
        clientRef.current?.disconnect();
        roomStore.resetRoom();
        const next = new URLSearchParams(searchParams);
        next.delete("room");
        next.delete("token");
        setSearchParams(next, { replace: true });
    }, [roomStore, searchParams, setSearchParams]);

    const sendPresence = useCallback((payload: unknown) => {
        clientRef.current?.sendPresence(payload);
    }, []);

    return {
        roomActive: roomStore.active,
        roomRole: roomStore.role,
        roomConnected: roomStore.connected,
        onlineCount: roomStore.onlineCount,
        shareUrls: roomStore.shareUrls,
        sharePath: roomStore.sharePath,
        readOnly: roomStore.readOnly,
        isGuest: roomStore.role === "guest",
        isHost: roomStore.role === "host",
        startShare,
        stopShare,
        sendPresence,
        roomId: roomStore.roomId,
        roomToken: roomStore.token,
    };
}

export function shouldPersistProjectToLocal(role: "host" | "guest" | null, roomActive: boolean) {
    if (!roomActive) return true;
    return role === "host";
}
