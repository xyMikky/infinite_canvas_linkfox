import { folderAssetFileToImagePayload } from "@/lib/canvas/folder-asset";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import type { PromptAssetGeneration, PromptAssetMedia } from "@/services/api/prompt-source-runtime";

export const SIDE_PANEL_INSERT_MIME = "application/x-infinite-canvas-side-panel";
export const CANVAS_ASSET_DROP_HOVER_EVENT = "infinite-canvas:asset-drop-hover";
export const CANVAS_PROMPT_DROP_HOVER_EVENT = "infinite-canvas:prompt-drop-hover";

type AssetInsertDrag = { source: "asset"; assetId: string };
type FolderFileInsertDrag = { source: "folderFile"; assetId: string; path: string; name: string };
type PromptInsertDrag = { source: "prompt"; title: string; content: string; bundle?: PromptAssetMedia[]; generation?: PromptAssetGeneration };
export type SidePanelInsertDrag = AssetInsertDrag | FolderFileInsertDrag | PromptInsertDrag;

export function writeSidePanelInsertDataTransfer(dataTransfer: DataTransfer, payload: SidePanelInsertDrag) {
    dataTransfer.effectAllowed = "copyMove";
    dataTransfer.setData(SIDE_PANEL_INSERT_MIME, JSON.stringify(payload));
    if (payload.source === "prompt") dataTransfer.setData("text/plain", payload.content || payload.title);
}

export function readSidePanelInsertFromDataTransfer(dataTransfer: DataTransfer): SidePanelInsertDrag | null {
    const raw = dataTransfer.getData(SIDE_PANEL_INSERT_MIME);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as SidePanelInsertDrag;
        if (parsed?.source === "asset" && parsed.assetId) return parsed;
        if (parsed?.source === "folderFile" && parsed.assetId && parsed.path) return parsed;
        if (parsed?.source === "prompt") return parsed;
        return null;
    } catch {
        return null;
    }
}

export function resolveSidePanelInsertPayload(drag: SidePanelInsertDrag | null): InsertAssetPayload | null {
    if (!drag) return null;
    if (drag.source === "folderFile") return null;
    if (drag.source === "prompt") {
        return { kind: "promptAsset", title: drag.title || "", prompt: drag.content || "", bundle: drag.bundle || [], generation: drag.generation };
    }
    const asset = useAssetStore.getState().assets.find((item) => item.id === drag.assetId);
    return asset ? assetToInsertPayload(asset) : null;
}

/** 含文件夹内图片等需异步读文件的拖放 */
export async function resolveSidePanelInsertPayloadAsync(drag: SidePanelInsertDrag | null): Promise<InsertAssetPayload | null> {
    if (!drag) return null;
    if (drag.source === "folderFile") {
        const asset = useAssetStore.getState().assets.find((item) => item.id === drag.assetId);
        if (!asset || asset.kind !== "folder") return null;
        return folderAssetFileToImagePayload(asset, drag.path, drag.name || drag.path.split("/").pop() || "image");
    }
    return resolveSidePanelInsertPayload(drag);
}

export function assetToInsertPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "folder") return { kind: "folder", assetId: asset.id };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, title: asset.title, storageKey: asset.data.storageKey, width: asset.data.width, height: asset.data.height };
    return { kind: "image", dataUrl: asset.data.dataUrl || asset.coverUrl || "", title: asset.title, storageKey: asset.data.storageKey };
}

export function assetDragPreview(asset: Asset) {
    if (asset.kind === "image") return { imageUrl: asset.coverUrl || asset.data.dataUrl, label: asset.title, size: 96 };
    if (asset.kind === "video") return { imageUrl: asset.coverUrl || undefined, label: asset.title, size: 96 };
    return { label: asset.title, size: 96 };
}

export function setCanvasAssetDropHover(active: boolean) {
    window.dispatchEvent(new CustomEvent(CANVAS_ASSET_DROP_HOVER_EVENT, { detail: { active } }));
}

export function setCanvasPromptDropHover(active: boolean) {
    window.dispatchEvent(new CustomEvent(CANVAS_PROMPT_DROP_HOVER_EVENT, { detail: { active } }));
}

export function isPointOverAssetDropZone(clientX: number, clientY: number) {
    return isPointOverSelector(clientX, clientY, "[data-asset-drop-zone='true']");
}

export function isPointOverPromptDropZone(clientX: number, clientY: number) {
    return isPointOverSelector(clientX, clientY, "[data-prompt-drop-zone='true']");
}

function isPointOverSelector(clientX: number, clientY: number, selector: string) {
    const zone = document.querySelector(selector);
    if (!(zone instanceof HTMLElement)) return false;
    const rect = zone.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

export function setSidePanelDragGhost(event: DragEvent, preview: { imageUrl?: string; label?: string; size?: number }) {
    const size = preview.size || 96;
    const ghost = document.createElement("div");
    ghost.style.cssText = "position:absolute;top:-1000px;left:-1000px;overflow:hidden;border-radius:12px;background:#111;color:#fff;font-size:12px;line-height:1.3;";
    ghost.style.width = `${size}px`;
    if (preview.imageUrl) {
        const img = document.createElement("img");
        img.src = preview.imageUrl;
        img.alt = "";
        img.style.cssText = `display:block;width:${size}px;height:${size}px;object-fit:cover;`;
        ghost.appendChild(img);
    } else {
        ghost.style.padding = "10px";
        ghost.textContent = (preview.label || "").slice(0, 40);
    }
    document.body.appendChild(ghost);
    event.dataTransfer?.setDragImage(ghost, size / 2, size / 2);
    window.setTimeout(() => ghost.remove(), 0);
}
