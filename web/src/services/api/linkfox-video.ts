import axios from "axios";

import i18n from "@/i18n";
import { boolConfig } from "@/lib/seedance-video";
import { linkfoxVideoModel } from "@/lib/linkfox-video";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { requestLinkfoxVideoV3 } from "./linkfox-video-v3";
import {
    assertLinkfoxConfig,
    createLinkfoxTask,
    LINKFOX_VIDEO_MAX_POLL_TIME_MS,
    pollLinkfoxUntilDone,
    resolveImageUrls,
    type LinkfoxRequestConfig,
} from "./linkfox-client";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

const SINGLE_PATH = "/aigc/videoGenAsync";
const MULTI_PATH = "/aigc/multiImageVideoGenAsync";

const MULTI_MODELS = new Set(["KLING", "SEED", "SEED_FAST", "HAPPY_HORSE"]);
const SINGLE_MODELS = new Set(["KLING", "WAN", "SEED", "SEED_FAST", "HAILUO"]);

const VIDEO_TIME_OPTIONS: Record<string, number[]> = {
    KLING: [5, 10],
    WAN: [5, 10, 15],
    SEED: [5, 10, 15],
    SEED_FAST: [5, 10, 15],
    HAILUO: [6, 10],
    HAPPY_HORSE: [5, 10, 15],
};

export type LinkfoxVideoResult = { blob?: Blob; url?: string; mimeType?: string };

function normalizeVideoType(model: string) {
    const value = (model || "KLING").trim().toUpperCase() || "KLING";
    if (SINGLE_MODELS.has(value) || MULTI_MODELS.has(value)) return value;
    throw new Error(apiText("linkfoxVideoModelUnsupported", { model: value }));
}

function clampVideoTime(videoType: string, seconds: string) {
    const options = VIDEO_TIME_OPTIONS[videoType] || [5, 10];
    const requested = Math.floor(Number(seconds) || options[0]);
    return options.reduce((best, item) => (Math.abs(item - requested) < Math.abs(best - requested) ? item : best));
}

function mapVideoAspectRatio(size: string, videoType: string): "16:9" | "9:16" | undefined {
    if (videoType === "WAN" || videoType === "HAILUO") return undefined;
    const value = (size || "").trim().toLowerCase();
    if (value.includes("9:16") || value === "720x1280" || value === "1080x1920") return "9:16";
    if (value.includes("16:9") || value === "1280x720" || value === "1920x1080") return "16:9";
    if (value.includes(":")) {
        const [w, h] = value.split(":").map(Number);
        if (w > 0 && h > 0) return w / h < 1 ? "9:16" : "16:9";
    }
    const dims = value.match(/^(\d+)x(\d+)$/);
    if (dims) {
        const width = Number(dims[1]);
        const height = Number(dims[2]);
        if (width > 0 && height > 0) return width / height < 1 ? "9:16" : "16:9";
    }
    return "16:9";
}

function mapVideoResolution(vquality: string, videoType: string): string | undefined {
    if (videoType === "WAN") return undefined;
    const raw = (vquality || "720").replace(/p$/i, "").toLowerCase();
    const asNumber = Number(raw);
    if (videoType === "HAILUO") {
        if (asNumber >= 1000 || raw === "1080" || raw === "high") return "1080p";
        return "768p";
    }
    if (videoType === "SEED_FAST") {
        if (asNumber <= 480 || raw === "low") return "480p";
        return "720p";
    }
    if (videoType === "SEED" || videoType === "HAPPY_HORSE") {
        if (asNumber <= 480 || raw === "low") return "480p";
        if (asNumber >= 1000 || raw === "1080" || raw === "high") return "1080p";
        return "720p";
    }
    // KLING
    if (asNumber >= 1000 || raw === "1080" || raw === "high") return "1080p";
    return "720p";
}

function supportsPro(videoType: string) {
    return videoType === "KLING" || videoType === "SEED" || videoType === "HAILUO";
}

function supportsVoice(videoType: string, multi: boolean) {
    if (multi) return videoType === "SEED" || videoType === "SEED_FAST";
    return videoType === "WAN" || videoType === "SEED" || videoType === "SEED_FAST";
}

function supportsLastFrame(videoType: string, isPro: boolean) {
    if (videoType === "WAN" || videoType === "SEED" || videoType === "SEED_FAST") return true;
    if (videoType === "KLING") return isPro;
    return false;
}

async function resultToVideo(url: string, signal?: AbortSignal): Promise<LinkfoxVideoResult> {
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal, timeout: 180_000 });
        if (response.data?.type?.includes("json")) return { url, mimeType: "video/mp4" };
        return { blob: response.data, mimeType: response.data.type || "video/mp4" };
    } catch (error) {
        if (signal?.aborted || axios.isCancel(error)) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

export async function requestLinkfoxVideo(
    config: LinkfoxRequestConfig,
    prompt: string,
    references: ReferenceImage[],
    options?: { signal?: AbortSignal; videoReferences?: ReferenceVideo[]; audioReferences?: ReferenceAudio[] },
): Promise<LinkfoxVideoResult> {
    assertLinkfoxConfig(config);
    const model = linkfoxVideoModel(config.model);
    const videos = options?.videoReferences || [];
    const audios = options?.audioReferences || [];
    if (model) return resultToVideo(await requestLinkfoxVideoV3(config, model, prompt, references, videos, audios, options?.signal), options?.signal);
    if (videos.length || audios.length) throw new Error(apiText("videoReferencesUnsupported"));
    const videoType = normalizeVideoType(config.model || "KLING");
    if (!references.length) throw new Error(apiText("linkfoxVideoReferenceRequired"));

    const imageUrls = await resolveImageUrls(config, references, options?.signal);
    if (!imageUrls.length) throw new Error(apiText("linkfoxVideoReferenceRequired"));

    const videoTime = clampVideoTime(videoType, config.videoSeconds || "5");
    const quality = (config.quality || config.vquality || "").toLowerCase();
    const isPro = supportsPro(videoType) && (quality.includes("high") || quality === "1080" || quality === "1080p" || config.vquality === "1080");
    const useMulti = videoType === "HAPPY_HORSE" || (imageUrls.length >= 2 && MULTI_MODELS.has(videoType));
    const voice = supportsVoice(videoType, useMulti) && boolConfig(config.videoGenerateAudio, true);
    const aspectRatio = mapVideoAspectRatio(config.size || "16:9", videoType);
    const resolution = mapVideoResolution(config.vquality || "720", videoType);

    let path = SINGLE_PATH;
    let body: Record<string, unknown>;

    if (useMulti) {
        const limit = videoType === "KLING" ? 7 : 9;
        path = MULTI_PATH;
        body = {
            imageList: imageUrls.slice(0, limit),
            videoType,
            videoTime,
            prompt: (prompt || "").slice(0, 2000),
            promptOptimizer: false,
            isPro: supportsPro(videoType) ? isPro : false,
            voice,
            ...(aspectRatio ? { aspectRatio } : {}),
            ...(resolution ? { resolution } : {}),
        };
    } else {
        if (!SINGLE_MODELS.has(videoType)) throw new Error(apiText("linkfoxVideoMultiOnly", { model: videoType }));
        const imageUrl = imageUrls[0];
        const lastFrame = imageUrls.length >= 2 && supportsLastFrame(videoType, isPro) ? imageUrls[1] : undefined;
        body = {
            imageUrl,
            videoType,
            videoTime,
            prompt: (prompt || "").slice(0, 2000),
            promptOptimizer: false,
            isPro: supportsPro(videoType) ? isPro : false,
            voice: supportsVoice(videoType, false) ? voice : false,
            ...(lastFrame ? { lastFrameImageUrl: lastFrame } : {}),
            ...(aspectRatio ? { aspectRatio } : {}),
            ...(resolution ? { resolution } : {}),
        };
    }

    const created = await createLinkfoxTask(config, path, body, options?.signal);
    const done = await pollLinkfoxUntilDone(config, created.taskId!, {
        signal: options?.signal,
        maxPollTimeMs: LINKFOX_VIDEO_MAX_POLL_TIME_MS,
    });
    const url = (done.resultList || []).find((item) => item?.url)?.url;
    if (!url) throw new Error(apiText("linkfoxVideoNoResult"));
    return resultToVideo(url, options?.signal);
}
