import { getNodeSpec, NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { resolveModelInputSpec, type ModelInputSpec } from "@/lib/canvas/model-input-spec";
import { resolveModelForCapability, type AiConfig } from "@/stores/use-config-store";
import type { UploadedImage } from "@/services/image-storage";
import type { UploadedFile } from "@/services/file-storage";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasImageGenerationType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId, type Position } from "@/types/canvas";

const WORKBENCH_SLOT_ROW_HEIGHT = 28;

export function createCanvasNode(type: CanvasNodeTypeId, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const spec = getNodeSpec(type);
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return {
        id,
        type,
        title: spec.title,
        position: {
            x: position.x - spec.width / 2,
            y: position.y - spec.height / 2,
        },
        width: spec.width,
        height: spec.height,
        metadata: { ...spec.metadata, ...metadata },
    };
}

/** 纠正工作台旧默认高度（过矮裁切 / 过高留白），用户手动拉高过的保留。 */
export function ensureWorkbenchNodeSize(node: CanvasNodeData): CanvasNodeData {
    if (node.type !== CanvasNodeType.Config) return node;
    const targetHeight = NODE_DEFAULT_SIZE[CanvasNodeType.Config].height;
    const minWidth = NODE_DEFAULT_SIZE[CanvasNodeType.Config].width;
    const legacyHeights = new Set([240, 290, 300, 318, 320, 348, 376, 380]);
    const nextTitle = node.title === "生成配置" || node.title === "Generation config" ? NODE_DEFAULT_SIZE[CanvasNodeType.Config].title : node.title;
    if (!legacyHeights.has(node.height) && node.height >= targetHeight && node.width >= minWidth && nextTitle === node.title) return node;
    return {
        ...node,
        width: Math.max(node.width, minWidth),
        height: legacyHeights.has(node.height) || node.height < targetHeight ? targetHeight : node.height,
        title: nextTitle,
    };
}

/** 基准高度包含独立提示词入口；首行媒体含 8px 区块间距，后续行含 4px 行距。 */
export function workbenchHeightForInputSpec(spec: ModelInputSpec): number {
    const mediaRows = [spec.images, spec.videos, spec.audios].filter(Boolean).length;
    const base = NODE_DEFAULT_SIZE[CanvasNodeType.Config].height;
    if (mediaRows === 0) return base - 32;
    return base + Math.max(0, mediaRows - 1) * WORKBENCH_SLOT_ROW_HEIGHT;
}

/** 按节点当前模式/模型适配工作台高度；切换模型时跟随内容增高或收紧。 */
export function fitWorkbenchNodeHeight(node: CanvasNodeData, globalConfig: AiConfig): CanvasNodeData {
    if (node.type !== CanvasNodeType.Config) return node;
    const mode = (node.metadata?.generationMode || "image") as CanvasGenerationMode;
    const config = { ...globalConfig, videoReferenceMode: node.metadata?.videoReferenceMode || globalConfig.videoReferenceMode, model: resolveModelForCapability(globalConfig, node.metadata?.model, mode) };
    const height = workbenchHeightForInputSpec(resolveModelInputSpec(config, mode));
    if (node.height === height) return node;
    return { ...node, height };
}

export function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

export function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
    return { content: video.url, storageKey: video.storageKey, status: "success", naturalWidth: video.width, naturalHeight: video.height, bytes: video.bytes, mimeType: video.mimeType || "video/mp4", durationMs: video.durationMs };
}

export function audioMetadata(audio: UploadedFile): CanvasNodeMetadata {
    return { content: audio.url, storageKey: audio.storageKey, status: "success", bytes: audio.bytes, mimeType: audio.mimeType || "audio/mpeg", durationMs: audio.durationMs };
}

export function modelMetadata(model: UploadedFile, fileName?: string): CanvasNodeMetadata {
    return {
        content: model.url,
        storageKey: model.storageKey,
        status: "success",
        bytes: model.bytes,
        mimeType: model.mimeType || "application/octet-stream",
        interactive: false,
        modelShowTextures: false,
        modelPreviewBg: "dark",
        ...(fileName ? { modelFileName: fileName } : {}),
    };
}

export function referenceUrl(image: ReferenceImage) {
    return image.storageKey || image.url || (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined);
}

export function buildImageGenerationMetadata(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[]): CanvasNodeMetadata {
    return {
        generationType: type,
        model: config.model,
        size: config.size,
        quality: config.quality,
        ...(config.background ? { background: config.background } : {}),
        ...(config.modelParams && Object.keys(config.modelParams).length ? { modelParams: config.modelParams } : {}),
        count,
        references: references.map(referenceUrl).filter((url): url is string => Boolean(url)),
    };
}

export function buildAudioGenerationMetadata(config: AiConfig): CanvasNodeMetadata {
    return {
        model: config.model,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
        audioEmotion: config.audioEmotion,
        audioTitle: config.audioTitle,
        audioInstrumental: config.audioInstrumental,
        audioTags: config.audioTags,
        audioLyrics: config.audioLyrics,
        audioStyle: config.audioStyle,
        audioCloneModel: config.audioCloneModel,
        audioNoiseReduction: config.audioNoiseReduction,
        audioVolumeNormalization: config.audioVolumeNormalization,
    };
}

export function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeData["metadata"]>) {
    const safePatch = patch || {};
    const next = { ...node, metadata: { ...node.metadata, ...safePatch } };
    const spec = node.type === CanvasNodeType.Video ? NODE_DEFAULT_SIZE[CanvasNodeType.Video] : NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = typeof safePatch.size === "string" && !node.metadata?.content ? nodeSizeFromRatio(safePatch.size, spec.width, spec.height) : null;
    return size && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}
