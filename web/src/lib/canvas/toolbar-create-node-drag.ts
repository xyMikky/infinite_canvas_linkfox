export const TOOLBAR_CREATE_NODE_MIME = "application/x-infinite-canvas-toolbar-create-node";

export function writeToolbarCreateNodeDataTransfer(dataTransfer: DataTransfer, type: string) {
    dataTransfer.effectAllowed = "copy";
    dataTransfer.setData(TOOLBAR_CREATE_NODE_MIME, JSON.stringify({ type }));
    dataTransfer.setData("text/plain", type);
}

export function readToolbarCreateNodeFromDataTransfer(dataTransfer: DataTransfer): string | null {
    const raw = dataTransfer.getData(TOOLBAR_CREATE_NODE_MIME);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as { type?: string };
        return typeof parsed?.type === "string" && parsed.type ? parsed.type : null;
    } catch {
        return null;
    }
}
