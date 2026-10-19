import { defaultConfig, resolveModelForCapability, type AiConfig } from "@/stores/use-config-store";
import i18n from "@/i18n";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { resolveImageSourceUrl, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { LOCAL_EDIT_DEFAULT_RESOLUTION } from "@/lib/canvas/banana-local-edit";
import { imageMetadata, referenceUrl } from "@/lib/canvas/canvas-node-factory";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type { ImageSettingsReferenceOption } from "@/components/image-settings-panel";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

export function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

export function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

export async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

async function hydrateKeyedImage(storageKey?: string, content?: string) {
    if (storageKey) return resolveImageSourceUrl(storageKey, content || "");
    return content;
}

export async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const meta = node.metadata;
            if (!meta) return node;
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && meta.storageKey) {
                return { ...node, metadata: { ...meta, content: await resolveMediaUrl(meta.storageKey, meta.content) } };
            }
            if (node.type !== CanvasNodeType.Image) return node;
            const images = await Promise.all((meta.images || []).map(async (image) => (image.storageKey || image.content ? { ...image, content: await resolveImageSourceUrl(image.storageKey, image.content) } : image)));
            const [content, localEditOriginalContent, localEditProcessedContent, localEditCroppedContent, outpaintWorkContent, outpaintPreviewContent] = await Promise.all([
                hydrateKeyedImage(meta.storageKey, meta.content),
                hydrateKeyedImage(meta.localEditOriginalStorageKey, meta.localEditOriginalContent),
                hydrateKeyedImage(meta.localEditProcessedStorageKey, meta.localEditProcessedContent),
                hydrateKeyedImage(meta.localEditCroppedStorageKey, meta.localEditCroppedContent),
                hydrateKeyedImage(meta.outpaintWorkStorageKey, meta.outpaintWorkContent),
                hydrateKeyedImage(meta.outpaintPreviewStorageKey, meta.outpaintPreviewContent),
            ]);
            const nextMeta = {
                ...meta,
                content,
                images,
                localEditOriginalContent,
                localEditProcessedContent,
                localEditCroppedContent,
                outpaintWorkContent,
                outpaintPreviewContent,
            };
            if (content?.startsWith("data:image/") && !meta.storageKey) return { ...node, metadata: { ...nextMeta, ...imageMetadata(await uploadImage(content)) } };
            return { ...node, metadata: nextMeta };
        }),
    );
}

export async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text" || (input.type === "folder" && input.text?.trim())).length,
        imageCount: inputs.filter((input) => input.type === "image").length,
        videoCount: inputs.filter((input) => input.type === "video").length,
        audioCount: inputs.filter((input) => input.type === "audio").length,
    };
}

export function getImageSettingsReferenceOptions(inputs: NodeGenerationInput[]): ImageSettingsReferenceOption[] {
    return inputs
        .filter((input): input is NodeGenerationInput & { image: NonNullable<NodeGenerationInput["image"]> } => input.type === "image" && Boolean(input.image))
        .map((input, index) => ({
            id: input.image.id,
            label: input.title || imageReferenceLabel(index),
            thumbUrl: input.image.dataUrl || input.image.url,
        }));
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    const localEditSize = node?.metadata?.localEditPreprocess
        ? node.metadata.localEditChosenRatio || (typeof node.metadata.modelParams?.aspectRatio === "string" ? node.metadata.modelParams.aspectRatio : undefined) || node.metadata.size
        : undefined;
    const localEditQuality = node?.metadata?.localEditPreprocess ? node.metadata.quality || LOCAL_EDIT_DEFAULT_RESOLUTION : undefined;
    return {
        ...config,
        model: resolveModelForCapability(config, node?.metadata?.model, mode),
        reasoningEffort: node?.metadata?.reasoningEffort || config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: localEditQuality || node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: localEditSize || node?.metadata?.size || config.size || defaultConfig.size,
        background: node?.metadata?.background ?? config.background ?? defaultConfig.background,
        modelParams: node?.metadata?.modelParams || config.modelParams || defaultConfig.modelParams,
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        videoRealPersonMode: node?.metadata?.realPersonMode || config.videoRealPersonMode || defaultConfig.videoRealPersonMode,
        videoReferenceMode: node?.metadata?.videoReferenceMode || config.videoReferenceMode,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        audioEmotion: node?.metadata?.audioEmotion || config.audioEmotion || defaultConfig.audioEmotion,
        audioTitle: node?.metadata?.audioTitle || config.audioTitle || defaultConfig.audioTitle,
        audioInstrumental: node?.metadata?.audioInstrumental || config.audioInstrumental || defaultConfig.audioInstrumental,
        audioTags: node?.metadata?.audioTags || config.audioTags || defaultConfig.audioTags,
        audioLyrics: node?.metadata?.audioLyrics || config.audioLyrics || defaultConfig.audioLyrics,
        audioStyle: node?.metadata?.audioStyle || config.audioStyle || defaultConfig.audioStyle,
        audioCloneModel: node?.metadata?.audioCloneModel || config.audioCloneModel || defaultConfig.audioCloneModel,
        audioNoiseReduction: node?.metadata?.audioNoiseReduction || config.audioNoiseReduction || defaultConfig.audioNoiseReduction,
        audioVolumeNormalization: node?.metadata?.audioVolumeNormalization || config.audioVolumeNormalization || defaultConfig.audioVolumeNormalization,
        // count 仅表示生图张数；文本/视频/音频不要沿用配置节点上残留的生图 count
        count: String(mode === "image" ? node?.metadata?.count || config.canvasImageCount || config.count || defaultConfig.count : "1"),
    };
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) =>
        node.metadata?.status === "loading"
            ? {
                  ...node,
                  metadata: {
                      ...node.metadata,
                      status: "error" as const,
                      errorDetails: i18n.t("canvas.generation.interrupted"),
                      images: node.metadata.images?.map((image) => (image.status === "loading" ? { ...image, status: "error" as const, errorDetails: i18n.t("canvas.generation.interrupted") } : image)),
                  },
              }
            : node,
    );
}

/** 复制/粘贴节点时剥离「运行中」瞬态，避免副本一直显示停止按钮或生成中。 */
export function sanitizeNodeMetadataForClone(metadata?: CanvasNodeMetadata): CanvasNodeMetadata | undefined {
    if (!metadata) return undefined;
    const next: CanvasNodeMetadata = { ...metadata };
    if (next.rhPlaceholderId) next.rhPlaceholderId = "";
    if (next.codexPhase === "running" || next.codexPhase === "queued") next.codexPhase = "idle";
    if (next.status === "loading") {
        next.status = "idle";
        next.errorDetails = "";
    }
    if (next.images?.some((image) => image.status === "loading")) {
        next.images = next.images.map((image) => (image.status === "loading" ? { ...image, status: "idle" as const, errorDetails: "" } : image));
    }
    return next;
}

export function cloneCanvasNodeData(node: CanvasNodeData, patch: Partial<CanvasNodeData> = {}): CanvasNodeData {
    const metadata = sanitizeNodeMetadataForClone({ ...node.metadata, ...patch.metadata });
    return {
        ...node,
        ...patch,
        position: patch.position ? { ...patch.position } : { ...node.position },
        metadata,
    };
}

export function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === i18n.t("common.requestCanceled") || error.message === i18n.t("apiErrors.requestCanceled") || error.name === "AbortError");
}

export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || (!node.metadata?.content && !node.metadata?.storageKey)) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content || "",
            storageKey: node.metadata.storageKey,
        },
    ];
}

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name);
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? i18n.t("canvas.generation.front") : params.horizontalAngle > 0 ? i18n.t("canvas.generation.rotateRight", { angle: params.horizontalAngle }) : i18n.t("canvas.generation.rotateLeft", { angle: Math.abs(params.horizontalAngle) });
    const pitch = params.pitchAngle === 0 ? i18n.t("canvas.generation.level") : params.pitchAngle > 0 ? i18n.t("canvas.generation.topDown", { angle: params.pitchAngle }) : i18n.t("canvas.generation.lowAngle", { angle: Math.abs(params.pitchAngle) });
    return i18n.t("canvas.generation.angleLabel", { horizontal, pitch, distance: params.cameraDistance.toFixed(1), lens: i18n.t(params.wideAngle ? "canvas.editors.wide" : "canvas.editors.standard") });
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return i18n.t("canvas.generation.anglePrompt", { angle: buildAngleLabel(params) });
}
