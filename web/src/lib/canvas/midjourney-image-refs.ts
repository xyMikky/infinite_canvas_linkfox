import type { ReferenceImage } from "@/types/image";

/** 未勾选的底图 id（逗号分隔）；缺省表示全部勾选。 */
export const MJ_BASE_EXCLUDED_IDS_KEY = "mjBaseExcludedIds";
/** 是否启用风格参考 sref。 */
export const MJ_SREF_ENABLED_KEY = "mjSrefEnabled";
/** 用作 sref 的参考图 id。 */
export const MJ_SREF_IMAGE_ID_KEY = "mjSrefImageId";

export type MidjourneyRefPlan = {
    baseImages: ReferenceImage[];
    srefImage: ReferenceImage | null;
};

function parseIdList(raw: unknown): string[] {
    if (raw === undefined || raw === null || raw === "") return [];
    return String(raw)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

/** Midjourney（悠船）单次任务固定返回的变体张数。 */
export const MIDJOURNEY_IMAGES_PER_TASK = 4;

export function isMidjourneyImageEndpoint(modelOrEndpoint: string) {
    const raw = modelOrEndpoint.replace(/^\/+/, "");
    const endpoint = raw.includes("::") ? raw.slice(raw.indexOf("::") + 2) : raw;
    return endpoint.replace(/^\/+/, "").startsWith("youchuan/");
}

export function readMjBaseExcludedIds(modelParams?: Record<string, string | number | boolean> | null) {
    return new Set(parseIdList(modelParams?.[MJ_BASE_EXCLUDED_IDS_KEY]));
}

export function resolveMjBaseImageIds(referenceIds: string[], modelParams?: Record<string, string | number | boolean> | null) {
    const excluded = readMjBaseExcludedIds(modelParams);
    return referenceIds.filter((id) => !excluded.has(id));
}

export function isMjSrefEnabled(modelParams?: Record<string, string | number | boolean> | null) {
    return Boolean(modelParams?.[MJ_SREF_ENABLED_KEY]);
}

export function resolveMjSrefImageId(referenceIds: string[], modelParams?: Record<string, string | number | boolean> | null) {
    if (!isMjSrefEnabled(modelParams) || !referenceIds.length) return "";
    const stored = String(modelParams?.[MJ_SREF_IMAGE_ID_KEY] || "").trim();
    if (stored && referenceIds.includes(stored)) return stored;
    return referenceIds[0] || "";
}

export function toggleMjBaseImageExcluded(
    modelParams: Record<string, string | number | boolean> | undefined,
    imageId: string,
    checked: boolean,
    allIds: string[],
) {
    const excluded = readMjBaseExcludedIds(modelParams);
    if (checked) excluded.delete(imageId);
    else excluded.add(imageId);
    return [...excluded].filter((id) => allIds.includes(id)).join(",");
}

export function planMidjourneyRefs(references: ReferenceImage[], modelParams?: Record<string, string | number | boolean> | null): MidjourneyRefPlan {
    const ids = references.map((item) => item.id);
    const byId = new Map(references.map((item) => [item.id, item]));
    const baseIds = resolveMjBaseImageIds(ids, modelParams);
    const srefId = resolveMjSrefImageId(ids, modelParams);
    return {
        baseImages: baseIds.map((id) => byId.get(id)).filter((item): item is ReferenceImage => Boolean(item)),
        srefImage: srefId ? byId.get(srefId) || null : null,
    };
}
