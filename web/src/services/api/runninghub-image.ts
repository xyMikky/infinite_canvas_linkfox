import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { findRunninghubImageParams, resolveImageSize, unpackQualityValue } from "@/lib/canvas/image-setting-schema";
import { isMidjourneyImageEndpoint, planMidjourneyRefs } from "@/lib/canvas/midjourney-image-refs";
import type { ReferenceImage } from "@/types/image";
import { RUNNINGHUB_MODELS, RUNNINGHUB_CN_MODELS, RUNNINGHUB_REALISTIC_IMAGE } from "./runninghub-models";
import {
    resolveRunninghubImageUrls,
    runRunninghubEndpoint,
    urlToDataUrl,
    withSystemPrompt,
    type RunninghubConfig,
} from "./runninghub-client";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

function mapAspectRatio(size: string, allowed?: string[]) {
    const value = (size || "").trim().toLowerCase();
    const options = allowed?.length ? allowed : ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
    if (!value || value === "auto") return options.includes("1:1") ? "1:1" : options[0];
    if (value.includes(":")) {
        const hit = options.find((item) => item.toLowerCase() === value);
        if (hit) return hit;
        const [w, h] = value.split(":").map(Number);
        if (w > 0 && h > 0) {
            const ratio = w / h;
            return options
                .map((label) => {
                    const [aw, ah] = label.split(":").map(Number);
                    return { label, value: aw > 0 && ah > 0 ? aw / ah : Number.POSITIVE_INFINITY };
                })
                .reduce((best, item) => (Math.abs(item.value - ratio) < Math.abs(best.value - ratio) ? item : best)).label;
        }
    }
    const dims = value.match(/^(\d+)x(\d+)$/);
    if (dims) {
        const width = Number(dims[1]);
        const height = Number(dims[2]);
        if (width > 0 && height > 0) {
            const ratio = width / height;
            return options
                .map((label) => {
                    const [aw, ah] = label.split(":").map(Number);
                    return { label, value: aw > 0 && ah > 0 ? aw / ah : Number.POSITIVE_INFINITY };
                })
                .reduce((best, item) => (Math.abs(item.value - ratio) < Math.abs(best.value - ratio) ? item : best)).label;
        }
    }
    return options.includes("1:1") ? "1:1" : options[0];
}

function mapSeedreamSize(size: string, quality: string) {
    const dims = (size || "").match(/^(\d+)x(\d+)$/i);
    if (dims) return { width: Number(dims[1]), height: Number(dims[2]) };
    const aspect = mapAspectRatio(size);
    const long = /4k|high|3k/i.test(quality || "") ? 3072 : 2048;
    if (aspect === "16:9") return { width: long, height: Math.round((long * 9) / 16) };
    if (aspect === "9:16") return { width: Math.round((long * 9) / 16), height: long };
    if (aspect === "4:3") return { width: long, height: Math.round((long * 3) / 4) };
    if (aspect === "3:4") return { width: Math.round((long * 3) / 4), height: long };
    return { width: long, height: long };
}

function resolveImageEndpoint(model: string) {
    const endpoint = (model || "").trim().replace(/^\/+/, "");
    if (!endpoint) throw new Error(apiText("runninghubEndpointRequired"));
    return endpoint;
}

/** 普通文生图不带参考图；Midjourney 文生图仍可用 imageUrl / sref。 */
export function isPlainTextToImageEndpoint(modelOrEndpoint: string) {
    const raw = (modelOrEndpoint || "").trim().replace(/^\/+/, "");
    const endpoint = raw.includes("::") ? raw.slice(raw.indexOf("::") + 2) : raw;
    if (isMidjourneyImageEndpoint(endpoint)) return false;
    return endpoint === RUNNINGHUB_REALISTIC_IMAGE || /text-to-image/i.test(endpoint);
}

function pickClosestOption(value: string, options: string[] | undefined, fallback: string) {
    if (!options?.length) return value || fallback;
    if (options.includes(value)) return value;
    return options.includes(fallback) ? fallback : options[0];
}

function appendAspectRatioHint(prompt: string, ratio: string, style: "pixel" | "midjourney" = "pixel") {
    const trimmed = (prompt || "").trim();
    const hint = style === "midjourney" ? `--ar ${ratio}` : `像素比例：${ratio}`;
    if (!trimmed) return hint;
    if (trimmed.includes(hint)) return trimmed;
    return `${trimmed}${style === "midjourney" ? ` ${hint}` : `\n${hint}`}`;
}

/** 避免提示词里的 --ar 与 body.aspectRatio 重复，触发渠道侧参数解析错误（如 ar9）。 */
function stripMidjourneyAspectFlag(prompt: string) {
    return prompt.replace(/\s--ar\s+[^\s]+/gi, "").trim();
}

function buildImagePayload(
    endpoint: string,
    prompt: string,
    config: RunninghubConfig,
    baseImageUrls: string[],
    srefUrl?: string,
) {
    if (endpoint === RUNNINGHUB_REALISTIC_IMAGE) {
        const [width, height] = resolveImageSize({ model: endpoint, size: config.size }).split("x").map(Number);
        if (width <= 0 || height <= 0) throw new Error("图片宽度和高度必须大于 0");
        return {
            nodeInfoList: [
                { nodeId: "3", fieldName: "text", fieldValue: withSystemPrompt(config.systemPrompt || "", prompt) },
                { nodeId: "144", fieldName: "text", fieldValue: String(width) },
                { nodeId: "145", fieldName: "text", fieldValue: String(height) },
            ],
            instanceType: "plus",
            usePersonalQueue: false,
        };
    }
    const params = findRunninghubImageParams(endpoint);
    const byKey = new Map(params.map((item) => [item.fieldKey, item]));
    const packed = unpackQualityValue(config.quality || "");
    const modelParams = config.modelParams || {};
    let requestPrompt = withSystemPrompt(config.systemPrompt || "", prompt);

    const aspectParam = byKey.get("aspectRatio");
    const apiAspectOptions = aspectParam?.options || [];
    const supportsEmptyAspect = apiAspectOptions.includes("empty");
    const supportsLiteralAuto = apiAspectOptions.includes("auto");
    const ratioPresets = apiAspectOptions.filter((item) => item !== "empty" && item !== "auto");
    const rawSize = ((config.size || "").trim() || (typeof modelParams.aspectRatio === "string" ? String(modelParams.aspectRatio).trim() : "")).trim();
    const isAuto = !rawSize || rawSize === "auto" || rawSize === "empty";
    const isCustomRatio = /^\d+(?:\.\d+)?:(\d+(?:\.\d+)?)$/.test(rawSize) && !ratioPresets.includes(rawSize) && rawSize !== "auto" && rawSize !== "empty";
    const isMidjourney = endpoint.startsWith("youchuan/");
    const defaultAspect = String(aspectParam?.defaultValue || ratioPresets[0] || "1:1");

    if (isMidjourney) {
        requestPrompt = stripMidjourneyAspectFlag(requestPrompt);
    }

    // empty 模型：auto/自定义都传 empty；自定义再写进提示词
    if (aspectParam && supportsEmptyAspect && isCustomRatio) {
        requestPrompt = appendAspectRatioHint(requestPrompt, rawSize, "pixel");
    }
    // Midjourney：自定义比例只写 --ar，不再额外传 aspectRatio
    if (aspectParam && isMidjourney && isCustomRatio) {
        requestPrompt = appendAspectRatioHint(requestPrompt, rawSize, "midjourney");
    }

    const payload: Record<string, unknown> = { prompt: requestPrompt };

    if (byKey.has("width") || byKey.has("height") || byKey.has("outputWidth") || byKey.has("outputHeight") || endpoint.includes("seedream")) {
        const size = mapSeedreamSize(config.size || "1:1", packed.resolution || packed.quality || config.quality || "");
        if (byKey.has("width") || endpoint.includes("seedream")) payload.width = size.width;
        if (byKey.has("height") || endpoint.includes("seedream")) payload.height = size.height;
        if (byKey.has("outputWidth")) payload.outputWidth = size.width;
        if (byKey.has("outputHeight")) payload.outputHeight = size.height;
    }

    if (aspectParam) {
        if (isMidjourney && isAuto && !isCustomRatio) {
            // auto：与官方 Playground 一致，不强制比例
        } else if (supportsEmptyAspect && (isAuto || isCustomRatio)) {
            // 注册表里的 empty 表示「不强制比例」——不要传字面量 "empty"，接口会校验失败
        } else if (supportsLiteralAuto && isAuto) {
            payload.aspectRatio = "auto";
        } else if (isCustomRatio) {
            if (!isMidjourney) {
                payload.aspectRatio = mapAspectRatio(rawSize, ratioPresets.length ? ratioPresets : apiAspectOptions);
            }
        } else if (!isAuto) {
            payload.aspectRatio = mapAspectRatio(rawSize, ratioPresets.length ? ratioPresets : apiAspectOptions);
        } else {
            // 当前 size 仍是上一模型的 auto，但本模型不支持 unset → 回退默认比例
            payload.aspectRatio = mapAspectRatio(defaultAspect === "empty" || defaultAspect === "auto" ? "1:1" : defaultAspect, ratioPresets.length ? ratioPresets : apiAspectOptions);
        }
    } else if (!byKey.has("width") && !byKey.has("height") && !endpoint.includes("seedream") && aspectParam) {
        if (rawSize && rawSize !== "auto") payload.aspectRatio = mapAspectRatio(rawSize);
    }

    const sizeParam = byKey.get("size");
    if (sizeParam?.options?.length && !aspectParam) {
        payload.size = pickClosestOption(config.size || String(sizeParam.defaultValue || sizeParam.options[0]), sizeParam.options, sizeParam.options[0]);
    }

    const resolutionParam = byKey.get("resolution");
    if (resolutionParam) {
        const fallback = String(resolutionParam.defaultValue || resolutionParam.options?.[0] || "1k");
        const rawResolution = packed.resolution || packed.quality || fallback;
        if (rawResolution && rawResolution !== "empty" && rawResolution !== "auto") {
            payload.resolution = pickClosestOption(rawResolution, resolutionParam.options, fallback);
        }
    } else if (endpoint.includes("seedream")) {
        payload.resolution = /4k|3k|high/i.test(packed.resolution || packed.quality || config.quality || "") ? "3k" : "2k";
    }

    const qualityParam = byKey.get("quality");
    if (qualityParam) {
        const fallback = String(qualityParam.defaultValue || qualityParam.options?.[0] || "medium");
        payload.quality = pickClosestOption(packed.quality || (!resolutionParam ? packed.resolution || config.quality || fallback : fallback), qualityParam.options, fallback);
    }

    const backgroundParam = byKey.get("background");
    if (backgroundParam) {
        payload.background = pickClosestOption(config.background || "", backgroundParam.options, String(backgroundParam.defaultValue || "auto"));
    }

    const outputFormat = byKey.get("outputFormat");
    if (outputFormat) {
        if (config.background === "transparent" && outputFormat.options?.some((item) => /png/i.test(item))) {
            payload.outputFormat = outputFormat.options.find((item) => /png/i.test(item));
        } else if (outputFormat.defaultValue !== undefined) {
            payload.outputFormat = outputFormat.defaultValue;
        }
    }

    for (const [key, param] of byKey) {
        if (param.type !== "INT" && param.type !== "BOOLEAN") continue;
        if (key === "width" || key === "height" || key === "outputWidth" || key === "outputHeight") continue;
        const raw = modelParams[key] !== undefined ? modelParams[key] : param.defaultValue;
        if (raw === undefined) continue;
        if (param.type === "BOOLEAN") {
            payload[key] = Boolean(raw);
            continue;
        }
        let n = Math.round(Number(raw));
        if (!Number.isFinite(n)) n = Math.round(Number(param.defaultValue) || 0);
        if (typeof param.min === "number") n = Math.max(param.min, n);
        if (typeof param.max === "number") n = Math.min(param.max, n);
        payload[key] = n;
    }

    if (baseImageUrls.length) {
        if (endpoint.includes("/edit") || endpoint.includes("image-to-image") || endpoint.includes("image-edit")) {
            payload.imageUrls = baseImageUrls;
        } else if (isMidjourneyImageEndpoint(endpoint)) {
            payload.imageUrl = baseImageUrls[0];
        }
    }
    if (srefUrl) payload.sref = srefUrl;
    return payload;
}

export type RunninghubImageRefs = {
    baseImageUrls: string[];
    srefUrl?: string;
    requestPromptPrefix?: string;
};

async function resolveRunninghubImageRequestRefs(config: RunninghubConfig, references: ReferenceImage[], signal?: AbortSignal): Promise<RunninghubImageRefs> {
    const isMidjourney = isMidjourneyImageEndpoint(config.model || "");
    const refPlan = isMidjourney ? planMidjourneyRefs(references, config.modelParams) : null;
    const baseRefs = refPlan ? refPlan.baseImages : references;
    const srefRefs = refPlan?.srefImage ? [refPlan.srefImage] : [];
    const baseImageUrls = baseRefs.length ? await resolveRunninghubImageUrls(config, baseRefs, signal) : [];
    const srefUrls = srefRefs.length ? await resolveRunninghubImageUrls(config, srefRefs, signal) : [];
    if (isMidjourney && baseImageUrls.length > 1) {
        return { baseImageUrls: [], srefUrl: srefUrls[0], requestPromptPrefix: baseImageUrls.join(" ") };
    }
    return { baseImageUrls, srefUrl: srefUrls[0] };
}

/** 多任务并发前预上传参考图，避免每个任务重复上传触发 RH 限流/失败。 */
export async function prepareRunninghubImageRefs(config: RunninghubConfig, references: ReferenceImage[], signal?: AbortSignal) {
    return resolveRunninghubImageRequestRefs(config, references, signal);
}

export async function requestRunninghubImages(
    config: RunninghubConfig,
    prompt: string,
    references: ReferenceImage[],
    options?: { signal?: AbortSignal; runninghubImageRefs?: RunninghubImageRefs },
) {
    const ignoreRefs = isPlainTextToImageEndpoint(config.model || "");
    const effectiveReferences = ignoreRefs ? [] : references;
    const isMidjourney = isMidjourneyImageEndpoint(config.model || "");
    const refPlan = isMidjourney ? planMidjourneyRefs(effectiveReferences, config.modelParams) : null;
    const baseRefs = refPlan ? refPlan.baseImages : effectiveReferences;
    const srefRefs = refPlan?.srefImage ? [refPlan.srefImage] : [];
    const endpoint = resolveImageEndpoint(config.model || "rhart-image-n-pro/text-to-image");
    const needsImages = /\/(edit|image-to-image|image-edit)(\b|$)/i.test(endpoint) || endpoint.includes("imageUrls");
    if (needsImages && !baseRefs.length) throw new Error(apiText("runninghubReferenceRequired"));
    const resolved = !ignoreRefs && options?.runninghubImageRefs ? options.runninghubImageRefs : await resolveRunninghubImageRequestRefs(config, effectiveReferences, options?.signal);
    if (needsImages && !resolved.baseImageUrls.length && !resolved.requestPromptPrefix) throw new Error(apiText("runninghubReferenceRequired"));
    const requestPrompt = resolved.requestPromptPrefix ? `${resolved.requestPromptPrefix} ${prompt}`.trim() : prompt;
    const result = await runRunninghubEndpoint(
        config,
        endpoint,
        buildImagePayload(endpoint, requestPrompt, config, resolved.baseImageUrls, resolved.srefUrl),
        options?.signal,
    );
    const images = await Promise.all(
        result.outputs
            .filter((item) => /^https?:\/\//i.test(item) || item.startsWith("data:image"))
            .map(async (url) => ({ id: nanoid(), dataUrl: await urlToDataUrl(url, options?.signal) })),
    );
    if (!images.length) throw new Error(apiText("noImageReturned"));
    return images;
}

export function runninghubModelList(china = false) {
    return (china ? RUNNINGHUB_CN_MODELS : RUNNINGHUB_MODELS).map((model) => model.name);
}
