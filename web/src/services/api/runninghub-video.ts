import i18n from "@/i18n";
import { clampToSeconds, resolveRunninghubVideoFamily, runninghubAllowsVideoAudioRefs, runninghubKlingSeconds } from "@/lib/canvas/video-setting-schema";
import { isRunninghubVideoEditModel } from "@/lib/canvas/video-local-edit-model";
import { boolConfig, seedanceRunninghubDurationOptions } from "@/lib/seedance-video";
import { modelOptionName } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { RUNNINGHUB_MODELS } from "./runninghub-models";
import {
    resolveRunninghubAudioUrls,
    resolveRunninghubImageUrls,
    resolveRunninghubVideoUrls,
    runRunninghubEndpoint,
    withSystemPrompt,
    type RunninghubConfig,
} from "./runninghub-client";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);
const SEEDANCE_SECONDS = [...seedanceRunninghubDurationOptions];

function mapVeoAspectRatio(size: string) {
    const value = (size || "").trim().toLowerCase();
    if (value.includes("9:16") || value === "720x1280" || value === "1080x1920") return "9:16";
    if (value.includes("16:9") || value === "1280x720" || value === "1920x1080") return "16:9";
    if (value.includes(":")) {
        const [w, h] = value.split(":").map(Number);
        if (w > 0 && h > 0) return w / h < 1 ? "9:16" : "16:9";
    }
    return "16:9";
}

function mapKlingAspectRatio(size: string) {
    const value = (size || "").trim();
    if (value === "1:1" || value === "1024x1024") return "1:1";
    if (value.includes("9:16") || value === "720x1280" || value === "1080x1920") return "9:16";
    if (value.includes("16:9") || value === "1280x720" || value === "1920x1080") return "16:9";
    return mapVeoAspectRatio(size);
}

function mapSeedanceRatio(size: string) {
    const value = (size || "").trim();
    if (!value || value === "auto" || value === "adaptive") return "adaptive";
    if (["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"].includes(value)) return value;
    if (value.includes("9:16") || value === "720x1280" || value === "1080x1920") return "9:16";
    if (value.includes("16:9") || value === "1280x720" || value === "1920x1080") return "16:9";
    if (value.includes("1:1") || value === "1024x1024") return "1:1";
    if (value.includes("21:9") || value === "1792x1024") return "21:9";
    const dims = value.match(/^(\d+)x(\d+)$/);
    if (dims) {
        const width = Number(dims[1]);
        const height = Number(dims[2]);
        if (!width || !height) return "adaptive";
        const ratio = width / height;
        const options = [
            ["16:9", 16 / 9],
            ["4:3", 4 / 3],
            ["1:1", 1],
            ["3:4", 3 / 4],
            ["9:16", 9 / 16],
            ["21:9", 21 / 9],
        ] as const;
        return options.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best), options[0])[0];
    }
    return "adaptive";
}

function mapVeoResolution(vquality: string, allow4k: boolean) {
    const raw = (vquality || "720").trim().toLowerCase().replace(/p$/i, "");
    if (allow4k && (raw === "4k" || raw === "2160")) return "4k";
    if (raw === "1080" || raw === "high") return "1080p";
    return "720p";
}

function mapSeedanceResolution(vquality: string) {
    const raw = (vquality || "720").trim().toLowerCase();
    if (raw === "native1080p" || raw === "native1080") return "native1080p";
    if (raw === "native4k" || raw === "native2160") return "native4k";
    if (raw === "2k") return "2k";
    if (raw === "4k" || raw === "2160" || raw === "2160p") return "4k";
    if (raw === "1080" || raw === "1080p" || raw === "high") return "1080p";
    if (raw === "480" || raw === "480p" || raw === "low") return "480p";
    return "720p";
}

function resolveSeedanceMode(endpoint: string): "text-to-video" | "image-to-video" | "multimodal-video" {
    const value = endpoint.toLowerCase();
    if (value.includes("image-to-video")) return "image-to-video";
    if (value.includes("text-to-video")) return "text-to-video";
    return "multimodal-video";
}

function readSeedanceSeed(config: RunninghubConfig) {
    const raw = config.modelParams?.seed;
    if (raw === undefined || raw === null || raw === "") return -1;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.trunc(value) : -1;
}

function isStartEndVideoEndpoint(endpoint: string) {
    return /start-end-to-video|start-to-end/i.test(endpoint);
}

function usesMultiImageVideoRefs(endpoint: string) {
    return /reference-to-video|refrence-to-video|multimodal-to-video|multimodal-video/i.test(endpoint);
}

function attachRunninghubVideoImages(endpoint: string, payload: Record<string, unknown>, imageUrls: string[]) {
    if (!imageUrls.length) return;
    const family = resolveRunninghubVideoFamily(endpoint);
    if (isStartEndVideoEndpoint(endpoint)) {
        payload.firstFrameUrl = imageUrls[0];
        if (imageUrls[1]) payload.lastFrameUrl = imageUrls[1];
        return;
    }
    if (endpoint.startsWith("youchuan/") || family === "kling") {
        payload.imageUrl = imageUrls[0];
        return;
    }
    if (family === "veo-fast" || family === "veo-lite" || family === "veo-pro") {
        payload.imageUrls = imageUrls;
        return;
    }
    if (usesMultiImageVideoRefs(endpoint) && imageUrls.length > 1) {
        payload.imageUrls = imageUrls;
        return;
    }
    if (imageUrls.length === 1) payload.imageUrl = imageUrls[0];
    else payload.imageUrls = imageUrls;
}

function attachRunninghubVideoMedia(
    endpoint: string,
    payload: Record<string, unknown>,
    imageUrls: string[],
    videoUrls: string[],
    audioUrls: string[],
) {
    attachRunninghubVideoImages(endpoint, payload, imageUrls);
    if (videoUrls.length === 1) payload.videoUrl = videoUrls[0];
    else if (videoUrls.length > 1) payload.videoUrls = videoUrls;
    if (audioUrls.length) payload.audioUrl = audioUrls[0];
}

function shouldSendKlingAspectRatio(endpoint: string) {
    return !/image-to-video|start-to-end|start-end|reference-to-video|refrence-to-video/i.test(endpoint);
}

function buildSeedancePayload(config: RunninghubConfig, endpoint: string, prompt: string, imageUrls: string[], videoUrls: string[], audioUrls: string[]) {
    const mode = resolveSeedanceMode(endpoint);
    const base: Record<string, unknown> = {
        prompt,
        resolution: mapSeedanceResolution(config.vquality || "720"),
        duration: clampToSeconds(SEEDANCE_SECONDS, config.videoSeconds || "5"),
        ratio: mapSeedanceRatio(config.size || "adaptive"),
        generateAudio: boolConfig(config.videoGenerateAudio, true),
        returnLastFrame: boolConfig(String(config.modelParams?.returnLastFrame ?? "false"), false),
        seed: readSeedanceSeed(config),
    };
    if (mode === "text-to-video") return base;
    const realPersonMode = boolConfig(config.videoRealPersonMode, true);
    if (mode === "image-to-video") {
        return {
            ...base,
            firstFrameUrl: imageUrls[0],
            ...(imageUrls[1] ? { lastFrameUrl: imageUrls[1] } : {}),
            realPersonMode,
            ...(realPersonMode ? { conversionSlots: ["all"] } : {}),
        };
    }
    return {
        ...base,
        realPersonMode,
        ...(realPersonMode ? { conversionSlots: ["all"] } : {}),
        ...(imageUrls.length ? { imageUrls } : {}),
        ...(videoUrls.length ? { videoUrls } : {}),
        ...(audioUrls.length ? { audioUrls } : {}),
    };
}

function buildFamilyPayload(config: RunninghubConfig, endpoint: string, prompt: string, imageUrls: string[], videoUrls: string[], audioUrls: string[]) {
    const family = resolveRunninghubVideoFamily(endpoint);
    const text = (prompt || "").trim();
    if (isRunninghubVideoEditModel(endpoint)) {
        return {
            prompt: withSystemPrompt(config.systemPrompt || "", text),
            videoUrl: videoUrls[0],
            ...(imageUrls.length ? { imageUrls } : {}),
            keepOriginalSound: boolConfig(config.videoGenerateAudio, true),
        };
    }
    if (family === "seedance") return buildSeedancePayload(config, endpoint, text, imageUrls, videoUrls, audioUrls);
    if (family === "kling") {
        const payload: Record<string, unknown> = {
            prompt: text,
            duration: clampToSeconds(runninghubKlingSeconds(endpoint), config.videoSeconds || "5"),
            sound: boolConfig(config.videoGenerateAudio, true),
        };
        if (shouldSendKlingAspectRatio(endpoint)) {
            payload.aspectRatio = mapKlingAspectRatio(config.size || "16:9");
        }
        attachRunninghubVideoImages(endpoint, payload, imageUrls);
        return payload;
    }
    if (family === "youchuan") {
        const payload: Record<string, unknown> = { prompt: text };
        attachRunninghubVideoImages(endpoint, payload, imageUrls);
        return payload;
    }
    if (family === "veo-lite") {
        const payload: Record<string, unknown> = {
            prompt: text,
            aspectRatio: mapVeoAspectRatio(config.size || "16:9"),
            resolution: mapVeoResolution(config.vquality || "1080", false),
            duration: clampToSeconds([4, 6, 8], config.videoSeconds || "6"),
        };
        attachRunninghubVideoImages(endpoint, payload, imageUrls);
        return payload;
    }
    if (family === "veo-pro") {
        const payload: Record<string, unknown> = {
            prompt: text,
            aspectRatio: mapVeoAspectRatio(config.size || "16:9"),
            resolution: mapVeoResolution(config.vquality || "720", true),
            duration: clampToSeconds([4, 6, 8], config.videoSeconds || "8"),
            generateAudio: boolConfig(config.videoGenerateAudio, false),
        };
        attachRunninghubVideoImages(endpoint, payload, imageUrls);
        return payload;
    }
    if (family === "veo-fast") {
        const payload: Record<string, unknown> = {
            prompt: text,
            aspectRatio: mapVeoAspectRatio(config.size || "16:9"),
            resolution: mapVeoResolution(config.vquality || "720", true),
            duration: "8",
        };
        attachRunninghubVideoImages(endpoint, payload, imageUrls);
        if (/official/.test(endpoint)) payload.generateAudio = boolConfig(config.videoGenerateAudio, true);
        return payload;
    }
    return null;
}

function buildGenericPayload(config: RunninghubConfig, endpoint: string, prompt: string, imageUrls: string[], videoUrls: string[], audioUrls: string[]) {
    const def = RUNNINGHUB_MODELS.find((item) => item.name === endpoint);
    const params = def?.params || [];
    const payload: Record<string, unknown> = { prompt: withSystemPrompt(config.systemPrompt || "", prompt) };
    if (!params.length) {
        attachRunninghubVideoMedia(endpoint, payload, imageUrls, videoUrls, audioUrls);
        return payload;
    }

    const byKey = new Map(params.map((item) => [item.fieldKey, item]));
    const modelParams = config.modelParams || {};
    if (byKey.has("duration")) {
        payload.duration = clampToSeconds([3, 4, 5, 6, 7, 8, 9, 10], config.videoSeconds || "5");
    }
    const size = (config.size || "").trim();
    if (size && size !== "auto" && byKey.has("aspectRatio")) {
        payload.aspectRatio = size;
    }
    if (config.vquality && byKey.has("resolution")) {
        payload.resolution = config.vquality;
    }
    if (byKey.has("generateAudio")) payload.generateAudio = boolConfig(config.videoGenerateAudio, true);
    if (byKey.has("watermark")) payload.watermark = boolConfig(config.videoWatermark, false);
    if (byKey.has("realPersonMode")) {
        const realPersonMode = boolConfig(config.videoRealPersonMode, true);
        payload.realPersonMode = realPersonMode;
        if (realPersonMode) payload.conversionSlots = ["all"];
    }
    for (const param of params) {
        if (param.type !== "INT" && param.type !== "BOOLEAN" && param.type !== "LIST") continue;
        const raw = modelParams[param.fieldKey] !== undefined ? modelParams[param.fieldKey] : param.defaultValue;
        if (raw === undefined) continue;
        if (param.type === "BOOLEAN") {
            payload[param.fieldKey] = Boolean(raw);
            continue;
        }
        if (param.type === "INT") {
            let n = Math.round(Number(raw));
            if (!Number.isFinite(n)) n = Math.round(Number(param.defaultValue) || 0);
            if (typeof param.min === "number") n = Math.max(param.min, n);
            if (typeof param.max === "number") n = Math.min(param.max, n);
            payload[param.fieldKey] = n;
            continue;
        }
        payload[param.fieldKey] = raw;
    }
    attachRunninghubVideoMedia(endpoint, payload, imageUrls, videoUrls, audioUrls);
    return payload;
}

function resolveVideoEndpoint(model: string, imageCount: number, hasVideo: boolean) {
    const endpoint = (model || "").trim().replace(/^\/+/, "");
    if (!endpoint) throw new Error(apiText("runninghubEndpointRequired"));
    const known = new Set(RUNNINGHUB_MODELS.map((item) => item.name));
    const family = resolveRunninghubVideoFamily(endpoint);
    if (family === "seedance" || family === "kling" || family === "youchuan" || endpoint.includes("multimodal-video")) return endpoint;
    if (hasVideo && endpoint.endsWith("/text-to-video")) {
        const edit = endpoint.replace(/\/text-to-video$/, "/video-edit");
        if (known.has(edit)) return edit;
    }
    if (imageCount >= 2 && endpoint.endsWith("/text-to-video")) {
        const startEnd = endpoint.replace(/\/text-to-video$/, "/start-end-to-video");
        if (known.has(startEnd)) return startEnd;
        const startToEnd = endpoint.replace(/\/text-to-video$/, "/start-to-end");
        if (known.has(startToEnd)) return startToEnd;
    }
    if (imageCount > 0 && endpoint.endsWith("/text-to-video")) {
        const i2v = endpoint.replace(/\/text-to-video$/, "/image-to-video");
        if (known.has(i2v)) return i2v;
    }
    return endpoint;
}

export async function requestRunninghubVideo(
    config: RunninghubConfig,
    prompt: string,
    references: ReferenceImage[] = [],
    videoReferences: ReferenceVideo[] = [],
    audioReferences: ReferenceAudio[] = [],
    signal?: AbortSignal,
) {
    const model = modelOptionName(config.model || "");
    const allowsMedia = runninghubAllowsVideoAudioRefs(model);
    const videoEdit = isRunninghubVideoEditModel(model);
    if (videoEdit) {
        if (videoReferences.length !== 1) throw new Error("视频编辑需要且只能连接一个视频");
        if (references.length > 4) throw new Error("Kling O3 视频编辑最多支持 4 张参考图");
        if (audioReferences.length) throw new Error("Kling O3 视频编辑不支持独立参考音频");
    }
    if (!allowsMedia && ((!videoEdit && videoReferences.length) || audioReferences.length)) throw new Error(apiText("runninghubVideoOnlyImages"));
    if (allowsMedia && audioReferences.length && !references.length && !videoReferences.length) throw new Error(apiText("seedanceAudioRequiresVisual"));

    const endpoint = resolveVideoEndpoint(model, references.length, videoReferences.length > 0);
    const family = resolveRunninghubVideoFamily(endpoint);
    const needsImage = /image-to-video|start-end|reference-to-video|multimodal/i.test(endpoint);
    const needsVideo = /video-edit|video-extend|video-to-video|lip-sync|motion-control/i.test(endpoint);
    if (needsImage && !references.length && !/text-to-video/i.test(endpoint) && family !== "seedance") throw new Error(apiText("runninghubReferenceRequired"));
    if (family === "seedance" && /image-to-video/i.test(endpoint) && !references.length) throw new Error(apiText("runninghubVideoReferenceRequired"));
    if (needsVideo && !videoReferences.length) throw new Error(apiText("runninghubReferenceRequired"));

    const imageUrls = references.length ? await resolveRunninghubImageUrls(config, references, signal) : [];
    if (videoEdit && imageUrls.length !== references.length) throw new Error("视频编辑参考图读取失败，请重新选择参考图");
    const videoUrls = (allowsMedia || videoEdit) && videoReferences.length ? await resolveRunninghubVideoUrls(config, videoReferences, signal) : [];
    const audioUrls = allowsMedia && audioReferences.length ? await resolveRunninghubAudioUrls(config, audioReferences, signal) : [];
    const payload = buildFamilyPayload(config, endpoint, prompt, imageUrls, videoUrls, audioUrls) || buildGenericPayload(config, endpoint, prompt, imageUrls, videoUrls, audioUrls);

    const result = await runRunninghubEndpoint(config, endpoint, payload, signal);
    const url = result.outputs.find((item) => /^https?:\/\//i.test(item) || item.startsWith("data:"));
    if (!url) throw new Error(apiText("runninghubVideoNoResult"));
    return { url, mimeType: "video/mp4" };
}
