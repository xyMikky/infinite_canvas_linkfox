import { isSeedanceVideoConfig, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { RUNNINGHUB_MODELS, RUNNINGHUB_REALISTIC_IMAGE } from "@/services/api/runninghub-models";
import { resolveAudioMediaSlots } from "@/lib/canvas/audio-setting-schema";
import { linkfoxImageModel } from "@/lib/linkfox-image";
import { linkfoxVideoFirstLast, linkfoxVideoModel } from "@/lib/linkfox-video";
import { isRunninghubVideoEditModel } from "@/lib/canvas/video-local-edit-model";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { CanvasGenerationMode } from "@/types/canvas";

export type MediaSlotSpec = { min: number; max: number };
export type ModelInputSpec = {
    prompt?: boolean;
    images?: MediaSlotSpec;
    videos?: MediaSlotSpec;
    audios?: MediaSlotSpec;
};

const IMAGE_SLOT_MAX = 10;
const LINKFOX_VIDEO_MULTI = new Set(["KLING", "SEED", "SEED_FAST", "HAPPY_HORSE"]);

export function resolveModelInputSpec(config: AiConfig, mode: CanvasGenerationMode): ModelInputSpec {
    const request = resolveModelRequestConfig(config, config.model || "");
    const endpoint = modelOptionName(config.model || "").toLowerCase();
    if (mode === "text") return { prompt: true };
    if (mode === "audio") return { prompt: true, ...resolveAudioMediaSlots(config) };
    if (mode === "model") return resolveModel3dInputSpec(endpoint);
    if (mode === "image") return resolveImageInputSpec(request.apiFormat, endpoint);
    return resolveVideoInputSpec(config, request.apiFormat, endpoint);
}

function resolveModel3dInputSpec(endpoint: string): ModelInputSpec {
    if (/text-to-3d/i.test(endpoint)) return { prompt: true };
    if (/multi-image-to-3d/i.test(endpoint)) return { prompt: false, images: { min: 2, max: 4 } };
    if (/hunyuan3d/i.test(endpoint)) return { prompt: false, images: { min: 1, max: 8 } };
    return { prompt: false, images: { min: 1, max: 1 } };
}

function resolveImageInputSpec(apiFormat: string, endpoint: string): ModelInputSpec {
    if (apiFormat === "runninghub" && endpoint === RUNNINGHUB_REALISTIC_IMAGE) return { prompt: true };
    if (apiFormat === "linkfox") {
        const spec = linkfoxImageModel(endpoint);
        if (spec && spec.references <= 0) return { prompt: true };
        return { prompt: true, images: { min: 0, max: spec?.references || IMAGE_SLOT_MAX } };
    }
    if (apiFormat === "runninghub") {
        const needsImage = /\/(edit|image-to-image|image-edit)(\b|$)/i.test(endpoint) || endpoint.includes("image-to-image");
        const maxImages = RUNNINGHUB_MODELS.find((model) => model.name === endpoint)?.maxImages;
        return { prompt: true, images: { min: needsImage ? 1 : 0, max: maxImages ?? (isSingularImageUrl(endpoint) ? 1 : IMAGE_SLOT_MAX) } };
    }
    return { prompt: true, images: { min: 0, max: IMAGE_SLOT_MAX } };
}

function resolveVideoInputSpec(config: AiConfig, apiFormat: string, endpoint: string): ModelInputSpec {
    if (apiFormat === "runninghub" && isRunninghubVideoEditModel(endpoint)) {
        return { prompt: true, images: { min: 0, max: 4 }, videos: { min: 1, max: 1 } };
    }
    if (isSeedanceVideoConfig(config)) {
        return { prompt: true, images: { min: 0, max: SEEDANCE_REFERENCE_LIMITS.images }, videos: { min: 0, max: SEEDANCE_REFERENCE_LIMITS.videos }, audios: { min: 0, max: SEEDANCE_REFERENCE_LIMITS.audios } };
    }
    if (apiFormat === "runninghub" && (endpoint.includes("seedance") || endpoint.includes("sparkvideo"))) {
        if (/text-to-video/i.test(endpoint)) return { prompt: true };
        if (/image-to-video/i.test(endpoint)) return { prompt: true, images: { min: 1, max: 2 } };
        return { prompt: true, images: { min: 0, max: SEEDANCE_REFERENCE_LIMITS.images }, videos: { min: 0, max: SEEDANCE_REFERENCE_LIMITS.videos }, audios: { min: 0, max: SEEDANCE_REFERENCE_LIMITS.audios } };
    }
    if (/multimodal-video|multimodal-to-video/i.test(endpoint)) {
        return { prompt: true, images: { min: 0, max: SEEDANCE_REFERENCE_LIMITS.images }, videos: { min: 0, max: SEEDANCE_REFERENCE_LIMITS.videos }, audios: { min: 0, max: SEEDANCE_REFERENCE_LIMITS.audios } };
    }
    if (apiFormat === "linkfox") {
        const model = linkfoxVideoModel(config.model || config.videoModel);
        if (model) {
            const frames = linkfoxVideoFirstLast(model, config.videoReferenceMode);
            return {
                prompt: true,
                images: { min: frames || (!model.text && !model.videos && !model.audioOnly) ? 1 : 0, max: frames ? 2 : model.images },
                ...(!frames && model.videos ? { videos: { min: 0, max: SEEDANCE_REFERENCE_LIMITS.videos } } : {}),
                ...(!frames && model.audios ? { audios: { min: 0, max: model.audios } } : {}),
            };
        }
        const family = modelOptionName(config.model || "").toUpperCase();
        return { prompt: true, images: { min: 1, max: family === "KLING" ? 7 : LINKFOX_VIDEO_MULTI.has(family) ? 9 : 2 } };
    }
    if (apiFormat === "runninghub") {
        const needsImage = /image-to-video|reference-to-video|start-end-to-video/i.test(endpoint);
        return { prompt: true, images: { min: needsImage ? 1 : 0, max: isSingularImageUrl(endpoint) ? 1 : IMAGE_SLOT_MAX } };
    }
    return { prompt: true, images: { min: 0, max: IMAGE_SLOT_MAX } };
}

function isSingularImageUrl(endpoint: string) {
    return endpoint.includes("imageurl") && !endpoint.includes("imageurls");
}
