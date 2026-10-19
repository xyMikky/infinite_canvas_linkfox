import localforage from "localforage";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { resolveMediaUrl } from "@/services/file-storage";
import { resolveImageUrl } from "@/services/image-storage";
import type { PromptAssetGeneration, PromptAssetMedia, RawPrompt } from "./prompt-source-runtime";

export const LOCAL_PROMPT_SOURCE_ID = "local";

export type LocalPromptInput = {
    groupId?: string;
    title: string;
    prompt: string;
    description?: string;
    tags?: string[];
    coverUrl?: string;
    bundle?: PromptAssetMedia[];
    generation?: PromptAssetGeneration;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "local_prompts" });
const LIST_KEY = "items";

export function localPromptCategory() {
    return i18n.t("prompts.localCategory");
}

export function isLocalPromptSource(sourceId?: string) {
    return sourceId === LOCAL_PROMPT_SOURCE_ID;
}

function isPersistableCoverUrl(url: string) {
    const value = url.trim();
    return Boolean(value) && !value.startsWith("blob:");
}

async function resolveBundle(bundle: PromptAssetMedia[]) {
    return Promise.all(
        bundle.map(async (item) => {
            if (item.storageKey) {
                const url = item.kind === "image" ? await resolveImageUrl(item.storageKey) : await resolveMediaUrl(item.storageKey);
                return url ? { ...item, url } : { ...item, url: undefined };
            }
            // 历史数据可能残留 blob: 临时地址，不能当封面用
            if (item.url && !isPersistableCoverUrl(item.url)) return { ...item, url: undefined };
            return item;
        }),
    );
}

function coverFromBundle(bundle?: PromptAssetMedia[]) {
    if (!bundle?.length) return "";
    return (
        bundle.find((item) => item.cover && item.kind === "image" && item.url)?.url ||
        bundle.find((item) => item.role === "output" && item.kind === "image" && item.url)?.url ||
        bundle.find((item) => item.kind === "image" && item.url)?.url ||
        ""
    );
}

function normalizeTags(tags?: string[]) {
    return Array.from(new Set((tags || []).map((tag) => tag.trim()).filter(Boolean)));
}

/** 未解析 URL 的原始记录，供图片清理统计引用 */
export async function readLocalPromptRecords() {
    return (await store.getItem<RawPrompt[]>(LIST_KEY)) || [];
}

export async function listLocalPrompts(): Promise<RawPrompt[]> {
    const items = await readLocalPromptRecords();
    let dirty = false;
    const persisted = items.map((item) => {
        let changed = false;
        let coverUrl = item.coverUrl || "";
        if (coverUrl && !isPersistableCoverUrl(coverUrl)) {
            coverUrl = "";
            changed = true;
        }
        const bundle = item.bundle?.map((entry) => {
            if (!entry.url || isPersistableCoverUrl(entry.url)) return entry;
            changed = true;
            const copy = { ...entry };
            delete copy.url;
            return copy;
        });
        if (!changed) return item;
        dirty = true;
        return { ...item, coverUrl, ...(bundle ? { bundle } : {}) };
    });
    if (dirty) await store.setItem(LIST_KEY, persisted);

    return (
        await Promise.all(
            persisted.map(async (item) => {
                if (!item.bundle?.length) return item;
                const bundle = await resolveBundle(item.bundle);
                return { ...item, bundle, coverUrl: coverFromBundle(bundle) || item.coverUrl };
            }),
        )
    ).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export async function createLocalPrompt(input: LocalPromptInput): Promise<RawPrompt> {
    const now = new Date().toISOString();
    const bundle = (input.bundle || []).map((item) => {
        const next = { ...item };
        delete next.url;
        return next;
    });
    const coverUrl = isPersistableCoverUrl((input.coverUrl || "").trim())
        ? (input.coverUrl || "").trim()
        : isPersistableCoverUrl(coverFromBundle(input.bundle))
          ? coverFromBundle(input.bundle)
          : "";
    const item: RawPrompt = {
        id: nanoid(),
        title: input.title.trim(),
        prompt: input.prompt.trim(),
        description: (input.description || "").trim(),
        coverUrl,
        referenceImageUrls: [],
        tags: normalizeTags(input.tags),
        preview: "",
        createdAt: now,
        updatedAt: now,
        ...(bundle.length ? { bundle } : {}),
        ...(input.generation ? { generation: input.generation } : {}),
    };
    if (!item.title || (!item.prompt && !bundle.length)) throw new Error(i18n.t("prompts.editor.required"));
    const items = await readLocalPromptRecords();
    await store.setItem(LIST_KEY, [item, ...items]);
    return item;
}

export async function updateLocalPrompt(id: string, input: LocalPromptInput): Promise<RawPrompt> {
    const items = await readLocalPromptRecords();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(i18n.t("prompts.editor.missing"));
    const current = items[index];
    const title = input.title.trim();
    const prompt = input.prompt.trim();
    const bundle = ((input.bundle !== undefined ? input.bundle : current.bundle) || []).map((item) => {
        const next = { ...item };
        delete next.url;
        return next;
    });
    if (!title || (!prompt && !bundle.length)) throw new Error(i18n.t("prompts.editor.required"));
    const rawCover =
        input.bundle !== undefined
            ? (input.coverUrl || "").trim() || coverFromBundle(input.bundle)
            : input.coverUrl !== undefined
              ? (input.coverUrl || "").trim()
              : current.coverUrl;
    const coverUrl = isPersistableCoverUrl(rawCover) ? rawCover : "";
    const next: RawPrompt = {
        ...current,
        title,
        prompt,
        description: input.description !== undefined ? (input.description || "").trim() : current.description,
        coverUrl,
        tags: input.tags !== undefined ? normalizeTags(input.tags) : current.tags,
        updatedAt: new Date().toISOString(),
    };
    if (input.bundle !== undefined) {
        if (bundle.length) next.bundle = bundle;
        else delete next.bundle;
    }
    if (input.generation !== undefined) {
        if (input.generation) next.generation = input.generation;
        else delete next.generation;
    }
    const list = items.slice();
    list[index] = next;
    await store.setItem(LIST_KEY, list);
    return next;
}

export async function deleteLocalPrompt(id: string) {
    const items = await readLocalPromptRecords();
    const removed = items.find((item) => item.id === id);
    await store.setItem(
        LIST_KEY,
        items.filter((item) => item.id !== id),
    );
    if (removed?.bundle?.length) {
        const { useAssetStore } = await import("@/stores/use-asset-store");
        useAssetStore.getState().cleanupImages();
    }
}
