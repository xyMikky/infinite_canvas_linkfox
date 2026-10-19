import { saveAs } from "file-saver";

import { FOLDER_NODE_TYPE } from "@/components/canvas/nodes/folder-node";
import { SMART_PREVIEW_NODE_TYPE } from "@/components/canvas/nodes/smart-preview-node";
import i18n from "@/i18n";
import { folderSourceStorageKey, loadFolderPreviewSources } from "@/lib/canvas/folder-preview-cache";
import { createZip } from "@/lib/zip";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import type { CanvasExportAsset, CanvasExportFile } from "@/types/canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export async function exportCanvasProjects(projects: CanvasProject[], fileName = i18n.t("canvas.export.defaultProjectName")) {
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const exportedProjects = await Promise.all(
        projects.map(async (project) => {
            const files: CanvasExportAsset[] = [];
            const mediaKeys = collectStorageKeys(project);
            await Promise.all(
                mediaKeys.map(async (storageKey) => {
                    const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
                    if (!blob) return;
                    const path = `projects/${project.id}/files/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`;
                    files.push({ storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
                    zipFiles.push({ name: path, data: blob });
                }),
            );
            await Promise.all(
                project.nodes
                    .filter((node) => node.type === FOLDER_NODE_TYPE)
                    .map(async (node) => {
                        const sources = await loadFolderPreviewSources(node.id);
                        for (const source of sources) {
                            const storageKey = folderSourceStorageKey(node.id, source.path);
                            const path = `projects/${project.id}/folders/${node.id}/${source.path}`;
                            const mimeType = mimeFromFileName(source.name);
                            const blob = new Blob([source.data], { type: mimeType });
                            files.push({ storageKey, path, mimeType, bytes: blob.size });
                            zipFiles.push({ name: path, data: blob });
                        }
                    }),
            );
            return { project, files };
        }),
    );

    const data: CanvasExportFile = { app: "infinite-canvas", version: 3, exportedAt: new Date().toISOString(), projects: exportedProjects };
    const zip = await createZip([{ name: "projects.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

export async function exportCanvasNodes(nodes: CanvasNodeData[], fileName = i18n.t("canvas.export.defaultNodesName")) {
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const used = new Set<string>();
    const uniqueName = (base: string, ext: string) => {
        const safe = safeFileName(base) || i18n.t("canvas.export.item");
        let name = `${safe}.${ext}`;
        for (let i = 1; used.has(name); i += 1) name = `${safe}-${i}.${ext}`;
        used.add(name);
        return name;
    };

    await Promise.all(
        nodes.map(async (node) => {
            const title = node.title || node.type;
            const storageKey = node.metadata?.storageKey || "";
            if (storageKey) {
                const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
                if (blob) return void zipFiles.push({ name: uniqueName(title, fileExtension(blob.type, storageKey)), data: blob });
            }
            if (node.type === FOLDER_NODE_TYPE) {
                const sources = await loadFolderPreviewSources(node.id);
                if (sources.length) {
                    for (const source of sources) {
                        const mimeType = mimeFromFileName(source.name);
                        zipFiles.push({
                            name: `${safeFileName(title)}/${source.path}`,
                            data: new Blob([source.data], { type: mimeType }),
                        });
                    }
                    return;
                }
            }
            if (node.type === CanvasNodeType.Text) return void zipFiles.push({ name: uniqueName(title, "txt"), data: node.metadata?.content || node.metadata?.prompt || "" });
            if (node.type === SMART_PREVIEW_NODE_TYPE) {
                const content = String(node.metadata?.content || "");
                const kind = String(node.metadata?.smartPreviewKind || "");
                const pathName = String(node.metadata?.smartPreviewPath || "").split(/[\\/]/).pop() || "";
                if (content.startsWith("data:")) {
                    const blob = await (await fetch(content)).blob();
                    const ext = fileExtension(blob.type, storageKey);
                    return void zipFiles.push({ name: uniqueName(pathName.replace(/\.[^.]+$/, "") || title, ext), data: blob });
                }
                if (content.trim() && kind !== "excel") {
                    const ext =
                        kind === "canvasTsx"
                            ? "canvas.tsx"
                            : kind === "html"
                              ? "html"
                              : kind === "markdown"
                                ? "md"
                                : kind === "csv"
                                  ? "csv"
                                  : "txt";
                    const base = pathName.replace(/\.(canvas\.tsx|html?|md|markdown|txt|csv)$/i, "") || title;
                    return void zipFiles.push({ name: uniqueName(base, ext), data: content });
                }
            }
            const content = node.metadata?.content;
            if (content && content.startsWith("data:")) {
                const blob = await (await fetch(content)).blob();
                return void zipFiles.push({ name: uniqueName(title, fileExtension(blob.type, storageKey)), data: blob });
            }
            zipFiles.push({ name: uniqueName(title, "json"), data: JSON.stringify(node, null, 2) });
        }),
    );

    const zip = await createZip(zipFiles);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

function collectStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return [...keys];
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === "string" && item.includes(":") && !item.startsWith("folder-src:") && (key === "storageKey" || key.endsWith("StorageKey"))) {
            keys.add(item);
        } else if (Array.isArray(item)) {
            item.forEach((child) => collectStorageKeys(child, keys));
        } else {
            collectStorageKeys(item, keys);
        }
    }
    return [...keys];
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("ogg")) return "ogg";
    return storageKey.startsWith("image:") ? "png" : "bin";
}

function mimeFromFileName(name: string) {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    const map: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
        html: "text/html",
        htm: "text/html",
        css: "text/css",
        js: "text/javascript",
        mjs: "text/javascript",
        json: "application/json",
        md: "text/markdown",
        markdown: "text/markdown",
        txt: "text/plain",
        csv: "text/csv",
        mp4: "video/mp4",
        webm: "video/webm",
        mp3: "audio/mpeg",
        wav: "audio/wav",
    };
    return map[ext] || "application/octet-stream";
}
