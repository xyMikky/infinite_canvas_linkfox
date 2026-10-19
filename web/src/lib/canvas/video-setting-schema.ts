import { isSeedanceVideoConfig, seedanceDurationOptions, seedanceRatioOptions, seedanceResolutionOptions, seedanceRunninghubDurationOptions } from "@/lib/seedance-video";
import { RUNNINGHUB_MODELS } from "@/services/api/runninghub-models";
import { klingArgumentsForTool } from "@/services/api/kling-cli";
import { linkfoxVideoModel } from "@/lib/linkfox-video";
import { isDreaminaModel, isKlingModel, modelOptionName, resolveChannelModel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export type VideoSizeOption = { value: string; labelKey: string; width: number; height: number };

export type VideoSettingSchema = {
    source: "seedance" | "runninghub" | "linkfox" | "kling" | "dreamina" | "generic";
    resolutions: Array<{ value: string; label: string }>;
    allowCustomResolution: boolean;
    sizes: VideoSizeOption[];
    allowCustomDimensions: boolean;
    seconds: number[];
    allowCustomSeconds: boolean;
    secondsMin?: number;
    secondsMax?: number;
    showGenerateAudio: boolean;
    showWatermark: boolean;
    showRealPersonMode: boolean;
};

export type RunninghubVideoFamily = "seedance" | "veo-fast" | "veo-lite" | "veo-pro" | "kling" | "youchuan" | "generic";

const GENERIC_SIZES: VideoSizeOption[] = [
    { value: "1280x720", labelKey: "sizes.landscape", width: 1280, height: 720 },
    { value: "720x1280", labelKey: "sizes.portrait", width: 720, height: 1280 },
    { value: "1024x1024", labelKey: "sizes.square", width: 1024, height: 1024 },
    { value: "1792x1024", labelKey: "sizes.widescreen", width: 1792, height: 1024 },
    { value: "1024x1792", labelKey: "sizes.tall", width: 1024, height: 1792 },
    { value: "auto", labelKey: "sizes.auto", width: 0, height: 0 },
];

const GENERIC_RESOLUTIONS = [
    { value: "720", label: "720p" },
    { value: "480", label: "480p" },
];

const RATIO_SIZE: Record<string, VideoSizeOption> = {
    "16:9": { value: "16:9", labelKey: "ratios.landscape", width: 16, height: 9 },
    "9:16": { value: "9:16", labelKey: "ratios.portrait", width: 9, height: 16 },
    "1:1": { value: "1:1", labelKey: "ratios.square", width: 1, height: 1 },
    "4:3": { value: "4:3", labelKey: "ratios.standardLandscape", width: 4, height: 3 },
    "3:4": { value: "3:4", labelKey: "ratios.standardPortrait", width: 3, height: 4 },
    "21:9": { value: "21:9", labelKey: "ratios.cinematic", width: 21, height: 9 },
    adaptive: { value: "adaptive", labelKey: "adaptive", width: 0, height: 0 },
    auto: { value: "auto", labelKey: "adaptive", width: 0, height: 0 },
};

const KLING_V2_SECONDS = [5, 10];
const KLING_V3_SECONDS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export function analyzeSecondsControl(options: number[]) {
    const smart = options.includes(-1);
    const positive = options.filter((item) => item > 0).sort((a, b) => a - b);
    const min = positive[0] || 1;
    const max = positive[positive.length - 1] || min;
    const consecutive = positive.length >= 4 && positive.every((item, index) => index === 0 || item === positive[index - 1] + 1);
    return {
        mode: consecutive ? ("slider" as const) : ("pills" as const),
        min,
        max,
        smart,
        options: positive,
    };
}

export function resolveRunninghubVideoFamily(endpoint: string): RunninghubVideoFamily {
    const value = endpoint.toLowerCase();
    if (value.includes("seedance") || value.includes("sparkvideo")) return "seedance";
    if (value.includes("v3.1-fast") || value.includes("veo3.1-fast")) return "veo-fast";
    if (value.includes("v3.1-lite") || value.includes("veo3.1-lite")) return "veo-lite";
    if (value.includes("v3.1-pro") || value.includes("veo3.1-pro")) return "veo-pro";
    if (value.includes("kling")) return "kling";
    if (value.startsWith("youchuan/")) return "youchuan";
    return "generic";
}

/** RunningHub 仅 multimodal 系列支持参考视频/音频。 */
export function runninghubAllowsVideoAudioRefs(model: string) {
    return /multimodal-video|multimodal-to-video/i.test(model);
}

export function seedanceSupportsRealPersonMode(endpoint: string) {
    if (resolveRunninghubVideoFamily(endpoint) !== "seedance") return false;
    return !/text-to-video/i.test(endpoint);
}

export function runninghubKlingSeconds(endpoint: string) {
    return /kling-v3|kling-video-o3|kling-o3|\/v3/.test(endpoint.toLowerCase()) ? KLING_V3_SECONDS : KLING_V2_SECONDS;
}

export function clampToSeconds(options: number[], value: string, fallback = 5) {
    if (String(value).trim() === "-1" && options.includes(-1)) return "-1";
    const positive = options.filter((item) => item > 0);
    if (!positive.length) return String(fallback);
    const requested = Math.floor(Number(value) || positive[0] || fallback);
    return String(positive.reduce((best, item) => (Math.abs(item - requested) < Math.abs(best - requested) ? item : best), positive[0]));
}

export function resolveVideoSettingSchema(config: AiConfig): VideoSettingSchema {
    const selectedModel = config.model || config.videoModel;
    const request = resolveModelRequestConfig(config, selectedModel);
    const linkfox = request.apiFormat === "linkfox" ? linkfoxVideoModel(selectedModel) : undefined;
    if (linkfox) return {
        source: "linkfox",
        resolutions: linkfox.resolutions.map((value) => ({ value, label: value })),
        allowCustomResolution: false,
        sizes: (linkfox.ratios.length ? linkfox.ratios : ["adaptive"]).map((value) => RATIO_SIZE[value]),
        allowCustomDimensions: false,
        seconds: linkfox.seconds,
        allowCustomSeconds: false,
        showGenerateAudio: Boolean(linkfox.voice),
        showWatermark: false,
        showRealPersonMode: false,
    };
    if (isKlingModel(selectedModel)) {
        const model = resolveChannelModel(config, selectedModel);
        const byName = new Map((model?.klingArguments || []).map((item) => [item.name, item]));
        const find = (...names: string[]) => names.map((name) => byName.get(name)).find(Boolean);
        const resolution = find("resolution");
        const duration = find("duration", "seconds");
        // 图生视频多数模型不声明 aspect_ratio（跟输入图）；文生/部分 Omni 仅有固定比例。请求侧选 adaptive 时不传该参数。
        const aspectValues = new Set<string>();
        for (const tool of ["text_to_video", "image_to_video"] as const) {
            const aspect = klingArgumentsForTool(model, tool).find((item) => ["aspect_ratio", "aspectRatio", "ratio"].includes(item.name));
            for (const value of aspect?.allowedValues || []) aspectValues.add(value);
        }
        const fixedSizes = [...aspectValues]
            .map((value) => RATIO_SIZE[value] || { value, labelKey: "adaptive", width: 0, height: 0 })
            .filter((item) => item.value && item.value !== "auto" && item.value !== "adaptive");
        const sizes = [RATIO_SIZE.adaptive, ...fixedSizes];
        const seconds = (duration?.allowedValues || []).map(Number).filter((value) => Number.isFinite(value));
        return {
            source: "kling",
            resolutions: (resolution?.allowedValues || []).map((value) => ({ value, label: /p$/i.test(value) ? value : `${value}p` })),
            allowCustomResolution: false,
            sizes,
            allowCustomDimensions: false,
            seconds,
            allowCustomSeconds: Boolean(duration && !duration.allowedValues?.length),
            showGenerateAudio: Boolean(find("enable_audio", "enableAudio", "generateAudio", "generate_audio")),
            showWatermark: Boolean(find("watermark")),
            showRealPersonMode: false,
        };
    }
    if (isDreaminaModel(selectedModel)) {
        const model = resolveChannelModel(config, selectedModel);
        const resolutions = model?.dreaminaResolutions?.length ? model.dreaminaResolutions : ["720p"];
        // 图生视频 ratio 由输入图推断；文生可选手动比例。UI 始终提供「自适应」。
        const fixedRatios = model?.dreaminaRatios?.length
            ? model.dreaminaRatios
            : model?.dreaminaTools?.includes("text2video")
              ? ["1:1", "3:4", "16:9", "4:3", "9:16", "21:9"]
              : [];
        const sizes = [
            RATIO_SIZE.adaptive,
            ...fixedRatios
                .map((value) => RATIO_SIZE[value] || { value, labelKey: "adaptive", width: 0, height: 0 })
                .filter((item) => item.value && item.value !== "auto" && item.value !== "adaptive"),
        ];
        const min = model?.dreaminaDurationMin || 4;
        const max = model?.dreaminaDurationMax || 15;
        const seconds = Array.from({ length: max - min + 1 }, (_, index) => min + index);
        return {
            source: "dreamina",
            resolutions: resolutions.map((value) => ({ value, label: /p$/i.test(value) ? value : `${value}p` })),
            allowCustomResolution: false,
            sizes,
            allowCustomDimensions: false,
            seconds,
            allowCustomSeconds: false,
            showGenerateAudio: false,
            showWatermark: false,
            showRealPersonMode: false,
        };
    }
    if (request.apiFormat === "ark" || isSeedanceVideoConfig(config)) {
        return {
            source: "seedance",
            resolutions: seedanceResolutionOptions.map((item) => ({ value: item.value, label: item.label })),
            allowCustomResolution: false,
            sizes: seedanceRatioOptions.map((item) => RATIO_SIZE[item.value] || { value: item.value, labelKey: "adaptive", width: 0, height: 0 }),
            allowCustomDimensions: false,
            seconds: [...seedanceDurationOptions],
            allowCustomSeconds: false,
            showGenerateAudio: true,
            showWatermark: true,
            showRealPersonMode: false,
        };
    }

    if (request.apiFormat === "runninghub") {
        const endpoint = modelOptionName(config.model || config.videoModel || "");
        const family = resolveRunninghubVideoFamily(endpoint);
        if (family === "seedance") {
            return {
                source: "runninghub",
                resolutions: seedanceResolutionOptions.map((item) => ({ value: item.value, label: item.label })),
                allowCustomResolution: false,
                sizes: seedanceRatioOptions.map((item) => RATIO_SIZE[item.value] || { value: item.value, labelKey: "adaptive", width: 0, height: 0 }),
                allowCustomDimensions: false,
                seconds: [...seedanceRunninghubDurationOptions],
                allowCustomSeconds: false,
                showGenerateAudio: true,
                showWatermark: false,
                showRealPersonMode: seedanceSupportsRealPersonMode(endpoint),
            };
        }
        const def = RUNNINGHUB_MODELS.find((item) => item.name === endpoint);
        const byKey = new Map((def?.params || []).map((item) => [item.fieldKey, item]));
        const aspect = byKey.get("aspectRatio") || byKey.get("size");
        const resolution = byKey.get("resolution");
        const duration = byKey.get("duration");
        const sizes = (aspect?.options || []).map((value) => RATIO_SIZE[value] || { value, labelKey: "adaptive", width: 0, height: 0 }).filter((item) => item.value);
        const seconds = duration?.options?.map((item) => Number(item)).filter((item) => Number.isFinite(item)) || [];
        return {
            source: "runninghub",
            resolutions: (resolution?.options || []).map((value) => ({ value, label: /p$/i.test(value) ? value : `${value}` })),
            allowCustomResolution: false,
            sizes: sizes.length ? sizes : GENERIC_SIZES,
            allowCustomDimensions: Boolean(byKey.has("width") && byKey.has("height")),
            seconds: seconds.length ? seconds : [4, 5, 6, 8, 10],
            allowCustomSeconds: duration?.type === "INT",
            secondsMin: duration?.min,
            secondsMax: duration?.max,
            showGenerateAudio: byKey.has("generateAudio") || family === "seedance" || family === "kling",
            showWatermark: byKey.has("watermark"),
            showRealPersonMode: byKey.has("realPersonMode") || seedanceSupportsRealPersonMode(endpoint),
        };
    }

    return {
        source: "generic",
        resolutions: GENERIC_RESOLUTIONS,
        allowCustomResolution: false,
        sizes: GENERIC_SIZES,
        allowCustomDimensions: true,
        seconds: [6, 10, 12, 16, 20],
        allowCustomSeconds: false,
        showGenerateAudio: true,
        showWatermark: true,
        showRealPersonMode: false,
    };
}
