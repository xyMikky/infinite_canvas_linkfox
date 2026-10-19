import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import type { PromptAssetGeneration, PromptAssetMedia } from "@/services/api/prompt-source-runtime";
import { defaultConfig, resolveModelForCapability, type AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData, type Position } from "@/types/canvas";

export type PromptAssetDraft = {
    groupId?: string;
    prompt: string;
    media: PromptAssetMedia[];
    generation?: PromptAssetGeneration;
};

const NODE_MENTION = /@\[node:([^\]]+)\]/g;
const MEDIA_KIND: Partial<Record<string, PromptAssetMedia["kind"]>> = {
    [CanvasNodeType.Image]: "image",
    [CanvasNodeType.Video]: "video",
    [CanvasNodeType.Audio]: "audio",
};
const STACK_GAP = 48;
const WORKBENCH_GAP = 96;

function nodePrompt(node: CanvasNodeData) {
    return (node.metadata?.composerContent?.trim() || node.metadata?.prompt || "").trim();
}

function generationModeOf(node: CanvasNodeData): CanvasGenerationMode {
    if (node.type === CanvasNodeType.Config) return node.metadata?.generationMode || "image";
    if (node.type === CanvasNodeType.Video) return "video";
    if (node.type === CanvasNodeType.Audio) return "audio";
    if (node.type === CanvasNodeType.Text) return "text";
    return "image";
}

function pickConfigNode(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const ids = new Set(nodes.map((node) => node.id));
    const configs = nodes.filter((node) => node.type === CanvasNodeType.Config);
    if (!configs.length) return;
    const withPrompt = configs.filter((node) => nodePrompt(node));
    const candidates = withPrompt.length ? withPrompt : configs;
    return candidates.find((node) => connections.some((connection) => ids.has(connection.fromNodeId) && connection.toNodeId === node.id)) || candidates[0];
}

function inputMentionLabels(nodes: CanvasNodeData[], outputIds: Set<string>) {
    const labels = new Map<string, string>();
    const counts = { image: 0, video: 0, audio: 0 };
    for (const node of nodes) {
        if (outputIds.has(node.id)) continue;
        if (node.type === CanvasNodeType.Image) labels.set(node.id, imageReferenceLabel(counts.image++));
        else if (node.type === CanvasNodeType.Video) labels.set(node.id, seedanceReferenceLabel("video", counts.video++));
        else if (node.type === CanvasNodeType.Audio) labels.set(node.id, seedanceReferenceLabel("audio", counts.audio++));
    }
    return labels;
}

function mentionPromptToLabels(prompt: string, labels: Map<string, string>) {
    if (!prompt.includes("@[node:")) return prompt;
    return prompt.replace(NODE_MENTION, (_, id: string) => labels.get(id) || "").replace(/[ \t]+\n/g, "\n").trim();
}

function snapshotSource(nodes: CanvasNodeData[], outputIds: Set<string>, configNode?: CanvasNodeData) {
    if (configNode) return configNode;
    const rest = nodes.filter((node) => !outputIds.has(node.id) && node.type !== CanvasNodeType.Config);
    return rest.find((node) => node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) || rest.find((node) => node.type === CanvasNodeType.Text) || rest[0];
}

function snapshotGeneration(node: CanvasNodeData | undefined, config: AiConfig): PromptAssetGeneration | undefined {
    if (!node || !config) return;
    const mode = generationModeOf(node);
    const merged = {
        ...config,
        model: resolveModelForCapability(config, node.metadata?.model, mode),
        reasoningEffort: node.metadata?.reasoningEffort || config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node.metadata?.quality || config.quality || defaultConfig.quality,
        size: node.metadata?.size || config.size || defaultConfig.size,
        background: node.metadata?.background ?? config.background ?? defaultConfig.background,
        modelParams: node.metadata?.modelParams || config.modelParams || defaultConfig.modelParams,
        videoSeconds: node.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        videoRealPersonMode: node.metadata?.realPersonMode || config.videoRealPersonMode || defaultConfig.videoRealPersonMode,
        videoReferenceMode: node.metadata?.videoReferenceMode || config.videoReferenceMode,
        audioVoice: node.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        audioEmotion: node.metadata?.audioEmotion || config.audioEmotion || defaultConfig.audioEmotion,
        audioTitle: node.metadata?.audioTitle || config.audioTitle || defaultConfig.audioTitle,
        audioInstrumental: node.metadata?.audioInstrumental || config.audioInstrumental || defaultConfig.audioInstrumental,
        audioTags: node.metadata?.audioTags || config.audioTags || defaultConfig.audioTags,
        audioLyrics: node.metadata?.audioLyrics || config.audioLyrics || defaultConfig.audioLyrics,
        audioStyle: node.metadata?.audioStyle || config.audioStyle || defaultConfig.audioStyle,
        audioCloneModel: node.metadata?.audioCloneModel || config.audioCloneModel || defaultConfig.audioCloneModel,
        audioNoiseReduction: node.metadata?.audioNoiseReduction || config.audioNoiseReduction || defaultConfig.audioNoiseReduction,
        audioVolumeNormalization: node.metadata?.audioVolumeNormalization || config.audioVolumeNormalization || defaultConfig.audioVolumeNormalization,
        count: String(mode === "image" ? node.metadata?.count || config.canvasImageCount || config.count || defaultConfig.count : "1"),
    };
    const snapshot: PromptAssetGeneration = { generationMode: mode, model: merged.model };
    if (mode === "image") {
        snapshot.size = merged.size;
        snapshot.quality = merged.quality;
        snapshot.background = merged.background;
        snapshot.reasoningEffort = merged.reasoningEffort;
        const count = Number(merged.count);
        if (count > 0) snapshot.count = count;
    }
    if (mode === "video") {
        snapshot.size = merged.size;
        snapshot.seconds = merged.videoSeconds;
        snapshot.vquality = merged.vquality;
        snapshot.generateAudio = merged.videoGenerateAudio;
        snapshot.watermark = merged.videoWatermark;
        snapshot.realPersonMode = merged.videoRealPersonMode;
        snapshot.videoReferenceMode = merged.videoReferenceMode;
    }
    if (mode === "audio") {
        snapshot.audioVoice = merged.audioVoice;
        snapshot.audioFormat = merged.audioFormat;
        snapshot.audioSpeed = merged.audioSpeed;
        snapshot.audioInstructions = merged.audioInstructions;
        snapshot.audioEmotion = merged.audioEmotion;
        snapshot.audioTitle = merged.audioTitle;
        snapshot.audioInstrumental = merged.audioInstrumental;
        snapshot.audioTags = merged.audioTags;
        snapshot.audioLyrics = merged.audioLyrics;
        snapshot.audioStyle = merged.audioStyle;
        snapshot.audioCloneModel = merged.audioCloneModel;
        snapshot.audioNoiseReduction = merged.audioNoiseReduction;
        snapshot.audioVolumeNormalization = merged.audioVolumeNormalization;
    }
    if (merged.modelParams && Object.keys(merged.modelParams).length) snapshot.modelParams = { ...merged.modelParams };
    return snapshot.model ? snapshot : undefined;
}

export function previewPromptAssetFromNodes(nodes: CanvasNodeData[], connections: CanvasConnection[], config: AiConfig): PromptAssetDraft | null {
    const ids = new Set(nodes.map((node) => node.id));
    const outputIds = new Set(connections.filter((connection) => ids.has(connection.fromNodeId) && ids.has(connection.toNodeId)).map((connection) => connection.toNodeId));
    const configNode = pickConfigNode(nodes, connections);
    const workbenchPrompt = configNode ? mentionPromptToLabels(nodePrompt(configNode), inputMentionLabels(nodes, outputIds)) : "";
    const prompts: string[] = [];
    const media: PromptAssetMedia[] = [];
    const pushPrompt = (value: string) => {
        const text = value.trim();
        if (text && !prompts.includes(text)) prompts.push(text);
    };
    if (workbenchPrompt) pushPrompt(workbenchPrompt);
    for (const node of nodes) {
        if (node.type === CanvasNodeType.Config) continue;
        const role: PromptAssetMedia["role"] = outputIds.has(node.id) ? "output" : "input";
        const content = node.metadata?.content || "";
        if (node.type === CanvasNodeType.Text) {
            if (role === "input" && !workbenchPrompt) pushPrompt(content);
            else if (role === "output" && content.trim()) media.push({ role, kind: "text", text: content.trim() });
            continue;
        }
        const kind = MEDIA_KIND[node.type];
        if (!kind || !content) continue;
        if (role === "input" && !workbenchPrompt) pushPrompt(nodePrompt(node));
        media.push({
            role,
            kind,
            url: content,
            width: node.metadata?.naturalWidth || node.width,
            height: node.metadata?.naturalHeight || node.height,
            mimeType: node.metadata?.mimeType,
        });
    }
    const prompt = prompts.join("\n");
    if (!prompt && !media.length) return null;
    return { prompt, media, generation: snapshotGeneration(snapshotSource(nodes, outputIds, configNode), config) };
}

function persistItem(item: PromptAssetMedia, extra: Partial<PromptAssetMedia> = {}): PromptAssetMedia {
    return { role: item.role, kind: item.kind, ...(item.cover ? { cover: true } : {}), ...extra };
}

export async function persistPromptAssetMedia(media: PromptAssetMedia[]) {
    const next: PromptAssetMedia[] = [];
    for (const item of media) {
        if (item.kind === "text") {
            if (item.text?.trim()) next.push(persistItem(item, { text: item.text.trim() }));
            continue;
        }
        if (item.storageKey) {
            next.push(persistItem(item, { storageKey: item.storageKey, url: item.url, width: item.width, height: item.height, mimeType: item.mimeType }));
            continue;
        }
        if (!item.url) continue;
        if (item.kind === "image") {
            const uploaded = await uploadImage(item.url);
            next.push(persistItem(item, { storageKey: uploaded.storageKey, url: uploaded.url, width: uploaded.width, height: uploaded.height, mimeType: uploaded.mimeType }));
        } else {
            const uploaded = await uploadMediaFile(item.url, item.kind);
            next.push(persistItem(item, { storageKey: uploaded.storageKey, url: uploaded.url, width: uploaded.width, height: uploaded.height, mimeType: uploaded.mimeType }));
        }
    }
    return next;
}

function generationMetadata(generation?: PromptAssetGeneration) {
    if (!generation) return {};
    const metadata: PromptAssetGeneration = {};
    if (generation.generationMode) metadata.generationMode = generation.generationMode;
    if (generation.model) metadata.model = generation.model;
    if (generation.size) metadata.size = generation.size;
    if (generation.quality) metadata.quality = generation.quality;
    if (generation.count) metadata.count = generation.count;
    if (generation.background) metadata.background = generation.background;
    if (generation.reasoningEffort) metadata.reasoningEffort = generation.reasoningEffort;
    if (generation.modelParams) metadata.modelParams = { ...generation.modelParams };
    if (generation.seconds) metadata.seconds = generation.seconds;
    if (generation.vquality) metadata.vquality = generation.vquality;
    if (generation.generateAudio) metadata.generateAudio = generation.generateAudio;
    if (generation.watermark) metadata.watermark = generation.watermark;
    if (generation.realPersonMode) metadata.realPersonMode = generation.realPersonMode;
    if (generation.videoReferenceMode) metadata.videoReferenceMode = generation.videoReferenceMode;
    if (generation.audioVoice) metadata.audioVoice = generation.audioVoice;
    if (generation.audioFormat) metadata.audioFormat = generation.audioFormat;
    if (generation.audioSpeed) metadata.audioSpeed = generation.audioSpeed;
    if (generation.audioInstructions) metadata.audioInstructions = generation.audioInstructions;
    if (generation.audioEmotion) metadata.audioEmotion = generation.audioEmotion;
    if (generation.audioTitle) metadata.audioTitle = generation.audioTitle;
    if (generation.audioInstrumental) metadata.audioInstrumental = generation.audioInstrumental;
    if (generation.audioTags) metadata.audioTags = generation.audioTags;
    if (generation.audioLyrics) metadata.audioLyrics = generation.audioLyrics;
    if (generation.audioStyle) metadata.audioStyle = generation.audioStyle;
    if (generation.audioCloneModel) metadata.audioCloneModel = generation.audioCloneModel;
    if (generation.audioNoiseReduction) metadata.audioNoiseReduction = generation.audioNoiseReduction;
    if (generation.audioVolumeNormalization) metadata.audioVolumeNormalization = generation.audioVolumeNormalization;
    return metadata;
}

function mediaToNode(item: PromptAssetMedia): CanvasNodeData | null {
    const id = `${item.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (item.kind === "text") {
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
        return item.text?.trim() ? { id, type: CanvasNodeType.Text, title: spec.title, position: { x: 0, y: 0 }, width: spec.width, height: spec.height, metadata: { content: item.text, status: "success", fontSize: 14 } } : null;
    }
    if (!item.url) return null;
    if (item.kind === "image") {
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const size = fitNodeSize(item.width || spec.width, item.height || spec.height);
        return { id, type: CanvasNodeType.Image, title: spec.title, position: { x: 0, y: 0 }, width: size.width, height: size.height, metadata: { content: item.url, storageKey: item.storageKey, status: "success", naturalWidth: item.width, naturalHeight: item.height, mimeType: item.mimeType } };
    }
    if (item.kind === "video") {
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
        const size = fitNodeSize(item.width || spec.width, item.height || spec.height, 420, 640);
        return { id, type: CanvasNodeType.Video, title: spec.title, position: { x: 0, y: 0 }, width: size.width, height: size.height, metadata: { content: item.url, storageKey: item.storageKey, status: "success", naturalWidth: item.width, naturalHeight: item.height, mimeType: item.mimeType } };
    }
    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
    return { id, type: CanvasNodeType.Audio, title: spec.title, position: { x: 0, y: 0 }, width: spec.width, height: spec.height, metadata: { content: item.url, storageKey: item.storageKey, status: "success", mimeType: item.mimeType } };
}

function stackNodes(nodes: CanvasNodeData[], x: number, centerY: number) {
    const total = nodes.reduce((sum, node) => sum + node.height, 0) + STACK_GAP * Math.max(0, nodes.length - 1);
    let y = centerY - total / 2;
    for (const node of nodes) {
        node.position = { x: x - node.width / 2, y };
        y += node.height + STACK_GAP;
    }
}

function labelsToMentions(prompt: string, nodes: CanvasNodeData[]) {
    const items: Array<{ label: string; id: string }> = [];
    const counts = { image: 0, video: 0, audio: 0 };
    for (const node of nodes) {
        if (node.type === CanvasNodeType.Image) items.push({ label: imageReferenceLabel(counts.image++), id: node.id });
        else if (node.type === CanvasNodeType.Video) items.push({ label: seedanceReferenceLabel("video", counts.video++), id: node.id });
        else if (node.type === CanvasNodeType.Audio) items.push({ label: seedanceReferenceLabel("audio", counts.audio++), id: node.id });
    }
    items.sort((a, b) => b.label.length - a.label.length);
    let next = prompt;
    for (const item of items) next = next.split(item.label).join(`@[node:${item.id}]`);
    return next;
}

export function buildPromptAssetCanvasNodes(payload: { prompt: string; bundle: PromptAssetMedia[]; generation?: PromptAssetGeneration }, center: Position) {
    const nodes = payload.bundle.filter((item) => item.role !== "output").map(mediaToNode).filter((node): node is CanvasNodeData => Boolean(node));
    const prompt = payload.prompt.trim();
    const generation = generationMetadata(payload.generation);
    if (!(prompt || Object.keys(generation).length)) {
        stackNodes(nodes, center.x, center.y);
        return { nodes, connections: [] as CanvasConnection[] };
    }
    const mentioned = labelsToMentions(prompt, nodes);
    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
    const inputWidth = nodes.length ? Math.max(...nodes.map((node) => node.width)) : 0;
    const totalWidth = (nodes.length ? inputWidth + WORKBENCH_GAP : 0) + spec.width;
    const left = center.x - totalWidth / 2;
    if (nodes.length) stackNodes(nodes, left + inputWidth / 2, center.y);
    const configX = left + (nodes.length ? inputWidth + WORKBENCH_GAP : 0) + spec.width / 2;
    const configNode: CanvasNodeData = {
        id: `config-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: CanvasNodeType.Config,
        title: spec.title,
        position: { x: configX - spec.width / 2, y: center.y - spec.height / 2 },
        width: spec.width,
        height: spec.height,
        metadata: { content: "", status: "idle", generationMode: payload.generation?.generationMode || "image", ...generation, prompt: mentioned, composerContent: mentioned },
    };
    return {
        nodes: [...nodes, configNode],
        connections: nodes.map((node, index) => ({ id: `conn-${Date.now()}-${index}`, fromNodeId: node.id, toNodeId: configNode.id })),
    };
}
