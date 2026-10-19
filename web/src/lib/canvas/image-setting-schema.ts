import { linkfoxImageModel } from "@/lib/linkfox-image";
import { RUNNINGHUB_MODELS, RUNNINGHUB_CN_MODELS, RUNNINGHUB_REALISTIC_IMAGE, type RunninghubModelParam } from "@/services/api/runninghub-models";
import { klingArgumentsForTool } from "@/services/api/kling-cli";
import { isDreaminaModel, isKlingModel, modelOptionName, resolveChannelModel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export type ImageSettingFieldKind =
    | "quality"
    | "resolution"
    | "aspectRatio"
    | "dimensions"
    | "background"
    | "number"
    | "toggle"
    /** Midjourney：从已连接参考图中多选底图（默认全选）。 */
    | "mjBaseImages"
    /** Midjourney：开关 + 单选风格参考图 sref。 */
    | "mjSrefImage";

export type ImageSettingOption = { value: string; label: string };

export type ImageSettingField = {
    kind: ImageSettingFieldKind;
    fieldKey?: string;
    labelKey: string;
    options?: ImageSettingOption[];
    showAlign16?: boolean;
    /** Midjourney 等：无 auto/empty 也可填自定义比例（请求侧用 --ar）。 */
    allowCustomAspect?: boolean;
    /** 自定义比例为 W:H 比例（非像素尺寸），不展示 16 对齐。 */
    customAspectRatioMode?: boolean;
    min?: number;
    max?: number;
    defaultValue?: string | number | boolean;
    /** 仅当 modelParams 中该键为真时展示（如 sref 开启后显示 sw/sv）。 */
    visibleWhenParam?: string;
};

export type ImageSettingSchema = {
    source: "runninghub" | "linkfox" | "kling" | "dreamina" | "generic";
    fields: ImageSettingField[];
};

const GENERIC_QUALITY: ImageSettingOption[] = [
    { value: "auto", label: "auto" },
    { value: "high", label: "high" },
    { value: "medium", label: "medium" },
    { value: "low", label: "low" },
];

const GENERIC_ASPECT: ImageSettingOption[] = [
    { value: "1:1", label: "1:1" },
    { value: "3:2", label: "3:2" },
    { value: "2:3", label: "2:3" },
    { value: "4:3", label: "4:3" },
    { value: "3:4", label: "3:4" },
    { value: "16:9", label: "16:9" },
    { value: "9:16", label: "9:16" },
    { value: "2048x2048", label: "1:1(2k)" },
    { value: "2048x1152", label: "16:9(2k)" },
    { value: "1152x2048", label: "9:16(2k)" },
    { value: "3840x2160", label: "16:9(4k)" },
    { value: "2160x3840", label: "9:16(4k)" },
    { value: "auto", label: "auto" },
];

/** 额外 INT/BOOLEAN 参数展示顺序（Midjourney 等）。 */
const EXTRA_PARAM_ORDER = ["chaos", "stylize", "weird", "raw", "tile", "hd", "iw", "sw", "sv", "ow", "cw", "stop"];

export function resolveImageSettingSchema(config: AiConfig): ImageSettingSchema {
    const request = resolveModelRequestConfig(config, config.model);
    if (request.apiFormat === "linkfox") return linkfoxImageSchema(config.model);
    if (isKlingModel(config.model)) {
        const model = resolveChannelModel(config, config.model);
        const args = model?.klingArguments?.length ? model.klingArguments : klingArgumentsForTool(model, "text_to_image");
        const byName = new Map(args.map((item) => [item.name, item]));
        const find = (...names: string[]) => names.map((name) => byName.get(name)).find(Boolean);
        const resolution = find("img_resolution", "imgResolution");
        const aspect = find("aspect_ratio", "aspectRatio", "ratio");
        const fields: ImageSettingField[] = [];
        if (resolution?.allowedValues?.length) {
            fields.push({
                kind: "quality",
                fieldKey: resolution.name,
                labelKey: "quality",
                options: resolution.allowedValues.map((value) => ({ value, label: value })),
                defaultValue: resolution.default,
            });
        }
        if (aspect?.allowedValues?.length) {
            fields.push({
                kind: "aspectRatio",
                fieldKey: aspect.name,
                labelKey: "aspectRatio",
                options: aspect.allowedValues.map((value) => ({ value, label: value })),
                defaultValue: aspect.default,
            });
        }
        if (fields.length) return { source: "kling", fields };
    }
    if (isDreaminaModel(config.model)) {
        const model = resolveChannelModel(config, config.model);
        const resolutions = model?.dreaminaResolutions?.length ? model.dreaminaResolutions : ["2k", "4k"];
        const ratios = model?.dreaminaRatios?.length ? model.dreaminaRatios : ["16:9", "1:1", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"];
        return {
            source: "dreamina",
            fields: [
                { kind: "quality", labelKey: "quality", options: resolutions.map((value) => ({ value, label: value })), defaultValue: resolutions.includes("2k") ? "2k" : resolutions[0] },
                { kind: "aspectRatio", labelKey: "aspectRatio", options: ratios.map((value) => ({ value, label: value })), defaultValue: "16:9" },
            ],
        };
    }
    if (request.apiFormat === "runninghub") {
        const endpoint = modelOptionName(config.model || "");
        const def = [...RUNNINGHUB_MODELS, ...RUNNINGHUB_CN_MODELS].find((item) => item.name === endpoint);
        const fields = mapRunninghubParams(def?.params || [], endpoint);
        if (fields.length) return { source: "runninghub", fields };
    }
    return {
        source: "generic",
        fields: [
            { kind: "quality", labelKey: "quality", options: GENERIC_QUALITY },
            { kind: "dimensions", labelKey: "size", showAlign16: true },
            { kind: "aspectRatio", labelKey: "aspectRatio", options: GENERIC_ASPECT },
            { kind: "background", labelKey: "transparent" },
        ],
    };
}

export function findRunninghubImageParams(modelValue: string): RunninghubModelParam[] {
    const endpoint = modelOptionName(modelValue);
    return [...RUNNINGHUB_MODELS, ...RUNNINGHUB_CN_MODELS].find((item) => item.name === endpoint)?.params || [];
}

/** quality 字段可打包为 `resolution|quality`（两者并存时）。 */
export function unpackQualityValue(raw: string) {
    const value = (raw || "").trim();
    if (!value) return { resolution: "", quality: "" };
    const index = value.indexOf("|");
    if (index < 0) {
        if (/^\d+k$/i.test(value) || /^(1k|2k|3k|4k)$/i.test(value)) return { resolution: value, quality: "" };
        return { resolution: "", quality: value };
    }
    return { resolution: value.slice(0, index), quality: value.slice(index + 1) };
}

export function packQualityValue(parts: { resolution?: string; quality?: string }, schema: ImageSettingSchema) {
    const hasResolution = schema.fields.some((field) => field.kind === "resolution");
    const hasQuality = schema.fields.some((field) => field.kind === "quality");
    const resolution = (parts.resolution || "").trim();
    const quality = (parts.quality || "").trim();
    if (hasResolution && hasQuality) {
        if (resolution && quality) return `${resolution}|${quality}`;
        return resolution || quality;
    }
    if (hasResolution) return resolution || quality;
    return quality || resolution;
}

/** 尺寸展示与请求共用；真实感模型只接受明确的像素宽高。 */
export function resolveImageSize(config: { model?: string; size?: string }) {
    const size = (config.size || "").trim();
    if (modelOptionName(config.model || "") !== RUNNINGHUB_REALISTIC_IMAGE) return size;
    if (/^\d+x\d+$/i.test(size)) return size.toLowerCase();
    const ratio = size.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (ratio && Number(ratio[1]) > 0 && Number(ratio[2]) > 0) {
        const aspect = Number(ratio[1]) / Number(ratio[2]);
        const width = Math.max(16, Math.round(1280 * Math.min(1, aspect) / 16) * 16);
        const height = Math.max(16, Math.round(1280 / Math.max(1, aspect) / 16) * 16);
        return `${width}x${height}`;
    }
    return "720x1280";
}

function linkfoxImageSchema(model: string): ImageSettingSchema {
    const spec = linkfoxImageModel(model) || linkfoxImageModel("BANANA_PRO");
    const resolutions = spec?.resolutions || ["1K", "2K", "4K"];
    const ratios = spec?.ratios || ["1:1", "16:9", "9:16"];
    const options = (values: string[]) => values.map((value) => ({ value, label: value }));
    const fields: ImageSettingField[] = [];
    if (resolutions.length) fields.push({ kind: "resolution", labelKey: "resolution", options: options(resolutions), defaultValue: resolutions[0] });
    if (spec?.qualities?.length) fields.push({ kind: "quality", labelKey: "quality", options: options(spec.qualities), defaultValue: spec.qualities.includes("medium") ? "medium" : spec.qualities[0] });
    fields.push({ kind: "aspectRatio", labelKey: "aspectRatio", options: options(ratios), defaultValue: ratios.includes("1:1") ? "1:1" : ratios[0] });
    return { source: "linkfox", fields };
}

/** 原 LinkFox 网关仍使用顶层参数；设置面板、摘要和请求共用同一份模型约束。 */
export function resolveLinkfoxImageParams(config: Pick<AiConfig, "model" | "quality" | "size">) {
    const schema = linkfoxImageSchema(config.model);
    const packed = unpackQualityValue(config.quality || "");
    const resolution = schema.fields.find((field) => field.kind === "resolution");
    const quality = schema.fields.find((field) => field.kind === "quality");
    return {
        ...(resolution ? { resolution: pickImageSchemaOption(resolution, packed.resolution.toUpperCase()) } : {}),
        ...(quality ? { quality: pickImageSchemaOption(quality, packed.quality.toLowerCase()) } : {}),
        aspectRatio: pickImageSchemaOption(schema.fields.find((field) => field.kind === "aspectRatio"), config.size || ""),
    };
}

export function imageSettingsSummary(config: AiConfig, translateQuality?: (value: string) => string) {
    const schema = resolveImageSettingSchema(config);
    const linkfox = schema.source === "linkfox" ? resolveLinkfoxImageParams(config) : null;
    const parts: string[] = [];
    const packed = linkfox ? { resolution: linkfox.resolution || "", quality: linkfox.quality || "" } : unpackQualityValue(config.quality || "");
    for (const field of schema.fields) {
        if (field.kind === "resolution" && packed.resolution) parts.push(packed.resolution);
        else if (field.kind === "quality") {
            const value =
                schema.source === "kling" || schema.source === "dreamina"
                    ? pickImageSchemaOption(field, packed.quality || config.quality || "")
                    : packed.quality || (!schema.fields.some((item) => item.kind === "resolution") ? config.quality || "" : "");
            if (!value) continue;
            parts.push(translateQuality?.(value) || value);
        } else if (field.kind === "aspectRatio" || field.kind === "dimensions") {
            const size = linkfox?.aspectRatio || (schema.source === "kling" || schema.source === "dreamina" ? pickImageSchemaOption(schema.fields.find((item) => item.kind === "aspectRatio"), config.size || "") : resolveImageSize(config));
            if (!size) continue;
            const hit = field.kind === "aspectRatio" ? field.options?.find((item) => item.value === size)?.label : undefined;
            parts.push(hit || size);
            break;
        }
    }
    return parts.filter(Boolean).join(" · ") || "—";
}

/** 将通用 quality/size 收敛到当前 schema 合法选项（可灵 1k/2k、比例等）。 */
export function pickImageSchemaOption(field: ImageSettingField | undefined, raw: string) {
    const options = field?.options || [];
    if (!options.length) return raw;
    const value = (raw || "").trim();
    if (options.some((item) => item.value === value)) return value;
    if (field?.kind === "quality" || field?.kind === "resolution") {
        const mapped = mapGenericImageQuality(value);
        if (options.some((item) => item.value === mapped)) return mapped;
    }
    if (field?.kind === "aspectRatio" && /^\d+x\d+$/i.test(value)) {
        const dims = value.match(/^(\d+)x(\d+)$/i);
        if (dims) {
            const ratio = Number(dims[1]) / Number(dims[2]);
            const candidates = options.filter((item) => item.value.includes(":"));
            if (candidates.length) {
                return candidates.reduce((best, item) => {
                    const [w, h] = item.value.split(":").map(Number);
                    if (!w || !h) return best;
                    const bestParts = best.value.split(":").map(Number);
                    const bestRatio = (bestParts[0] || 1) / (bestParts[1] || 1);
                    return Math.abs(w / h - ratio) < Math.abs(bestRatio - ratio) ? item : best;
                }).value;
            }
        }
    }
    const fallback = field?.defaultValue != null ? String(field.defaultValue) : "";
    if (fallback && options.some((item) => item.value === fallback)) return fallback;
    return options[0]?.value || value;
}

function mapGenericImageQuality(raw: string) {
    const value = raw.trim().toLowerCase();
    if (!value) return "2k";
    if (value.includes("|")) {
        const [left, right] = value.split("|");
        return mapGenericImageQuality(right || left || "");
    }
    if (value === "low") return "1k";
    if (value === "high" || value === "medium" || value === "auto") return "2k";
    if (/^\d+k$/.test(value)) return value;
    return value;
}

export function readModelParam(config: AiConfig, field: ImageSettingField): string | number | boolean {
    const key = field.fieldKey || "";
    const stored = config.modelParams?.[key];
    if (stored !== undefined) return stored;
    if (field.defaultValue !== undefined) return field.defaultValue;
    if (field.kind === "toggle") return false;
    if (field.kind === "number") return field.min ?? 0;
    return "";
}

function looksLikeMjQuality(value: string) {
    return /^(0\.25|0\.5|1|2|4)$/.test(String(value).trim());
}

function mapRunninghubParams(params: RunninghubModelParam[], endpoint = ""): ImageSettingField[] {
    const byKey = new Map(params.map((item) => [item.fieldKey, item]));
    const fields: ImageSettingField[] = [];
    const isMidjourney = endpoint.startsWith("youchuan/");

    const resolutionParam = byKey.get("resolution");
    if (resolutionParam?.options?.length) {
        fields.push({
            kind: "resolution",
            fieldKey: "resolution",
            labelKey: "resolution",
            options: resolutionParam.options.map((value) => ({ value, label: value })),
        });
    }

    const qualityParam = byKey.get("quality");
    if (qualityParam?.options?.length) {
        fields.push({
            kind: "quality",
            fieldKey: "quality",
            labelKey: "quality",
            options: qualityParam.options.map((value) => ({
                value,
                label: isMidjourney
                    ? value
                    : looksLikeMjQuality(value)
                      ? `--q ${value}`
                      : value,
            })),
        });
    }

    const hasWidth = byKey.has("width") || byKey.has("outputWidth");
    const hasHeight = byKey.has("height") || byKey.has("outputHeight");
    if (hasWidth && hasHeight) {
        const width = byKey.get("width") || byKey.get("outputWidth");
        const height = byKey.get("height") || byKey.get("outputHeight");
        fields.push({
            kind: "dimensions", fieldKey: "width", labelKey: "size", showAlign16: true,
            defaultValue: width?.defaultValue && height?.defaultValue ? `${width.defaultValue}x${height.defaultValue}` : undefined,
        });
    }

    const aspectParam = byKey.get("aspectRatio") || (byKey.get("size")?.options?.length ? byKey.get("size") : undefined);
    if (aspectParam?.options?.length || aspectParam?.defaultValue === "auto" || aspectParam?.defaultValue === "empty") {
        const rawOptions = [...(aspectParam.options || [])];
        const supportsUnset = rawOptions.includes("empty") || rawOptions.includes("auto") || aspectParam.defaultValue === "empty" || isMidjourney;
        const options = rawOptions.map((value) => (value === "empty" ? "auto" : value));
        if (supportsUnset && !options.includes("auto")) options.unshift("auto");
        const unique = Array.from(new Set(options.filter(Boolean)));
        if (unique.length) {
            fields.push({
                kind: "aspectRatio",
                fieldKey: aspectParam.fieldKey,
                labelKey: "aspectRatio",
                allowCustomAspect: supportsUnset || isMidjourney,
                customAspectRatioMode: isMidjourney,
                options: unique.map((value) => ({ value, label: value === "auto" ? "auto" : value })),
            });
        }
    }

    const outputFormat = byKey.get("outputFormat");
    if (outputFormat?.options?.some((value) => /png/i.test(value))) {
        fields.push({ kind: "background", fieldKey: "outputFormat", labelKey: "transparent" });
    }

    if (isMidjourney) {
        fields.unshift(
            { kind: "mjSrefImage", labelKey: "mjSrefImage" },
            { kind: "mjBaseImages", labelKey: "mjBaseImages" },
        );
    }

    for (const key of EXTRA_PARAM_ORDER) {
        const param = byKey.get(key);
        if (!param) continue;
        // Midjourney：iw 有底图时才有意义，始终展示；sw/sv 仅在开启 sref 后展示
        const visibleWhenParam = isMidjourney && (key === "sw" || key === "sv") ? "mjSrefEnabled" : undefined;
        if (param.type === "BOOLEAN") {
            fields.push({
                kind: "toggle",
                fieldKey: key,
                labelKey: key,
                defaultValue: param.defaultValue,
                visibleWhenParam,
            });
            continue;
        }
        if (param.type === "INT") {
            fields.push({
                kind: "number",
                fieldKey: key,
                labelKey: key,
                min: param.min,
                max: param.max,
                defaultValue: param.defaultValue,
                visibleWhenParam,
            });
        }
    }

    return fields;
}
