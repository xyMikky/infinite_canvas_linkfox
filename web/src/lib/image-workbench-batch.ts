import i18n from "@/i18n";
import type { ReferenceImage } from "@/types/image";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

export type ReferenceBatchTask = {
    references: ReferenceImage[];
    label: string;
};

export type ReferenceBatchPlan = {
    mismatch: Array<{ index: number; count: number }>;
    tasks: ReferenceBatchTask[];
};

type DirectoryEntry = {
    isDirectory: boolean;
    isFile: boolean;
    name: string;
    createReader?: () => { readEntries: (success: (entries: DirectoryEntry[]) => void, error: (reason: DOMException) => void) => void };
    file?: (success: (file: File) => void, error: (reason: DOMException) => void) => void;
};

export function isWorkbenchImageFile(file: File) {
    return file.type.startsWith("image/") || IMAGE_EXT.test(file.name);
}

export function isTopLevelDirectoryFile(file: File) {
    const relative = (file.webkitRelativePath || "").replace(/\\/g, "/");
    if (!relative) return true;
    return relative.split("/").filter(Boolean).length === 2;
}

export function sortImageFiles<T extends { name: string }>(files: T[]) {
    return [...files].sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }));
}

/** limit 为空或小于 1 时同时跑完全部任务。 */
export async function runWithConcurrency(count: number, limit: number | null, worker: (index: number) => Promise<void>) {
    const size = Math.max(0, count);
    const workers = !limit || limit < 1 ? size : Math.min(Math.floor(limit), size);
    if (!workers) return;
    let cursor = 0;
    await Promise.all(
        Array.from({ length: workers }, async () => {
            while (cursor < size) {
                const index = cursor;
                cursor += 1;
                await worker(index);
            }
        }),
    );
}

export function plainReference(slot: ReferenceImage): ReferenceImage {
    const image = slot.batchImages?.[0] || slot;
    return { id: image.id, name: image.name, type: image.type, dataUrl: image.dataUrl, url: image.url, storageKey: image.storageKey };
}

export function isFilledReference(slot: ReferenceImage) {
    return Boolean(slot.dataUrl || slot.batchImages?.length);
}

export function planReferenceBatch(slots: ReferenceImage[]): ReferenceBatchPlan {
    const active = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => isFilledReference(slot));
    const folders = active.map(({ slot, index }) => ({ index, count: slot.batchImages?.length || 0 })).filter((item) => item.count > 0);
    if (!folders.length) return { mismatch: [], tasks: [{ references: active.map(({ slot }) => plainReference(slot)), label: "" }] };
    const count = folders[0].count;
    if (folders.some((item) => item.count !== count)) return { mismatch: folders, tasks: [] };
    const tasks = Array.from({ length: count }, (_, taskIndex) => {
        const references = active.map(({ slot }) => (slot.batchImages?.length ? slot.batchImages[taskIndex] : plainReference(slot)));
        const label = active.map(({ index }, position) => `${i18n.t("imageWorkbench.referenceSlot", { index: index + 1 })} ${references[position].name}`).join(" · ");
        return { references, label };
    });
    return { mismatch: [], tasks };
}

export async function readDroppedReferences(transfer: DataTransfer) {
    const folders: Array<{ name: string; files: File[] }> = [];
    const fixed: File[] = [];
    const items = Array.from(transfer.items || []);
    let sawEntry = false;
    for (const item of items) {
        const entry = item.webkitGetAsEntry?.() as DirectoryEntry | null;
        if (!entry) continue;
        sawEntry = true;
        if (entry.isDirectory) {
            folders.push({ name: entry.name, files: sortImageFiles((await readTopLevelFiles(entry)).filter(isWorkbenchImageFile)) });
        } else if (entry.isFile && entry.file) {
            const file = await fileFromEntry(entry);
            if (isWorkbenchImageFile(file)) fixed.push(file);
        }
    }
    if (sawEntry) return { fixed, folders };
    return { fixed: Array.from(transfer.files || []).filter(isWorkbenchImageFile), folders };
}

async function readTopLevelFiles(entry: DirectoryEntry) {
    const children = await readDirectoryEntries(entry);
    const files: File[] = [];
    for (const child of children) {
        if (!child.isFile) continue;
        files.push(await fileFromEntry(child));
    }
    return files;
}

function readDirectoryEntries(entry: DirectoryEntry) {
    const reader = entry.createReader?.();
    if (!reader) return Promise.resolve([] as DirectoryEntry[]);
    return new Promise<DirectoryEntry[]>((resolve, reject) => {
        const all: DirectoryEntry[] = [];
        const read = () => {
            reader.readEntries((entries) => {
                if (!entries.length) {
                    resolve(all);
                    return;
                }
                all.push(...entries);
                read();
            }, reject);
        };
        read();
    });
}

function fileFromEntry(entry: DirectoryEntry) {
    return new Promise<File>((resolve, reject) => {
        if (!entry.file) {
            reject(new Error("missing file"));
            return;
        }
        entry.file(resolve, reject);
    });
}
