import type { RunninghubAiAppNodeInfo } from "@/services/api/runninghub-ai-app";

export const RH_COMPOSITE_NODE_TYPE = "rh-composite";
export const RH_MULTI_LORA_WEBAPP_ID = "2074756017363177474";
export const RH_LEGACY_WEBAPP_ID = "2073585073613524993";

/** 放大 Lora 触发词；默认提示词与其共用同一段，避免去重失败后重复拼接。 */
export const RH_UPSCALE_TRIGGER =
    "enhance and upscale this image, restore fine details and natural texture, " +
    "sharpen, remove AI plastic smoothing and dark blotches, fix compression artifacts, " +
    "keep original content color and composition unchanged, remove dark blotches";

export const RH_DEFAULT_PROMPT = RH_UPSCALE_TRIGGER;

export type RhCompositeMode = "workflow" | "scale";
export type RhLoraKey =
    | "lora_upscale"
    | "lora_texture_detail"
    | "lora_lighting_stain_removal"
    | "lora_texture_removal"
    | "lora_light_removal"
    | "lora_lighting"
    | "lora_image_retouch";

export type RhLoraStrengths = Record<RhLoraKey, number>;

export const RH_LORA_KEYS: RhLoraKey[] = [
    "lora_upscale",
    "lora_texture_detail",
    "lora_lighting_stain_removal",
    "lora_texture_removal",
    "lora_light_removal",
    "lora_lighting",
    "lora_image_retouch",
];

export const RH_LORA_DEFAULTS: RhLoraStrengths = {
    lora_upscale: 1,
    lora_texture_detail: 0.2,
    lora_lighting_stain_removal: 0,
    lora_texture_removal: 0,
    lora_light_removal: 0,
    lora_lighting: 0,
    lora_image_retouch: 0,
};

/** 与 Comfy TRIGGER_WORDS 对齐 */
export const RH_LORA_TRIGGERS: Record<RhLoraKey, string> = {
    lora_upscale: RH_UPSCALE_TRIGGER,
    lora_texture_detail: "XDTL4, 增强照片微观细节",
    lora_lighting_stain_removal:
        "将图1转换为高级商业CG渲染图 / 高端广告精修图。提升画面质感：环境干净通透，光线柔和自然，" +
        "高光受控、阴影柔和，材质层次清晰，细节锐利，整体洁净、崭新、高级。效果应比原图更干净明亮，" +
        "同时保持物理真实感。去除污渍、灰尘、噪点、灰雾、曝光不均和低画质瑕疵。",
    lora_texture_removal: "弱纹风，平滑表面, 简化材质细节, 低纹理",
    lora_light_removal:
        "移除 image 1 中的方向光与光影效果。消除硬阴影和高光，改为均匀、柔和、无阴影的漫射环境光。" +
        "保留主体、颜色、材质、姿势与背景不变。平面化光照，曝光均匀，低对比。",
    lora_lighting:
        "整图专业光影优化，商业摄影级布光完成度，主光方向明确，辅光填充自然，高光受控不过曝，" +
        "阴影有层次不发脏，轮廓光清晰分离主体，金属玻璃皮革等材质高光真实，整体光比协调，广告成片质感",
    lora_image_retouch: "精修图片，移除污渍，让褶皱平整，让光线过渡自然，高保真细节纹理，移除杂乱的光照影响，高级渲染光。",
};

type NodeMapEntry = { nodeId: string; fieldName: string };

const V3_NODE_MAP: Record<string, NodeMapEntry> = {
    image: { nodeId: "88", fieldName: "image" },
    seed: { nodeId: "17", fieldName: "noise_seed" },
    prompt: { nodeId: "21", fieldName: "text" },
    lora_upscale: { nodeId: "52", fieldName: "strength_model" },
    lora_texture_detail: { nodeId: "99", fieldName: "strength_model" },
    lora_lighting_stain_removal: { nodeId: "100", fieldName: "strength_model" },
    lora_texture_removal: { nodeId: "101", fieldName: "strength_model" },
    lora_light_removal: { nodeId: "102", fieldName: "strength_model" },
    lora_lighting: { nodeId: "103", fieldName: "strength_model" },
    lora_image_retouch: { nodeId: "104", fieldName: "strength_model" },
};

const LEGACY_NODE_MAP: Record<string, NodeMapEntry> = {
    image: { nodeId: "88", fieldName: "image" },
    prompt: { nodeId: "21", fieldName: "text" },
    lora_upscale: { nodeId: "52", fieldName: "strength_model" },
    lora_texture_detail: { nodeId: "101", fieldName: "strength_model" },
    lora_lighting_stain_removal: { nodeId: "103", fieldName: "strength_model" },
    lora_texture_removal: { nodeId: "104", fieldName: "strength_model" },
    lora_light_removal: { nodeId: "105", fieldName: "strength_model" },
    lora_lighting: { nodeId: "106", fieldName: "strength_model" },
};

export function resolveRhNodeMap(webappId: string) {
    return webappId.trim() === RH_LEGACY_WEBAPP_ID ? LEGACY_NODE_MAP : V3_NODE_MAP;
}

/** 自动插入到提示词框中的触发词原文（用于归零时判断是否被用户改过）。 */
export type RhInsertedTriggers = Partial<Record<RhLoraKey, string>>;

export function insertedTriggerParamKey(key: RhLoraKey) {
    return `inserted_${key}`;
}

export function readInsertedTriggers(modelParams?: Record<string, string | number | boolean> | null): RhInsertedTriggers {
    const next: RhInsertedTriggers = {};
    if (!modelParams) return next;
    for (const key of RH_LORA_KEYS) {
        const raw = modelParams[insertedTriggerParamKey(key)];
        if (typeof raw === "string" && raw) next[key] = raw;
    }
    return next;
}

export function insertedTriggersToParams(inserted: RhInsertedTriggers) {
    const params: Record<string, string> = {};
    for (const key of RH_LORA_KEYS) {
        const value = inserted[key];
        params[insertedTriggerParamKey(key)] = typeof value === "string" ? value : "";
    }
    return params;
}

function cleanupPromptGaps(prompt: string) {
    return prompt.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").trim();
}

/**
 * 0→非0：始终向提示词追加一份默认触发词（即便已有相同文案）。
 * 非0间变化：不改提示词。
 * 非0→0：仅当提示词中仍完整保留当初插入的原文时才移除。
 */
export function applyLoraStrengthPromptChange(params: {
    prompt: string;
    key: RhLoraKey;
    prevStrength: number;
    nextStrength: number;
    inserted: RhInsertedTriggers;
}) {
    const { key } = params;
    const wasOn = Number(params.prevStrength) !== 0;
    const isOn = Number(params.nextStrength) !== 0;
    let prompt = params.prompt;
    const inserted: RhInsertedTriggers = { ...params.inserted };

    if (!wasOn && isOn) {
        const trigger = RH_LORA_TRIGGERS[key].trim();
        if (!trigger) return { prompt, inserted };
        // 0→非0：始终追加一份，即使提示词里已有相同文案
        prompt = cleanupPromptGaps(prompt ? `${prompt}\n${trigger}` : trigger);
        inserted[key] = trigger;
        return { prompt, inserted };
    }

    if (wasOn && !isOn) {
        const exact = (inserted[key] || "").trim();
        delete inserted[key];
        if (exact && prompt.includes(exact)) {
            prompt = cleanupPromptGaps(prompt.split(exact).join(""));
        }
        return { prompt, inserted };
    }

    return { prompt, inserted };
}

/** 为已启用但尚未记录插入的 Lora 补齐触发词（新建节点初始化用；已有 inserted 记录则跳过，避免每次打开面板重复追加）。 */
export function ensureActiveLoraTriggers(prompt: string, strengths: RhLoraStrengths, inserted: RhInsertedTriggers) {
    let nextPrompt = prompt;
    let nextInserted = { ...inserted };
    for (const key of RH_LORA_KEYS) {
        if (!strengths[key] || nextInserted[key]) continue;
        const trigger = RH_LORA_TRIGGERS[key].trim();
        if (!trigger) continue;
        // 初始化：默认提示词已含放大触发词时只记账，不重复追加；其余 Lora 补一份
        if (key === "lora_upscale" && nextPrompt.includes(trigger)) {
            nextInserted[key] = trigger;
            continue;
        }
        const result = applyLoraStrengthPromptChange({
            prompt: nextPrompt,
            key,
            prevStrength: 0,
            nextStrength: strengths[key],
            inserted: nextInserted,
        });
        nextPrompt = result.prompt;
        nextInserted = result.inserted;
    }
    return { prompt: nextPrompt, inserted: nextInserted };
}

export function buildV3NodeInfoList(params: {
    fileName: string;
    prompt: string;
    strengths: RhLoraStrengths;
    seed?: number;
    webappId?: string;
}): RunninghubAiAppNodeInfo[] {
    const nodeMap = resolveRhNodeMap(params.webappId || RH_MULTI_LORA_WEBAPP_ID);
    const list: RunninghubAiAppNodeInfo[] = [{ ...nodeMap.image, fieldValue: params.fileName }];
    if (nodeMap.prompt) list.push({ ...nodeMap.prompt, fieldValue: params.prompt });
    if (nodeMap.seed && params.seed != null && params.seed >= 0) {
        list.push({ ...nodeMap.seed, fieldValue: String(Math.floor(params.seed)) });
    }
    for (const key of RH_LORA_KEYS) {
        const entry = nodeMap[key];
        if (!entry) continue;
        list.push({ ...entry, fieldValue: String(params.strengths[key] ?? 0) });
    }
    return list;
}

export const RH_DEFAULT_SCALE_RATIO = 1.2;
export const RH_DEFAULT_SCALE_MAX_SIDE = 2500;

export type RhScaleParams = {
    ratio: number;
    /** 固定使用兰索斯（高质量） */
    resample?: "lanczos";
    alignMultiple: number;
    maxSide: number;
};

export function computeScaledSize(srcW: number, srcH: number, params: RhScaleParams) {
    const ratio = Math.max(0.01, Math.min(10, params.ratio || 1));
    let newW = Math.max(1, Math.round(srcW * ratio));
    let newH = Math.max(1, Math.round(srcH * ratio));
    const align = Math.max(1, Math.floor(params.alignMultiple || 1));
    if (align > 1) {
        newW = Math.max(align, Math.round(newW / align) * align);
        newH = Math.max(align, Math.round(newH / align) * align);
    }
    const maxSide = Math.max(0, Math.floor(params.maxSide || 0));
    if (maxSide > 0) {
        const longest = Math.max(newW, newH);
        if (longest > maxSide) {
            const clamp = maxSide / longest;
            newW = Math.max(1, Math.round(newW * clamp));
            newH = Math.max(1, Math.round(newH * clamp));
            if (align > 1) {
                newW = Math.max(align, Math.floor(newW / align) * align);
                newH = Math.max(align, Math.floor(newH / align) * align);
            }
        }
    }
    return { width: newW, height: newH };
}

export async function scaleDataUrlByRatio(dataUrl: string, params: RhScaleParams) {
    const image = await loadImage(dataUrl);
    const { width, height } = computeScaledSize(image.width, image.height, params);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL("image/png"), width, height };
}

function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("image load failed"));
        image.src = src;
    });
}

export function readRhLoraStrengths(modelParams?: Record<string, string | number | boolean> | null): RhLoraStrengths {
    const next = { ...RH_LORA_DEFAULTS };
    if (!modelParams) return next;
    for (const key of RH_LORA_KEYS) {
        const raw = modelParams[key];
        let value: number | null = null;
        if (typeof raw === "number" && Number.isFinite(raw)) value = raw;
        else if (typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw))) value = Number(raw);
        if (value != null) next[key] = Math.min(1, Math.max(0, value));
    }
    return next;
}

export function readRhScaleParams(modelParams?: Record<string, string | number | boolean> | null): RhScaleParams {
    const ratio = Number(modelParams?.scaleRatio ?? RH_DEFAULT_SCALE_RATIO);
    const alignMultiple = Number(modelParams?.scaleAlign ?? 1);
    const maxSide = Number(modelParams?.scaleMaxSide ?? RH_DEFAULT_SCALE_MAX_SIDE);
    return {
        ratio: Number.isFinite(ratio) ? ratio : RH_DEFAULT_SCALE_RATIO,
        resample: "lanczos",
        alignMultiple: Number.isFinite(alignMultiple) ? alignMultiple : 1,
        maxSide: Number.isFinite(maxSide) ? maxSide : RH_DEFAULT_SCALE_MAX_SIDE,
    };
}
