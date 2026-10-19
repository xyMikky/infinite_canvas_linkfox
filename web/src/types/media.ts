export type ReferenceVideo = {
    id: string;
    name: string;
    type: string;
    url: string;
    storageKey?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    clipStartMs?: number;
    clipEndMs?: number;
    includeAudio?: boolean;
};

export type ReferenceAudio = {
    id: string;
    name: string;
    type: string;
    url: string;
    storageKey?: string;
    bytes?: number;
    durationMs?: number;
    clipStartMs?: number;
    clipEndMs?: number;
};
