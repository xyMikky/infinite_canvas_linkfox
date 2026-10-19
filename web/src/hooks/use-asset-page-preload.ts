import { useEffect } from "react";
import type { Asset, FolderAsset } from "@/stores/use-asset-store";
import type { CanvasFolderEntry } from "@/types/canvas";
import { readAssetThumbnail } from "@/services/asset-thumbnail";
import { isFolderImageFileName, readFolderAssetThumbnail } from "@/lib/canvas/folder-asset";

// 先补齐当前页，再逐张预取下一页；切页后取消旧范围，不创建图片 URL。
export function useAssetPagePreload(items: Asset[] | CanvasFolderEntry[], page: number, pageSize: number, folder?: FolderAsset, enabled = true) {
    useEffect(() => {
        if (!enabled) return;
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            void (async () => {
                for (const item of items.slice((page - 1) * pageSize, (page + 1) * pageSize)) {
                    if (controller.signal.aborted) break;
                    try {
                        if (folder && "path" in item && item.kind === "file" && isFolderImageFileName(item.name)) await readFolderAssetThumbnail(folder, item.path, controller.signal);
                        else if ("id" in item && item.kind === "image") await readAssetThumbnail(item, controller.signal);
                    } catch { /* 预取失败交给可见卡片重试，不阻塞后续图片。 */ }
                }
            })();
        }, 250);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [items, page, pageSize, folder?.id, folder?.updatedAt, enabled]);
}
