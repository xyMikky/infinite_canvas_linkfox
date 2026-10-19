import type { AiTextMessage } from "@/services/api/image";
import i18n from "@/i18n";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { resolveGroupBundleText } from "@/lib/canvas/canvas-group-bundle";
import { getGenerationResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { peekResolvedImageUrl, persistableImageUrl } from "@/services/image-storage";
import { folderComposerContextText, folderInputSummary, getSmartPreviewComposerText, getSmartPreviewSelectedSheetText, resolveFolderSourceNode } from "@/lib/canvas/folder-input-resolve";

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

export type NodeGenerationInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio" | "skill" | "folder";
    title: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
    skill?: { name: string; path: string; displayName?: string; enabled?: boolean };
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string): NodeGenerationContext {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections);
    const sourceNode = nodes.find((node) => node.id === nodeId);
    if (sourceNode?.type === CanvasNodeType.Config && Boolean(sourceNode.metadata?.composerContent?.trim())) {
        return buildComposerGenerationContext(inputs, prompt);
    }

    // 多文本按连线顺序拼成一段；文件夹等其它带 text 的输入同样按该顺序追加
    const upstreamText = composeOrderedTextInputs(inputs);
    const referenceImages = inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = inputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = inputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: [prompt.trim(), upstreamText].filter(Boolean).join("\n\n"),
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

export function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string): NodeGenerationContext {
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
    const labelByNodeId = new Map<string, string>();
    const counts = { image: 0, video: 0, audio: 0, text: 0, skill: 0, folder: 0 };
    let lastIndex = 0;
    let nextPrompt = "";

    // @ 只负责把芯片换成可读标签；资源始终加载全部上游连线，不因是否 @ 而筛选
    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        nextPrompt += prompt.slice(lastIndex, match.index);
        const input = inputByNodeId.get(match[1]);
        if (input && input.type !== "text") {
            let label = labelByNodeId.get(input.nodeId);
            if (!label) {
                label = generationLabel(input.type, counts[input.type]++);
                labelByNodeId.set(input.nodeId, label);
            }
            // 文本节点最终按连线顺序拼成一段正文，@ 处不再插入【文本N】占位
            nextPrompt += input.type === "folder" ? `【${label}】` : label;
        }
        lastIndex = match.index + match[0].length;
    }
    nextPrompt += prompt.slice(lastIndex);

    // 多文本：按上传/连线顺序组成一段文本；文件夹仍保留可读标签块（Excel 等）
    const composedTexts = composeOrderedTextInputs(inputs.filter((input) => input.type === "text"));
    const folderBlocks = inputs
        .filter((input) => input.type === "folder")
        .map((input) => {
            const label = labelByNodeId.get(input.nodeId) || generationLabel(input.type, counts[input.type]++);
            labelByNodeId.set(input.nodeId, label);
            return `【${label}】\n${input.text || input.title}`;
        })
        .filter((block) => block.trim());
    const appended = [composedTexts, ...folderBlocks].filter(Boolean).join("\n\n");
    if (appended) nextPrompt = `${nextPrompt.trim()}\n\n${appended}`;

    const referenceImages = inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = inputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = inputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: nextPrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    const localTargetId = nodes.find(node => node.id === nodeId)?.metadata?.videoLocalEditTargetId;
    return getGenerationResourceNodes(nodeId, nodes, connections).flatMap((node): NodeGenerationInput[] => {
        const image = readReferenceImage(node);
        if (image) return [{ nodeId: node.id, type: "image" as const, title: node.title, image }];
        const video = readReferenceVideo(node, node.id === localTargetId);
        if (video) return [{ nodeId: node.id, type: "video" as const, title: node.id === localTargetId ? `${node.title} · 局部预处理` : node.title, video }];
        const audio = readReferenceAudio(node);
        if (audio) return [{ nodeId: node.id, type: "audio" as const, title: node.title, audio }];
        // 智能预览已选 Excel 工作表：只输入该表正文
        const selectedSheet = getSmartPreviewSelectedSheetText(node);
        if (selectedSheet) {
            return [{ nodeId: node.id, type: "text" as const, title: node.title, text: selectedSheet }];
        }
        // 已打开具体文本/Markdown 等预览时，用预览正文作提示词（优先于上游文件夹摘要）
        const previewText = getSmartPreviewComposerText(node);
        if (previewText) {
            return [{ nodeId: node.id, type: "text" as const, title: node.title, text: previewText }];
        }
        // 未选具体文件时透传上游项目文件夹摘要
        const folder = resolveFolderSourceNode(node, nodes, connections);
        if (folder) {
            const summary = folderInputSummary(folder);
            return [{ nodeId: node.id, type: "folder" as const, title: summary.folderName, text: folderComposerContextText(folder) }];
        }
        const text = readNodeTextInput(node, nodes);
        if (text) return [{ nodeId: node.id, type: "text" as const, title: node.title, text: text }];
        return [];
    });
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    const { prepareReferenceVideo } = await import("@/lib/canvas/video-clip");
    const { prepareReferenceAudio } = await import("@/lib/canvas/audio-clip");
    return {
        ...context,
        referenceImages: await Promise.all(context.referenceImages.map(async (image) => {
            const dataUrl = await imageToDataUrl(image);
            if (!dataUrl) throw new Error(`${image.name || image.id}：${i18n.t("common.imageReadFailed")}`);
            return { ...image, dataUrl };
        })),
        referenceVideos: await Promise.all(context.referenceVideos.map((video) => prepareReferenceVideo(video))),
        referenceAudios: await Promise.all(context.referenceAudios.map((audio) => prepareReferenceAudio(audio))),
    };
}

function readNodeTextInput(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    if (node.type === CanvasNodeType.Group) return resolveGroupBundleText(node, nodes);
    if (node.type === CanvasNodeType.Text) return readTextNodeContent(node);
    return node.metadata?.prompt || "";
}

/** Excel 优先用各工作表 content（父节点 content 可能被总长截断丢掉后面的表） */
function readTextNodeContent(node: CanvasNodeData) {
    const sheets = node.metadata?.excelSheets;
    if (node.metadata?.documentKind === "excel" && sheets?.length) {
        const fromSheets = sheets
            .map((sheet) => {
                const body = sheet.content?.trim();
                if (!body) return "";
                return sheets.length > 1 ? `[${sheet.name}]\n${body}` : body;
            })
            .filter(Boolean)
            .join("\n\n");
        if (fromSheets) return fromSheets;
    }
    return node.metadata?.content || node.metadata?.prompt || "";
}

/** 按连线/上传顺序把文本类输入拼成一段正文 */
function composeOrderedTextInputs(inputs: NodeGenerationInput[]) {
    return inputs
        .filter((input) => input.type === "text" || input.type === "folder")
        .map((input) => (input.text || "").trim())
        .filter(Boolean)
        .join("\n\n");
}

function generationLabel(type: NodeGenerationInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return seedanceReferenceLabel("video", index);
    if (type === "audio") return seedanceReferenceLabel("audio", index);
    if (type === "skill") return i18n.t("canvas.composer.resources.skill", { index: index + 1 });
    if (type === "folder") return i18n.t("canvas.composer.resources.folder", { index: index + 1 });
    return i18n.t("canvas.composer.resources.text", { index: index + 1 });
}

export function pickMentionedSkill(prompt: string, inputs: NodeGenerationInput[]) {
    return pickMentionedSkills(prompt, inputs)[0] || null;
}

export function pickMentionedSkills(prompt: string, inputs: NodeGenerationInput[]) {
    const skills: Array<{ name: string; path: string }> = [];
    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        const input = inputs.find((item) => item.nodeId === match[1] && item.type === "skill" && item.skill);
        if (!input?.skill) continue;
        if (skills.some((item) => item.name === input.skill!.name && item.path === input.skill!.path)) continue;
        skills.push({ name: input.skill.name, path: input.skill.path });
    }
    return skills;
}

function liveImageSrc(storageKey?: string, content?: string) {
    return peekResolvedImageUrl(storageKey) || persistableImageUrl(content);
}

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    if (node.type !== CanvasNodeType.Image || !node.metadata?.content) return null;
    // 即使地址尚未恢复，也按裁剪存储键读取；缺失时明确失败，不能改传整图。
    if (node.metadata.localEditPreprocess) {
        const storageKey = node.metadata.localEditCroppedStorageKey;
        const dataUrl = liveImageSrc(storageKey, node.metadata.localEditCroppedContent);
        return {
            id: node.id,
            name: `${node.title || node.id}-crop.png`,
            type: "image/png",
            dataUrl: dataUrl || "",
            storageKey,
        };
    }
    if (node.metadata.outpaintPreprocess && (node.metadata.outpaintWorkContent || node.metadata.outpaintWorkStorageKey)) {
        const storageKey = node.metadata.outpaintWorkStorageKey;
        const dataUrl = liveImageSrc(storageKey, node.metadata.outpaintWorkContent) || persistableImageUrl(node.metadata.outpaintWorkContent);
        return {
            id: node.id,
            name: `${node.title || node.id}-outpaint.png`,
            type: "image/png",
            dataUrl: dataUrl || "",
            storageKey,
        };
    }
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: liveImageSrc(node.metadata.storageKey, node.metadata.content) || persistableImageUrl(node.metadata.content) || node.metadata.content,
        storageKey: node.metadata.storageKey,
    };
}

function readReferenceVideo(node: CanvasNodeData, localEdit = false): ReferenceVideo | null {
    if (node.type !== CanvasNodeType.Video || !node.metadata?.content) return null;
    const plan = localEdit ? node.metadata.videoLocalEdit : undefined;
    if (plan) return {
        id: node.id, name: `${node.title || node.id}-局部预处理.mp4`, type: "video/mp4",
        url: plan.inputUrl || "", storageKey: plan.inputStorageKey,
        width: plan.inputWidth, height: plan.inputHeight, durationMs: plan.range.generationSeconds * 1000, includeAudio: false,
    };
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.metadata.mimeType || "video/mp4",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        width: node.metadata.naturalWidth,
        height: node.metadata.naturalHeight,
        durationMs: node.metadata.durationMs,
        clipStartMs: node.metadata.clipStartMs,
        clipEndMs: node.metadata.clipEndMs,
        includeAudio: node.metadata.includeAudio,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    if (node.type !== CanvasNodeType.Audio || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: node.metadata.mimeType || "audio/mpeg",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        durationMs: node.metadata.durationMs,
        clipStartMs: node.metadata.clipStartMs,
        clipEndMs: node.metadata.clipEndMs,
    };
}
